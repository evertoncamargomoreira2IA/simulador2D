import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { mergeSoe, parseSoe, soeSheets } from '../src/io/soe';
import { elementsModel } from '../src/model/builder';

const wb = (rows: unknown[][]) => {
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([['Resumo']]), 'Capa');
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet(rows), 'SOE');
  return w;
};

describe('importação de SOE', () => {
  it('lê blocos fechados por linha de soma, operações nomeadas e tempo com allowance', () => {
    const w = wb([
      ['', '', '', '', '', 48],
      ['SETOR', 'POSTOS', 'ATIVIDADES', 'TEMPO', 'TEMPO C/ ALLOWANCE', 'TAKT'],
      ['MAIN', 1, 'Pegar base e posicionar', 2, 2.2],
      ['', '', 'Colar etiqueta', 7, 7.7],
      ['', 'RFID', 'Colar etiqueta RFID', 7, 7.7],
      ['', '', '', 16, 17.6],
      ['', 'ROBO', 'Aplicar graxa', 6, 6.6, 'Robo'],
      ['', 2, 'Aplicar graxa 2', 14, 15.4, 'Robo'],
      ['', '', '', 20, 22],
    ]);
    expect(soeSheets(w)).toEqual(['SOE']);
    const r = parseSoe(w, 'SOE');
    expect(r.takt).toBe(48);
    expect(r.stations.map((s) => s.name)).toEqual(['Posto 1', 'Posto 2']);
    expect(r.stations[0].operations.map((o) => o.name)).toEqual(['Montagem', 'RFID']);
    expect(r.stations[0].total).toBeCloseTo(17.6);
    expect(r.stations[0].operations[0].activities[0].kind).toBe('nva');
    expect(r.stations[1].operations[0].name).toBe('ROBO');
  });

  it('planilha sem linhas de soma: muda de posto quando muda o número', () => {
    const w = wb([
      ['Posto', 'Operação', 'Atividade', 'Tempo (s)', 'Tipo'],
      ['1', 'Base', 'Montar base', 10, 'VA'],
      ['1', 'Base', 'Andar até o kanban', 4, ''],
      ['2', 'Placa', 'Encaixar placa', 12, 'VA'],
    ]);
    const r = parseSoe(w, 'SOE');
    expect(r.stations.map((s) => [s.name, s.total])).toEqual([
      ['Posto 1', 14],
      ['Posto 2', 12],
    ]);
    expect(r.stations[0].operations[0].activities[1].kind).toBe('walk');
  });

  it('aplica nos postos de mesmo nome do modelo aberto', () => {
    const m = elementsModel();
    m.nodes[1].name = 'Posto 1';
    const w = wb([
      ['Posto', 'Atividade', 'Tempo'],
      ['1', 'Montar', 30],
    ]);
    const { model, matched } = mergeSoe(m, parseSoe(w, 'SOE'));
    expect(matched).toBe(1);
    expect(model.nodes[1].cycleTime).toBe(30);
    expect(model.nodes[1].operations![0].activities[0].name).toBe('Montar');
  });
});

describe('SOE no formato Station / Task Description', () => {
  it('cada Station vira um posto e "Total time study" fecha o bloco', () => {
    const w = wb([
      ['Station', '', 'Task Description', '', 'Time Study', 'Ave observed time', 'Rating', 'Basic cycle time'],
      ['', '', '', '', 1, '', '', ''],
      ['Bulk 1', 1, 'Abrir a tampa', '', 10, 10, 1.1, 11],
      ['', 2, 'Colar pelicula', '', 4, 4, 1.1, 4.4],
      ['', '', 'Total time study', '', 14, 14, '', 15.4],
      ['OFF LINE 2', 1, 'Posicionar o motor', '', 5, 5, 1, 5],
    ]);
    const r = parseSoe(w, 'SOE');
    expect(r.stations.map((s) => [s.name, Math.round(s.total * 10) / 10])).toEqual([
      ['Bulk 1', 15.4],
      ['OFF LINE 2', 5],
    ]);
  });
});
