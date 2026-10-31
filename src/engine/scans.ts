// Coleta por escaneamento: cada posto lê o código da peça uma vez quando ela sai do posto.
// O ciclo do posto é o intervalo entre dois scans seguidos no mesmo posto; intervalos fora de
// média ± k·desvio (paradas, almoço, falta de peça) são descartados depois, no estudo de tempos.

import type { RealEvent } from './timeStudy';

export interface ScanRead {
  posto: string;
  serie: string;
  /** Hora do scan, em segundos. */
  hora: number;
  turno?: string;
  modelo?: string;
}

/** Transforma scans em leituras: início = scan anterior no mesmo posto, fim = este scan. */
export function scansToEvents(scans: ScanRead[]): RealEvent[] {
  const by = new Map<string, ScanRead[]>();
  for (const s of scans) {
    if (!Number.isFinite(s.hora)) continue;
    const k = s.posto.trim().toLowerCase();
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(s);
  }
  const out: RealEvent[] = [];
  for (const list of by.values()) {
    list.sort((a, b) => a.hora - b.hora);
    for (let i = 1; i < list.length; i++) {
      const s = list[i];
      if (s.hora <= list[i - 1].hora) continue;
      out.push({ posto: s.posto, serie: s.serie, inicio: list[i - 1].hora, fim: s.hora, ...(s.turno ? { turno: s.turno } : {}), ...(s.modelo ? { modelo: s.modelo } : {}) });
    }
  }
  return out.sort((a, b) => a.fim - b.fim);
}

/** Estatística do ciclo pelos scans de um posto (para mostrar e testar). */
export function scanCycle(intervals: number[], k = 2): { mean: number; sd: number; kept: number[]; out: number[] } {
  const xs = intervals.filter((x) => x > 0 && Number.isFinite(x));
  if (!xs.length) return { mean: 0, sd: 0, kept: [], out: [] };
  const m0 = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd0 = Math.sqrt(xs.reduce((a, b) => a + (b - m0) ** 2, 0) / Math.max(1, xs.length - 1));
  const kept = xs.filter((x) => Math.abs(x - m0) <= k * sd0 || sd0 === 0);
  const out = xs.filter((x) => !(Math.abs(x - m0) <= k * sd0 || sd0 === 0));
  const mean = kept.reduce((a, b) => a + b, 0) / Math.max(1, kept.length);
  const sd = Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, kept.length - 1));
  return { mean, sd, kept, out };
}
