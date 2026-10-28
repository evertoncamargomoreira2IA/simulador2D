// Planilha padrão: baixar, preencher no Excel e subir para gerar a linha inteira.
//
// Abas: "Leia-me", "Postos", "Ligações", "Pessoas e veículos" e "Parâmetros".
// A mesma planilha sai preenchida com o modelo aberto, então serve também para
// editar uma linha existente no Excel e subir de volta.

import * as XLSX from 'xlsx';
import { serpentine } from '../model/builder';
import { DEFAULT_SETTINGS, makeNode, makePool, newId, type LinkDef, type Model, type NodeDef, type NodeType, type PoolDef, type PoolKind, type SimSettings } from '../engine/types';

export const SHEETS = { readme: 'Leia-me', nodes: 'Postos', links: 'Ligações', pools: 'Pessoas e veículos', params: 'Parâmetros' };

const NODE_COLS = [
  'id', 'nome', 'tipo', 'tempo_ciclo_s', 'cv', 'capacidade', 'fila', 'operadores', 'disponibilidade', 'mttr_s', 'setup_s',
  'intervalo_chegada_s', 'lote', 'ponto_saida', 'tempo_fixo', 'pool_operadores', 'manuseio_s', 'potencia_kw', 'potencia_espera_kw',
  'custo_hora', 'kit_ao_lado', 'x_m', 'y_m', 'area_largura_m', 'area_altura_m',
] as const;
const LINK_COLS = ['de', 'para', 'peso', 'papel', 'transporte', 'distancia_m', 'uma_vez'] as const;
const POOL_COLS = ['id', 'nome', 'tipo', 'quantidade', 'velocidade_m_s', 'tempo_carga_s', 'custo_hora', 'potencia_kw', 'x_m', 'y_m'] as const;

const TIPOS: Record<string, NodeType> = {
  source: 'source', entrada: 'source', fonte: 'source',
  machine: 'machine', posto: 'machine', maquina: 'machine', máquina: 'machine',
  buffer: 'buffer', estoque: 'buffer',
  inspection: 'inspection', inspecao: 'inspection', inspeção: 'inspection', teste: 'inspection',
  rework: 'rework', reparo: 'rework', retrabalho: 'rework',
  sink: 'sink', saida: 'sink', saída: 'sink', expedicao: 'sink', expedição: 'sink',
};
const TIPO_PT: Record<NodeType, string> = { source: 'entrada', machine: 'posto', buffer: 'buffer', inspection: 'teste', rework: 'reparo', sink: 'saida' };
const POOL_TIPOS: Record<string, PoolKind> = { operador: 'operator', operadores: 'operator', operator: 'operator', empilhadeira: 'forklift', forklift: 'forklift', agv: 'agv', amr: 'agv' };
const POOL_PT: Record<PoolKind, string> = { operator: 'operador', forklift: 'empilhadeira', agv: 'agv' };

type Param = { k: keyof SimSettings; nome: string; unidade: string; desc: string; toSheet?: (v: number) => number; fromSheet?: (v: number) => number };
const PARAMS: Param[] = [
  { k: 'takt', nome: 'takt_s', unidade: 's', desc: 'Takt time da linha (3600 ÷ UPH alvo)' },
  { k: 'duration', nome: 'duracao_h', unidade: 'h', desc: 'Tempo simulado', toSheet: (v) => v / 3600, fromSheet: (v) => v * 3600 },
  { k: 'warmup', nome: 'aquecimento_min', unidade: 'min', desc: 'Período descartado no início (0 se a linha começa cheia)', toSheet: (v) => v / 60, fromSheet: (v) => v * 60 },
  { k: 'startFull', nome: 'linha_cheia', unidade: 'S/N', desc: 'S = começa em regime, como na produção' },
  { k: 'seed', nome: 'semente', unidade: '', desc: 'Mesma semente = mesma sequência de eventos' },
  { k: 'transportSpeed', nome: 'velocidade_transporte_m_s', unidade: 'm/s', desc: 'Velocidade da peça entre postos sem veículo' },
  { k: 'laborRate', nome: 'salario_hora', unidade: 'R$/h', desc: 'Custo do operador por hora' },
  { k: 'energyPrice', nome: 'energia_kwh', unidade: 'R$/kWh', desc: 'Preço da energia' },
  { k: 'materialCost', nome: 'material_peca', unidade: 'R$', desc: 'Custo de material por peça' },
  { k: 'maintenanceRate', nome: 'manutencao_hora', unidade: 'R$/h', desc: 'Custo por hora de máquina parada' },
  { k: 'gridCo2', nome: 'co2_rede', unidade: 'kg/kWh', desc: 'Fator de emissão da rede (escopo 2)' },
  { k: 'materialCo2', nome: 'co2_material', unidade: 'kg/peça', desc: 'Emissão do material por peça (escopo 3)' },
  { k: 'pxPerMeter', nome: 'escala_px_por_m', unidade: 'px/m', desc: 'Escala do desenho na tela (não mexer)' },
];

export const README: [string, string][] = [
  ['Como usar', ''],
  ['1', 'Preencha a aba Postos: uma linha por posto, buffer, entrada ou saída. Só id, nome e tipo são obrigatórios.'],
  ['2', 'Na aba Ligações, diga para onde cada posto manda a peça (de → para). Se deixar vazia, os postos são ligados na ordem da aba Postos.'],
  ['3', 'Se tiver empilhadeira, AGV ou operadores compartilhados, cadastre na aba Pessoas e veículos e use o id na coluna transporte (Ligações) ou pool_operadores (Postos).'],
  ['4', 'Ajuste takt, duração e custos na aba Parâmetros.'],
  ['5', 'No simulador: Importar → escolha esta planilha. A linha é montada e os erros aparecem na barra de mensagens.'],
  ['', ''],
  ['Colunas da aba Postos', ''],
  ['tipo', 'entrada, posto, buffer, teste, reparo ou saida'],
  ['tempo_ciclo_s', 'Tempo de ciclo de UMA peça em UMA giga (s). Com capacidade 6, o posto entrega 6 peças a cada tempo_ciclo.'],
  ['cv', 'Variação do tempo (0,05 = 5%). 0 = tempo fixo.'],
  ['capacidade', 'Gigas ou postos em paralelo. Em buffer, quantas peças cabem.'],
  ['fila', 'Peças que cabem antes do posto (buffer de entrada).'],
  ['disponibilidade', '0 a 1 (ou %). Abaixo de 1 gera falhas com o mttr_s informado.'],
  ['intervalo_chegada_s', 'Só para entrada: segundos entre peças. 0 = sempre tem material.'],
  ['lote', 'Junta N peças numa carga (carrinho, pallet) antes de seguir.'],
  ['ponto_saida', 'S no posto onde a produção da linha é medida (UPH).'],
  ['tempo_fixo', 'S para o posto não ser alterado pela calibração ao takt.'],
  ['kit_ao_lado', 'Montagem: quantos kits de cada componente ficam ao lado do posto.'],
  ['area_largura_m, area_altura_m', 'Área ocupada pelas gigas, para o operador andar entre elas.'],
  ['x_m, y_m', 'Posição em metros. Vazio = o simulador desenha em U. Se preencher todos, a planta DXF aberta é mantida.'],
  ['', ''],
  ['Colunas da aba Ligações', ''],
  ['peso', 'Divide a saída entre destinos. Ex.: 99 para o próximo posto e 1 para o reparo = 1% de reprova.'],
  ['papel', 'fluxo (padrão) ou peca: a ligação entrega um componente consumido na montagem do destino.'],
  ['transporte', 'id de uma empilhadeira ou AGV da aba Pessoas e veículos.'],
  ['distancia_m', 'Distância real do trecho em metros, quando o desenho não está em escala.'],
  ['uma_vez', 'S = a peça passa só uma vez (amostra que vai e volta, como OBA).'],
];

const yes = (v: unknown) => /^(s|sim|y|yes|true|1|x)$/i.test(String(v ?? '').trim());
const sn = (b: boolean | undefined) => (b ? 'S' : '');
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || String(v).trim() === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}
const frac = (v: unknown) => {
  const n = num(v);
  return n === undefined ? undefined : n > 1 ? n / 100 : n;
};
const r3 = (v: number) => Math.round(v * 1000) / 1000;

const EXAMPLE: Model = (() => {
  const st = (id: string, name: string, type: NodeType, p: Partial<NodeDef> = {}) => makeNode(type, { id, name, ...p });
  const nodes = [
    st('ENT', 'Entrada', 'source'),
    st('P1', 'Posto 1', 'machine', { cycleTime: 48, operators: 1 }),
    st('P2', 'Posto 2', 'machine', { cycleTime: 46, operators: 1 }),
    st('P3', 'Posto 3', 'machine', { cycleTime: 47, operators: 1 }),
    st('KIT', 'Kit off-line', 'machine', { cycleTime: 40, operators: 1 }),
    st('ENTK', 'Entrada kit', 'source'),
    st('TST', 'Teste final', 'inspection', { cycleTime: 600, capacity: 14, queueCap: 30, operators: 3, fixedTime: true }),
    st('REP', 'Reparo', 'rework', { cycleTime: 300, operators: 1 }),
    st('PCK', 'Embalagem', 'machine', { cycleTime: 45, operators: 1 }),
    st('CAR', 'Carrinho 15', 'buffer', { cycleTime: 0, capacity: 30, batchSize: 15, outputPoint: true }),
    st('WH', 'Armazém', 'sink'),
  ];
  const l = (from: string, to: string, p: Partial<LinkDef> = {}): LinkDef => ({ id: newId('L'), from, to, weight: 1, ...p });
  return {
    name: 'Planilha padrão (exemplo)',
    nodes,
    links: [
      l('ENT', 'P1'), l('P1', 'P2'), l('ENTK', 'KIT'), l('KIT', 'P2', { role: 'part' }), l('P2', 'P3'), l('P3', 'TST'),
      l('TST', 'PCK', { weight: 98 }), l('TST', 'REP', { weight: 2 }), l('REP', 'TST'), l('PCK', 'CAR'),
      l('CAR', 'WH', { poolId: 'AGV1', length: 200 }),
    ],
    pools: [makePool('agv', { id: 'AGV1', name: 'AGV expedição', count: 1, speed: 1 })],
    settings: { ...DEFAULT_SETTINGS, takt: 50.7, startFull: true },
  };
})();

/** Gera a planilha padrão. Sem modelo, sai com uma linha de exemplo para servir de guia. */
export function templateWorkbook(model?: Model): XLSX.WorkBook {
  const m = model && model.nodes.length ? model : EXAMPLE;
  // Exemplo sem posição: o simulador desenha em U ao importar.
  const pos = m !== EXAMPLE;
  const ppm = m.settings.pxPerMeter || DEFAULT_SETTINGS.pxPerMeter;
  const wb = XLSX.utils.book_new();
  const sheet = (rows: unknown[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map((wch) => ({ wch }));
    return ws;
  };
  XLSX.utils.book_append_sheet(wb, sheet([['Planilha padrão do Simulador 2D', ''], ...README], [26, 110]), SHEETS.readme);
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        [...NODE_COLS],
        ...m.nodes.map((n) => [
          n.id, n.name, TIPO_PT[n.type], r3(n.cycleTime), r3(n.cv), n.capacity, n.queueCap, n.operators, r3(n.availability), n.mttr,
          n.setupTime, n.interarrival, n.batchSize || '', sn(n.outputPoint), sn(n.fixedTime), n.poolId ?? '', n.handlingTime ?? '',
          n.powerKw || '', n.idlePowerKw || '', n.costPerHour || '', n.partBuffer ?? '', pos ? r3(n.x / ppm) : '', pos ? r3(n.y / ppm) : '',
          n.area ? r3(n.area.w / ppm) : '', n.area ? r3(n.area.h / ppm) : '',
        ]),
      ],
      [12, 24, 9, ...NODE_COLS.slice(3).map(() => 12)],
    ),
    SHEETS.nodes,
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [[...LINK_COLS], ...m.links.map((l) => [l.from, l.to, l.weight, l.role === 'part' ? 'peca' : 'fluxo', l.poolId ?? '', l.length ?? '', sn(l.once)])],
      [12, 12, 8, 8, 12, 12, 9],
    ),
    SHEETS.links,
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [[...POOL_COLS], ...(m.pools ?? []).map((p) => [p.id, p.name, POOL_PT[p.kind], p.count, p.speed, p.loadTime, p.costPerHour ?? '', p.powerKw ?? '', pos ? r3(p.x / ppm) : '', pos ? r3(p.y / ppm) : ''])],
      [12, 22, 13, 11, 15, 14, 11, 12, 9, 9],
    ),
    SHEETS.pools,
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ['parametro', 'valor', 'unidade', 'descricao'],
        ...PARAMS.map((p) => {
          const v = m.settings[p.k];
          const out = typeof v === 'boolean' ? sn(v) : typeof v === 'number' ? Math.round((p.toSheet ? p.toSheet(v) : v) * 1e5) / 1e5 : '';
          return [p.nome, out, p.unidade, p.desc];
        }),
      ],
      [28, 10, 10, 60],
    ),
    SHEETS.params,
  );
  return wb;
}

export function templateBytes(model?: Model): ArrayBuffer {
  return XLSX.write(templateWorkbook(model), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function isTemplate(wb: XLSX.WorkBook): boolean {
  const ws = wb.Sheets[SHEETS.nodes];
  if (!ws) return false;
  const head = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] ?? []).map(norm);
  return head.includes('id') && head.includes('tipo');
}

export interface TemplateResult {
  model: Model;
  warnings: string[];
  /** Todos os postos vieram com posição: a planta aberta pode ser mantida. */
  hasLayout: boolean;
}

/** Lê a planta padrão preenchida e monta o modelo. Erros graves viram exceção; o resto vira aviso. */
export function parseTemplate(wb: XLSX.WorkBook, name: string): TemplateResult {
  const rows = (s: string) => (wb.Sheets[s] ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[s], { defval: '' }) : []);
  const warnings: string[] = [];
  const settings: SimSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows(SHEETS.params)) {
    const p = PARAMS.find((x) => x.nome === norm(r.parametro));
    if (!p) continue;
    if (p.k === 'startFull') settings.startFull = yes(r.valor);
    else {
      const v = num(r.valor);
      if (v !== undefined) (settings as unknown as Record<string, number>)[p.k] = p.fromSheet ? p.fromSheet(v) : v;
    }
  }
  const ppm = settings.pxPerMeter;

  const pools: PoolDef[] = [];
  for (const r of rows(SHEETS.pools)) {
    const id = String(r.id ?? '').trim();
    if (!id) continue;
    const kind = POOL_TIPOS[norm(r.tipo)];
    if (!kind) {
      warnings.push(`Pessoas e veículos "${id}": tipo "${r.tipo}" desconhecido (use operador, empilhadeira ou agv).`);
      continue;
    }
    pools.push(
      makePool(kind, {
        id,
        name: String(r.nome || id),
        ...(num(r.quantidade) !== undefined ? { count: num(r.quantidade)! } : {}),
        ...(num(r.velocidade_m_s) !== undefined ? { speed: num(r.velocidade_m_s)! } : {}),
        ...(num(r.tempo_carga_s) !== undefined ? { loadTime: num(r.tempo_carga_s)! } : {}),
        ...(num(r.custo_hora) !== undefined ? { costPerHour: num(r.custo_hora)! } : {}),
        ...(num(r.potencia_kw) !== undefined ? { powerKw: num(r.potencia_kw)! } : {}),
        ...(num(r.x_m) !== undefined && num(r.y_m) !== undefined ? { x: num(r.x_m)! * ppm, y: num(r.y_m)! * ppm } : {}),
      }),
    );
  }
  const poolIds = new Set(pools.map((p) => p.id));

  const nodes: NodeDef[] = [];
  let withXY = 0;
  rows(SHEETS.nodes).forEach((r, i) => {
    const id = String(r.id ?? '').trim();
    const nome = String(r.nome ?? '').trim();
    if (!id && !nome) return;
    const type = TIPOS[norm(r.tipo)];
    if (!type) {
      warnings.push(`Linha ${i + 2} da aba Postos: tipo "${r.tipo}" desconhecido, usei "posto".`);
    }
    const nid = id || nome.replace(/\s+/g, '_');
    if (nodes.some((n) => n.id === nid)) throw new Error(`O id "${nid}" aparece duas vezes na aba Postos.`);
    const p: Partial<NodeDef> = { id: nid, name: nome || nid };
    const set = <K extends keyof NodeDef>(k: K, v: NodeDef[K] | undefined) => {
      if (v !== undefined) p[k] = v;
    };
    set('cycleTime', num(r.tempo_ciclo_s));
    set('cv', frac(r.cv));
    set('capacity', num(r.capacidade));
    set('queueCap', num(r.fila));
    set('operators', num(r.operadores));
    set('availability', frac(r.disponibilidade));
    set('mttr', num(r.mttr_s));
    set('setupTime', num(r.setup_s));
    set('interarrival', num(r.intervalo_chegada_s));
    set('batchSize', num(r.lote));
    set('handlingTime', num(r.manuseio_s));
    set('powerKw', num(r.potencia_kw));
    set('idlePowerKw', num(r.potencia_espera_kw));
    set('costPerHour', num(r.custo_hora));
    set('partBuffer', num(r.kit_ao_lado));
    const aw = num(r.area_largura_m);
    const ah = num(r.area_altura_m);
    if (aw !== undefined && ah !== undefined) p.area = { w: aw * ppm, h: ah * ppm };
    if (yes(r.ponto_saida)) p.outputPoint = true;
    if (yes(r.tempo_fixo)) p.fixedTime = true;
    const pool = String(r.pool_operadores ?? '').trim();
    if (pool) {
      if (poolIds.has(pool)) p.poolId = pool;
      else warnings.push(`Posto "${nid}": pool_operadores "${pool}" não existe na aba Pessoas e veículos.`);
    }
    const x = num(r.x_m);
    const y = num(r.y_m);
    if (x !== undefined && y !== undefined) {
      p.x = x * ppm;
      p.y = y * ppm;
      withXY++;
    }
    nodes.push(makeNode(type ?? 'machine', p));
  });
  if (nodes.length === 0) throw new Error('A aba Postos está vazia.');

  const byKey = (k: string) => nodes.find((n) => n.id === k) ?? nodes.find((n) => n.name === k);
  const links: LinkDef[] = [];
  for (const [i, r] of rows(SHEETS.links).entries()) {
    const de = String(r.de ?? '').trim();
    const para = String(r.para ?? '').trim();
    if (!de && !para) continue;
    const a = byKey(de);
    const b = byKey(para);
    if (!a || !b) {
      warnings.push(`Linha ${i + 2} da aba Ligações: ${!a ? `"${de}"` : `"${para}"`} não existe na aba Postos.`);
      continue;
    }
    if (b.type === 'source' || a.type === 'sink') {
      warnings.push(`Ligação ${de} → ${para} ignorada: nada entra numa entrada nem sai de uma saída.`);
      continue;
    }
    const tr = String(r.transporte ?? '').trim();
    if (tr && !poolIds.has(tr)) warnings.push(`Ligação ${de} → ${para}: transporte "${tr}" não existe na aba Pessoas e veículos.`);
    links.push({
      id: newId('L'),
      from: a.id,
      to: b.id,
      weight: num(r.peso) ?? 1,
      ...(/^pe[cç]a|part/.test(norm(r.papel)) ? { role: 'part' as const } : {}),
      ...(tr && poolIds.has(tr) ? { poolId: tr } : {}),
      ...(num(r.distancia_m) !== undefined ? { length: num(r.distancia_m)! } : {}),
      ...(yes(r.uma_vez) ? { once: true } : {}),
    });
  }
  if (links.length === 0) {
    for (let i = 0; i < nodes.length - 1; i++) {
      if (nodes[i].type === 'sink' || nodes[i + 1].type === 'source') continue;
      links.push({ id: newId('L'), from: nodes[i].id, to: nodes[i + 1].id, weight: 1 });
    }
    warnings.push('Aba Ligações vazia: liguei os postos na ordem da aba Postos.');
  }

  if (!nodes.some((n) => n.type === 'source')) warnings.push('Nenhuma entrada (tipo entrada): a linha não recebe peças.');
  if (!nodes.some((n) => n.type === 'sink')) warnings.push('Nenhuma saída (tipo saida): as peças não terminam a rota.');
  for (const n of nodes) {
    if (n.type !== 'source' && !links.some((l) => l.to === n.id)) warnings.push(`"${n.name}" não recebe peça de ninguém.`);
    if (n.type !== 'sink' && !links.some((l) => l.from === n.id)) warnings.push(`"${n.name}" não manda peça para ninguém.`);
  }

  const spread = new Set(nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`)).size > 1;
  const hasLayout = withXY === nodes.length && spread;
  if (!hasLayout) serpentine(nodes);
  return { model: { name, nodes, links, pools, settings }, warnings, hasLayout };
}
