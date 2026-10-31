// Gêmeo digital pelo banco do artefato.
// Linha física: uma aba (ou outro computador) roda a linha e transmite cada ciclo (posto, série, início, fim)
// e o estado de cada posto. Gêmeo: o Monitoramento real assina esses documentos e mostra a mesma operação,
// com alguns segundos de atraso, lado a lado com o que o modelo prevê.
// Quando a linha de verdade tiver a API dos postos, ela entra no lugar da linha física.

import { useEffect, useRef } from 'react';
import type { RealEvent } from '../engine/timeStudy';
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

export const TWIN_DOCS = { modelo: 'gemeo/modelo', estado: 'gemeo/estado', leituras: 'gemeo/leituras' };
/** Leituras guardadas no banco (as mais recentes): cabe folgado no limite de 256 KiB por documento. */
const MAX_EVENTS = 4000;

export interface TwinNode {
  state: string;
  fila: number;
  fazendo: number;
  feitas: number;
}
export interface TwinState {
  sessao: string;
  nome: string;
  relogio: number;
  rodando: boolean;
  pecas: number;
  uph: number;
  em: number;
  postos: Record<string, TwinNode>;
}

/** Leituras compactas: [posto (índice), série, início, fim]. */
export function packEvents(ev: RealEvent[]): { postos: string[]; e: [number, number, number, number][] } {
  const postos: string[] = [];
  const idx = new Map<string, number>();
  const e = ev.slice(-MAX_EVENTS).map((x): [number, number, number, number] => {
    if (!idx.has(x.posto)) {
      idx.set(x.posto, postos.length);
      postos.push(x.posto);
    }
    return [idx.get(x.posto)!, Number(x.serie.replace(/\D/g, '')) || 0, Math.round(x.inicio * 10) / 10, Math.round(x.fim * 10) / 10];
  });
  return { postos, e };
}
export function unpackEvents(p: { postos: string[]; e: [number, number, number, number][] }): RealEvent[] {
  return p.e.map(([i, s, a, b]) => ({ posto: p.postos[i] ?? `Posto ${i + 1}`, serie: `SN${String(s).padStart(6, '0')}`, inicio: a, fim: b }));
}

const STATION = (t: string) => t === 'machine' || t === 'inspection' || t === 'rework';
const plain = (m: Model): Model => ({ ...m, background: undefined });

/** Aba da linha física: transmite os ciclos e o estado enquanto a simulação roda. */
export function PhysicalSource() {
  const on = useStore((s) => s.physical);
  const sim = useStore((s) => s.sim);
  const buf = useRef<RealEvent[]>([]);
  const sessao = useRef('');
  const dirty = useRef(false);

  // nova sessão (ligou ou trocou de modelo/simulação): manda o modelo e zera as leituras
  useEffect(() => {
    if (!on) return;
    buf.current = [];
    sessao.current = `s${Date.now().toString(36)}`;
    const m = useStore.getState().model;
    sim.onCycle = ({ node, serial, start, end }) => {
      if (!STATION(node.type) || start < sim.t0) return;
      buf.current.push({ posto: node.name, serie: `SN${String(serial).padStart(6, '0')}`, inicio: start - sim.t0, fim: end - sim.t0 });
      if (buf.current.length > MAX_EVENTS * 1.5) buf.current = buf.current.slice(-MAX_EVENTS);
      dirty.current = true;
    };
    void getDb().then((db) => {
      if (!db) {
        useStore.getState().setMessage('Linha física: a transmissão só funciona no link online (o banco do artefato leva as leituras ao gêmeo).');
        return;
      }
      void db.doc(TWIN_DOCS.modelo).set({ sessao: sessao.current, json: JSON.stringify(plain(m)), em: Date.now() }).catch(() => undefined);
      void db.doc(TWIN_DOCS.leituras).set({ sessao: sessao.current, ...packEvents([]), em: Date.now() }).catch(() => undefined);
    });
    return () => {
      sim.onCycle = undefined;
    };
  }, [on, sim]);

  // estado a cada 2 s e leituras a cada 4 s (só quando mudou)
  useEffect(() => {
    if (!on) return;
    let n = 0;
    const id = setInterval(async () => {
      const db = await getDb();
      if (!db) return;
      const st = useStore.getState();
      const s = st.sim;
      const postos: Record<string, TwinNode> = {};
      for (const r of s.nodes) {
        if (!STATION(r.def.type)) continue;
        postos[r.def.id] = { state: r.state, fila: r.queue.length, fazendo: r.processing.length, feitas: r.processed };
      }
      const state: TwinState = {
        sessao: sessao.current,
        nome: st.model.name,
        relogio: Math.max(0, s.now - s.t0),
        rodando: st.run === 'running',
        pecas: st.kpi.completed,
        uph: st.kpi.throughputPerHour,
        em: Date.now(),
        postos,
      };
      void db.doc(TWIN_DOCS.estado).set({ json: JSON.stringify(state), em: state.em }).catch(() => undefined);
      if (++n % 2 === 0 && dirty.current) {
        dirty.current = false;
        void db.doc(TWIN_DOCS.leituras).set({ sessao: sessao.current, ...packEvents(buf.current), em: Date.now() }).catch(() => undefined);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [on]);

  return null;
}

/** Gêmeo: assina a linha física. Abre o modelo dela, carrega as leituras e guarda o estado para o canvas e o painel. */
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
    onStatus('Esperando a linha física… Abra o link em outra aba ou computador, clique em 🏭 Linha física e ▶ Start.');
    stops.push(
      db.doc(TWIN_DOCS.modelo).onSnapshot((s) => {
        const d = s.exists ? s.data() : undefined;
        if (!d?.json || d.sessao === sessao) return;
        sessao = String(d.sessao);
        try {
          const m = JSON.parse(String(d.json)) as Model;
          const st = useStore.getState();
          st.setModel({ ...m, settings: { ...m.settings, study: 'monitoramento' } }, `Gêmeo digital ligado à linha física "${m.name}". Os blocos mostram o estado real de cada posto (selo 🏭), com alguns segundos de atraso.`);
          st.setTwin(null);
        } catch {
          onStatus('Modelo da linha física ilegível.');
        }
      }),
      db.doc(TWIN_DOCS.leituras).onSnapshot((s) => {
        const d = s.exists ? s.data() : undefined;
        if (!d?.e || (sessao && d.sessao !== sessao)) return;
        const ev = unpackEvents(d as unknown as { postos: string[]; e: [number, number, number, number][] });
        if (ev.length) loadRealEvents(ev, 'gêmeo digital: linha física ao vivo');
      }),
      db.doc(TWIN_DOCS.estado).onSnapshot((s) => {
        const d = s.exists ? s.data() : undefined;
        if (!d?.json) return;
        try {
          const t = JSON.parse(String(d.json)) as TwinState;
          if (sessao && t.sessao !== sessao) return;
          useStore.getState().setTwin(t);
          onStatus(`Recebendo da linha física: ${fmtTime(t.relogio)} de turno, ${t.pecas} peças.`);
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

/** Faixa do gêmeo sobre o canvas: o que a linha física está fazendo agora × o que o modelo prevê. */
export function TwinBar() {
  const twin = useStore((s) => s.twin);
  const meta = useStore((s) => s.model.settings.takt);
  if (!twin) return null;
  const delay = Math.max(0, (Date.now() - twin.em) / 1000);
  const parados = Object.values(twin.postos).filter((p) => p.state === 'down' || p.state === 'starved' || p.state === 'blocked').length;
  return (
    <div className="twin-bar" role="status">
      <b>🏭 Gêmeo digital</b>
      <span>Linha física {twin.rodando ? 'rodando' : 'parada'} · {fmtTime(twin.relogio)}</span>
      <span>Real: <b>{twin.pecas}</b> peças · <b>{fmt(twin.uph, 1)}</b> UPH</span>
      {meta > 0 && <span className={twin.uph >= 3600 / meta ? 'good' : 'bad'}>Meta {fmt(3600 / meta, 0)} UPH</span>}
      <span>{parados} postos esperando ou travados</span>
      <span className={delay > 10 ? 'bad' : 'muted'}>atraso {fmt(delay, 0)} s</span>
    </div>
  );
}
