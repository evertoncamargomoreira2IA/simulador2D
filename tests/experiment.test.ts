import { describe, expect, it } from 'vitest';
import { applyFactor, combos, evaluate, metaUph, optimize, peopleIn, runExperiment } from '../src/engine/experiment';
import { discoveryDemoModel, mixModel } from '../src/model/builder';

type Model = Parameters<typeof peopleIn>[0];
type Factor = Parameters<typeof applyFactor>[1];

const demo = (): Model => structuredClone(discoveryDemoModel());
function machine(m: Model) {
  const node = m.nodes.find((n) => n.type === 'machine');
  if (!node) throw new Error('O modelo precisa conter um posto.');
  return node;
}
const factor = (kind: Factor['kind'], target: string, values: number[]): Factor => ({ kind, target, values });

describe('peopleIn', () => {
  it('soma operadores elegíveis e pools de operadores sem duplicar pessoas', () => {
    const m = demo();
    const expected =
      m.nodes.reduce((sum, n) => sum + (!['source', 'sink', 'buffer'].includes(n.type) && !n.poolId ? (n.operators ?? 0) : 0), 0) +
      (m.pools ?? []).reduce((sum, p) => sum + (p.kind === 'operator' ? p.count : 0), 0);
    expect(peopleIn(m)).toBe(expected);
  });
});

describe('applyFactor', () => {
  it('devolve uma cópia e não muta o modelo original', () => {
    const m = demo();
    const before = structuredClone(m);
    const node = machine(m);
    const result = applyFactor(m, factor('gigas', node.id, [2]), 2);
    expect(result).not.toBe(m);
    expect(m).toEqual(before);
    expect(result.nodes.find((n) => n.id === node.id)?.capacity).toBe(2);
    machine(result).capacity = 99;
    expect(m).toEqual(before);
  });

  it('arredonda gigas, respeita o mínimo de um e ajusta operadores manuais', () => {
    const m = demo();
    const node = machine(m);
    node.manual = true;
    node.poolId = undefined;
    node.capacity = 1;
    node.operators = 1;
    expect(applyFactor(m, factor('gigas', node.id, [2.6]), 2.6).nodes.find((n) => n.id === node.id)).toMatchObject({ capacity: 3, operators: 3 });
    expect(applyFactor(m, factor('gigas', node.id, [0]), 0).nodes.find((n) => n.id === node.id)).toMatchObject({ capacity: 1, operators: 1 });
  });

  it('reconhece um posto manual pela quantidade de operadores', () => {
    const m = demo();
    const node = machine(m);
    node.manual = false;
    node.poolId = undefined;
    node.capacity = 2;
    node.operators = 2;
    expect(applyFactor(m, factor('gigas', node.id, [4]), 4).nodes.find((n) => n.id === node.id)).toMatchObject({ capacity: 4, operators: 4 });
  });

  it('preserva operadores quando o posto usa um pool', () => {
    const m = demo();
    const node = machine(m);
    node.manual = true;
    node.poolId = 'pool-teste';
    node.operators = 2;
    expect(applyFactor(m, factor('gigas', node.id, [4]), 4).nodes.find((n) => n.id === node.id)).toMatchObject({ capacity: 4, operators: 2 });
  });

  it('limita o tempo a 0.1 e remove tempos por produto', () => {
    const m = demo();
    const node = machine(m);
    const before = structuredClone(m);
    const changed = applyFactor(m, factor('tempo', node.id, [0]), 0).nodes.find((n) => n.id === node.id);
    expect(changed?.cycleTime).toBe(0.1);
    expect(changed?.productTimes).toBeUndefined();
    expect(m).toEqual(before);
    expect(applyFactor(m, factor('tempo', node.id, [12.5]), 12.5).nodes.find((n) => n.id === node.id)?.cycleTime).toBe(12.5);
  });

  it('arredonda a capacidade da fila', () => {
    const m = demo();
    const node = machine(m);
    expect(applyFactor(m, factor('fila', node.id, [7.6]), 7.6).nodes.find((n) => n.id === node.id)?.queueCap).toBe(8);
  });
});

describe('combos', () => {
  it('gera o fatorial completo na ordem dos fatores', () => {
    expect(combos([factor('gigas', 'posto', [1, 2]), factor('tempo', 'posto', [3, 4, 5])])).toEqual([
      [1, 3], [1, 4], [1, 5], [2, 3], [2, 4], [2, 5],
    ]);
  });
  it('gera uma combinação por valor de um único fator', () => {
    expect(combos([factor('gigas', 'posto', [1, 2, 3])])).toEqual([[1], [2], [3]]);
  });
});

describe('evaluate', () => {
  it('é determinístico para chamadas com os mesmos parâmetros', () => {
    const m = demo();
    const before = structuredClone(m);
    const first = evaluate(m, 3, 2);
    const second = evaluate(m, 3, 2);
    expect(first.uph.mean).toBe(second.uph.mean);
    expect(first.uph.mean).toBeGreaterThan(0);
    expect(first.uph.half).toBeGreaterThanOrEqual(0);
    expect(first.util).toBeInstanceOf(Map);
    expect(m).toEqual(before);
  });
});

describe('runExperiment', () => {
  it('mais gigas no gargalo não reduz o UPH além da tolerância', () => {
    const m = demo();
    const baseline = evaluate(m, 3, 2);
    const bottleneck = m.nodes.find((n) => n.id === baseline.bottleneck);
    if (!bottleneck) throw new Error('Gargalo não encontrado no modelo.');
    const low = Math.max(1, bottleneck.capacity);
    const high = low + 1;
    const before = structuredClone(m);
    const results = runExperiment(m, [factor('gigas', bottleneck.id, [low, high])], 3, 2);
    expect(results.map((r) => r.values)).toEqual([[low], [high]]);
    expect(results[1].uph.mean).toBeGreaterThanOrEqual(results[0].uph.mean - 1);
    for (const r of results) {
      expect(typeof r.meets).toBe('boolean');
      expect(r.people).toBe(peopleIn(applyFactor(m, factor('gigas', bottleneck.id, []), r.values[0])));
    }
    expect(m).toEqual(before);
  });
});

describe('metaUph', () => {
  it('retorna uma meta positiva para os modelos de exemplo', () => {
    expect(metaUph(demo())).toBeGreaterThan(0);
    expect(metaUph(mixModel())).toBeCloseTo(90, 0);
  });
});

describe('optimize', () => {
  it('atinge a meta da demonstração adicionando gigas e preserva o original', () => {
    const m = demo();
    const before = structuredClone(m);
    const result = optimize(m, { hours: 4, reps: 3 });
    expect(result.steps[0].action).toBe('Linha atual');
    expect(result.meets).toBe(true);
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.steps.at(-1)!.uph).toBeGreaterThan(result.steps[0].uph);
    for (const c of result.changes) expect(c.after).not.toBe(c.before);
    expect(m).toEqual(before);
  }, 60_000);

  it('termina sem atingir uma meta inviável e respeita maxGigas', () => {
    const m = demo();
    const result = optimize(m, { target: 10_000, maxGigas: 3, maxSteps: 30, hours: 2, reps: 3 });
    expect(result.steps[0].action).toBe('Linha atual');
    expect(result.meets).toBe(false);
    for (const n of result.model.nodes.filter((x) => x.type === 'machine')) expect(n.capacity).toBeLessThanOrEqual(3);
  }, 60_000);
});
