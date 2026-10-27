import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importWorkbook } from '../src/io/importer';
import { modelRows, toCsv } from '../src/io/exporter';
import { Simulator } from '../src/engine/simulator';
import { lineKpi } from '../src/engine/metrics';
import { simpleModel } from '../src/model/builder';

describe('importação', () => {
  it('CSV simples em sequência ganha Source e Finished Goods', () => {
    const csv = 'nome,tempo_ciclo\nCorte,10\nSolda,14\nInspeção final,6\nRetrabalho,30\nEmbalagem,9';
    const { model } = importWorkbook(csv, 'linha.csv');
    expect(model.nodes.map((n) => n.type)).toEqual(['source', 'machine', 'machine', 'inspection', 'rework', 'machine', 'sink']);
    const sim = new Simulator(model);
    sim.runToEnd();
    expect(lineKpi(sim).nodes.find((n) => n.name === 'Solda')!.id).toBe(lineKpi(sim).bottleneckId);
  });

  it('exportar CSV e reimportar preserva blocos e rotas', () => {
    const m = simpleModel();
    const { model } = importWorkbook(toCsv(modelRows(m)), 'x.csv');
    expect(model.nodes).toHaveLength(m.nodes.length);
    expect(model.links).toHaveLength(m.links.length);
    expect(model.nodes[1].x).toBe(Math.round(m.nodes[1].x));
  });

  const pcp = process.env.PCP_XLSX;
  it.skipIf(!pcp || !existsSync(pcp))('PCP LP2 (planilha real)', () => {
    const buf = readFileSync(pcp!);
    const { model, info } = importWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'LP2.xlsx');
    expect(info).toContain('70 postos');
    expect(model.nodes.filter((n) => n.type === 'rework')).toHaveLength(5);
  });
});
