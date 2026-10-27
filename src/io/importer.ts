// Importação de modelos: Excel (.xlsx/.xls), CSV e JSON.
//
// Formatos aceitos:
// 1. Tabela simples (1ª aba ou CSV), uma linha por bloco. Colunas reconhecidas (pt/en):
//    id, nome|name|posto|station, tipo|type, tempo_ciclo|cycle_time|ct, capacidade|capacity,
//    fila|queue, operadores|operators|manpower, disponibilidade|availability, mttr, cv,
//    x, y, proximo|next ("ID" ou "ID:peso", separados por vírgula).
// 2. Plano de Controle de Processo (PCP) com cabeçalho "Station" + "Manpower"
//    (ex.: PCP da linha LP2, aba "Top Level"). Cada posto recebe o tempo de ciclo padrão.
// 3. JSON exportado pelo próprio simulador.

import * as XLSX from 'xlsx';
import type { Model, NodeType } from '../engine/types';
import { buildLine, type StationRow } from '../model/builder';

export interface ImportResult {
  model: Model;
  info: string;
}

const ALIASES: Record<keyof StationRow, string[]> = {
  id: ['id', 'codigo', 'código', 'code'],
  name: ['nome', 'name', 'posto', 'station', 'estacao', 'estação', 'recurso', 'resource'],
  type: ['tipo', 'type', 'bloco', 'block'],
  cycleTime: ['tempo_ciclo', 'tempo de ciclo', 'cycle_time', 'cycle time', 'ct', 'tc', 'ciclo', 'cycletime'],
  capacity: ['capacidade', 'capacity', 'cap'],
  queueCap: ['fila', 'queue', 'queuecap', 'buffer_entrada'],
  operators: ['operadores', 'operators', 'manpower', 'mao_de_obra', 'mão de obra', 'mo'],
  availability: ['disponibilidade', 'availability', 'disp'],
  mttr: ['mttr'],
  cv: ['cv', 'variacao', 'variação'],
  x: ['x'],
  y: ['y'],
  next: ['proximo', 'próximo', 'next', 'destino', 'to', 'saida', 'saída'],
};

const TYPE_ALIASES: Record<string, NodeType> = {
  source: 'source', fonte: 'source', 'raw material': 'source', 'materia prima': 'source', 'matéria-prima': 'source',
  machine: 'machine', maquina: 'machine', máquina: 'machine', posto: 'machine', station: 'machine', assembly: 'machine', montagem: 'machine',
  buffer: 'buffer', estoque: 'buffer', wip: 'buffer', supermarket: 'buffer', storage: 'buffer',
  inspection: 'inspection', inspecao: 'inspection', inspeção: 'inspection', qc: 'inspection', 'quality gate': 'inspection',
  rework: 'rework', retrabalho: 'rework', repair: 'rework', reparo: 'rework',
  sink: 'sink', 'finished goods': 'sink', 'produto acabado': 'sink', expedicao: 'sink', expedição: 'sink', shipping: 'sink',
};

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').replace('%', ''));
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function pct(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  return n > 1 ? n / 100 : n;
}

/** Converte linhas (objetos por cabeçalho) em postos. */
export function rowsToStations(rows: Record<string, unknown>[]): StationRow[] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const col = (k: keyof StationRow) => headers.find((h) => ALIASES[k].includes(norm(h)));
  const c = Object.fromEntries((Object.keys(ALIASES) as (keyof StationRow)[]).map((k) => [k, col(k)])) as Record<
    keyof StationRow,
    string | undefined
  >;
  if (!c.name && !c.id) throw new Error('A tabela precisa de uma coluna "nome" (ou "name"/"posto"/"station").');
  const out: StationRow[] = [];
  for (const r of rows) {
    const name = String(r[c.name ?? c.id!] ?? '').trim();
    if (!name) continue;
    const t = c.type ? TYPE_ALIASES[norm(r[c.type])] : undefined;
    out.push({
      id: c.id ? String(r[c.id] ?? '').trim() || undefined : undefined,
      name,
      type: t,
      cycleTime: c.cycleTime ? num(r[c.cycleTime]) : undefined,
      capacity: c.capacity ? num(r[c.capacity]) : undefined,
      queueCap: c.queueCap ? num(r[c.queueCap]) : undefined,
      operators: c.operators ? num(r[c.operators]) : undefined,
      availability: c.availability ? pct(r[c.availability]) : undefined,
      mttr: c.mttr ? num(r[c.mttr]) : undefined,
      cv: c.cv ? pct(r[c.cv]) : undefined,
      x: c.x ? num(r[c.x]) : undefined,
      y: c.y ? num(r[c.y]) : undefined,
      next: c.next ? String(r[c.next] ?? '') : undefined,
    });
  }
  return out;
}

/** Procura uma aba no formato PCP (cabeçalho com "Station" e "Manpower"). */
export function parsePcp(wb: XLSX.WorkBook): StationRow[] | null {
  const order = [...wb.SheetNames].sort((a, b) => (norm(b) === 'top level' ? 1 : 0) - (norm(a) === 'top level' ? 1 : 0));
  for (const name of order) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: null });
    for (let h = 0; h < Math.min(grid.length, 15); h++) {
      const row = grid[h].map(norm);
      const st = row.indexOf('station');
      const mp = row.indexOf('manpower');
      if (st < 0 || mp < 0) continue;
      const out: StationRow[] = [];
      for (const r of grid.slice(h + 1)) {
        const no = String(r[0] ?? '').trim();
        const station = String(r[st] ?? '').replace(/\s+/g, ' ').trim();
        if (!/^\d/.test(no) || !station) continue;
        out.push({ name: station, operators: num(r[mp]) ?? 1, availability: 0.98, mttr: 90 });
      }
      if (out.length > 1) return out;
    }
  }
  return null;
}

export function importWorkbook(data: ArrayBuffer | string, fileName: string, cycleTime = 12): ImportResult {
  const wb = typeof data === 'string' ? XLSX.read(data, { type: 'string' }) : XLSX.read(data, { type: 'array' });
  const base = fileName.replace(/\.[^.]+$/, '');
  const pcp = parsePcp(wb);
  if (pcp) {
    const model = buildLine(pcp, { name: base, cycleTime });
    return { model, info: `PCP detectado: ${pcp.length} postos, tempo de ciclo ${cycleTime} s em cada posto.` };
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const stations = rowsToStations(rows);
  if (stations.length === 0) throw new Error('Nenhum posto encontrado no arquivo.');
  const model = buildLine(stations, { name: base, cycleTime });
  return { model, info: `${stations.length} blocos importados da aba "${wb.SheetNames[0]}".` };
}

export function importJson(text: string): ImportResult {
  const m = JSON.parse(text) as Model;
  if (!Array.isArray(m.nodes) || !Array.isArray(m.links)) throw new Error('JSON não é um modelo do simulador.');
  return { model: m, info: `Modelo "${m.name}" carregado (${m.nodes.length} blocos).` };
}

export async function importFile(file: File, cycleTime = 12): Promise<ImportResult> {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'json') return importJson(await file.text());
  if (ext === 'csv' || ext === 'txt') return importWorkbook(await file.text(), file.name, cycleTime);
  return importWorkbook(await file.arrayBuffer(), file.name, cycleTime);
}
