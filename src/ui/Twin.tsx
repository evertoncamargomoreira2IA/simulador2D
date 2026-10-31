// Gêmeo digital pelo banco do artefato (faz papel do servidor da fábrica).
// Coleta por escaneamento: cada posto escaneia a peça uma vez quando ela sai; o ciclo do posto é o
// intervalo entre scans seguidos, descartando o que fica fora de média ± 2 desvios.
// Fontes: a linha virtual (servidor de teste, roda em segundo plano), a linha física (o canvas de outra
// janela ou computador) ou, no futuro, a API dos postos. O Monitoramento real só espelha: não simula nada.

import { useEffect, useRef } from 'react';
import { scanCycle, scansToEvents, type ScanRead } from '../engine/scans';
import { Rng } from '../engine/rng';
import { Simulator } from '../engine/simulator';
import type { Model } from '../engine/types';
import { useStore } from '../store';
import { loadRealEvents } from './realLoad';
import { fmt, fmtTime } from './theme';

interface Snap {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface Db {
  doc(path: string): {
    set(d: Record<string, unknown>): Promise<void>;
    get(): Promise<Snap>;
    onSnapshot(next: (s: Snap) => void, err?: (e: unknown) => void): () => void;
  };
}
const getDb = async (): Promise<Db | null> => {
  const h = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  return h?.use ? ((await h.use('db').catch(() => null)) as Db | null) : null;
};

export const TWIN_DOCS = { modelo: 'gemeo/modelo', estado: 'gemeo/estado', scans: 'gemeo/scans' };
/** Scans guardados no banco (os mais recentes): cabe folgado no limite de 256 KiB por documento. */
const MAX_SCANS = 5000;

export interface TwinNode {
  state: string;
  fila: number;
  fazendo: number;
  feitas: number;
  /** Ciclo pelo intervalo entre scans (s), já sem os fora do desvio. */
  ciclo?: number;
  /** Intervalos descartados (fora de média ± 2 desvios). */
  fora?: number;
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
const plain = (m: Model): Model => ({ ...m, background: undefined, settings: { ...m.settings, replay: undefined, replayPrev: undefined } });

/** Junta os scans de uma linha e publica o estado e os scans no banco. */
class Emitter {
  scans: ScanRead[] = [];
  sessao = `s${Date.now().toString(36)}`;
  dirty = false;
  private n = 0;
  constructor(
    private sim: Simulator,
    private model: Model,
    private fonte: string,
  ) {
    sim.onCycle = ({ node, serial, end }) => {
      if (!STATION(node.type) || end < sim.t0) return;
      this.scans.push({ posto: node.name, serie: `SN${String(serial).padStart(6, '0')}`, hora: end - sim.t0 });
      if (this.scans.length > MAX_SCANS * 1.5) this.scans = this.scans.slice(-MAX_SCANS);
      this.dirty = true;
    };
  }
  async start(): Promise<boolean> {
    const db = await getDb();
    if (!db) return false;
    await db.doc(TWIN_DOCS.modelo).set({ sessao: this.sessao, fonte: this.fonte, json: JSON.stringify(plain(this.model)), em: Date.now() }).catch(() => undefined);
    await db.doc(TWIN_DOCS.scans).set({ sessao: this.sessao, ...packScans([]), em: Date.now() }).catch(() => undefined);
    return true;
  }
  /** Estado de cada posto + ciclo pelos scans. */
  state(running: boolean): TwinState {
    const s = this.sim;
    const byName = new Map<string, number[]>();
    const last = new Map<string, number>();
    for (const x of this.scans) {
      const p = last.get(x.posto);
      if (p !== undefined) {
        const l = byName.get(x.posto) ?? [];
        l.push(x.hora - p);
        byName.set(x.posto, l);
      }
      last.set(x.posto, x.hora);
    }
    const postos: Record<string, TwinNode> = {};
    let pecas = 0;
    for (const r of s.nodes) {
      if (r.def.type === 'sink') pecas += r.processed;
      if (!STATION(r.def.type)) continue;
      const c = scanCycle(byName.get(r.def.name) ?? []);
      postos[r.def.id] = { state: r.state, fila: r.queue.length, fazendo: r.processing.length, feitas: r.processed, ciclo: c.mean || undefined, fora: c.out.length };
    }
    const relogio = Math.max(0, s.now - s.t0);
    return { sessao: this.sessao, fonte: this.fonte, nome: this.model.name, relogio, rodando: running, pecas, uph: relogio > 0 ? (pecas * 3600) / relogio : 0, em: Date.now(), postos };
  }
  async publish(running: boolean) {
    const db = await getDb();
    if (!db) return;
    await db.doc(TWIN_DOCS.estado).set({ json: JSON.stringify(this.state(running)), em: Date.now() }).catch(() => undefined);
    if (++this.n % 2 === 0 && this.dirty) {
      this.dirty = false;
      await db.doc(TWIN_DOCS.scans).set({ sessao: this.sessao, ...packScans(this.scans), em: Date.now() }).catch(() => undefined);
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
    const e = new Emitter(sim, useStore.getState().model, 'linha física');
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
export function startVirtualLine(model: Model, speed: number): Promise<boolean> {
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
  const e = new Emitter(sim, model, `linha virtual (servidor de teste, ${speed}×)`);
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

/** No monitoramento, o rodapé mostra só o real de cada posto (sem indicadores de simulação). */
export function TwinTable() {
  const twin = useStore((s) => s.twin);
  const nodes = useStore((s) => s.model.nodes);
  const takt = useStore((s) => s.model.settings.takt);
  const LABEL: Record<string, string> = { working: 'trabalhando', starved: 'esperando peça', blocked: 'bloqueado', down: 'parado', setup: 'setup', break: 'pausa', off: 'desligado', resource: 'esperando recurso', transport: 'transporte' };
  return (
    <section className="dash twin-dash" aria-label="Postos em tempo real">
      <div style={{ gridColumn: '1 / -1', minWidth: 0, overflow: 'auto' }}>
        <p className="label">📡 Monitoramento real · o que cada posto está fazendo (sem simulação)</p>
        {!twin ? (
          <p className="hint">Esperando a linha. Em 📡 Monitoramento real, ligue a linha virtual (servidor de teste), siga a linha física ou ligue a API.</p>
        ) : (
          <table className="grid-table">
            <thead>
              <tr><th>Posto</th><th>Estado agora</th><th>Peças (scans)</th><th>Ciclo pelos scans</th><th>× takt</th><th>Fora do desvio</th><th>Fila</th></tr>
            </thead>
            <tbody>
              {nodes.filter((n) => twin.postos[n.id]).map((n) => {
                const p = twin.postos[n.id];
                const over = takt > 0 && (p.ciclo ?? 0) / Math.max(1, n.capacity) > takt;
                return (
                  <tr key={n.id}>
                    <td>{n.name}</td>
                    <td><i className="dot" style={{ background: `var(--st-${p.state === 'starved' ? 'starved' : p.state === 'working' ? 'working' : p.state === 'blocked' ? 'blocked' : p.state === 'down' ? 'down' : 'off'})` }} /> {LABEL[p.state] ?? p.state}</td>
                    <td>{p.feitas}</td>
                    <td>{p.ciclo ? `${fmt(p.ciclo, 1)} s` : '–'}</td>
                    <td className={over ? 'bad' : 'good'}>{p.ciclo && takt > 0 ? `${fmt(((p.ciclo / Math.max(1, n.capacity)) / takt) * 100, 0)}%` : '–'}</td>
                    <td>{p.fora ?? 0}</td>
                    <td>{p.fila}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
