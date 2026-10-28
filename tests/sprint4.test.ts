import { describe, expect, it } from 'vitest';
import { applyAction, lineBalance, suggest } from '../src/engine/advisor';
import { footprint, spaghetti } from '../src/engine/analytics';
import { calibrateToTakt, steadyUph } from '../src/engine/calibrate';
import { lineKpi } from '../src/engine/metrics';
import { Simulator } from '../src/engine/simulator';
import { DEFAULT_SETTINGS, makeNode, makePool, type LinkDef, type Model, type NodeDef } from '../src/engine/types';

let k = 0;
const link = (from: string, to: string, extra: Partial<LinkDef> = {}): LinkDef => ({ id: `L${k++}`, from, to, weight: 1, ...extra });
const node = (type: NodeDef['type'], id: string, x: number, extra: Partial<NodeDef> = {}) =>
  makeNode(type, { id, name: id, x, y: 100, cv: 0.05, ...extra });

function line(ct = 55, extra: Partial<Model['settings']> = {}): Model {
  return {
    name: 'linha',
    nodes: [
      node('source', 'IN', 0),
      node('machine', 'A', 100, { cycleTime: ct * 0.9, powerKw: 1, idlePowerKw: 0.2 }),
      node('machine', 'B', 200, { cycleTime: ct, powerKw: 1, idlePowerKw: 0.2 }),
      node('inspection', 'T', 300, { cycleTime: 600, capacity: 14, queueCap: 20, fixedTime: true, operators: 0 }),
      node('machine', 'PACK', 400, { cycleTime: ct * 0.8 }),
      node('inspection', 'OBA', 400, { cycleTime: 900, capacity: 3, queueCap: 10, fixedTime: true }),
      node('sink', 'FG', 500),
    ],
    links: [
      link('IN', 'A'),
      link('A', 'B'),
      link('B', 'T'),
      link('T', 'PACK'),
      link('PACK', 'FG', { weight: 90 }),
      link('PACK', 'OBA', { weight: 10, once: true, poolId: 'AGV', length: 50 }),
      link('OBA', 'PACK', { poolId: 'AGV', length: 50 }),
    ],
    pools: [makePool('agv', { id: 'AGV', count: 1, x: 400, y: 140 })],
    settings: { ...DEFAULT_SETTINGS, duration: 4 * 3600, takt: 50.7, ...extra },
  };
}

describe('Sprint 4: linha cheia, calibração e amostragem OBA', () => {
  it('linha cheia mede o UPH de regime desde o primeiro minuto', () => {
    const cold = new Simulator(line(48));
    cold.runToEnd();
    const full = new Simulator({ ...line(48), settings: { ...line(48).settings, startFull: true } });
    full.runToEnd();
    expect(full.clock).toBeCloseTo(4 * 3600, 0);
    expect(lineKpi(full).throughputPerHour).toBeGreaterThan(lineKpi(cold).throughputPerHour + 1.5);
    expect(full.timeline[0].t).toBeGreaterThanOrEqual(full.t0);
  });

  it('amostra do OBA volta ao posto uma única vez e o loop não trava', () => {
    const sim = new Simulator({ ...line(48), settings: { ...line(48).settings, startFull: true, duration: 8 * 3600 } });
    sim.runToEnd();
    const kpi = lineKpi(sim);
    expect(kpi.throughputPerHour).toBeGreaterThan(65);
    const oba = sim.byId.get('OBA')!;
    const pack = sim.byId.get('PACK')!;
    // ~10% das peças vão ao OBA e nenhuma volta para lá de novo.
    expect(oba.processed / pack.processed).toBeGreaterThan(0.05);
    expect(oba.processed / pack.processed).toBeLessThan(0.15);
  });

  it('calibração escala só os tempos não fixos e atinge o takt', () => {
    const m = line(55);
    expect(steadyUph(m)).toBeLessThan(70);
    const c = calibrateToTakt(m);
    expect(c.factor).toBeLessThan(1);
    expect(c.uph).toBeGreaterThanOrEqual(70.5);
    expect(c.model.nodes.find((n) => n.id === 'T')!.cycleTime).toBe(600);
    expect(c.model.nodes.find((n) => n.id === 'B')!.cycleTime).toBeLessThan(55);
  });
});

describe('Sprints 3 a 8: análises e IA explicável', () => {
  const sim = new Simulator({ ...line(48), settings: { ...line(48).settings, startFull: true } });
  sim.runToEnd();
  const kpi = lineKpi(sim);

  it('custo, energia e carbono por peça', () => {
    const fp = footprint(sim, kpi);
    expect(fp.energy.kWh).toBeGreaterThan(0);
    expect(fp.energy.efficiency).toBeGreaterThan(0.5);
    expect(fp.cost.labor).toBeGreaterThan(0);
    expect(fp.cost.perUnit).toBeCloseTo(fp.cost.total / kpi.completed, 6);
    expect(fp.co2.scope2).toBeCloseTo(fp.energy.kWh * (DEFAULT_SETTINGS.gridCo2 ?? 0), 6);
  });

  it('spaghetti aponta a volta do OBA e soma a movimentação', () => {
    const sp = spaghetti(sim, kpi);
    expect(sp.materialMeters).toBeGreaterThan(0);
    expect(sp.legs.find((l) => l.from === 'OBA')!.backtrack).toBe(true);
  });

  it('sugestões citam o gargalo e as ações são aplicáveis', () => {
    const list = suggest(sim.model, sim, kpi);
    expect(list.length).toBeGreaterThan(0);
    const withAction = list.find((s) => s.action?.kind === 'capacity');
    if (withAction) {
      const m2 = applyAction(sim.model, withAction.action!);
      expect(m2.nodes.find((n) => n.id === (withAction.action as { nodeId: string }).nodeId)!.capacity).toBe(2);
    }
    expect(lineBalance(sim.model).efficiency).toBeGreaterThan(0.7);
  });
});
