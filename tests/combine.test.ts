import { describe, expect, it } from 'vitest';
import { lineKpi } from '../src/engine/metrics';
import { Simulator } from '../src/engine/simulator';
import { DEFAULT_SETTINGS, makeNode, makePool, type LinkDef, type Model, type NodeDef } from '../src/engine/types';

let k = 0;
const link = (from: string, to: string, extra: Partial<LinkDef> = {}): LinkDef => ({ id: `L${k++}`, from, to, weight: 1, ...extra });
const node = (type: NodeDef['type'], id: string, x: number, extra: Partial<NodeDef> = {}) =>
  makeNode(type, { id, name: id, x, y: 100, cv: 0, ...extra });
const model = (nodes: NodeDef[], links: LinkDef[], extra: Partial<Model> = {}): Model => ({
  name: 't',
  nodes,
  links,
  settings: { ...DEFAULT_SETTINGS, duration: 3600, transportSpeed: 0 },
  ...extra,
});

describe('peças por viagem e combinar peças', () => {
  const trip = (q?: number) => {
    const op = makePool('operator', { id: 'OP', count: 1, x: 200, y: 100, speed: 1 });
    const m = model(
      [
        node('source', 'MP', 0),
        node('machine', 'A', 100, { cycleTime: 30 }),
        node('machine', 'B', 400, { cycleTime: 20, queueCap: 20 }),
        node('sink', 'FG', 500),
      ],
      [link('MP', 'A'), link('A', 'B', { poolId: 'OP', tripQty: q }), link('B', 'FG')],
      { pools: [op] },
    );
    m.settings.pxPerMeter = 40;
    const sim = new Simulator(m);
    sim.runToEnd();
    return { sim, kpi: lineKpi(sim) };
  };

  it('operador leva várias peças por viagem e faz menos viagens', () => {
    const one = trip();
    const five = trip(5);
    expect(five.kpi.throughputPerHour).toBeGreaterThan(110);
    expect(five.sim.pools[0].requests).toBeLessThan(one.sim.pools[0].requests / 3);
    const inNodes = five.sim.nodes.reduce((s, n) => s + five.sim.nodeWip(n), 0);
    expect(inNodes + five.sim.transits.size).toBe(five.sim.wip);
  });

  it('posto junta 3 peças de 3 postos e respeita a quantidade por produto', () => {
    const m = model(
      [
        node('source', 'S1', 0),
        node('source', 'S2', 0),
        node('source', 'S3', 0),
        node('machine', 'P1', 100, { cycleTime: 10 }),
        node('machine', 'P2', 100, { cycleTime: 10 }),
        node('machine', 'P3', 100, { cycleTime: 10 }),
        node('machine', 'X', 200, { cycleTime: 20, partBuffer: 2 }),
        node('sink', 'FG', 300),
      ],
      [
        link('S1', 'P1'),
        link('S2', 'P2'),
        link('S3', 'P3'),
        link('P1', 'X'),
        link('P2', 'X', { role: 'part' }),
        link('P3', 'X', { role: 'part', partQty: 4 }),
        link('X', 'FG'),
      ],
    );
    const sim = new Simulator(m);
    sim.runToEnd();
    const kpi = lineKpi(sim);
    // P3 faz 360/h e cada produto leva 4: no máximo 90 produtos/h
    expect(kpi.throughputPerHour).toBeGreaterThan(80);
    expect(kpi.throughputPerHour).toBeLessThanOrEqual(91);
    expect(kpi.consumed).toBeGreaterThanOrEqual(kpi.completed * 5);
  });
});

describe('dois postos abastecendo o mesmo destino com peças por viagem', () => {
  it('não trava quando o destino não comporta duas viagens cheias', () => {
    const op = makePool('operator', { id: 'OP', count: 1, x: 300, y: 200, speed: 1 });
    const m = model(
      [
        node('source', 'S1', 0),
        node('source', 'S2', 0),
        node('machine', 'A', 100, { cycleTime: 10 }),
        node('machine', 'B', 100, { cycleTime: 10 }),
        node('machine', 'X', 400, { cycleTime: 8, queueCap: 4, batchSize: 2 }),
        node('sink', 'FG', 500),
      ],
      [link('S1', 'A'), link('S2', 'B'), link('A', 'X', { poolId: 'OP', tripQty: 4 }), link('B', 'X', { poolId: 'OP', tripQty: 4 }), link('X', 'FG')],
      { pools: [op] },
    );
    m.settings.pxPerMeter = 40;
    const sim = new Simulator(m);
    sim.runToEnd();
    expect(lineKpi(sim).throughputPerHour).toBeGreaterThan(100);
  });
  it('carrinhos/bins por item: AMR leva o carrinho inteiro de cada item para a montagem', () => {
    // 50 do item B e 20 do item A, um AMR, montagem de 30 s
    let k = 0;
    const L = (from: string, to: string, x: Partial<LinkDef> = {}): LinkDef => ({ id: `B${k++}`, from, to, weight: 1, ...x });
    const N = (t: NodeDef['type'], id: string, x: number, y: number, e: Partial<NodeDef> = {}) => makeNode(t, { id, name: id, x, y, cv: 0, ...e });
    const m: Model = {
      name: 'bins',
      nodes: [N('source', 'S', 0, 200), N('machine', 'P1', 150, 200, { cycleTime: 30 }), N('machine', 'X', 400, 200, { cycleTime: 30, assembly: true, partBuffer: 2 }), N('sink', 'FG', 550, 200),
        N('source', 'SB', 0, 400), N('buffer', 'BufB', 150, 400, { capacity: 200 }), N('source', 'SA', 0, 0), N('buffer', 'BufA', 150, 0, { capacity: 200 })],
      links: [L('S', 'P1'), L('P1', 'X'), L('X', 'FG'), L('SB', 'BufB'), L('BufB', 'X', { role: 'part', poolId: 'AMR', tripQty: 50 }), L('SA', 'BufA'), L('BufA', 'X', { role: 'part', poolId: 'AMR', tripQty: 20 })],
      pools: [makePool('amr', { id: 'AMR', name: 'AMR', count: 1, speed: 1, loadTime: 10, x: 300, y: 300 })],
      settings: { ...DEFAULT_SETTINGS, duration: 4 * 3600 },
    };
    const s = new Simulator(m);
    s.runToEnd();
    // a montagem roda no ritmo dela (~120/h), sem cair para viagens de 1 peça
    expect(s.completed).toBeGreaterThan(4 * 110);
    const bins = s.links.filter((l) => l.isPart);
    expect(bins.map((l) => s.binCap(l))).toEqual([100, 40]);
    for (const l of bins) expect(s.binHave(l)).toBeLessThanOrEqual(s.binCap(l));
    // viagens cheias: o AMR fez poucas viagens (peças / viagem)
    expect(s.pools[0].requests).toBeLessThan((s.completed * 2) / 20 + 10);
  });
});
