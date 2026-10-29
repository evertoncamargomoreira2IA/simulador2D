// Atividades em tabela: colar do Excel num posto ou ler a aba "Atividades" da planilha padrão.

import { ACTIVITY_LABEL, type Activity, type Operation } from '../engine/types';
import { activityKind } from './soe';

export const ACT_COLS = ['posto', 'operacao', 'atividade', 'tempo_s', 'tipo'] as const;

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || String(v).trim() === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}
const str = (v: unknown) => String(v ?? '').trim();

/** Junta atividades na operação anterior quando o nome repete (ou vem vazio). */
function push(ops: Operation[], opName: string, a: Activity) {
  const last = ops[ops.length - 1];
  if (last && (!opName || last.name === opName)) last.activities.push(a);
  else ops.push({ name: opName || `Operação ${ops.length + 1}`, activities: [a] });
}

/**
 * Linhas coladas do Excel para um posto. Aceita:
 * atividade | tempo · atividade | tempo | tipo · operação | atividade | tempo · operação | atividade | tempo | tipo.
 * Linhas sem tempo numérico (cabeçalho, total) são ignoradas.
 */
export function parseActivityRows(rows: unknown[][]): Operation[] {
  const ops: Operation[] = [];
  for (const raw of rows) {
    const r = raw.map((c) => (typeof c === 'number' ? c : str(c)));
    while (r.length && r[r.length - 1] === '') r.pop();
    let op = '';
    let name: string;
    let time: number | undefined;
    let tag = '';
    if (r.length >= 4) [op, name, time, tag] = [str(r[0]), str(r[1]), num(r[2]), str(r[3])];
    else if (r.length === 3 && num(r[1]) !== undefined) [name, time, tag] = [str(r[0]), num(r[1]), str(r[2])];
    else if (r.length === 3) [op, name, time] = [str(r[0]), str(r[1]), num(r[2])];
    else if (r.length === 2) [name, time] = [str(r[0]), num(r[1])];
    else continue;
    if (time === undefined || time < 0 || !name || /^total/i.test(name)) continue;
    push(ops, op, { name, time, kind: activityKind(name, tag) });
  }
  return ops;
}

/** Texto colado (Excel manda colunas por tab; aceita também ; ). */
export function parseActivityText(text: string): Operation[] {
  const sep = text.includes('\t') ? '\t' : ';';
  return parseActivityRows(
    text
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => l.split(sep)),
  );
}

/** Aba Atividades: agrupa por posto (id ou nome). */
export function parseActivitySheet(rows: Record<string, unknown>[]): Map<string, Operation[]> {
  const out = new Map<string, Operation[]>();
  for (const r of rows) {
    const posto = str(r.posto);
    const name = str(r.atividade);
    const time = num(r.tempo_s);
    if (!posto || !name || time === undefined) continue;
    const ops = out.get(posto) ?? [];
    push(ops, str(r.operacao) || ops[ops.length - 1]?.name || 'Operação 1', { name, time, kind: activityKind(name, str(r.tipo)) });
    out.set(posto, ops);
  }
  return out;
}

/** Linhas da aba Atividades para um posto. */
export function activitySheetRows(posto: string, ops: Operation[] | undefined): unknown[][] {
  return (ops ?? []).flatMap((o) => o.activities.map((a) => [posto, o.name, a.name, a.time, ACTIVITY_LABEL[a.kind]]));
}
