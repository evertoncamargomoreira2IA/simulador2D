// Cenários salvos (no navegador) para comparar estados atual e futuro lado a lado.

import { footprint } from '../engine/analytics';
import { cycleRows, effectiveTakt } from '../engine/balance';
import { lineKpi } from '../engine/metrics';
import { Simulator } from '../engine/simulator';
import type { Model } from '../engine/types';

export interface Scenario {
  id: string;
  name: string;
  model: Model;
  r: {
    uph: number;
    lead: number;
    wip: number;
    cost: number;
    kwh: number;
    co2: number;
    people: number;
    fpy: number;
    completed: number;
    target?: number;
    maxLoad?: number;
    balance?: number;
    bottleneck?: string;
  };
}
const SC_KEY = 'sim2d.scenarios';

export function loadScenarios(): Scenario[] {
  try {
    return JSON.parse(localStorage.getItem(SC_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveScenarios(list: Scenario[]): boolean {
  try {
    localStorage.setItem(SC_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // armazenamento indisponível ou cheio: fica só nesta sessão
  }
}

export function peopleOf(model: Model): number {
  return (
    model.nodes.reduce((a, n) => a + (n.poolId || n.type === 'source' || n.type === 'sink' ? 0 : n.operators), 0) +
    (model.pools ?? []).filter((p) => p.kind === 'operator').reduce((a, p) => a + p.count, 0)
  );
}

/** Carga planejada da linha principal: maior posto e balanceamento (média ÷ maior). */
export function lineLoad(model: Model): { max: number; balance: number } {
  const main = cycleRows(model).filter((r) => !r.offline);
  const max = Math.max(0, ...main.map((r) => r.plan));
  return { max, balance: main.length && max ? main.reduce((s, r) => s + r.plan, 0) / (main.length * max) : 0 };
}

export function runScenario(model: Model, duration?: number): Scenario['r'] {
  const m = structuredClone(model);
  if (duration) m.settings = { ...m.settings, duration: Math.min(m.settings.duration, duration) };
  const sim = new Simulator(m);
  sim.runToEnd();
  const k = lineKpi(sim);
  const fp = footprint(sim, k);
  const takt = effectiveTakt(model);
  const ld = lineLoad(model);
  return {
    uph: k.throughputPerHour,
    lead: k.leadTime,
    wip: k.avgWip,
    cost: fp.cost.perUnit,
    kwh: fp.energy.perUnit,
    co2: fp.co2.perUnit,
    people: peopleOf(model),
    fpy: k.firstPassYield,
    completed: k.completed,
    target: takt > 0 ? (k.throughputPerHour * takt) / 3600 : 0,
    maxLoad: ld.max,
    balance: ld.balance,
    bottleneck: model.nodes.find((n) => n.id === k.bottleneckId)?.name,
  };
}
