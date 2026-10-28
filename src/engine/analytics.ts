// Análises sobre uma simulação: custos (Sprint 4), energia (Sprint 5), carbono (Sprint 6)
// e spaghetti chart (Sprint 3). Funções puras sobre o Simulator e os KPIs.

import type { LineKpi } from './metrics';
import type { NodeRt, Simulator } from './simulator';
import { DEFAULT_SETTINGS } from './types';

export interface NodeFootprint {
  id: string;
  name: string;
  kWh: number;
  /** Parte do consumo com o posto parado, esperando ou bloqueado. */
  kWhIdle: number;
  co2: number;
  labor: number;
  machine: number;
  energy: number;
  maintenance: number;
  setup: number;
  cost: number;
}

export interface Footprint {
  hours: number;
  units: number;
  nodes: NodeFootprint[];
  pools: { id: string; name: string; kWh: number; co2: number; cost: number; labor: number }[];
  cost: {
    material: number;
    labor: number;
    energy: number;
    consumables: number;
    maintenance: number;
    setup: number;
    transport: number;
    storage: number;
    machine: number;
    total: number;
    perUnit: number;
    perShift: number;
  };
  energy: { kWh: number; kWhIdle: number; perUnit: number; perShift: number; efficiency: number };
  co2: { scope1: number; scope2: number; scope3: number; total: number; perUnit: number; perShift: number };
}

function settingsOf(sim: Simulator) {
  return { ...DEFAULT_SETTINGS, ...sim.model.settings };
}

/** Segundos-posto trabalhando, em setup, ociosos (ligado) e em falha no período das estatísticas. */
function stationSeconds(sim: Simulator, n: NodeRt) {
  const elapsed = Math.max(0, sim.now - sim.statsStart);
  const cap = Math.max(1, n.def.capacity);
  const st = sim.stateTimes(n);
  const work = sim.workUtilization(n) * elapsed * cap;
  const setup = st.setup * cap;
  const down = st.down * cap;
  const idle = Math.max(0, cap * (elapsed - st.off) - work - setup - down);
  return { elapsed, work, setup, down, idle };
}

export function footprint(sim: Simulator, kpi: LineKpi): Footprint {
  const s = settingsOf(sim);
  const hours = Math.max(1e-9, (sim.now - sim.statsStart) / 3600);
  const units = kpi.completed;
  const nodes: NodeFootprint[] = [];
  for (const n of sim.nodes) {
    const d = n.def;
    if (d.type === 'source' || d.type === 'sink') continue;
    const t = stationSeconds(sim, n);
    const kWhWork = (d.powerKw * (t.work + t.setup)) / 3600;
    const kWhIdle = (d.idlePowerKw * (t.idle + t.down)) / 3600;
    const kWh = kWhWork + kWhIdle;
    const factor = d.co2Factor > 0 ? d.co2Factor : s.gridCo2 ?? 0;
    const labor = d.poolId ? 0 : d.operators * (s.laborRate ?? 0) * hours;
    const machine = d.costPerHour * hours;
    const energy = kWh * (s.energyPrice ?? 0);
    const maintenance = (t.down / Math.max(1, d.capacity) / 3600) * (s.maintenanceRate ?? 0);
    const setup = (t.setup / Math.max(1, d.capacity) / 3600) * (d.costPerHour + d.operators * (s.laborRate ?? 0));
    nodes.push({
      id: d.id,
      name: d.name,
      kWh,
      kWhIdle,
      co2: kWh * factor,
      labor,
      machine,
      energy,
      maintenance,
      setup,
      cost: labor + machine + energy + maintenance,
    });
  }
  const pools = sim.pools.map((p) => {
    const busyH = p.units.reduce((a, u) => a + sim.unitBusyTime(u), 0) / 3600;
    const count = p.units.length;
    const kWh = (p.def.powerKw ?? 0) * busyH;
    const labor = p.def.kind === 'operator' ? count * (s.laborRate ?? 0) * hours : 0;
    const vehicle = p.def.kind === 'operator' ? 0 : count * (p.def.costPerHour ?? 0) * hours;
    const co2 = kWh * (s.gridCo2 ?? 0) + (p.def.fuelCo2 ?? 0) * busyH;
    return { id: p.def.id, name: p.def.name, kWh, co2, labor, cost: labor + vehicle + kWh * (s.energyPrice ?? 0) };
  });
  const sum = (f: (n: NodeFootprint) => number) => nodes.reduce((a, n) => a + f(n), 0);
  const poolEnergy = pools.reduce((a, p) => a + p.kWh, 0);
  const kWh = sum((n) => n.kWh) + poolEnergy;
  const kWhIdle = sum((n) => n.kWhIdle);
  const transport = pools.filter((p) => p.labor === 0).reduce((a, p) => a + p.cost, 0);
  const labor = sum((n) => n.labor) + pools.reduce((a, p) => a + p.labor, 0);
  const energy = kWh * (s.energyPrice ?? 0);
  const material = units * (s.materialCost ?? 0);
  const storage = kpi.avgWip * hours * (s.wipCost ?? 0);
  const maintenance = sum((n) => n.maintenance);
  const setup = sum((n) => n.setup);
  const machine = sum((n) => n.machine);
  const total = material + labor + energy + maintenance + setup + transport + storage + machine;
  const shift = (s.duration || 8 * 3600) / 3600 / hours;
  const scope1 = sim.pools.reduce((a, p) => a + (p.def.fuelCo2 ?? 0) * (p.units.reduce((b, u) => b + sim.unitBusyTime(u), 0) / 3600), 0);
  const scope2 = sum((n) => n.co2) + poolEnergy * (s.gridCo2 ?? 0);
  const scope3 = units * (s.materialCo2 ?? 0);
  const co2 = scope1 + scope2 + scope3;
  const per = (v: number) => (units > 0 ? v / units : 0);
  return {
    hours,
    units,
    nodes,
    pools,
    cost: { material, labor, energy, consumables: 0, maintenance, setup, transport, storage, machine, total, perUnit: per(total), perShift: total * shift },
    energy: { kWh, kWhIdle, perUnit: per(kWh), perShift: kWh * shift, efficiency: kWh > 0 ? 1 - kWhIdle / kWh : 1 },
    co2: { scope1, scope2, scope3, total: co2, perUnit: per(co2), perShift: co2 * shift },
  };
}

// ---- Spaghetti chart ----

export interface FlowLeg {
  id: string;
  from: string;
  to: string;
  distance: number;
  moved: number;
  meters: number;
  /** Volta no fluxo (destino a montante da origem). */
  backtrack: boolean;
  /** Anda contra o sentido geral da linha no layout. */
  against: boolean;
  vehicle: boolean;
}

export interface Spaghetti {
  legs: FlowLeg[];
  materialMeters: number;
  metersPerUnit: number;
  operatorMeters: number;
  vehicleMeters: number;
  crossings: number;
  backtrackMeters: number;
  transportShare: number;
}

function segmentsCross(a: number[], b: number[]): boolean {
  const [x1, y1, x2, y2] = a;
  const [x3, y3, x4, y4] = b;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

export function spaghetti(sim: Simulator, kpi: LineKpi): Spaghetti {
  // Ordem no fluxo: busca em largura a partir das fontes pelos links de fluxo.
  const order = new Map<NodeRt, number>();
  const queue = sim.nodes.filter((n) => n.def.type === 'source');
  queue.forEach((n) => order.set(n, 0));
  while (queue.length) {
    const n = queue.shift()!;
    for (const l of n.out) {
      if (order.has(l.to)) continue;
      order.set(l.to, order.get(n)! + 1);
      queue.push(l.to);
    }
  }
  const sources = sim.nodes.filter((n) => n.def.type === 'source');
  const sinks = sim.nodes.filter((n) => n.def.type === 'sink');
  const avgX = (ns: NodeRt[]) => (ns.length ? ns.reduce((a, n) => a + n.def.x, 0) / ns.length : 0);
  const dir = Math.sign(avgX(sinks) - avgX(sources)) || 1;
  const legs: FlowLeg[] = sim.links.map((l) => {
    const dx = (l.to.def.x - l.from.def.x) / sim.ppm;
    return {
      id: l.def.id,
      from: l.from.def.name,
      to: l.to.def.name,
      distance: l.distance,
      moved: l.moved,
      meters: l.distance * l.moved,
      backtrack: (order.get(l.to) ?? 0) <= (order.get(l.from) ?? 0) && !l.isPart,
      against: dx * dir < -1 && !l.isPart,
      vehicle: !!l.pool,
    };
  });
  let crossings = 0;
  const segs = sim.links.map((l) => [l.from.def.x, l.from.def.y, l.to.def.x, l.to.def.y]);
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segmentsCross(segs[i], segs[j])) crossings++;
  const materialMeters = legs.reduce((a, l) => a + l.meters, 0);
  const pools = kpi.pools;
  return {
    legs: legs.sort((a, b) => b.meters - a.meters),
    materialMeters,
    metersPerUnit: kpi.completed > 0 ? materialMeters / kpi.completed : 0,
    operatorMeters: pools.filter((p) => p.kind === 'operator').reduce((a, p) => a + p.distance, 0),
    vehicleMeters: pools.filter((p) => p.kind !== 'operator').reduce((a, p) => a + p.distance, 0),
    crossings,
    backtrackMeters: legs.filter((l) => l.backtrack || l.against).reduce((a, l) => a + l.meters, 0),
    transportShare: kpi.leadTime > 0 ? kpi.transportTime / kpi.leadTime : 0,
  };
}
