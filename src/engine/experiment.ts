// Experimentador e otimizador.
// Experimentador: escolhe 1 ou 2 variáveis (gigas, tempo, fila, buffer, frota), cada uma com alguns valores;
// roda todas as combinações com réplicas e devolve UPH médio ± intervalo de 95%.
// Otimizador: parte da linha atual e põe gigas (com operador) no gargalo até o UPH chegar na meta com folga
// estatística; depois tira gigas que sobram. Resultado: a linha que atinge a meta com menos pessoas.

import { effectiveTakt } from './balance';
import { lineKpi } from './metrics';
import { replicaStats, type ReplicaStats } from './replicas';
import { Simulator } from './simulator';
import type { Model, NodeDef } from './types';

export type FactorKind = 'gigas' | 'tempo' | 'fila' | 'buffer' | 'frota';

export const FACTOR_LABEL: Record<FactorKind, string> = {
  gigas: 'Gigas do posto',
  tempo: 'Tempo de ciclo do posto (s)',
  fila: 'Fila de entrada do posto',
  buffer: 'Capacidade do buffer',
  frota: 'Quantidade da frota/equipe',
};

export interface Factor {
  kind: FactorKind;
  /** Nó (gigas, tempo, fila, buffer) ou pool (frota). */
  target: string;
  values: number[];
}

export interface ExpResult {
  values: number[];
  uph: ReplicaStats;
  lead: number;
  wip: number;
  people: number;
  /** Atinge a meta mesmo no pior caso do intervalo (média − meia largura ≥ meta). */
  meets: boolean;
}

export function peopleIn(m: Model): number {
  return (
    m.nodes.reduce((a, n) => a + (n.poolId || n.type === 'source' || n.type === 'sink' || n.type === 'buffer' ? 0 : n.operators), 0) +
    (m.pools ?? []).filter((p) => p.kind === 'operator').reduce((a, p) => a + p.count, 0)
  );
}

const isManual = (n: NodeDef) => !!n.manual || n.operators >= n.capacity;

/** Aplica um valor da variável no modelo (cópia). */
export function applyFactor(m: Model, f: Factor, v: number): Model {
  const c = structuredClone(m);
  if (f.kind === 'frota') {
    const p = c.pools?.find((x) => x.id === f.target);
    if (p) p.count = Math.max(0, Math.round(v));
    return c;
  }
  const n = c.nodes.find((x) => x.id === f.target);
  if (!n) return c;
  if (f.kind === 'gigas') {
    const g = Math.max(1, Math.round(v));
    // posto manual: cada giga a mais leva um operador junto
    if (isManual(n) && !n.poolId) n.operators = g;
    n.capacity = g;
  } else if (f.kind === 'tempo') {
    n.cycleTime = Math.max(0.1, v);
    n.cycleFromOps = false;
    n.productTimes = undefined;
  } else if (f.kind === 'fila') n.queueCap = Math.max(0, Math.round(v));
  else if (f.kind === 'buffer') n.capacity = Math.max(1, Math.round(v));
  return c;
}

/** Combinações de todas as variáveis (fatorial completo). */
export function combos(factors: Factor[]): number[][] {
  return factors.reduce<number[][]>((acc, f) => acc.flatMap((a) => f.values.map((v) => [...a, v])), [[]]);
}

/** Roda uma configuração com `reps` sementes (turno encurtado para `hours`). */
export function evaluate(m: Model, reps: number, hours?: number): { uph: ReplicaStats; lead: number; wip: number; bottleneck: string | null; util: Map<string, number> } {
  const uphs: number[] = [];
  let lead = 0;
  let wip = 0;
  const util = new Map<string, number>();
  const bott = new Map<string, number>();
  for (let r = 0; r < reps; r++) {
    const mm = { ...m, settings: { ...m.settings, seed: (m.settings.seed || 1) + r * 101, duration: hours ? Math.min(m.settings.duration, hours * 3600) : m.settings.duration } };
    const sim = new Simulator(mm);
    sim.runToEnd();
    const k = lineKpi(sim);
    uphs.push(k.throughputPerHour);
    lead += k.leadTime / reps;
    wip += k.avgWip / reps;
    if (k.bottleneckId) bott.set(k.bottleneckId, (bott.get(k.bottleneckId) ?? 0) + 1);
    for (const n of k.nodes) util.set(n.id, (util.get(n.id) ?? 0) + n.utilization / reps);
  }
  const bottleneck = [...bott.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { uph: replicaStats(uphs), lead, wip, bottleneck, util };
}

export function runExperiment(m: Model, factors: Factor[], reps: number, hours?: number): ExpResult[] {
  const meta = metaUph(m);
  return combos(factors).map((values) => {
    const mm = factors.reduce((acc, f, i) => applyFactor(acc, f, values[i]), m);
    const e = evaluate(mm, reps, hours);
    return { values, uph: e.uph, lead: e.lead, wip: e.wip, people: peopleIn(mm), meets: meta > 0 && e.uph.mean - e.uph.half >= meta };
  });
}

export const metaUph = (m: Model) => {
  const t = effectiveTakt(m);
  return t > 0 ? 3600 / t : 0;
};

export interface OptStep {
  action: string;
  uph: number;
  half: number;
  people: number;
  gigas: number;
}

export interface OptResult {
  model: Model;
  steps: OptStep[];
  meets: boolean;
  /** Mudanças de gigas por posto: antes → depois. */
  changes: { id: string; name: string; before: number; after: number }[];
}

/**
 * Otimizador guloso: enquanto o UPH (pior caso do intervalo de 95%) não chega na meta, põe 1 giga no gargalo;
 * depois tenta tirar 1 giga de cada posto com folga e mantém se a meta continua garantida.
 * `maxGigas` limita as gigas por posto; `onStep` informa o andamento.
 */
export function optimize(m: Model, opts: { target?: number; reps?: number; hours?: number; maxGigas?: number; maxSteps?: number } = {}, onStep?: (s: OptStep) => void): OptResult {
  const target = opts.target ?? metaUph(m);
  const reps = opts.reps ?? 3;
  const maxG = opts.maxGigas ?? 6;
  const maxSteps = opts.maxSteps ?? 25;
  const stations = (mm: Model) => mm.nodes.filter((n) => n.type === 'machine' || n.type === 'inspection' || n.type === 'rework');
  const gigasOf = (mm: Model) => stations(mm).reduce((a, n) => a + n.capacity, 0);
  const steps: OptStep[] = [];
  const log = (action: string, mm: Model, e: ReturnType<typeof evaluate>) => {
    const s = { action, uph: e.uph.mean, half: e.uph.half, people: peopleIn(mm), gigas: gigasOf(mm) };
    steps.push(s);
    onStep?.(s);
  };
  const ok = (e: ReturnType<typeof evaluate>) => e.uph.mean - e.uph.half >= target;
  let cur = structuredClone(m);
  let e = evaluate(cur, reps, opts.hours);
  log('Linha atual', cur, e);
  const tried = new Set<string>();
  // fase 1: soma gigas no gargalo
  for (let i = 0; i < maxSteps && !ok(e); i++) {
    const cand = stations(cur)
      .filter((n) => n.capacity < maxG && !tried.has(n.id))
      .sort((a, b) => (b.id === e.bottleneck ? 1 : 0) - (a.id === e.bottleneck ? 1 : 0) || (e.util.get(b.id) ?? 0) - (e.util.get(a.id) ?? 0));
    const n = cand[0];
    if (!n) break;
    const next = applyFactor(cur, { kind: 'gigas', target: n.id, values: [] }, n.capacity + 1);
    const ne = evaluate(next, reps, opts.hours);
    if (ne.uph.mean <= e.uph.mean + 0.2) {
      // não ajudou: o gargalo está em outro lugar (transporte, abastecimento); não insiste neste posto
      tried.add(n.id);
      continue;
    }
    tried.clear();
    cur = next;
    e = ne;
    log(`+1 giga em ${n.name} (${n.capacity} → ${n.capacity + 1})`, cur, e);
  }
  // fase 2: tira gigas que sobram (menor utilização primeiro)
  if (ok(e)) {
    const order = stations(cur)
      .filter((n) => n.capacity > 1)
      .sort((a, b) => (e.util.get(a.id) ?? 0) - (e.util.get(b.id) ?? 0));
    for (const n0 of order) {
      const n = cur.nodes.find((x) => x.id === n0.id)!;
      if (n.capacity <= 1) continue;
      const next = applyFactor(cur, { kind: 'gigas', target: n.id, values: [] }, n.capacity - 1);
      const ne = evaluate(next, reps, opts.hours);
      if (ok(ne)) {
        cur = next;
        e = ne;
        log(`−1 giga em ${n.name} (${n.capacity} → ${n.capacity - 1})`, cur, e);
      }
    }
  }
  const changes = stations(cur)
    .map((n) => ({ id: n.id, name: n.name, before: m.nodes.find((x) => x.id === n.id)?.capacity ?? n.capacity, after: n.capacity }))
    .filter((c) => c.before !== c.after);
  return { model: cur, steps, meets: ok(e), changes };
}
