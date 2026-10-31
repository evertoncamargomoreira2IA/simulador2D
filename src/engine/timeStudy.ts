// Estudo de tempos com dados reais da operação: cada leitura diz em que posto a peça (série)
// começou e terminou, e opcionalmente qual operação. Daqui saem o ciclo real por posto e por
// operação, o descarte de discrepantes, o número mínimo de amostras e o tempo padrão.
// LGPD: o evento não tem campo de pessoa; só posto, turno e número de série da peça.

import { baseCycle, operationsTime, type Model, type NodeDef } from './types';

export interface RealEvent {
  /** Nome do posto como no modelo. */
  posto: string;
  /** Número de série da peça (ou da carga). */
  serie: string;
  /** Início e fim em segundos (relógio da coleta). */
  inicio: number;
  fim: number;
  /** Operação do SOE (vazio = ciclo do posto inteiro). */
  operacao?: string;
  turno?: string;
  /** Modelo do produto (mix). */
  modelo?: string;
}

export interface StudyOptions {
  /** Descarta valores além de média ± sigma desvios padrão (0 = não descarta). */
  sigma: number;
  /** Fator de ritmo (1 = ritmo normal; 1,1 = operador 10% mais rápido que o normal). */
  rating: number;
  /** Tolerâncias (fadiga, necessidades pessoais), fração sobre o tempo normal. */
  allowance: number;
  /** Desvio do tempo padrão contra o SOE que gera alerta (fração). */
  alertPct: number;
  /** Erro aceito na média para o número mínimo de amostras (fração) e confiança. */
  errorPct: number;
  confidence: 0.9 | 0.95 | 0.99;
}

export const STUDY_DEFAULTS: StudyOptions = { sigma: 2, rating: 1, allowance: 0, alertPct: 0.1, errorPct: 0.05, confidence: 0.95 };

const Z: Record<StudyOptions['confidence'], number> = { 0.9: 1.645, 0.95: 1.96, 0.99: 2.576 };

export interface Stat {
  n: number;
  kept: number;
  /** Valores descartados (s), em ordem. */
  out: number[];
  mean: number;
  sd: number;
  min: number;
  max: number;
  /** Amostras mínimas para o erro e a confiança pedidos. */
  needed: number;
  /** Tempo normal (média × ritmo) e padrão (normal × (1 + tolerâncias)). */
  normal: number;
  standard: number;
  /** SOE/modelo (s) e desvio do tempo padrão contra ele. */
  plan: number;
  dev: number | null;
  alert: boolean;
}

export interface OpStudy extends Stat {
  name: string;
}

export interface StationStudy extends Stat {
  id: string | null;
  name: string;
  ops: OpStudy[];
}

const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sdOf = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/** Separa os discrepantes: fora de média ± k desvios (uma passada, como na cronoanálise). */
export function splitOutliers(xs: number[], k: number): { kept: number[]; out: number[] } {
  if (k <= 0 || xs.length < 3) return { kept: [...xs], out: [] };
  const m = meanOf(xs);
  const s = sdOf(xs);
  if (s === 0) return { kept: [...xs], out: [] };
  const kept: number[] = [];
  const out: number[] = [];
  for (const x of xs) (Math.abs(x - m) > k * s ? out : kept).push(x);
  return { kept, out };
}

/** Número mínimo de amostras: n' = (z·s / (e·x̄))². */
export function minSamples(mean: number, sd: number, errorPct: number, z: number): number {
  if (mean <= 0 || errorPct <= 0) return 0;
  return Math.ceil(((z * sd) / (errorPct * mean)) ** 2);
}

export function statOf(xs: number[], plan: number, o: StudyOptions): Stat {
  const { kept, out } = splitOutliers(xs, o.sigma);
  const mean = meanOf(kept);
  const sd = sdOf(kept);
  const normal = mean * o.rating;
  const standard = normal * (1 + o.allowance);
  const dev = plan > 0 && kept.length ? standard / plan - 1 : null;
  return {
    n: xs.length,
    kept: kept.length,
    out,
    mean,
    sd,
    min: kept.length ? Math.min(...kept) : 0,
    max: kept.length ? Math.max(...kept) : 0,
    needed: minSamples(mean, sd, o.errorPct, Z[o.confidence]),
    normal,
    standard,
    plan,
    dev,
    alert: dev !== null && Math.abs(dev) > o.alertPct,
  };
}

const key = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Estudo por posto. Ciclo da peça no posto = do primeiro início ao último fim das leituras dela ali
 * (vale para leitura do posto inteiro ou por operação). Operações: duração de cada leitura com operação.
 */
export function studyEvents(events: RealEvent[], model: Model, o: StudyOptions = STUDY_DEFAULTS): StationStudy[] {
  const byName = new Map<string, NodeDef>(model.nodes.map((n) => [key(n.name), n]));
  const groups = new Map<string, { name: string; cycles: Map<string, { a: number; b: number }>; ops: Map<string, number[]> }>();
  for (const e of events) {
    if (!(e.fim >= e.inicio)) continue;
    const k = key(e.posto);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { name: e.posto, cycles: new Map(), ops: new Map() }));
    const c = g.cycles.get(e.serie);
    if (c) {
      c.a = Math.min(c.a, e.inicio);
      c.b = Math.max(c.b, e.fim);
    } else g.cycles.set(e.serie, { a: e.inicio, b: e.fim });
    if (e.operacao) {
      const list = g.ops.get(e.operacao) ?? [];
      list.push(e.fim - e.inicio);
      g.ops.set(e.operacao, list);
    }
  }
  const order = new Map(model.nodes.map((n, i) => [key(n.name), i]));
  return [...groups.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9))
    .map(([k, g]) => {
      const node = byName.get(k);
      const plan = node ? baseCycle(node, model.settings) || operationsTime(node.operations) : 0;
      const st = statOf([...g.cycles.values()].map((c) => c.b - c.a), plan, o);
      const ops = [...g.ops.entries()].map(([name, xs]) => {
        const op = node?.operations?.find((x) => key(x.name) === key(name));
        const opPlan = op ? op.activities.reduce((a, x) => a + (x.time || 0), 0) : 0;
        return { name, ...statOf(xs, opPlan, o) };
      });
      return { id: node?.id ?? null, name: node?.name ?? g.name, ops, ...st };
    });
}
