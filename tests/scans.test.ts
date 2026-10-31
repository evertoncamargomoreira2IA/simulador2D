import { describe, expect, it } from 'vitest';
import { scanCycle, scansToEvents } from '../src/engine/scans';
import { studyEvents } from '../src/engine/timeStudy';
import { eventsFromRows } from '../src/io/realFeed';
import { tenStationModel } from '../src/model/builder';

describe('Coleta por escaneamento', () => {
  it('ciclo = intervalo entre scans seguidos no mesmo posto', () => {
    const ev = scansToEvents([
      { posto: 'Posto 1', serie: 'A', hora: 0 },
      { posto: 'Posto 1', serie: 'B', hora: 32 },
      { posto: 'Posto 2', serie: 'A', hora: 10 },
      { posto: 'Posto 1', serie: 'C', hora: 66 },
    ]);
    expect(ev.filter((e) => e.posto === 'Posto 1').map((e) => e.fim - e.inicio)).toEqual([32, 34]);
    expect(ev.filter((e) => e.posto === 'Posto 2')).toHaveLength(0);
  });

  it('descarta intervalos fora de média ± 2 desvios (parada, almoço)', () => {
    const xs = [32, 33, 31, 34, 32, 33, 31, 32, 33, 34, 32, 31, 600];
    const c = scanCycle(xs);
    expect(c.out).toEqual([600]);
    expect(c.mean).toBeGreaterThan(31);
    expect(c.mean).toBeLessThan(34);
  });

  it('a planilha/API só com a hora do scan vira ciclo por posto', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ posto: 'Posto 1', serie: `SN${i}`, hora: `08:${String(Math.floor((i * 32) / 60)).padStart(2, '0')}:${String((i * 32) % 60).padStart(2, '0')}` }));
    rows.push({ posto: 'Posto 1', serie: 'SN99', hora: '09:30:00' });
    const ev = eventsFromRows(rows);
    expect(ev).toHaveLength(30);
    const st = studyEvents(ev, tenStationModel());
    expect(st[0].mean).toBeCloseTo(32, 0);
    expect(st[0].out.length).toBeGreaterThan(0);
  });
});
