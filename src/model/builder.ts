// Monta modelos a partir de listas de postos e faz o layout automático em serpentina.

import { DEFAULT_SETTINGS, makeNode, makePool, MANUAL_PATCH, newId, operationsTime, type ActivityKind, type LinkDef, type Model, type NodeDef, type NodeType, type Operation, type TimeDist } from '../engine/types';
import { LP2_STATIONS } from './lp2';
import { supplyPlant } from './plant';

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
  return m;
}

/** Exemplo didático: 3 postos fazem peças diferentes, um AMR e um operador levam até a montagem, que junta tudo em um produto. */
export function combineModel(): Model {
  const nd = (type: NodeType, id: string, name: string, x: number, y: number, extra: Partial<NodeDef> = {}) =>
    makeNode(type, { id, name, x, y, ...extra });
  const nodes: NodeDef[] = [
    nd('source', 'S1', 'Material peça 1', 80, 120),
    nd('source', 'S2', 'Material peça 2', 80, 260),
    nd('source', 'S3', 'Material peça 3', 80, 400),
    nd('machine', 'P1', 'Posto 1 – Base', 260, 120, { cycleTime: 30 }),
    nd('machine', 'P2', 'Posto 2 – Placa', 260, 260, { cycleTime: 25 }),
    nd('machine', 'P3', 'Posto 3 – Parafusos', 260, 400, { cycleTime: 8 }),
    nd('machine', 'X', 'Posto X – Montagem', 620, 260, { cycleTime: 32, queueCap: 4, partBuffer: 6 }),
    nd('sink', 'FG', 'Produto pronto', 820, 260),
  ];
  const L = (from: string, to: string, extra: Partial<LinkDef> = {}): LinkDef => ({ id: newId('L'), from, to, weight: 1, ...extra });
  const links: LinkDef[] = [
    L('S1', 'P1'),
    L('S2', 'P2'),
    L('S3', 'P3'),
    L('P1', 'X', { poolId: 'AMR', tripQty: 2 }),
    L('P2', 'X', { role: 'part', poolId: 'OP' }),
    L('P3', 'X', { role: 'part', partQty: 4, poolId: 'AMR', tripQty: 8 }),
    L('X', 'FG'),
  ];
  return {
    name: 'Exemplo: combinar peças com AMR e operador',
    nodes,
    links,
    pools: [
      makePool('amr', { id: 'AMR', name: 'AMR', count: 1, x: 440, y: 400 }),
      makePool('operator', { id: 'OP', name: 'Abastecedor', count: 1, x: 440, y: 200 }),
    ],
    settings: { ...DEFAULT_SETTINGS, duration: 8 * 3600 },
  };
}

/** Exemplo didático: dois buffers abastecem o mesmo posto manual e um operador leva as peças, 4 por viagem. */
export function transportModel(): Model {
  const nd = (type: NodeType, id: string, name: string, x: number, y: number, extra: Partial<NodeDef> = {}) =>
    makeNode(type, { id, name, x, y, ...extra });
  const nodes: NodeDef[] = [
    nd('source', 'S1', 'Material A', 80, 100),
    nd('machine', 'A', 'Posto A', 240, 100, { ...MANUAL_PATCH, cycleTime: 20, operators: 1 }),
    nd('buffer', 'B1', 'Buffer A', 420, 100, { capacity: 10 }),
    nd('source', 'S2', 'Material B', 80, 340),
    nd('machine', 'B', 'Posto B', 240, 340, { ...MANUAL_PATCH, cycleTime: 20, operators: 1 }),
    nd('buffer', 'B2', 'Buffer B', 420, 340, { capacity: 10 }),
    nd('machine', 'D', 'Posto destino', 660, 220, { ...MANUAL_PATCH, cycleTime: 9, operators: 1, queueCap: 4 }),
    nd('sink', 'FG', 'Produto pronto', 860, 220),
  ];
  const L = (from: string, to: string, extra: Partial<LinkDef> = {}): LinkDef => ({ id: newId('L'), from, to, weight: 1, ...extra });
  return {
    name: 'Exemplo: operador levando peças de dois buffers',
    nodes,
    links: [
      L('S1', 'A'), L('A', 'B1'), L('B1', 'D', { poolId: 'OP', tripQty: 4 }),
      L('S2', 'B'), L('B', 'B2'), L('B2', 'D', { poolId: 'OP', tripQty: 4 }),
      L('D', 'FG'),
    ],
    pools: [makePool('operator', { id: 'OP', name: 'Abastecedor', count: 1, x: 540, y: 220 })],
    settings: { ...DEFAULT_SETTINGS, duration: 8 * 3600 },
  };
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

/**
 * Exemplo de abastecimento e FGI: linha de 100 UPH (takt 36 s) com 10 postos de montagem, 5 off-line,
 * 4 operadores de teste e 5 de packing. O material sai do supermercado, o kit é preparado no kitting e o
 * rebocador do milk run leva tudo pelo corredor; o produto embalado vai para o FGI e a empilhadeira leva à expedição.
 */
export function supplyModel(): Model {
  const nodes: NodeDef[] = [];
  const links: LinkDef[] = [];
  const nd = (type: NodeType, id: string, name: string, x: number, y: number, extra: Partial<NodeDef> = {}) => {
    const n = makeNode(type, { id, name, x, y, ...extra });
    nodes.push(n);
    return n;
  };
  const L = (from: string, to: string, extra: Partial<LinkDef> = {}) => links.push({ id: newId('L'), from, to, weight: 1, ...extra });
  const manual = (cycleTime: number, extra: Partial<NodeDef> = {}): Partial<NodeDef> => ({ ...MANUAL_PATCH, cycleTime, operators: 1, cv: 0.08, queueCap: 1, layer: 'Produção', ...extra });
  const AISLE = 335;
  const milkRun = (x0: number, x1: number): Partial<LinkDef> => ({ poolId: 'MR', tripQty: 20, bins: 2, path: [{ x: x0, y: AISLE }, { x: x1, y: AISLE }] });

  // supermercado → kitting → kits prontos
  nd('source', 'SK', 'SM kit base', 400, 110, { layer: 'Abastecimento' });
  nd('machine', 'KIT', 'Kitting (preparação do kit)', 1100, 160, manual(64, { capacity: 2, operators: 2, area: { w: 90, h: 40 }, layer: 'Abastecimento' }));
  nd('buffer', 'KP', 'Kits prontos', 1380, 220, { capacity: 40, layer: 'Abastecimento' });
  L('SK', 'KIT');
  L('KIT', 'KP');

  // linha principal: 10 postos de montagem
  const MT = [33, 34, 32, 35, 33, 34, 31, 35, 33, 34];
  MT.forEach((ct, i) => {
    const id = `M${i + 1}`;
    const offline = i % 2 === 1;
    nd('machine', id, `Montagem ${i + 1}`, 320 + i * 110, 555, manual(ct, offline ? { assembly: true, partBuffer: 3 } : {}));
    if (i > 0) L(`M${i}`, id);
  });
  L('KP', 'M1', milkRun(1380, 320));

  // off-line: 5 submontagens, cada uma alimenta um posto par da linha
  const OL = [34, 33, 35, 32, 34];
  OL.forEach((ct, j) => {
    const x = 430 + j * 220;
    const sx = 520 + j * 70;
    // fornecedor/recebimento repõe a posição do supermercado; o milk run puxa dela
    nd('source', `SO${j + 1}`, `Recebimento OL${j + 1}`, 80 + (j % 2) * 90, 80 + Math.floor(j / 2) * 80, { layer: 'Abastecimento' });
    nd('buffer', `SM${j + 1}`, `SM off-line ${j + 1}`, sx, 230, { capacity: 60, layer: 'Abastecimento' });
    nd('machine', `OL${j + 1}`, `Off-line ${j + 1}`, x, 430, manual(ct, { queueCap: 2 }));
    L(`SO${j + 1}`, `SM${j + 1}`);
    L(`SM${j + 1}`, `OL${j + 1}`, milkRun(sx, x));
    L(`OL${j + 1}`, `M${2 * j + 2}`, { role: 'part' });
  });

  // teste: 4 bancadas, 4 operadores
  nd('inspection', 'TST', 'Teste funcional', 1480, 555, { cycleTime: 136, capacity: 4, operators: 4, cv: 0.05, queueCap: 2, area: { w: 90, h: 60 } });
  L('M10', 'TST');

  // packing: 5 postos voltando para a esquerda
  const PK = [33, 35, 34, 32, 34];
  PK.forEach((ct, k) => {
    nd('machine', `PK${k + 1}`, `Packing ${k + 1}`, 1480 - k * 170, 800, manual(ct));
    L(k === 0 ? 'TST' : `PK${k}`, `PK${k + 1}`);
  });

  // FGI e expedição
  nd('buffer', 'FGI', 'FGI (estoque de acabados)', 480, 800, { capacity: 400, layer: 'Expedição' });
  nd('sink', 'EXP', 'Expedição', 130, 800, { layer: 'Expedição', outputPoint: false });
  L('PK5', 'FGI');
  L('FGI', 'EXP', { poolId: 'EMP', tripQty: 40 });

  return {
    name: 'Exemplo: abastecimento (supermercado, kitting, milk run) e FGI – 100 UPH',
    nodes,
    links,
    pools: [
      makePool('agv', { id: 'MR', name: 'Rebocador milk run', count: 2, speed: 1.2, loadTime: 20, x: 1100, y: AISLE }),
      makePool('forklift', { id: 'EMP', name: 'Empilhadeira', count: 1, x: 400, y: 660 }),
    ],
    background: supplyPlant(),
    refStation: 'PK5',
    settings: { ...DEFAULT_SETTINGS, takt: 36, startFull: true, warmup: 0, pxPerMeter: 20, duration: 8 * 3600 },
  };
}

/**
 * Exemplo de mix: linha de 8 postos que faz 3 modelos (A 60%, B 30%, C 10%), takt 40 s (90 UPH).
 * O modelo B pesa no aparafusamento e o C no teste; a programação e o teste param para trocar de modelo.
 * Cada posto usa uma curva de tempo diferente (lognormal, triangular, normal, uniforme).
 */
export function mixModel(): Model {
  const rows: [string, number, Record<string, number>, number, TimeDist?][] = [
    ['Preparação', 34, {}, 0, { kind: 'triangular' }],
    ['Montagem base', 36, { B: 38 }, 0],
    ['Aparafusamento', 33, { B: 44, C: 39 }, 0, { kind: 'normal' }],
    ['Cabeamento', 35, { C: 42 }, 0],
    ['Programação', 30, { C: 36 }, 12, { kind: 'uniform' }],
    ['Teste funcional', 70, { C: 88 }, 20, { kind: 'triangular' }],
    ['Inspeção final', 32, {}, 0, { kind: 'normal' }],
    ['Embalagem', 34, { B: 37 }, 0],
  ];
  const nodes: NodeDef[] = [];
  const links: LinkDef[] = [];
  const add = (n: NodeDef) => {
    const prev = nodes[nodes.length - 1];
    nodes.push(n);
    if (prev) links.push({ id: newId('L'), from: prev.id, to: n.id, weight: 1 });
  };
  add(makeNode('source', { name: 'Kits', x: 100, y: 220 }));
  rows.forEach(([name, cycleTime, productTimes, changeover, dist], i) =>
    add(
      makeNode(name === 'Inspeção final' ? 'inspection' : 'machine', {
        ...MANUAL_PATCH,
        id: `X${i + 1}`,
        name,
        x: 240 + i * 130,
        y: 220,
        cycleTime,
        cv: 0.08,
        capacity: name === 'Teste funcional' ? 2 : 1,
        operators: name === 'Teste funcional' ? 2 : 1,
        queueCap: 2,
        availability: 1,
        productTimes: Object.keys(productTimes).length ? productTimes : undefined,
        changeover: changeover || undefined,
        dist,
        area: name === 'Teste funcional' ? { w: 100, h: 50 } : undefined,
      }),
    ),
  );
  add(makeNode('sink', { name: 'Produto acabado', x: 240 + rows.length * 130, y: 220 }));
  return {
    name: 'Exemplo: mix de 3 modelos (A 60%, B 30%, C 10%)',
    nodes,
    links,
    pools: [],
    refStation: 'X8',
    products: [
      { id: 'A', name: 'A', color: '#22d3ee', share: 60, factor: 1 },
      { id: 'B', name: 'B', color: '#e8913a', share: 30, factor: 1 },
      { id: 'C', name: 'C', color: '#a78bfa', share: 10, factor: 1 },
    ],
    settings: { ...DEFAULT_SETTINGS, takt: 40, startFull: true, warmup: 0 },
  };
}
