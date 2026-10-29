import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseActivityText } from '../src/io/activities';
import { parseTemplate, templateWorkbook } from '../src/io/template';

describe('atividades em tabela', () => {
  it('lê colunas operação | atividade | tempo | tipo e ignora cabeçalho', () => {
    const ops = parseActivityText('operacao\tatividade\ttempo\ttipo\nMontar\tEncaixar\t12\tVA\nMontar\tParafusar\t8,5\tVA\nAbastecer\tAndar até o carrinho\t4\tdeslocamento\nTotal\t\t24,5\t');
    expect(ops.map((o) => o.name)).toEqual(['Montar', 'Abastecer']);
    expect(ops[0].activities[1].time).toBe(8.5);
    expect(ops[1].activities[0].kind).toBe('walk');
  });
  it('aceita só atividade | tempo', () => {
    const ops = parseActivityText('Pegar placa;5\nAguardar teste;10');
    expect(ops).toHaveLength(1);
    expect(ops[0].activities.map((a) => a.kind)).toEqual(['nva', 'wait']);
  });
  it('planilha padrão ida e volta com aba Atividades e estudo', () => {
    const wb = templateWorkbook();
    expect(wb.SheetNames).toContain('Atividades');
    const ws = wb.Sheets['Parâmetros'];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    const i = rows.findIndex((r) => r[0] === 'estudo');
    XLSX.utils.sheet_add_aoa(ws, [['estudo', 'elemento']], { origin: `A${i + 1}` });
    const { model } = parseTemplate(wb, 'x');
    const p1 = model.nodes.find((n) => n.id === 'P1')!;
    expect(p1.operations?.length).toBe(2);
    expect(p1.cycleTime).toBe(48);
    expect(model.settings.studyMode).toBe('elements');
  });
});
