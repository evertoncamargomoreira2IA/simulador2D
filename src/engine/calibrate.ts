// Calibração dos tempos de ciclo para o takt.
// Os tempos do SOE já trazem as ineficiências; para atender a demanda, todos os postos
// (menos os de tempo fixo) são escalados pelo mesmo fator, achado por busca binária
// simulando a linha cheia.

import { lineKpi } from './metrics';
import { Simulator } from './simulator';
import type { Model, NodeDef } from './types';

export interface Calibration {
  factor: number;
  uph: number;
  target: number;
  model: Model;
}

const scalable = (n: NodeDef) =>
  !n.fixedTime && n.cycleTime > 0 && n.type !== 'source' && n.type !== 'sink' && n.type !== 'buffer';

export function scaleTimes(model: Model, factor: number): Model {
  return {
    ...model,
    nodes: model.nodes.map((n) => (scalable(n) ? { ...n, cycleTime: Math.round(n.cycleTime * factor * 100) / 100 } : n)),
  };
}

/** UPH medido em regime (linha cheia) por `hours` horas. */
export function steadyUph(model: Model, hours = 4): number {
  const m: Model = { ...model, settings: { ...model.settings, startFull: true, warmup: 0, duration: hours * 3600 } };
  const sim = new Simulator(structuredClone(m));
  sim.runToEnd();
  return lineKpi(sim).throughputPerHour;
}

/** Menor redução proporcional dos tempos que entrega o UPH do takt (com 0,5% de folga). */
export function calibrateToTakt(model: Model, steps = 10): Calibration {
  const takt = model.settings.takt;
  const target = takt > 0 ? 3600 / takt : 0;
  const goal = target * 1.005;
  let uph = steadyUph(model);
  if (target <= 0 || uph >= goal) return { factor: 1, uph, target, model };
  let lo = 0.5;
  let hi = 1;
  let best = { factor: lo, uph: steadyUph(scaleTimes(model, lo)) };
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    const u = steadyUph(scaleTimes(model, mid));
    if (u >= goal) {
      lo = mid;
      best = { factor: mid, uph: u };
    } else hi = mid;
  }
  const factor = Math.floor(best.factor * 1000) / 1000;
  uph = steadyUph(scaleTimes(model, factor));
  return { factor, uph, target, model: scaleTimes(model, factor) };
}
