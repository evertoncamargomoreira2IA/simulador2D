// Formulário Yamazumi no padrão SOE: uma linha por atividade, posto, operação, tempo, tempo com allowance e tipo.
// Preenchido no Excel e importado de volta, cada posto vira um bloco da linha (Importar → Criar uma linha nova).

import * as XLSX from 'xlsx';
import type { ActivityKind, Model, Operation } from '../engine/types';
import { elementsModel } from '../model/builder';

export interface FormStation {
  name: string;
  operations: Operation[];
}

const TIPO: Record<ActivityKind, string> = { va: 'VA', nva: 'NVA', walk: 'Deslocamento', wait: 'Espera', machine: 'Máquina' };

const HEAD = ['', 'SETOR', 'POSTO', 'OPERAÇÃO', 'ATIVIDADE', 'TEMPO (s)', 'TEMPO C/ ALLOWANCE (s)', 'TIPO', 'TAKT'];

/** Monta a planilha SOE. Total de cada posto em linha própria (fecha o posto, como no SOE). */
export function soeFormWorkbook(stations: FormStation[], opts: { line?: string; sector?: string; takt?: number; allowance?: number } = {}): XLSX.WorkBook {
  const allow = opts.allowance ?? 0.1;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const aoa: unknown[][] = [
    ['', `SOE ${opts.line ?? 'Nome da linha'}`, '', 'Allowance', allow, '', '', 'Takt (s) →', opts.takt ?? ''],
    HEAD,
  ];
  // linhas com fórmula: [linha (0-based), primeira atividade, última atividade]
  const totals: [number, number, number][] = [];
  const acts: number[] = [];
  for (const st of stations) {
    const first = aoa.length;
    for (const op of st.operations)
      for (const a of op.activities) {
        acts.push(aoa.length);
        aoa.push(['', opts.sector ?? 'MONTAGEM', st.name, op.name, a.name, r2(a.time), r2(a.time * (1 + allow)), TIPO[a.kind]]);
      }
    if (aoa.length === first) continue;
    const tot = st.operations.reduce((s, o) => s + o.activities.reduce((x, a) => x + a.time, 0), 0);
    totals.push([aoa.length, first, aoa.length - 1]);
    aoa.push(['', '', '', '', `Total ${/^\d/.test(st.name) ? `posto ${st.name}` : st.name}`, r2(tot), r2(tot * (1 + allow)), '']);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // fórmulas vivas no Excel (o valor calculado vai junto para quem lê sem recalcular)
  for (const r of acts) {
    const c = ws[XLSX.utils.encode_cell({ r, c: 6 })];
    c.f = `F${r + 1}*(1+$E$1)`;
  }
  for (const [r, a, b] of totals) {
    ws[XLSX.utils.encode_cell({ r, c: 5 })].f = `SUM(F${a + 1}:F${b + 1})`;
    ws[XLSX.utils.encode_cell({ r, c: 6 })].f = `SUM(G${a + 1}:G${b + 1})`;
  }
  ws['!cols'] = [{ wch: 2 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 70 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 10 }];
  ws['!autofilter'] = { ref: `B2:H${aoa.length}` };

  const how = XLSX.utils.aoa_to_sheet([
    ['Formulário Yamazumi (padrão SOE)'],
    [''],
    ['Passo', 'O que fazer'],
    ['1', 'Na aba SOE, escreva uma linha por atividade, na ordem em que o operador faz.'],
    ['2', 'POSTO: nome ou número do posto (ex.: 1, 2, Robô, Teste). Repita em todas as linhas do posto.'],
    ['3', 'OPERAÇÃO (opcional): agrupa atividades do posto (ex.: Etiquetas, Fixação). Vira a cor do bloco no Yamazumi.'],
    ['4', 'TEMPO (s): tempo medido da atividade. A coluna TEMPO C/ ALLOWANCE calcula sozinha com o allowance da célula E1.'],
    ['5', 'TIPO: VA, NVA, Deslocamento, Espera ou Máquina (veja a aba Tipos).'],
    ['6', 'No fim de cada posto, deixe uma linha de Total (só os tempos, sem atividade). Ela separa um posto do outro.'],
    ['7', 'TAKT (opcional): escreva o takt na célula I1.'],
    ['8', 'No simulador: Importar → escolha este arquivo → "Criar uma linha nova com estes postos". Os blocos são criados sozinhos, na ordem da planilha.'],
    ['9', 'Veja em Análises → Yamazumi. Para mudar, edite a planilha e importe de novo, ou use Operações e atividades.'],
  ]);
  how['!cols'] = [{ wch: 8 }, { wch: 110 }];
  const tipos = XLSX.utils.aoa_to_sheet([
    ['TIPO', 'Significado', 'Exemplos'],
    ['VA', 'Agrega valor: transforma o produto', 'encaixar, parafusar, colar, conectar'],
    ['NVA', 'Não agrega, mas é necessária', 'pegar, desembalar, inspecionar, escanear, virar'],
    ['Deslocamento', 'Andar / transportar', 'andar até o carrinho, levar ao próximo posto'],
    ['Espera', 'Parado esperando', 'aguardar máquina, aguardar peça'],
    ['Máquina', 'Tempo automático (robô, teste)', 'teste automático, ciclo do robô'],
  ]);
  tipos['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 50 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SOE');
  XLSX.utils.book_append_sheet(wb, how, 'Como preencher');
  XLSX.utils.book_append_sheet(wb, tipos, 'Tipos');
  return wb;
}

/** Formulário a partir do modelo aberto (postos com atividades) ou, sem atividades, com o exemplo genérico. */
export function soeFormBytes(model?: Model): { bytes: ArrayBuffer; fromModel: boolean } {
  const pick = (m: Model) => m.nodes.filter((n) => n.operations?.some((o) => o.activities.length)).map((n) => ({ name: n.name, operations: n.operations! }));
  let st = model ? pick(model) : [];
  const fromModel = st.length > 0;
  if (!fromModel) st = pick(elementsModel());
  const takt = model && model.settings.takt > 0 ? model.settings.takt : undefined;
  const wb = soeFormWorkbook(st, { line: fromModel ? model!.name : 'Exemplo', takt });
  return { bytes: XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, fromModel };
}
