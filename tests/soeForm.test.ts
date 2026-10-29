import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { soeFormBytes, soeFormWorkbook } from '../src/io/soeForm';
import { parseSoe, soeSheets } from '../src/io/soe';

describe('formulário Yamazumi (padrão SOE)', () => {
  it('ida e volta: cada posto do formulário vira um posto com as mesmas atividades', () => {
    const { bytes } = soeFormBytes();
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(soeSheets(wb)).toEqual(['SOE']);
    const soe = parseSoe(wb, 'SOE');
    expect(soe.stations.length).toBe(7);
    expect(soe.stations[0].name).toMatch(/Posto 1/);
    expect(soe.stations[0].operations.length).toBe(3);
    // importa o tempo com allowance (10%)
    const raw = soe.stations[0].operations.flatMap((o) => o.activities).reduce((s, a) => s + a.time, 0);
    expect(raw).toBeCloseTo(40 * 1.1, 0);
  });

  it('posto com nome de texto e tipos do SOE', () => {
    const wb = soeFormWorkbook(
      [
        { name: '1', operations: [{ name: 'Base', activities: [{ name: 'Pegar base', time: 3, kind: 'nva' }, { name: 'Colar etiqueta', time: 7, kind: 'va' }] }] },
        { name: 'Robô', operations: [{ name: 'Graxa', activities: [{ name: 'Aplicar graxa', time: 14, kind: 'machine' }] }] },
      ],
      { takt: 48, allowance: 0 },
    );
    const soe = parseSoe(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' }), 'SOE');
    expect(soe.stations.map((s) => s.name)).toEqual(['Posto 1', 'Robô']);
    expect(soe.stations[1].operations[0].activities[0].kind).toBe('machine');
    expect(soe.takt).toBe(48);
  });
});
