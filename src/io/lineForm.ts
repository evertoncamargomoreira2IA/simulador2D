// Formulário da linha completa: várias abas de SOE (uma por setor) + abas opcionais
// "Postos" (roteiro: gigas, operadores, para onde cada posto manda), "Indiretos" e "Config".
// Monta o modelo inteiro de uma vez, com um bloco por operador nos postos manuais.

import * as XLSX from 'xlsx';
import { DEFAULT_STAFF, STAFF_LABEL, type StaffConfig, type StaffKind, type StaffRole } from '../engine/routing';
import { DEFAULT_SETTINGS, makeNode, MANUAL_PATCH, operationsTime, type LinkDef, type Model, type NodeDef, type NodeType, type Operation, type ShiftStop } from '../engine/types';
import { parseSoe, soeSheets } from './soe';

export type LineKind = 'manual' | 'maquina' | 'teste' | 'reparo' | 'buffer';

export interface LineStation {
  setor: string;
  posto: string;
  tipo: LineKind;
  gigas: number;
  operadores: number;
  /** Posto que recebe o que este posto faz (vazio = o próximo do setor). */
  alimenta?: string;
  /** Como chega no destino: no fluxo (a peça segue) ou como componente (é consumido na montagem). */
  ligacao: 'fluxo' | 'componente';
  /** Tempo do posto (s): do SOE; a coluna TEMPO da aba Postos vale para postos sem SOE (teste, OBA). */
  tempo: number;
  /** Reprova (%) e posto de reparo que recebe a reprova (volta para o mesmo posto). */
  reprova?: number;
  reparo?: string;
  operations?: Operation[];
}

export interface LineSpec {
  name: string;
  takt?: number;
  turnoH?: number;
  pausas?: ShiftStop[];
  stations: LineStation[];
  staff?: StaffConfig;
  /** Abas de SOE lidas, na ordem. */
  sheets: string[];
}

const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
export const nameKey = (s: string) => norm(s).replace(/\s+/g, ' ');
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};
const rowsOf = (wb: XLSX.WorkBook, s: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[s], { header: 1, defval: '' });
const findSheet = (wb: XLSX.WorkBook, re: RegExp) => wb.SheetNames.find((s) => re.test(norm(s)));

/** Lê uma tabela com cabeçalho (primeira linha com as colunas pedidas nas 8 primeiras). */
function table(rows: unknown[][], need: RegExp[]): { head: string[]; data: unknown[][] } | null {
  for (let r = 0; r < Math.min(8, rows.length); r++) {
    const head = (rows[r] ?? []).map(norm);
    if (need.every((re) => head.some((h) => re.test(h)))) return { head, data: rows.slice(r + 1) };
  }
  return null;
}
const col = (head: string[], re: RegExp) => head.findIndex((h) => re.test(h));

function tipoOf(v: unknown, posto: string): LineKind {
  const t = norm(v);
  if (/maquin|robo|automat/.test(t)) return 'maquina';
  if (/test|inspe|oba|oqa|qualid/.test(t)) return 'teste';
  if (/repar|retrab/.test(t)) return 'reparo';
  if (/buffer|estoque|fila/.test(t)) return 'buffer';
  if (t) return 'manual';
  return /^robo/i.test(posto) ? 'maquina' : 'manual';
}

/** Lê a planilha da linha completa. Null se não houver nenhuma aba de SOE nem aba Postos. */
export function parseLineWorkbook(wb: XLSX.WorkBook, fallbackName = 'Linha'): LineSpec | null {
  const sheets = soeSheets(wb);
  const soe = new Map<string, { setor: string; operations: Operation[]; total: number }>();
  const order: LineStation[] = [];
  let takt: number | undefined;
  for (const s of sheets) {
    const r = parseSoe(wb, s);
    takt ??= r.takt;
    const setor = s.replace(/^soe\s*/i, '').trim() || s;
    for (const st of r.stations) {
      soe.set(nameKey(st.name), { setor, operations: st.operations, total: st.total });
      order.push({ setor, posto: st.name, tipo: tipoOf('', st.name), gigas: 1, operadores: /^robo/i.test(st.name) ? 0 : 1, ligacao: 'fluxo', tempo: st.total, operations: st.operations });
    }
  }

  // Aba Postos: manda na ordem, no tipo, nas gigas, nos operadores e no destino.
  const ps = findSheet(wb, /^postos?$|roteiro|^estac/);
  let stations = order;
  const t = ps ? table(rowsOf(wb, ps), [/^posto/, /^setor/]) : null;
  if (t) {
    const c = {
      setor: col(t.head, /^setor/),
      posto: col(t.head, /^posto/),
      tipo: col(t.head, /^tipo/),
      gigas: col(t.head, /^gigas|^postos paral|^fixture/),
      ops: col(t.head, /^operador/),
      alim: col(t.head, /^alimenta|^destino|^envia/),
      lig: col(t.head, /^liga|^como/),
      tempo: col(t.head, /^tempo/),
      rep: col(t.head, /^reprova|^yield|^refugo/),
      reparo: col(t.head, /^reparo|^retrabalho/),
    };
    stations = [];
    for (const r of t.data) {
      const posto = String(r[c.posto] ?? '').trim();
      if (!posto) continue;
      const s = soe.get(nameKey(posto));
      const tipo = tipoOf(c.tipo >= 0 ? r[c.tipo] : '', posto);
      const ops = c.ops >= 0 ? num(r[c.ops]) : undefined;
      stations.push({
        setor: String(r[c.setor] ?? '').trim() || s?.setor || 'Linha',
        posto,
        tipo,
        gigas: Math.max(1, Math.round((c.gigas >= 0 ? num(r[c.gigas]) : undefined) ?? 1)),
        operadores: Math.max(0, Math.round(ops ?? (tipo === 'maquina' || tipo === 'buffer' ? 0 : 1))),
        alimenta: c.alim >= 0 ? String(r[c.alim] ?? '').trim() || undefined : undefined,
        ligacao: c.lig >= 0 && /compon|kit|pe[cç]a/.test(norm(r[c.lig])) ? 'componente' : 'fluxo',
        tempo: s?.total ?? (c.tempo >= 0 ? num(r[c.tempo]) : undefined) ?? 0,
        reprova: c.rep >= 0 ? num(r[c.rep]) : undefined,
        reparo: c.reparo >= 0 ? String(r[c.reparo] ?? '').trim() || undefined : undefined,
        operations: s?.operations,
      });
    }
    // postos do SOE que ficaram fora da aba Postos entram no fim, como manuais
    const listed = new Set(stations.map((s) => nameKey(s.posto)));
    for (const o of order) if (!listed.has(nameKey(o.posto))) stations.push(o);
  }
  if (!stations.length) return null;

  // Aba Config: chave → valor.
  let name = fallbackName;
  let turnoH: number | undefined;
  const pausas: ShiftStop[] = [];
  const staff: StaffConfig = structuredClone(DEFAULT_STAFF);
  let hasStaff = false;
  const cf = findSheet(wb, /^config/);
  if (cf)
    for (const r of rowsOf(wb, cf)) {
      const k = norm(r[0]);
      const v = r[1];
      if (!k) continue;
      if (/^linha/.test(k)) name = String(v || name);
      else if (/^produto/.test(k)) (staff.produto = String(v ?? '')), (hasStaff = true);
      else if (/^takt/.test(k)) takt = num(v) ?? takt;
      else if (/^turno.*\(h|^duracao/.test(k)) turnoH = num(v);
      else if (/^turnos/.test(k)) (staff.turnos = Math.max(1, num(v) ?? 1)), (hasStaff = true);
      else if (/pessoa|banheiro/.test(k)) (staff.pessoalMin = num(v) ?? staff.pessoalMin), (hasStaff = true);
      else if (/fadiga/.test(k)) (staff.fadigaPct = num(v) ?? 0), (hasStaff = true);
      else if (/^pausa|^almoco|^parada/.test(k)) {
        const d = num(v);
        if (d && d > 0) pausas.push({ name: String(r[0]).replace(/\(.*\)/, '').trim(), start: num(r[2]) ?? 240, duration: d, kind: 'break' });
      }
    }

  // Aba Indiretos: função, tipo, quantidade, responsabilidade.
  const ind = findSheet(wb, /^indireto|^mao de obra ind/);
  const ti = ind ? table(rowsOf(wb, ind), [/^fun/, /^q/]) : null;
  if (ti) {
    const c = { f: col(ti.head, /^fun/), k: col(ti.head, /^tipo/), q: col(ti.head, /^q/), o: col(ti.head, /^respons|^obs|^descr/) };
    const roles: StaffRole[] = [];
    for (const r of ti.data) {
      const funcao = String(r[c.f] ?? '').trim();
      if (!funcao) continue;
      const kt = norm(c.k >= 0 ? r[c.k] : funcao);
      const kind = (Object.keys(STAFF_LABEL) as StaffKind[]).find((k) => kt.startsWith(norm(STAFF_LABEL[k]).slice(0, 5)) || kt.startsWith(k)) ?? 'outro';
      roles.push({ id: `r${roles.length}`, kind, funcao, qtd: Math.max(0, Math.round(num(r[c.q]) ?? 0)), obs: c.o >= 0 ? String(r[c.o] ?? '') : '' });
    }
    staff.roles = roles;
    hasStaff = true;
  }

  return { name, takt, turnoH, pausas, stations, staff: hasStaff ? staff : undefined, sheets };
}

const TYPE: Record<LineKind, NodeType> = { manual: 'machine', maquina: 'machine', teste: 'inspection', reparo: 'rework', buffer: 'buffer' };

/** Nomes dos blocos de cada posto: um por operador nos postos manuais com mais de um operador. */
export function blockNames(s: LineStation): string[] {
  return s.tipo === 'manual' && s.operadores > 1 ? Array.from({ length: s.operadores }, (_, i) => `${s.posto} · Op ${i + 1}`) : [s.posto];
}

/**
 * Monta o modelo da linha completa. Posições: do modelo base (mesmo nome) se houver;
 * senão, uma faixa por setor. Cada setor encadeia os postos na ordem; o último segue o
 * "alimenta" (ou vai para a saída). Postos manuais com N operadores viram N blocos em paralelo.
 */
export function lineModel(spec: LineSpec, base?: Model): Model {
  const nodes: NodeDef[] = [];
  const links: LinkDef[] = [];
  let li = 0;
  const link = (from: string, to: string, extra: Partial<LinkDef> = {}) => links.push({ id: `L${li++}`, from, to, weight: 1, ...extra });
  const used = new Set<string>();
  const mkId = (s: string) => {
    let id = s.replace(/\s*·\s*/g, '_').replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || 'N';
    for (let i = 2; used.has(id); i++) id = `${id.replace(/_\d+$/, '')}_${i}`;
    used.add(id);
    return id;
  };
  const basePos = new Map((base?.nodes ?? []).map((n) => [nameKey(n.name), n]));
  const sectors = [...new Set(spec.stations.map((s) => s.setor))];
  const blocks = new Map<string, NodeDef[]>(); // posto → blocos

  sectors.forEach((setor, si) => {
    spec.stations
      .filter((s) => s.setor === setor)
      .forEach((s, i) => {
        const names = blockNames(s);
        const list = names.map((name, k) => {
          const b = basePos.get(nameKey(name)) ?? basePos.get(nameKey(s.posto));
          const off = names.length > 1 ? (k - (names.length - 1) / 2) * 46 : 0;
          const n = makeNode(TYPE[s.tipo], {
            id: mkId(name),
            name,
            x: b ? b.x : 160 + i * 120,
            y: (b ? b.y : 120 + si * 190) + off,
            cycleTime: Math.round(s.tempo * 100) / 100,
            cv: 0.05,
            availability: 1,
            mttr: 60,
            queueCap: 1,
            capacity: names.length > 1 ? 1 : s.gigas,
            operators: names.length > 1 ? 1 : s.operadores,
            layer: setor,
            ...(s.tipo === 'manual' ? { ...MANUAL_PATCH, operators: names.length > 1 ? 1 : Math.max(1, s.operadores) } : {}),
            ...(s.tipo === 'buffer' ? { capacity: s.gigas, cycleTime: 0, operators: 0 } : {}),
            ...(s.operations?.length ? { operations: s.operations, cycleFromOps: true, cycleTime: Math.round(operationsTime(s.operations) * 100) / 100 } : {}),
            ...(!s.operations?.length && s.tipo !== 'manual' && s.tipo !== 'buffer' ? { fixedTime: true } : {}),
          });
          nodes.push(n);
          return n;
        });
        blocks.set(nameKey(s.posto), list);
      });
  });

  const all = (p?: string) => (p ? blocks.get(nameKey(p)) ?? blocks.get(nameKey(p.replace(/\s*·.*$/, ''))) : undefined);
  const fan = (from: NodeDef[], to: NodeDef[], extra: Partial<LinkDef> = {}) => {
    for (const f of from) for (const t of to) link(f.id, t.id, extra);
  };
  const fed = new Set<string>();
  const outs = new Set<string>();
  for (const setor of sectors) {
    const list = spec.stations.filter((s) => s.setor === setor && s.tipo !== 'reparo');
    list.forEach((s, i) => {
      const from = all(s.posto)!;
      const dest = s.alimenta ? all(s.alimenta) : i < list.length - 1 ? all(list[i + 1].posto) : undefined;
      if (!dest) return;
      const part = !!s.alimenta && s.ligacao === 'componente';
      const pct = s.reprova && s.reparo && all(s.reparo) ? Math.min(99, Math.max(0, s.reprova)) : 0;
      fan(from, dest, part ? { role: 'part' } : pct ? { weight: (100 - pct) / dest.length } : {});
      if (part) for (const d of dest) d.assembly = true;
      else for (const d of dest) fed.add(d.id);
      if (pct) {
        const rep = all(s.reparo)!;
        fan(from, rep, { weight: pct });
        fan(rep, from);
        for (const r of rep) fed.add(r.id);
      }
      for (const f of from) outs.add(f.id);
    });
  }
  // Entradas de material para quem não recebe nada; saída para quem não manda nada.
  const firsts = nodes.filter((n) => n.type !== 'rework' && !fed.has(n.id) && !links.some((l) => l.to === n.id && l.role !== 'part'));
  const seenSrc = new Map<string, NodeDef>();
  for (const n of firsts) {
    const setor = n.layer;
    let src = seenSrc.get(n.name);
    if (!src) {
      src = makeNode('source', { id: mkId(`Entrada ${n.name}`), name: `Entrada ${n.name}`, x: n.x - 70, y: n.y, layer: setor });
      nodes.push(src);
      seenSrc.set(n.name, src);
    }
    link(src.id, n.id);
  }
  const lasts = nodes.filter((n) => n.type !== 'source' && n.type !== 'rework' && !outs.has(n.id) && !links.some((l) => l.from === n.id));
  if (lasts.length) {
    const far = lasts.reduce((a, b) => (b.x > a.x ? b : a));
    const sink = makeNode('sink', { id: mkId('Produto acabado'), name: 'Produto acabado', x: far.x + 110, y: far.y, operators: 0 });
    nodes.push(sink);
    for (const n of lasts) link(n.id, sink.id);
  }
  // Kanban de 4 componentes ao lado de cada posto de montagem.
  for (const n of nodes) if (n.assembly) n.partBuffer = 4;

  const settings = {
    ...(base?.settings ?? DEFAULT_SETTINGS),
    takt: spec.takt ?? base?.settings.takt ?? 0,
    duration: spec.turnoH ? spec.turnoH * 3600 : base?.settings.duration ?? DEFAULT_SETTINGS.duration,
    studyMode: 'elements' as const,
    startFull: true,
    warmup: 0,
    ...(spec.pausas?.length ? { stops: spec.pausas } : {}),
    ...(spec.staff ? { staff: spec.staff } : {}),
  };
  return { name: spec.name, nodes, links, settings, ...(base?.background ? { background: base.background } : {}), ...(base?.zones ? { zones: base.zones } : {}) };
}

/** Passo a passo do formulário da linha completa (aba "Como preencher"). */
export const HOW_TO_FILL: string[][] = [
  ['Formulário da linha completa (padrão SOE + roteiro)'],
  [''],
  ['Passo', 'O que fazer'],
  ['1', 'Uma aba de SOE por setor (ex.: SOE Main Line, SOE Feed Shaft, SOE Packing). Uma linha por atividade, na ordem em que o operador faz.'],
  ['2', 'POSTO: nome do posto como no chão de fábrica. Repita em todas as linhas do posto. No fim de cada posto, uma linha de Total (só os tempos).'],
  ['3', 'TEMPO C/ ALLOWANCE: calcula sozinho com o allowance da célula E1. TIPO: VA, NVA, Deslocamento, Espera ou Máquina.'],
  ['4', 'Aba Postos: uma linha por posto, na ordem do fluxo de cada setor. GIGAS = postos/fixtures em paralelo. OPERADORES: em posto manual, cada operador vira um bloco.'],
  ['5', 'Aba Postos → ALIMENTA: para onde o posto manda (vazio = próximo posto do mesmo setor). LIGAÇÃO: Fluxo (a peça segue) ou Componente (é consumido na montagem do destino).'],
  ['6', 'Aba Postos → TEMPO (s): só para postos sem SOE (teste, OBA, reparo). REPROVA (%) e REPARO: a reprova vai para o reparo e volta ao mesmo posto.'],
  ['7', 'Aba Indiretos: multifuncional (cobre banheiro = allowance), coordenador, reparo, líder... com a quantidade. Vai para o Roteiro de produção.'],
  ['8', 'Aba Config: nome da linha, produto, takt, turno (h), pausas (min), minutos pessoais por operador, fadiga (%), turnos por dia.'],
  ['9', 'No simulador: Importar → este arquivo → "Linha completa (todas as abas)". Com um layout aberto, os blocos de mesmo nome ficam na posição do layout.'],
  ['10', 'Depois: ▶ Start, Análises → Yamazumi e 📋 Roteiro (mão de obra direta, indireta e allowance; imprime/PDF e Excel).'],
];

/** Acrescenta as abas Postos, Indiretos e Config (e troca o Como preencher) no formulário. */
export function appendLineSheets(
  wb: XLSX.WorkBook,
  stations: LineStation[],
  opts: { staff?: StaffConfig; line?: string; produto?: string; takt?: number; turnoH?: number; pausas?: { name: string; duration: number; start: number }[] } = {},
): XLSX.WorkBook {
  const label: Record<LineKind, string> = { manual: 'Manual', maquina: 'Máquina', teste: 'Teste', reparo: 'Reparo', buffer: 'Buffer' };
  const ps = XLSX.utils.aoa_to_sheet([
    ['SETOR', 'POSTO', 'TIPO', 'GIGAS', 'OPERADORES', 'ALIMENTA', 'LIGAÇÃO', 'TEMPO (s)', 'REPROVA (%)', 'REPARO', 'OBS'],
    ...stations.map((s) => [
      s.setor, s.posto, label[s.tipo], s.gigas, s.operadores, s.alimenta ?? '', s.alimenta ? (s.ligacao === 'componente' ? 'Componente' : 'Fluxo') : '',
      s.operations?.length ? '' : Math.round(s.tempo * 100) / 100, s.reprova ?? '', s.reparo ?? '', '',
    ]),
  ]);
  ps['!cols'] = [14, 30, 10, 7, 11, 18, 12, 10, 11, 14, 40].map((wch) => ({ wch }));
  ps['!autofilter'] = { ref: `A1:K${stations.length + 1}` };
  const staff = opts.staff ?? DEFAULT_STAFF;
  const ind = XLSX.utils.aoa_to_sheet([
    ['FUNÇÃO', 'TIPO', 'QTD', 'RESPONSABILIDADE'],
    ...staff.roles.map((r) => [r.funcao, STAFF_LABEL[r.kind], r.qtd, r.obs ?? '']),
  ]);
  ind['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 6 }, { wch: 70 }];
  const cfg = XLSX.utils.aoa_to_sheet([
    ['ITEM', 'VALOR', 'INÍCIO (min)', 'OBS'],
    ['Linha', opts.line ?? 'Nome da linha'],
    ['Produto', opts.produto ?? staff.produto ?? ''],
    ['Takt (s)', opts.takt ?? ''],
    ['Turno (h)', opts.turnoH ?? 8],
    ['Turnos por dia', staff.turnos],
    ['Minutos pessoais por operador (banheiro)', staff.pessoalMin, '', 'Entra no allowance; coberto pelos multifuncionais'],
    ['Fadiga (%)', staff.fadigaPct],
    ...(opts.pausas ?? []).map((p) => [`Pausa ${p.name} (min)`, p.duration, p.start]),
  ]);
  cfg['!cols'] = [{ wch: 40 }, { wch: 14 }, { wch: 12 }, { wch: 50 }];
  const how = XLSX.utils.aoa_to_sheet(HOW_TO_FILL);
  how['!cols'] = [{ wch: 8 }, { wch: 130 }];
  for (const [name, ws] of [['Postos', ps], ['Indiretos', ind], ['Config', cfg], ['Como preencher', how]] as const) {
    if (wb.SheetNames.includes(name)) wb.Sheets[name] = ws;
    else XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return wb;
}
