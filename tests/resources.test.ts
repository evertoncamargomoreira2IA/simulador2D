import { describe, expect, it } from 'vitest';
import { lineKpi } from '../src/engine/metrics';
import { Simulator } from '../src/engine/simulator';
import { DEFAULT_SETTINGS, makeNode, makePool, type LinkDef, type Model, type NodeDef } from '../src/engine/types';

let k = 0;
const link = (from: string, to: string, extra: Partial<LinkDef> = {}): LinkDef => ({ id: `L${k++}`, from, to, weight: 1, ...extra });
const node = (type: NodeDef['type'], id: string, x: number, extra: Partial<NodeDef> = {}) =>
  makeNode(type, { id, name: id, x, y: 100, cv: 0, ...extra });

function model(nodes: NodeDef[], links: LinkDef[], extra: Partial<Model> = {}): Model {
  return { name: 't', nodes, links, settings: { ...DEFAULT_SETTINGS, duration: 3600, transportSpeed: 0 }, ...extra };
}

describe('Sprint 2: montagem, operadores e transporte', () => {
  it('montagem consome um componente por peça e limita pela submontagem mais lenta', () => {
    const m = model(
      [
        node('source', 'MP', 0),
        node('machine', 'M1', 100, { cycleTime: 10 }),
        node('sink', 'FG', 200),
        node('source', 'MPsub', 100),
        node('machine', 'SUB', 100, { cycleTime: 20 }),
      ],
      [link('MP', 'M1'), link('M1', 'FG'), link('MPsub', 'SUB'), link('SUB', 'M1', { role: 'part' })],
    );
    const sim = new Simulator(m);
    sim.runToEnd();
    const kpi = lineKpi(sim);
    expect(kpi.throughputPerHour).toBeGreaterThan(170);
    expect(kpi.throughputPerHour).toBeLessThanOrEqual(181);
    expect(kpi.consumed).toBeGreaterThanOrEqual(kpi.completed);
    const inNodes = sim.nodes.reduce((s, n) => s + sim.nodeWip(n), 0);
    expect(inNodes + sim.transits.size).toBe(sim.wip);
  });

  it('teste com 6 gigas e 2 operadores: gigas limitam, operadores fazem só carga/descarga', () => {
    const pool = makePool('operator', { id: 'OP', count: 2, x: 300, y: 100, speed: 1 });
    const m = model(
      [
        node('source', 'MP', 0),
        node('machine', 'PST', 300, { cycleTime: 150, capacity: 6, queueCap: 2, poolId: 'OP', handlingTime: 30 }),
        node('sink', 'FG', 600),
      ],
      [link('MP', 'PST'), link('PST', 'FG')],
      { pools: [pool] },
    );
    m.settings.pxPerMeter = 40;
    const sim = new Simulator(m);
    sim.runToEnd();
    const kpi = lineKpi(sim);
    // 6 gigas / (150 s + 30 s de manuseio) = 120 peças/h
    expect(kpi.throughputPerHour).toBeGreaterThan(110);
    expect(kpi.throughputPerHour).toBeLessThanOrEqual(121);
    const ops = kpi.pools[0];
    expect(ops.utilization).toBeGreaterThan(0.4);
    expect(ops.utilization).toBeLessThan(0.6);
  });

  it('operadores insuficientes viram o gargalo e o posto espera recurso', () => {
    const pool = makePool('operator', { id: 'OP', count: 1, x: 300, y: 100 });
    const m = model(
      [
        node('source', 'MP', 0),
        node('machine', 'T', 300, { cycleTime: 60, capacity: 6, queueCap: 2, poolId: 'OP', handlingTime: 0 }),
        node('sink', 'FG', 600),
      ],
      [link('MP', 'T'), link('T', 'FG')],
      { pools: [pool] },
    );
    const sim = new Simulator(m);
    sim.runToEnd();
    const kpi = lineKpi(sim);
    expect(kpi.throughputPerHour).toBeLessThanOrEqual(61);
    expect(kpi.pools[0].utilization).toBeGreaterThan(0.95);
    // só uma giga trabalha por vez: 1/6 de utilização das gigas
    expect(kpi.nodes.find((n) => n.id === 'T')!.utilization).toBeLessThan(0.2);
  });

  it('empilhadeira leva as peças e acumula distância', () => {
    const fork = makePool('forklift', { id: 'FK', count: 1, speed: 2, loadTime: 10, x: 0, y: 100 });
    const m = model(
      [node('source', 'MP', 0), node('machine', 'M', 40, { cycleTime: 60 }), node('sink', 'FG', 40 + 400)],
      [link('MP', 'M'), link('M', 'FG', { poolId: 'FK' })],
      { pools: [fork] },
    );
    m.settings.pxPerMeter = 40;
    const sim = new Simulator(m);
    sim.runToEnd();
    const kpi = lineKpi(sim);
    // a máquina fica bloqueada esperando a empilhadeira: ~85 s por peça em vez de 60 s
    expect(kpi.completed).toBeGreaterThan(40);
    // 10 m ida e 10 m volta por viagem
    expect(kpi.pools[0].distance / kpi.completed).toBeGreaterThan(15);
    expect(kpi.pools[0].utilization).toBeGreaterThan(0.3);
  });
});
