// Formulário da linha completa: várias abas de SOE + Postos, Indiretos e Config.
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { appendLineSheets, blockNames, lineModel, parseLineWorkbook } from '../src/io/lineForm';
import { buildRouting } from '../src/engine/routing';
import { makeNode, type Model } from '../src/engine/types';

const HEAD = ['', 'SETOR', 'POSTO', 'OPERAÇÃO', 'ATIVIDADE', 'TEMPO (s)', 'TEMPO C/ ALLOWANCE (s)', 'TIPO', 'TAKT'];
function soe(name: string, stations: [string, number[]][]): XLSX.WorkSheet {
  const aoa: unknown[][] = [['', `SOE ${name}`, '', 'Allowance', 0, '', '', 'Takt (s) →', 50], HEAD];
  for (const [p, ts] of stations) {
    ts.forEach((t, i) => aoa.push(['', name, p, 'Montagem', `Atividade ${i + 1}`, t, t, 'VA']));
    const s = ts.reduce((a, b) => a + b, 0);
    aoa.push(['', '', '', '', `Total ${p}`, s, s, '']);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}
function book(sheets: [string, XLSX.WorkSheet][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [n, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, n);
  return wb;
}
const twoSectors = () =>
  book([
    ['SOE Main', soe('Main', [['P1', [20, 20]], ['P2', [30, 15]]])],
    ['SOE Feed', soe('Feed', [['FS1', [25]], ['FS2', [60, 30]], ['FS3', [30]]])],
  ]);

describe('parseLineWorkbook', () => {
  it('sem aba Postos: todas as abas, um setor por aba, takt da planilha', () => {
    const s = parseLineWorkbook(twoSectors(), 'X')!;
    expect(s.sheets).toEqual(['SOE Main', 'SOE Feed']);
    expect(s.takt).toBe(50);
    expect(s.stations.map((x) => `${x.setor}/${x.posto}/${x.tempo}`)).toEqual(['Main/P1/40', 'Main/P2/45', 'Feed/FS1/25', 'Feed/FS2/90', 'Feed/FS3/30']);
    const m = lineModel(s);
    expect(m.nodes.filter((n) => n.type === 'sink')).toHaveLength(1);
    expect(m.nodes.filter((n) => n.type === 'source').map((n) => n.name)).toEqual(['Entrada P1', 'Entrada FS1']);
  });

  it('aba Postos: um bloco por operador, componente, teste com reprova e reparo', () => {
    const wb = twoSectors();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['SETOR', 'POSTO', 'TIPO', 'GIGAS', 'OPERADORES', 'ALIMENTA', 'LIGAÇÃO', 'TEMPO (s)', 'REPROVA (%)', 'REPARO'],
        ['Main', 'P1', 'Manual', 1, 1],
        ['Main', 'PST', 'Teste', 6, 2, '', '', 150, 5, 'Rep'],
        ['Main', 'P2', 'Manual', 1, 1],
        ['Main', 'Rep', 'Reparo', 1, 1, '', '', 300],
        ['Feed', 'FS1', 'Manual', 1, 1],
        ['Feed', 'FS2', 'Manual', 1, 2],
        ['Feed', 'FS3', 'Manual', 1, 1, 'P2', 'Componente'],
      ]),
      'Postos',
    );
    const s = parseLineWorkbook(wb)!;
    const fs2 = s.stations.find((x) => x.posto === 'FS2')!;
    expect(blockNames(fs2)).toEqual(['FS2 · Op 1', 'FS2 · Op 2']);
    const m = lineModel(s);
    const id = (name: string) => m.nodes.find((n) => n.name === name)!.id;
    expect(m.nodes.filter((n) => n.name.startsWith('FS2 ·')).map((n) => [n.capacity, n.operators, n.cycleTime])).toEqual([
      [1, 1, 90],
      [1, 1, 90],
    ]);
    const pst = m.nodes.find((n) => n.name === 'PST')!;
    expect([pst.type, pst.capacity, pst.operators, pst.cycleTime]).toEqual(['inspection', 6, 2, 150]);
    const w = (a: string, b: string) => m.links.find((l) => l.from === id(a) && l.to === id(b))?.weight;
    expect(w('PST', 'P2')).toBe(95);
    expect(w('PST', 'Rep')).toBe(5);
    expect(w('Rep', 'PST')).toBe(1);
    const part = m.links.find((l) => l.from === id('FS3') && l.to === id('P2'))!;
    expect(part.role).toBe('part');
    expect(m.nodes.find((n) => n.name === 'P2')!.assembly).toBe(true);
    // FS1 alimenta os dois blocos do FS2
    expect(m.links.filter((l) => l.from === id('FS1')).length).toBe(2);
    // o roteiro conta os dois operadores do FS2 e os 2 do PST
    expect(buildRouting(m).diretos).toBe(1 + 2 + 1 + 1 + 1 + 2 + 1);
  });

  it('Indiretos e Config viram o roteiro e o turno', () => {
    const wb = twoSectors();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['FUNÇÃO', 'TIPO', 'QTD', 'RESPONSABILIDADE'], ['Multifuncional', 'Multifuncional', 3, 'Banheiro'], ['Coordenador', 'Coordenador', 1, '']]), 'Indiretos');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['ITEM', 'VALOR', 'INÍCIO (min)'], ['Linha', 'Linha X'], ['Takt (s)', 48], ['Turno (h)', 9], ['Turnos por dia', 2], ['Minutos pessoais por operador (banheiro)', 25], ['Pausa Almoço (min)', 60, 240]]),
      'Config',
    );
    const s = parseLineWorkbook(wb)!;
    expect(s.name).toBe('Linha X');
    expect(s.takt).toBe(48);
    expect(s.staff!.roles.map((r) => [r.kind, r.qtd])).toEqual([
      ['multi', 3],
      ['coordenador', 1],
    ]);
    expect([s.staff!.pessoalMin, s.staff!.turnos]).toEqual([25, 2]);
    const m = lineModel(s);
    expect(m.settings.duration).toBe(9 * 3600);
    expect(m.settings.stops).toEqual([{ name: 'Pausa Almoço', start: 240, duration: 60, kind: 'break' }]);
    expect(m.settings.staff?.roles).toHaveLength(2);
  });

  it('ida e volta: appendLineSheets grava o roteiro e o import lê igual', () => {
    const first = parseLineWorkbook(twoSectors())!;
    first.stations[3] = { ...first.stations[3], operadores: 2 };
    first.stations[4] = { ...first.stations[4], alimenta: 'P2', ligacao: 'componente' };
    const wb = appendLineSheets(twoSectors(), first.stations, { line: 'L', takt: 50 });
    expect(wb.SheetNames).toEqual(expect.arrayContaining(['Postos', 'Indiretos', 'Config', 'Como preencher']));
    const back = parseLineWorkbook(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })))!;
    expect(back.stations.map((s) => [s.posto, s.operadores, s.alimenta ?? '', s.ligacao, s.tempo])).toEqual(
      first.stations.map((s) => [s.posto, s.operadores, s.alimenta ?? '', s.ligacao, s.tempo]),
    );
    expect(back.name).toBe('L');
  });

  it('modelo base com o mesmo nome passa a posição (layout)', () => {
    const base: Model = { name: 'b', nodes: [makeNode('machine', { id: 'x', name: 'P2', x: 777, y: 333 })], links: [], settings: lineModel(parseLineWorkbook(twoSectors())!).settings };
    const m = lineModel(parseLineWorkbook(twoSectors())!, base);
    const p2 = m.nodes.find((n) => n.name === 'P2')!;
    expect([p2.x, p2.y]).toEqual([777, 333]);
  });
});

describe('roteiro: sequência escolhida', () => {
  it('ordem do usuário manda; sem ordem, principal primeiro e off-lines depois', () => {
    const m = lineModel(parseLineWorkbook(twoSectors())!);
    const auto = buildRouting(m).rows.map((r) => r.posto);
    expect(auto).toHaveLength(5);
    const ids = buildRouting(m).rows.map((r) => r.id).reverse();
    const rev = buildRouting(m, { roles: [], pessoalMin: 20, fadigaPct: 0, turnos: 1, ordem: ids });
    expect(rev.rows.map((r) => r.posto)).toEqual([...auto].reverse());
    expect(rev.rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
  });
});
