import { describe, expect, it } from 'vitest';
import { lineKpi } from '../src/engine/metrics';
import { Simulator } from '../src/engine/simulator';
import { DEFAULT_SETTINGS, makeNode, makePool, type LinkDef, type Model, type NodeDef } from '../src/engine/types';

let k = 0;
const link = (from: string, to: string, extra: Partial<LinkDef> = {}): LinkDef => ({ id: `L${k++}`, from, to, weight: 1, ...extra });
const node = (type: NodeDef['type'], id: string, x: number, extra: Partial<NodeDef> = {}) =>
  makeNode(type, { id, name: id, x, y: 100, cv: 0, ...extra });

function expedition(): Model {
  return {
    name: 'expedição',
    nodes: [
      node('source', 'IN', 0),
      node('machine', 'M', 100, { cycleTime: 50 }),
      node('machine', 'CART', 200, { cycleTime: 0, batchSize: 15, capacity: 2, queueCap: 0, operators: 0, outputPoint: true }),
      node('machine', 'PALLET', 300, { cycleTime: 120, batchSize: 48, queueCap: 15 }),
      node('machine', 'WRAP', 400, { cycleTime: 300, queueCap: 1 }),
      node('buffer', 'TRANSF', 500, { capacity: 4 }),
      node('sink', 'WH', 600),
    ],
    links: [
      link('IN', 'M'),
      link('M', 'CART'),
      link('CART', 'PALLET', { poolId: 'AGV', length: 200 }),
      link('PALLET', 'WRAP'),
      link('WRAP', 'TRANSF'),
      link('TRANSF', 'WH', { poolId: 'FORK', length: 60 }),
    ],
    pools: [
      makePool('agv', { id: 'AGV', count: 1, speed: 1, loadTime: 30, x: 200, y: 140 }),
      makePool('forklift', { id: 'FORK', count: 1, speed: 1.5, loadTime: 20, x: 500, y: 140 }),
    ],
    settings: { ...DEFAULT_SETTINGS, duration: 8 * 3600, takt: 50, transportSpeed: 0 },
  };
}

describe('Sprint 3: carrinhos, pallets e expedição', () => {
  it('mede a produção no ponto da linha e expede pallets de 48', () => {
    const sim = new Simulator(expedition());
    sim.runToEnd();
    const kpi = lineKpi(sim);
    // Linha a 50 s: ~72 pç/h medidas na entrada do carrinho.
    expect(kpi.throughputPerHour).toBeGreaterThan(70);
    expect(kpi.completed).toBeGreaterThan(560);
    // Pallets inteiros chegam ao warehouse.
    expect(kpi.shippedLoads).toBeGreaterThan(8);
    expect(kpi.shipped).toBe(kpi.shippedLoads * 48);
    // Conservação de unidades: nós + trânsito = WIP.
    let inTransit = 0;
    for (const t of sim.transits) inTransit += t.entity.qty;
    const inNodes = sim.nodes.reduce((s, n) => s + sim.nodeWip(n), 0);
    expect(inNodes + inTransit).toBe(sim.wip);
  });

  it('AGV percorre a distância real do link (200 m) e não vira gargalo', () => {
    const sim = new Simulator(expedition());
    sim.runToEnd();
    const kpi = lineKpi(sim);
    const agv = kpi.pools.find((p) => p.id === 'AGV')!;
    // ~37 carrinhos × 400 m ida e volta.
    expect(agv.distance).toBeGreaterThan(30 * 380);
    expect(agv.utilization).toBeGreaterThan(0.3);
    expect(agv.utilization).toBeLessThan(0.9);
  });

  it('total cycle time soma o trabalho, lead time inclui esperas', () => {
    const sim = new Simulator(expedition());
    sim.runToEnd();
    const kpi = lineKpi(sim);
    expect(kpi.totalCycleTime).toBeCloseTo(50, 0);
    expect(kpi.leadTime).toBeGreaterThanOrEqual(kpi.totalCycleTime);
  });
});
