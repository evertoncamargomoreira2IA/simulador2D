// Réplicas: roda o mesmo modelo com sementes diferentes e resume o UPH com faixa de confiança.

import { lineKpi } from './metrics';
import { Simulator } from './simulator';
import type { Model } from './types';

export interface ReplicaRun {
  seed: number;
  uph: number;
  completed: number;
  lead: number;
}

export interface ReplicaStats {
  n: number;
  mean: number;
  sd: number;
  /** Meia largura do intervalo de 95% (média ± half). */
  half: number;
  min: number;
  max: number;
  /** Percentis 5 e 95 das réplicas (faixa onde caem 90% dos turnos). */
  p5: number;
  p95: number;
}

// t de Student bicaudal 95% por graus de liberdade (1..30); acima disso ~1,96.
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return 0;
  const p = (sorted.length - 1) * q;
  const i = Math.floor(p);
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (p - i);
};

export function replicaStats(values: number[]): ReplicaStats {
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const t = n > 1 ? (T95[n - 2] ?? 1.96) : 0;
  const sorted = [...values].sort((a, b) => a - b);
  return { n, mean, sd, half: n > 1 ? (t * sd) / Math.sqrt(n) : 0, min: sorted[0] ?? 0, max: sorted[n - 1] ?? 0, p5: quantile(sorted, 0.05), p95: quantile(sorted, 0.95) };
}

/** Uma réplica: mesma linha, semente diferente. */
export function runReplica(model: Model, seed: number): ReplicaRun {
  const sim = new Simulator(structuredClone({ ...model, settings: { ...model.settings, seed } }));
  sim.runToEnd();
  const k = lineKpi(sim);
  return { seed, uph: k.throughputPerHour, completed: k.completed, lead: k.leadTime };
}
