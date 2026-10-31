// Gêmeo digital pelo banco do artefato (faz papel do servidor da fábrica).
// Coleta por escaneamento: cada posto escaneia a peça uma vez quando ela sai; o ciclo do posto é o
// intervalo entre scans seguidos, descartando o que fica fora de média ± 2 desvios.
// Fontes: a linha virtual (servidor de teste, roda em segundo plano), a linha física (o canvas de outra
// janela ou computador) ou, no futuro, a API dos postos. O Monitoramento real só espelha: não simula nada.

import { useEffect, useRef } from 'react';
import { scansToEvents, stationsFromScans, type ScanRead } from '../engine/scans';
import { Rng } from '../engine/rng';
import { Simulator } from '../engine/simulator';
import type { Model } from '../engine/types';
import type { AndonStop } from '../engine/twinKpi';
import { useStore } from '../store';
import { loadRealEvents } from './realLoad';
import { fmt, fmtTime } from './theme';

interface Snap {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface Db {
  collection(path: string): { get(): Promise<{ docs: { id: string; data(): Record<string, unknown> | undefined }[] }> };
  doc(path: string): {
    set(d: Record<string, unknown>): Promise<void>;
    get(): Promise<Snap>;
    onSnapshot(next: (s: Snap) => void, err?: (e: unknown) => void): () => void;
  };
}
/**
 * Banco local (arquivo offline ou sem o banco do artefato): guarda no navegador e avisa as outras abas
 * do mesmo computador. Assim a linha virtual, o gêmeo, o histórico e o andon funcionam também offline.
 */
const LS_DB = 'sim2d.db.';
const localDb = (): Db => {
  const subs = new Map<string, Set<(s: Snap) => void>>();
  const snap = (p: string): Snap => {
    let v: string | null = null;
    try {
      v = localStorage.getItem(LS_DB + p);
    } catch {
      v = null;
    }
    return { exists: !!v, data: () => (v ? (JSON.parse(v) as Record<string, unknown>) : undefined) };
  };
  const fire = (p: string) => subs.get(p)?.forEach((f) => f(snap(p)));
  window.addEventListener('storage', (e) => {
    if (e.key?.startsWith(LS_DB)) fire(e.key.slice(LS_DB.length));
  });
  return {
    collection: (c) => ({
      get: async () => {
        const docs: { id: string; data(): Record<string, unknown> | undefined }[] = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith(`${LS_DB}${c}/`)) docs.push({ id: k.slice(LS_DB.length + c.length + 1), data: () => snap(k.slice(LS_DB.length)).data() });
          }
        } catch {
          /* sem armazenamento */
        }
        return { docs };
      },
    }),
    doc: (p) => ({
      set: async (d) => {
        try {
          localStorage.setItem(LS_DB + p, JSON.stringify(d));
        } catch {
          /* navegador cheio: segue sem gravar */
        }
        fire(p);
      },
      get: async () => snap(p),
      onSnapshot: (next) => {
        if (!subs.has(p)) subs.set(p, new Set());
        subs.get(p)!.add(next);
        setTimeout(() => next(snap(p)), 0);
        return () => subs.get(p)?.delete(next);
      },
    }),
  };
};
let local: Db | null = null;
const getDb = async (): Promise<Db | null> => {
  const h = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  const db = h?.use ? ((await h.use('db').catch(() => null)) as Db | null) : null;
  return db ?? (local ??= localDb());
};

export const TWIN_DOCS = { modelo: 'gemeo/modelo', estado: 'gemeo/estado', scans: 'gemeo/scans' };
/** Scans guardados no banco (os mais recentes): cabe folgado no limite de 256 KiB por documento. */
const MAX_SCANS = 5000;
const HIST = 'historico';
const plain = (m: Model): Model => ({ ...m, background: undefined, settings: { ...m.settings, replay: undefined, replayPrev: undefined } });

/** Como retomar a coleta depois (queda de energia, página fechada). */
export interface MonResume {
  kind: 'api' | 'gemeo' | 'virtual';
  url?: string;
  every?: number;
  speed?: number;
}

/** Documentos do histórico no banco (do artefato ou o local do navegador). */
export const histStore = {
  async set(id: string, d: Record<string, unknown>) {
    await (await getDb())?.doc(id).set(d).catch(() => undefined);
  },
  async get(id: string): Promise<Record<string, unknown> | undefined> {
    return (await (await getDb())?.doc(id).get().catch(() => null))?.data();
  },
  async list(col: string): Promise<Record<string, unknown>[]> {
    const db = await getDb();
    return db ? (await db.collection(col).get()).docs.map((d) => d.data()).filter((d): d is Record<string, unknown> => !!d) : [];
  },
};

/** Grava (ou atualiza) uma sessão no histórico: modelo, scans e como retomar. */
export function saveHistory(h: { sessao: string; fonte: string; model: Model; inicio: number; relogio: number; scans: ScanRead[]; retomar?: MonResume }) {
  return histStore.set(`${HIST}/${h.sessao}`, {
    sessao: h.sessao,
    fonte: h.fonte,
    nome: h.model.name,
    inicio: h.inicio,
    em: Date.now(),
    relogio: h.relogio,
    modelo: JSON.stringify(plain(h.model)),
    ...(h.retomar ? { retomar: JSON.stringify(h.retomar) } : {}),
    ...packScans(h.scans),
  });
}

export interface TwinNode {
  state: string;
  fila: number;
  fazendo: number;
  feitas: number;
  /** Ciclo pelo intervalo entre scans (s), já sem os fora do desvio. */
  ciclo?: number;
  /** Intervalos descartados (fora de média ± 2 desvios). */
  fora?: number;
  /** Relógio do último scan do posto (s): a bolinha pisca enquanto chegam scans. */
  ult?: number;
  /** Minutos perdidos nos intervalos fora do desvio (paradas, falta de peça). */
  paradoMin?: number;
}
export interface TwinState {
  sessao: string;
  fonte: string;
  nome: string;
  relogio: number;
  rodando: boolean;
  pecas: number;
  uph: number;
  em: number;
  postos: Record<string, TwinNode>;
}

type Packed = { postos: string[]; s: [number, number, number][] };
export function packScans(scans: ScanRead[]): Packed {
  const postos: string[] = [];
  const idx = new Map<string, number>();
  const s = scans.slice(-MAX_SCANS).map((x): [number, number, number] => {
    if (!idx.has(x.posto)) {
      idx.set(x.posto, postos.length);
      postos.push(x.posto);
    }
    return [idx.get(x.posto)!, Number(x.serie.replace(/\D/g, '')) || 0, Math.round(x.hora * 10) / 10];
  });
  return { postos, s };
}
export function unpackScans(p: Packed): ScanRead[] {
  return p.s.map(([i, n, h]) => ({ posto: p.postos[i] ?? `Posto ${i + 1}`, serie: `SN${String(n).padStart(6, '0')}`, hora: h }));
}

const STATION = (t: string) => t === 'machine' || t === 'inspection' || t === 'rework';

/** Continuação de uma coleta gravada (retomar depois de queda de energia). */
export interface ResumeBase {
  sessao: string;
  inicio: number;
  relogio: number;
  scans: ScanRead[];
}

/** Junta os scans de uma linha e publica o estado e os scans no banco. */
class Emitter {
  scans: ScanRead[] = [];
  sessao = `s${Date.now().toString(36)}`;
  inicio = Date.now();
  dirty = false;
  /** Relógio da coleta anterior (retomada): os scans novos continuam a partir dele. */
  private offset = 0;
  private baseFeitas = new Map<string, number>();
  private n = 0;
  constructor(
    private sim: Simulator,
    private model: Model,
    private fonte: string,
    private retomar?: MonResume,
    base?: ResumeBase,
  ) {
    if (base) {
      this.sessao = base.sessao;
      this.inicio = base.inicio;
      this.offset = base.relogio;
      this.scans = base.scans.slice();
      for (const [k, v] of stationsFromScans(base.scans)) this.baseFeitas.set(k, v.feitas);
      this.dirty = true;
    }
    sim.onCycle = ({ node, serial, end }) => {
      if (!STATION(node.type) || end < sim.t0) return;
      this.scans.push({ posto: node.name, serie: `SN${String(serial).padStart(6, '0')}`, hora: end - sim.t0 + this.offset });
      if (this.scans.length > MAX_SCANS * 1.5) this.scans = this.scans.slice(-MAX_SCANS);
      this.dirty = true;
    };
  }
  async start(): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;
    await db.doc(TWIN_DOCS.modelo).set({ sessao: this.sessao, fonte: this.fonte, json: JSON.stringify(plain(this.model)), em: Date.now() }).catch(() => undefined);
    await db.doc(TWIN_DOCS.scans).set({ sessao: this.sessao, ...packScans(this.scans), em: Date.now() }).catch(() => undefined);
    return true;
  }
  private relogio() {
    return this.offset + Math.max(0, this.sim.now - this.sim.t0);
  }
  /** Estado de cada posto + ciclo pelos scans. */
  state(running: boolean): TwinState {
    const s = this.sim;
    const sc = stationsFromScans(this.scans);
    const lastIds = new Set(this.model.links.filter((l) => this.model.nodes.find((n) => n.id === l.to)?.type === 'sink').map((l) => l.from));
    const postos: Record<string, TwinNode> = {};
    let pecas = 0;
    let basePecas = 0;
    for (const r of s.nodes) {
      if (r.def.type === 'sink') pecas += r.processed;
      if (!STATION(r.def.type)) continue;
      const c = sc.get(r.def.name);
      const base = this.baseFeitas.get(r.def.name) ?? 0;
      if (lastIds.has(r.def.id)) basePecas += base;
      postos[r.def.id] = { state: r.state, fila: r.queue.length, fazendo: r.processing.length, feitas: r.processed + base, ciclo: c?.ciclo, fora: c?.fora ?? 0, ult: c?.ult, paradoMin: c?.paradoMin ?? 0 };
    }
    pecas += basePecas;
    const relogio = this.relogio();
    return { sessao: this.sessao, fonte: this.fonte, nome: this.model.name, relogio, rodando: running, pecas, uph: relogio > 0 ? (pecas * 3600) / relogio : 0, em: Date.now(), postos };
  }
  async publish(running: boolean) {
    const db = await getDb();
    if (!db) return;
    await db.doc(TWIN_DOCS.estado).set({ json: JSON.stringify(this.state(running)), em: Date.now() }).catch(() => undefined);
    if (++this.n % 2 === 0 && this.dirty) {
      this.dirty = false;
      await db.doc(TWIN_DOCS.scans).set({ sessao: this.sessao, ...packScans(this.scans), em: Date.now() }).catch(() => undefined);
      // histórico: cada sessão fica guardada para o estudo e para retomar depois de uma queda
      await saveHistory({ sessao: this.sessao, fonte: this.fonte, model: this.model, inicio: this.inicio, relogio: this.relogio(), scans: this.scans, retomar: this.retomar });
    }
  }
  stop() {
    this.sim.onCycle = undefined;
  }
}

/** Aba da linha física: o canvas desta janela faz papel da linha e transmite enquanto roda. */
export function PhysicalSource() {
  const on = useStore((s) => s.physical);
  const sim = useStore((s) => s.sim);
  const em = useRef<Emitter | null>(null);
  useEffect(() => {
    if (!on) return;
    const e = new Emitter(sim, useStore.getState().model, 'linha física', { kind: 'gemeo' });
    em.current = e;
    void e.start().then((ok) => {
      if (!ok) useStore.getState().setMessage('Linha física: a transmissão só funciona no link online (o banco do artefato leva os scans ao gêmeo).');
    });
    const id = setInterval(() => void e.publish(useStore.getState().run === 'running'), 2000);
    return () => {
      clearInterval(id);
      e.stop();
    };
  }, [on, sim]);
  return null;
}

/**
 * Linha virtual (servidor de teste): roda a linha em segundo plano no relógio de verdade (× velocidade),
 * com a variação do chão de fábrica (cada posto um pouco acima ou abaixo do padrão, paradas curtas),
 * escaneia cada peça em cada posto e publica no banco como faria a API da fábrica.
 */
let virtual: { stop: () => void; speed: number } | null = null;
export const virtualRunning = () => virtual;
export function startVirtualLine(model: Model, speed: number, base?: ResumeBase): Promise<boolean> {
  stopVirtualLine();
  const m: Model = { ...plain(model), settings: { ...model.settings, duration: 7 * 24 * 3600, startFull: true, warmup: 0, study: 'simulacao' } };
  const sim = new Simulator(m);
  const rng = new Rng((m.settings.seed || 1) * 7919 + Date.now() % 997);
  const bias = new Map(m.nodes.map((n) => [n.id, 1 + (rng.next() * 2 - 1) * 0.1]));
  sim.tweak = (node, work) => {
    let w = work * (bias.get(node.id) ?? 1);
    if (rng.next() < 0.03) w += w * (2 + rng.next() * 3); // parada curta: falta de peça, dúvida, retrabalho
    return w;
  };
  const e = new Emitter(sim, model, `linha virtual (servidor de teste, ${speed}×)`, { kind: 'virtual', speed }, base);
  let last = performance.now();
  const tick = setInterval(() => {
    const t = performance.now();
    sim.advanceTo(sim.now + ((t - last) / 1000) * speed);
    last = t;
  }, 500);
  const pub = setInterval(() => void e.publish(true), 2000);
  virtual = {
    speed,
    stop: () => {
      clearInterval(tick);
      clearInterval(pub);
      e.stop();
    },
  };
  return e.start();
}
export function stopVirtualLine() {
  virtual?.stop();
  virtual = null;
}

/** Gêmeo: assina a fonte. Abre o modelo dela, transforma os scans em ciclos e guarda o estado para o canvas. */
export function followTwin(onStatus: (s: string) => void): () => void {
  let stops: (() => void)[] = [];
  let sessao = '';
  let alive = true;
  void getDb().then((db) => {
    if (!alive) return;
    if (!db) {
      onStatus('O gêmeo digital só funciona no link online (lê o banco do artefato).');
      return;
    }
    onStatus('Esperando a linha… Ligue a linha virtual (servidor de teste) ou a 🏭 Linha física em outra janela.');
    stops.push(
      db.doc(TWIN_DOCS.modelo).onSnapshot((s) => {
        const d = s.exists ? s.data() : undefined;
        if (!d?.json || d.sessao === sessao) return;
        sessao = String(d.sessao);
        try {
          const m = JSON.parse(String(d.json)) as Model;
          const st = useStore.getState();
          st.setRun('idle');
          st.setModel({ ...m, settings: { ...m.settings, study: 'monitoramento' } }, `Gêmeo digital ligado a: ${String(d.fonte ?? 'linha')} · "${m.name}". Cada bloco mostra o estado real do posto e o ciclo pelos scans (selo 🏭).`);
          st.setTwin(null);
        } catch {
          onStatus('Modelo da linha ilegível.');
        }
      }),
      db.doc(TWIN_DOCS.scans).onSnapshot((s) => {
        const d = s.exists ? s.data() : undefined;
        if (!d?.s || (sessao && d.sessao !== sessao)) return;
        const ev = scansToEvents(unpackScans(d as unknown as Packed));
        if (ev.length) loadRealEvents(ev, 'gêmeo digital: scans dos postos ao vivo');
      }),
      db.doc(TWIN_DOCS.estado).onSnapshot((s) => {
        const d = s.exists ? s.data() : undefined;
        if (!d?.json) return;
        try {
          const t = JSON.parse(String(d.json)) as TwinState;
          if (sessao && t.sessao !== sessao) return;
          useStore.getState().setTwin(t);
          onStatus(`Recebendo de ${t.fonte}: ${fmtTime(t.relogio)} de turno, ${t.pecas} peças.`);
        } catch {
          /* ignora estado incompleto */
        }
      }),
    );
  });
  return () => {
    alive = false;
    stops.forEach((f) => f());
    stops = [];
    useStore.getState().setTwin(null);
  };
}

/** Faixa do gêmeo sobre o canvas: o que a linha está fazendo agora. */
export function TwinBar() {
  const twin = useStore((s) => s.twin);
  const meta = useStore((s) => s.model.settings.takt);
  if (!twin) return null;
  const delay = Math.max(0, (Date.now() - twin.em) / 1000);
  const ps = Object.values(twin.postos);
  const parados = ps.filter((p) => p.state === 'down' || p.state === 'starved' || p.state === 'blocked').length;
  const fora = ps.reduce((a, p) => a + (p.fora ?? 0), 0);
  return (
    <div className="twin-bar" role="status">
      <b>🏭 Gêmeo digital</b>
      <span>{twin.fonte} · {twin.rodando ? 'rodando' : 'parada'} · {fmtTime(twin.relogio)}</span>
      <span>Real: <b>{twin.pecas}</b> peças · <b>{fmt(twin.uph, 1)}</b> UPH</span>
      {meta > 0 && <span className={twin.uph >= 3600 / meta ? 'good' : 'bad'}>Meta {fmt(3600 / meta, 0)} UPH</span>}
      <span>{parados} postos esperando ou travados</span>
      <span title="Intervalos entre scans fora de média ± 2 desvios (paradas, falta de peça): não entram no ciclo">{fora} scans fora do desvio</span>
      <span className={delay > 10 ? 'bad' : 'muted'}>atraso {fmt(delay, 0)} s</span>
    </div>
  );
}

export interface HistItem {
  sessao: string;
  fonte: string;
  nome: string;
  inicio: number;
  em: number;
  relogio: number;
  scans: number;
  retomar?: MonResume;
}
const parseResume = (v: unknown): MonResume | undefined => {
  try {
    return v ? (JSON.parse(String(v)) as MonResume) : undefined;
  } catch {
    return undefined;
  }
};
/** Sessões gravadas (o que rodou), mais recentes primeiro. */
export async function listHistory(): Promise<HistItem[] | null> {
  const docs = await histStore.list(HIST);
  return docs
    .filter((d) => !!d.sessao)
    .map((d) => ({ sessao: String(d.sessao), fonte: String(d.fonte ?? ''), nome: String(d.nome ?? ''), inicio: Number(d.inicio) || 0, em: Number(d.em) || 0, relogio: Number(d.relogio) || 0, scans: Array.isArray(d.s) ? d.s.length : 0, retomar: parseResume(d.retomar) }))
    .sort((a, b) => b.em - a.em);
}
/** Abre uma sessão gravada: modelo, scans e como retomar. */
export async function loadHistory(sessao: string): Promise<{ model: Model | null; scans: ScanRead[]; inicio: number; relogio: number; retomar?: MonResume } | null> {
  const d = await histStore.get(`${HIST}/${sessao}`);
  if (!d) return null;
  let model: Model | null = null;
  try {
    model = d.modelo ? (JSON.parse(String(d.modelo)) as Model) : null;
  } catch {
    model = null;
  }
  return { model, scans: unpackScans(d as unknown as Packed), inicio: Number(d.inicio) || Date.now(), relogio: Number(d.relogio) || 0, retomar: parseResume(d.retomar) };
}

/** Paradas marcadas no andon de uma sessão. */
export async function loadAndon(sessao: string): Promise<AndonStop[]> {
  const d = await histStore.get(`andon/${sessao}`);
  try {
    return d?.json ? (JSON.parse(String(d.json)) as AndonStop[]) : [];
  } catch {
    return [];
  }
}
export function saveAndon(sessao: string, stops: AndonStop[]) {
  return histStore.set(`andon/${sessao}`, { sessao, json: JSON.stringify(stops), em: Date.now() });
}

/** Ordens para o monitoramento ligado (vindas do painel): atualizar a conexão, zerar o turno ou retomar uma coleta. */
export type TwinCmd = { cmd: 'refresh' } | { cmd: 'reset' } | { cmd: 'resume'; sessao: string };
export const twinCmd = (c: TwinCmd) => window.dispatchEvent(new CustomEvent<TwinCmd>('twin-cmd', { detail: c }));
