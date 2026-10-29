// Monta modelos a partir de listas de postos e faz o layout automático em serpentina.

import { DEFAULT_SETTINGS, makeNode, MANUAL_PATCH, newId, operationsTime, type ActivityKind, type LinkDef, type Model, type NodeDef, type NodeType, type Operation } from '../engine/types';
import { LP2_STATIONS } from './lp2';

export interface StationRow {
  id?: string;
  name: string;
  type?: NodeType;
  cycleTime?: number;
  capacity?: number;
  queueCap?: number;
  operators?: number;
  availability?: number;
  mttr?: number;
  cv?: number;
  x?: number;
  y?: number;
  /** Destinos: "ID" ou "ID:peso", separados por vírgula/ponto e vírgula. */
  next?: string;
}

export function inferType(name: string): NodeType {
  const s = name.toLowerCase();
  if (/^(source|fonte|raw|mp\b|mat[eé]ria)/.test(s)) return 'source';
  if (/(finished|acabado|^fg\b|sink|expedi|shipping)/.test(s)) return 'sink';
  if (/(repair|retrabalho|rework|reparo)/.test(s)) return 'rework';
  if (/(^qc|\bqc\b|inspe|aoi|quality|teste?\b|test\b)/.test(s)) return 'inspection';
  if (/(buffer|wip|estoque|supermarket|supermercado|storage|armaz)/.test(s)) return 'buffer';
  return 'machine';
}

const COLS = 12;
const DX = 100;
const DY = 190;
const X0 = 160;
const Y0 = 120;

/**
 * Constrói uma linha a partir de postos em sequência.
 * - Inspeção seguida de Retrabalho: inspeção → próximo posto (peso 100 - rejeição)
 *   e → retrabalho (peso rejeição); retrabalho volta para a inspeção (reteste).
 * - Source e Finished Goods são criados se não existirem.
 */
export function buildLine(rows: StationRow[], opts: { name: string; cycleTime?: number; rejectPct?: number } ): Model {
  const ct = opts.cycleTime ?? 12;
  const rejectPct = opts.rejectPct ?? 3;
  const nodes: NodeDef[] = [];
  const links: LinkDef[] = [];
  const typed = rows.map((r) => ({ ...r, type: r.type ?? inferType(r.name) }));
  const hasExplicitNext = typed.some((r) => r.next && r.next.trim());
  if (!hasExplicitNext) {
    if (typed[0]?.type !== 'source') typed.unshift({ name: 'Raw Material', type: 'source' });
    if (typed[typed.length - 1]?.type !== 'sink') typed.push({ name: 'Finished Goods', type: 'sink' });
  }

  const used = new Set<string>();
  const mkId = (r: StationRow, i: number) => {
    let id = (r.id ?? r.name).toString().trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || `N${i}`;
    if (used.has(id)) id = `${id}_${i}`;
    used.add(id);
    return id;
  };

  const mainSeq: NodeDef[] = [];
  let lastInspection: NodeDef | null = null;
  const reworkOf = new Map<NodeDef, NodeDef>();
  typed.forEach((r, i) => {
    const node = makeNode(r.type!, {
      id: mkId(r, i),
      name: r.name,
      ...(r.type === 'machine' || r.type === 'inspection' ? { cycleTime: ct } : {}),
      ...(r.cycleTime !== undefined ? { cycleTime: r.cycleTime } : {}),
      ...(r.capacity !== undefined ? { capacity: r.capacity } : {}),
      ...(r.queueCap !== undefined ? { queueCap: r.queueCap } : {}),
      ...(r.operators !== undefined ? { operators: r.operators } : {}),
      ...(r.availability !== undefined ? { availability: r.availability } : {}),
      ...(r.mttr !== undefined ? { mttr: r.mttr } : {}),
      ...(r.cv !== undefined ? { cv: r.cv } : {}),
    });
    nodes.push(node);
    if (r.type === 'rework' && lastInspection && !reworkOf.has(lastInspection)) {
      reworkOf.set(lastInspection, node);
    } else {
      mainSeq.push(node);
      lastInspection = r.type === 'inspection' ? node : null;
    }
  });

  if (hasExplicitNext) {
    typed.forEach((r, i) => {
      for (const part of (r.next ?? '').split(/[,;]/)) {
        const [to, w] = part.split(':').map((s) => s.trim());
        if (!to) continue;
        const target = nodes.find((n) => n.id === to || n.name === to);
        if (target) links.push({ id: newId('L'), from: nodes[i].id, to: target.id, weight: w ? Number(w) || 1 : 1 });
      }
    });
  } else {
    for (let i = 0; i < mainSeq.length - 1; i++) {
      const a = mainSeq[i];
      const b = mainSeq[i + 1];
      const rw = reworkOf.get(a);
      links.push({ id: newId('L'), from: a.id, to: b.id, weight: rw ? 100 - rejectPct : 1 });
      if (rw) {
        links.push({ id: newId('L'), from: a.id, to: rw.id, weight: rejectPct });
        links.push({ id: newId('L'), from: rw.id, to: a.id, weight: 1 });
      }
    }
  }

  const hasXY = typed.every((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
  if (hasXY) {
    typed.forEach((r, i) => {
      nodes[i].x = r.x!;
      nodes[i].y = r.y!;
    });
  } else {
    serpentine(mainSeq, reworkOf);
  }
  return { name: opts.name, nodes, links, settings: { ...DEFAULT_SETTINGS } };
}

/** Layout em serpentina (U), retrabalhos abaixo da inspeção correspondente. */
export function serpentine(seq: NodeDef[], reworkOf: Map<NodeDef, NodeDef> = new Map()): void {
  seq.forEach((n, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    n.x = X0 + (row % 2 === 0 ? col : COLS - 1 - col) * DX;
    n.y = Y0 + row * DY;
    const rw = reworkOf.get(n);
    if (rw) {
      rw.x = n.x;
      rw.y = n.y + 85;
    }
  });
}

export function lp2Model(): Model {
  return buildLine(
    LP2_STATIONS.map(([name, mp]) => ({ name, operators: mp ?? 1, availability: 0.98, mttr: 90 })),
    { name: 'Linha LP2 – exemplo (70 postos)', cycleTime: 12 },
  );
}

export function simpleModel(): Model {
  const m = buildLine(
    [
      { name: 'Raw Material', type: 'source' },
      { name: 'Machine 1', cycleTime: 10 },
      { name: 'Machine 2', cycleTime: 12 },
      { name: 'Buffer', type: 'buffer', capacity: 10 },
      { name: 'Machine 3', cycleTime: 14, availability: 0.95, mttr: 120 },
      { name: 'Inspection', type: 'inspection', cycleTime: 8 },
      { name: 'Rework', type: 'rework', cycleTime: 45 },
      { name: 'Finished Goods', type: 'sink' },
    ],
    { name: 'Linha exemplo simples', cycleTime: 12, rejectPct: 5 },
  );
  m.nodes.forEach((n, i) => {
    if (n.type !== 'rework') n.x = 120 + i * 130;
    n.y = 200;
  });
  const rw = m.nodes.find((n) => n.type === 'rework')!;
  const insp = m.nodes.find((n) => n.type === 'inspection')!;
  rw.x = insp.x;
  rw.y = 330;
  m.settings.takt = 15;
  return m;
}

type Act = [string, number, ActivityKind];
const ELEMENT_LINE: { name: string; type?: NodeType; capacity?: number; efficiency?: number; ops: [string, Act[]][] }[] = [
  { name: 'Posto 1 – Base', ops: [['Preparar base', [['Pegar base do carrinho', 4, 'nva'], ['Inspecionar base', 3, 'nva'], ['Posicionar no pallet', 3, 'va']]], ['Etiquetas', [['Colar etiqueta de série', 6, 'va'], ['Escanear série', 3, 'nva'], ['Colar etiqueta de lote', 5, 'va']]], ['Fixação inicial', [['Fixar 4 parafusos', 12, 'va'], ['Andar até o kanban', 4, 'walk']]]] },
  { name: 'Posto 2 – Placa', ops: [['Placa eletrônica', [['Pegar e desembalar placa', 6, 'nva'], ['Encaixar placa', 8, 'va'], ['Fixar 3 parafusos', 9, 'va']]], ['Cabos', [['Conectar cabo de força', 5, 'va'], ['Conectar cabo flat', 6, 'va'], ['Rotear cabos', 8, 'va']]]] },
  { name: 'Posto 3 – Mecanismo', efficiency: 0.9, ops: [['Mecanismo', [['Pegar mecanismo', 4, 'nva'], ['Lubrificar 4 pontos', 8, 'va'], ['Encaixar mecanismo', 10, 'va'], ['Fixar 2 parafusos', 7, 'va']]], ['Ajuste', [['Girar produto 180°', 3, 'nva'], ['Ajustar folga', 9, 'va'], ['Aguardar parafusadeira', 4, 'wait']]]] },
  { name: 'Posto 4 – Tampa', ops: [['Tampa traseira', [['Pegar tampa', 3, 'nva'], ['Encaixar tampa', 7, 'va'], ['Fixar 6 parafusos', 16, 'va']]], ['Acabamento', [['Colar 2 pés de borracha', 6, 'va'], ['Limpar superfície', 5, 'nva']]]] },
  { name: 'Posto 5 – Inspeção visual', type: 'inspection', ops: [['Inspeção', [['Inspeção cosmética', 15, 'nva'], ['Conferir etiquetas', 6, 'nva'], ['Registrar no sistema', 5, 'nva']]]] },
  { name: 'Teste funcional', type: 'inspection', capacity: 3, ops: [['Teste', [['Conectar no testador', 10, 'nva'], ['Teste automático', 120, 'machine'], ['Desconectar e liberar', 8, 'nva']]]] },
  { name: 'Posto 6 – Embalagem', ops: [['Embalagem', [['Montar caixa', 10, 'nva'], ['Colocar produto e calços', 14, 'va'], ['Colocar manual e acessórios', 8, 'va'], ['Fechar e etiquetar caixa', 12, 'va']]]] },
];

/** Linha genérica com operações e atividades por posto (estudo por elemento e Yamazumi). */
export function elementsModel(): Model {
  const nodes: NodeDef[] = [];
  const links: LinkDef[] = [];
  const add = (n: NodeDef) => {
    const prev = nodes[nodes.length - 1];
    nodes.push(n);
    if (prev) links.push({ id: newId('L'), from: prev.id, to: n.id, weight: 1 });
  };
  add(makeNode('source', { name: 'Kit de peças', x: 120, y: 220 }));
  ELEMENT_LINE.forEach((s, i) => {
    const operations: Operation[] = s.ops.map(([name, acts]) => ({ name, activities: acts.map(([n, time, kind]) => ({ name: n, time, kind })) }));
    const type = s.type ?? 'machine';
    add(
      makeNode(type, {
        ...(type === 'machine' ? MANUAL_PATCH : {}),
        name: s.name,
        x: 260 + i * 130,
        y: 220,
        operators: 1,
        capacity: s.capacity ?? 1,
        queueCap: 2,
        cv: 0.08,
        availability: 1,
        cycleTime: operationsTime(operations),
        operations,
        cycleFromOps: true,
        efficiency: s.efficiency,
        area: s.capacity && s.capacity > 1 ? { w: 100, h: 50 } : undefined,
      }),
    );
  });
  add(makeNode('sink', { name: 'Produto acabado', x: 260 + ELEMENT_LINE.length * 130, y: 220 }));
  return {
    name: 'Linha exemplo – estudo por elemento (Yamazumi)',
    nodes,
    links,
    pools: [],
    settings: { ...DEFAULT_SETTINGS, studyMode: 'elements', startFull: true, warmup: 0 },
  };
}
