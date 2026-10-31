import { describe, expect, it } from 'vitest';
import { studyEvents } from '../src/engine/timeStudy';
import { simulatedFeed } from '../src/io/realFeed';
import { supplyModel } from '../src/model/builder';
import { curveRows, reliabilityOf } from '../src/ui/StationCurves';

describe('Curva normal por posto', () => {
  it('classifica a confiabilidade pelo CV', () => {
    expect(reliabilityOf(0.03)).toBe('Alta');
    expect(reliabilityOf(0.08)).toBe('Média');
    expect(reliabilityOf(0.2)).toBe('Baixa');
  });

  it('monta uma curva por posto com frações entre 0 e 1', () => {
    const m = supplyModel();
    const ev = simulatedFeed(m, { hours: 1, glitch: 0.03, opCv: 0.12, drift: 0.15 });
    const rows = curveRows(studyEvents(ev, m), ev, m, 2, 0.1, 36);
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) {
      expect(r.sd).toBeGreaterThan(0);
      expect(r.inSoe).toBeGreaterThanOrEqual(0);
      expect(r.inSoe).toBeLessThanOrEqual(1);
      expect(r.overTakt).toBeGreaterThanOrEqual(0);
      expect(r.overTakt).toBeLessThanOrEqual(1);
    }
    // o teste tem 4 bancadas: o limite do takt é 4 × 36 s
    expect(rows.find((r) => r.id === 'TST')?.limit).toBe(144);
  });
});
