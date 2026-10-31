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

export interface ScanStation {
  /** Peças escaneadas no posto. */
  feitas: number;
  /** Ciclo pelo intervalo entre scans (s), sem os fora do desvio. */
  ciclo?: number;
  /** Intervalos descartados (fora de média ± 2 desvios). */
  fora: number;
  /** Hora do último scan (s). */
  ult?: number;
  /** Minutos perdidos nos intervalos fora do desvio (o que passou da média). */
  paradoMin: number;
}

/** Resumo de cada posto pelos scans (chave = nome do posto como veio). */
export function stationsFromScans(scans: ScanRead[]): Map<string, ScanStation> {
  const by = new Map<string, number[]>();
  for (const s of scans) if (Number.isFinite(s.hora)) (by.get(s.posto) ?? by.set(s.posto, []).get(s.posto)!).push(s.hora);
  const out = new Map<string, ScanStation>();
  for (const [posto, hs] of by) {
    hs.sort((a, b) => a - b);
    const iv: number[] = [];
    for (let i = 1; i < hs.length; i++) iv.push(hs[i] - hs[i - 1]);
    const c = scanCycle(iv);
    const lost = c.out.reduce((a, x) => a + Math.max(0, x - c.mean), 0) / 60;
    out.set(posto, { feitas: hs.length, ciclo: c.mean || undefined, fora: c.out.length, ult: hs[hs.length - 1], paradoMin: Math.round(lost * 10) / 10 });
  }
  return out;
}

/**
 * Peças do WIP inicial por posto: séries escaneadas no posto que nunca passaram pelo posto anterior
 * (já estavam na linha quando o turno começou). Explica por que um posto pode ter mais peças que o anterior.
 * prevOf: para cada posto, os postos imediatamente antes dele (vazio = primeiro posto, não conta).
 */
export function carryOver(scans: ScanRead[], prevOf: Map<string, string[]>): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  const out = new Map<string, number>();
  for (const s of [...scans].sort((a, b) => a.hora - b.hora)) {
    const prev = prevOf.get(s.posto) ?? [];
    if (seen.get(s.posto)?.has(s.serie)) continue; // mesma série lida duas vezes no posto: conta uma
    if (prev.length && !prev.some((p) => seen.get(p)?.has(s.serie))) out.set(s.posto, (out.get(s.posto) ?? 0) + 1);
    (seen.get(s.posto) ?? seen.set(s.posto, new Set()).get(s.posto)!).add(s.serie);
  }
  return out;
}
