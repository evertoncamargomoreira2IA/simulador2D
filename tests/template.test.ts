import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { importWorkbook } from '../src/io/importer';
import { parseTemplate, templateBytes, templateWorkbook } from '../src/io/template';
import { lp2Model } from '../src/model/builder';
import { steadyUph } from '../src/engine/calibrate';
import { cycleRows } from '../src/ui/CycleTakt';
import { chartSequence, isAssembly, makeNode } from '../src/engine/types';

describe('planilha padrão', () => {
  it('exemplo vazio gera uma linha que roda', () => {
    const r = importWorkbook(templateBytes(), 'planilha.xlsx');
    expect(r.info).toMatch(/Planilha padrão/);
    expect(r.model.nodes.length).toBe(11);
    expect(r.model.pools?.[0].id).toBe('AGV1');
    expect(r.model.links.find((l) => l.role === 'part')).toBeTruthy();
    expect(r.keepBackground).toBe(false);
    expect(new Set(r.model.nodes.map((n) => n.x)).size).toBeGreaterThan(3);
    expect(steadyUph(r.model, 2)).toBeGreaterThan(50);
  });

  it('ida e volta mantém o modelo', () => {
    const m = lp2Model();
    const wb = XLSX.read(XLSX.write(templateWorkbook(m), { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const t = parseTemplate(wb, 'lp2');
    expect(t.model.nodes.length).toBe(m.nodes.length);
    expect(t.model.links.length).toBe(m.links.length);
    expect(t.warnings).toEqual([]);
    const a = steadyUph(m, 2);
    const b = steadyUph(t.model, 2);
    expect(Math.abs(a - b)).toBeLessThan(0.5);
  });

  it('avisa sobre ligação para posto inexistente', () => {
    const wb = templateWorkbook();
    XLSX.utils.sheet_add_aoa(wb.Sheets['Ligações'], [['P3', 'XYZ', 1]], { origin: -1 });
    const t = parseTemplate(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' }), 'x');
    expect(t.warnings.join(' ')).toMatch(/XYZ/);
  });
});

describe('cycle × takt', () => {
  it('lista postos na ordem do fluxo e marca off-line', () => {
    const r = importWorkbook(templateBytes(), 'planilha.xlsx');
    const rows = cycleRows(r.model);
    expect(rows[0].name).toBe('Posto 1');
    expect(rows.find((x) => x.name === 'Kit off-line')?.offline).toBe(true);
    expect(rows.find((x) => x.name === 'Teste final')?.plan).toBeCloseTo(600 / 14, 3);
  });
});

describe('sequência dos gráficos e montagem', () => {
  it('chartSequence ordena e esconde', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(chartSequence({ chartOrder: ['c', 'a'], chartHidden: ['d'] }, items).map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(chartSequence({ chartOrder: ['c', 'a'], chartHidden: ['d'] }, items, true).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(chartSequence({}, items).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('isAssembly reconhece flag e ligação de componente', () => {
    const m = makeNode('machine', { id: 'm' });
    expect(isAssembly(m, [])).toBe(false);
    expect(isAssembly({ ...m, assembly: true }, [])).toBe(true);
    expect(isAssembly(m, [{ to: 'm', role: 'part' }])).toBe(true);
  });
});
