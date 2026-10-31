import { describe, expect, it } from 'vitest';
import { lineKpi } from '../src/engine/metrics';
import { Simulator } from '../src/engine/simulator';
import { tenStationModel } from '../src/model/builder';

describe('Linha de 10 postos (versão offline)', () => {
  const m = tenStationModel();
  it('tem 10 postos manuais com 15% de variação, ligados em sequência', () => {
    const st = m.nodes.filter((n) => n.type === 'machine' || n.type === 'inspection');
    expect(st).toHaveLength(10);
    expect(st.every((n) => n.cv === 0.15 && n.manual && n.operators === 1)).toBe(true);
    expect(m.links).toHaveLength(11);
    expect(m.settings.takt).toBe(36);
  });
  it('roda e produz perto do ritmo do gargalo (35 s)', () => {
    const sim = new Simulator(structuredClone(m));
    sim.runToEnd();
    const k = lineKpi(sim);
    expect(k.throughputPerHour).toBeGreaterThan(80);
    expect(k.throughputPerHour).toBeLessThan(103);
  });
});
