// Painel real × simulado: uma foto pequena (cabe num documento do banco) com os indicadores
// da linha e, por posto, o SOE, o tempo simulado e o tempo real. É o que o leitor do link vê.

import { cycleRows, effectiveTakt } from './balance';
import { lineKpi } from './metrics';
import { Simulator } from './simulator';
import type { RealEvent } from './timeStudy';
import type { Model } from './types';

export interface PanelStation {
  id: string;
  name: string;
  /** Segundos por peça da linha (÷ gigas): SOE/modelo, simulado e real (null = sem leitura). */
  soe: number;
  sim: number;
  real: number | null;
  /** Peças no turno simulado e leituras reais do posto. */
  simCount: number;
  realCount: number | null;
  offline: boolean;
}

export interface PanelSnapshot {
  modelo: string;
  geradoEm: number;
  takt: number;
  metaUph: number;
  horas: number;
  sim: { uph: number; oee: number; wip: number; lead: number; gargalo: string };
  real: { uph: number | null; fonte: string; gargalo: string | null };
  /** Desvio (fração) que acende o alerta. */
  alerta: number;
  postos: PanelStation[];
}

const key = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** UPH real pelas leituras: peças do posto de referência (ou do último posto lido) ÷ horas cobertas. */
export function realUph(events: RealEvent[], refName?: string): number | null {
  if (!events.length) return null;
  const names = [...new Set(events.map((e) => key(e.posto)))];
  const ref = refName && names.includes(key(refName)) ? key(refName) : names[names.length - 1];
  const at = events.filter((e) => key(e.posto) === ref);
  const span = Math.max(...at.map((e) => e.fim)) - Math.min(...at.map((e) => e.inicio));
  return span > 0 ? (new Set(at.map((e) => e.serie)).size * 3600) / span : null;
}

/**
 * Roda o modelo (turno inteiro) e junta com os dados reais por posto.
 * `real` = ciclo real por posto pelo nome normalizado (s por giga) e quantas leituras.
 */
export function buildPanel(
  model: Model,
  real: Record<string, { cycle?: number; produced?: number }>,
  events: RealEvent[],
  fonte: string,
  alerta = 0.1,
): PanelSnapshot {
  const sim = new Simulator(model);
  sim.runToEnd();
  const k = lineKpi(sim);
  const takt = effectiveTakt(model);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const kById = new Map(k.nodes.map((n) => [n.id, n]));
  const postos: PanelStation[] = cycleRows(model, k).map((r) => {
    const n = byId.get(r.id)!;
    const rr = real[key(n.name)];
    const cap = Math.max(1, n.capacity);
    return {
      id: r.id,
      name: r.name,
      soe: r.raw,
      sim: r.real ?? r.raw,
      real: rr?.cycle ? rr.cycle / cap : null,
      simCount: kById.get(r.id)?.processed ?? 0,
      realCount: rr?.produced ?? null,
      offline: r.offline,
    };
  });
  const withReal = postos.filter((p) => p.real !== null && !p.offline);
  const ref = model.refStation ? byId.get(model.refStation)?.name : undefined;
  return {
    modelo: model.name,
    geradoEm: Date.now(),
    takt,
    metaUph: takt > 0 ? 3600 / takt : 0,
    horas: model.settings.duration / 3600,
    sim: {
      uph: k.throughputPerHour,
      oee: k.oee,
      wip: k.avgWip,
      lead: k.leadTime,
      gargalo: (k.bottleneckId && byId.get(k.bottleneckId)?.name) || '–',
    },
    real: {
      uph: realUph(events, ref),
      fonte,
      gargalo: withReal.length ? withReal.reduce((a, b) => (b.real! > a.real! ? b : a)).name : null,
    },
    alerta,
    postos,
  };
}

/** Desvio do real contra uma referência (SOE ou simulado). */
export const devOf = (real: number | null, ref: number) => (real === null || ref <= 0 ? null : real / ref - 1);
