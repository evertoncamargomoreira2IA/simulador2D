// Importação de SOE (sequência de operações): aba com POSTO, ATIVIDADE e TEMPO por linha.
// Cada bloco de atividades vira um posto; rótulos de texto na coluna do posto viram operações.

import * as XLSX from 'xlsx';
import { operationsTime, type ActivityKind, type Model, type NodeDef, type Operation } from '../engine/types';

export interface SoeStation {
  name: string;
  operations: Operation[];
  total: number;
}
export interface SoeResult {
  sheet: string;
  stations: SoeStation[];
  takt?: number;
}

const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

interface Cols {
  header: number;
  /** Rótulo da coluna do posto é o nome do posto (formato "Station"), e não de operação. */
  stationLabels: boolean;
  posto: number;
  ativ: number;
  tempo: number;
  op: number;
  tipo: number;
  takt: number;
}

function findCols(rows: unknown[][]): Cols | null {
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const h = (rows[r] ?? []).map(norm);
    const posto = h.findIndex((c) => /^postos?$|^estac|^station/.test(c));
    const ativ = h.findIndex((c) => /^atividade|^descri|^elemento|^task/.test(c));
    const tempos = h.map((c, i) => (/^tempo|cycle time|observed|time study|^time/.test(c) ? i : -1)).filter((i) => i >= 0);
    if (posto < 0 || ativ < 0 || !tempos.length) continue;
    // tempo com allowance (folga) tem prioridade: é o que fecha com o ciclo do posto
    const tempo = tempos.find((i) => /allow|folga|c\/|com |basic/.test(h[i])) ?? tempos.find((i) => /observed|media/.test(h[i])) ?? tempos[0];
    return {
      header: r,
      stationLabels: /^station|^estac/.test(h[posto]),
      posto,
      ativ,
      tempo,
      op: h.findIndex((c) => /^opera/.test(c)),
      tipo: h.findIndex((c) => /^tipo|^classif|^categ/.test(c)),
      takt: h.findIndex((c) => /^takt$/.test(c)),
    };
  }
  return null;
}

/** Abas que parecem SOE (cabeçalho com posto, atividade e tempo). */
export function soeSheets(wb: XLSX.WorkBook): string[] {
  return wb.SheetNames.filter((s) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[s], { header: 1, defval: '', range: 0 }).slice(0, 12);
    return !!findCols(rows);
  });
}

/** Classifica a atividade pelo texto (e pela coluna de tipo, se houver). */
export function activityKind(text: string, tag = ''): ActivityKind {
  const t = norm(text);
  const g = norm(tag);
  if (/robo|maquina|automat|machine/.test(g)) return 'machine';
  if (/^va$|agrega/.test(g) && !/nao/.test(g)) return 'va';
  if (/nva|nao agrega/.test(g)) return 'nva';
  if (/desloc|andar|walk/.test(g)) return 'walk';
  if (/espera|wait/.test(g)) return 'wait';
  if (/andar|caminh|desloc|ir ate|retornar/.test(t)) return 'walk';
  if (/aguard|esperar/.test(t)) return 'wait';
  if (/teste automatic|ciclo da maquina|robo/.test(t)) return 'machine';
  if (/inspe|verific|escane|pegar|desembal|vira |virar|inclin|transfer|empurr|conferir|registrar/.test(t) && !/colar|encaix|inser|fixar|conectar|aplicar|parafus|montar/.test(t))
    return 'nva';
  return 'va';
}

const short = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 70 ? `${t.slice(0, 67)}…` : t;
};

export function parseSoe(wb: XLSX.WorkBook, sheet: string): SoeResult {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: '' });
  const c = findCols(rows);
  if (!c) throw new Error(`a aba "${sheet}" não tem colunas de posto, atividade e tempo`);
  let takt: number | undefined;
  if (c.takt >= 0)
    for (let r = Math.max(0, c.header - 2); r <= c.header + 3 && r < rows.length; r++) {
      const v = Number(rows[r]?.[c.takt]);
      if (r !== c.header && v > 0) (takt = v), (r = rows.length);
    }

  const stations: SoeStation[] = [];
  let cur: { num?: string; ops: Operation[] } | null = null;
  let op: Operation | null = null;
  const close = () => {
    if (cur && cur.ops.some((o) => o.activities.length)) {
      const ops = cur.ops.filter((o) => o.activities.length);
      // sem número: usa o nome da primeira operação (ex.: OQA) ou a posição
      const name = cur.num ? (/^\d/.test(cur.num) ? `Posto ${cur.num}` : cur.num) : ops[0].name !== 'Montagem' ? ops[0].name : `Posto ${stations.length + 1}`;
      stations.push({ name, operations: ops, total: operationsTime(ops) });
    }
    cur = null;
    op = null;
  };
  for (const r of rows.slice(c.header + 1)) {
    const label = String(r[c.posto] ?? '').trim();
    const text = String(r[c.ativ] ?? '').trim();
    const t = Number(String(r[c.tempo] ?? '').replace(',', '.'));
    // linha de soma (sem atividade ou "Total…", só tempo) fecha o posto
    if (!text || /^total\b/i.test(text)) {
      if (t > 0 && cur) close();
      continue;
    }
    if (!(t > 0)) continue;
    const num = c.stationLabels ? label : /^(posto\s*)?\d+[a-z]?$/i.test(label) ? label.replace(/^posto\s*/i, '') : '';
    const c0: { num?: string; ops: Operation[] } | null = cur;
    // número diferente do posto atual = posto novo (planilha sem linhas de soma)
    if (num && c0 && c0.num && c0.num !== num) close();
    if (!cur) cur = { ops: [] };
    const st: { num?: string; ops: Operation[] } = cur;
    if (num && !st.num) st.num = num;
    const opName = c.op >= 0 ? String(r[c.op] ?? '').trim() : '';
    const named = opName || (label && !num ? label : '');
    if (!op || (named && named !== op.name)) {
      op = { name: named || 'Montagem', activities: [] };
      st.ops.push(op);
    }
    op.activities.push({ name: short(text), time: Math.round(t * 100) / 100, kind: activityKind(text, c.tipo >= 0 ? String(r[c.tipo] ?? '') : '') });
  }
  close();
  return { sheet, stations, takt };
}

const key = (s: string) => norm(s).replace(/^posto\s*/, '').replace(/\s+/g, ' ');

/** Aplica as atividades do SOE nos postos de mesmo nome. Devolve o modelo e quantos casaram. */
export function mergeSoe(model: Model, soe: SoeResult): { model: Model; matched: number } {
  const byKey = new Map(soe.stations.map((s) => [key(s.name), s]));
  let matched = 0;
  const nodes = model.nodes.map((n): NodeDef => {
    const s = byKey.get(key(n.name)) ?? byKey.get(key(n.id));
    if (!s || n.type === 'source' || n.type === 'sink' || n.type === 'buffer') return n;
    matched++;
    return { ...n, operations: s.operations, cycleFromOps: true, cycleTime: Math.round(s.total * 100) / 100 };
  });
  return { model: { ...model, nodes }, matched };
}
