import { describe, expect, it } from 'vitest';
import { cycleRows } from '../src/engine/balance';
import { lineKpi } from '../src/engine/metrics';
import { Simulator } from '../src/engine/simulator';
import { baseCycle, operationsTime } from '../src/engine/types';
import { elementsModel } from '../src/model/builder';

describe('estudo por elemento', () => {
  it('usa a soma das atividades no modo elemento e o ciclo do posto no modo cycle time', () => {
    const m = elementsModel();
    const n = m.nodes.find((x) => x.operations?.length)!;
    n.cycleTime = 99;
    expect(baseCycle(n, { studyMode: 'elements' })).toBeCloseTo(operationsTime(n.operations));
    expect(baseCycle(n, { studyMode: 'cycle' })).toBe(99);
    const rows = cycleRows({ ...m, settings: { ...m.settings, studyMode: 'cycle' } });
    expect(rows.find((r) => r.id === n.id)!.raw).toBe(99);
  });

  it('o exemplo roda e fica perto do takt', () => {
    const m = elementsModel();
    const sim = new Simulator(m);
    sim.runToEnd();
    const k = lineKpi(sim);
    expect(sim.error).toBeFalsy();
    expect(k.throughputPerHour).toBeGreaterThan(50);
    expect(k.throughputPerHour).toBeLessThan(80);
  });
});
