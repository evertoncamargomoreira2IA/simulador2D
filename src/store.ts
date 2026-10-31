// Estado global da interface (Zustand). O simulador fica fora do estado reativo
// e a tela é redesenhada por `tick` durante a animação.

import type { RealEvent } from './engine/timeStudy';
import { create } from 'zustand';
import { History } from './engine/history';
import { lineKpi, type LineKpi } from './engine/metrics';
import { Simulator } from './engine/simulator';
import { DEFAULT_SETTINGS, makeNode, newId, type LinkDef, type Model, type NodeDef, type NodeType } from './engine/types';
import { tenStationModel } from './model/builder';
import type { TwinState } from './ui/Twin';

export type Tool = 'select' | 'connect';
export type RunState = 'idle' | 'running' | 'paused' | 'done';

export interface Layers {
  grid: boolean;
  links: boolean;
  entities: boolean;
  labels: boolean;
  heat: boolean;
  plant: boolean;
  people: boolean;
  /** Destaca os 5 maiores gargalos no layout. */
  top5: boolean;
  /** Mapa de calor de emissão (CO2e por posto). */
  co2: boolean;
  /** Números de peças em cada posto e buffer (fila, em processo, ocupação). */
  counts: boolean;
}

export type AnalysisTab = 'ciclo' | 'yamazumi' | 'rebalancear' | 'replicas' | 'turnos' | 'throughput' | 'gargalos' | 'spaghetti' | 'custos' | 'energia' | 'carbono' | 'cenarios' | 'coleta' | 'experimentos' | 'real' | 'ia';

export interface RealRow {
  name: string;
  produced?: number;
  cycle?: number;
  state?: string;
}

interface State {
  model: Model;
  selected: string[];
  selectedLink: string | null;
  /** Operador/veículo selecionado no layout (grupo de recursos). */
  selectedPool: string | null;
  selectPool: (id: string | null) => void;
  tool: Tool;
  connectFrom: string | null;
  snap: boolean;
  gridSize: number;
  layers: Layers;
  run: RunState;
  speed: number;
  sim: Simulator;
  tick: number;
  kpi: LineKpi;
  message: string;
  /** Centro da área visível do canvas (coordenadas do modelo). */
  viewCenter: { x: number; y: number };
  setViewCenter: (p: { x: number; y: number }) => void;
  /** Aba aberta do painel de análises (null = fechado) e posto do pop-up de indicadores. */
  analysis: AnalysisTab | null;
  detailId: string | null;
  setAnalysis: (t: AnalysisTab | null) => void;
  setDetail: (id: string | null) => void;
  /** Dados reais por posto (digital twin), pelo nome do posto normalizado. */
  real: Record<string, RealRow>;
  realSource: string;
  setReal: (rows: Record<string, RealRow>, source: string) => void;
  /** Leituras da operação (API, arquivo ou linha simulada) para o estudo de tempos. */
  realEvents: RealEvent[];
  realEventsSource: string;
  setRealEvents: (ev: RealEvent[], source: string) => void;

  openModel: (m: Model, message?: string) => void;
  setModel: (m: Model, message?: string) => void;
  updateNode: (id: string, patch: Partial<NodeDef>) => void;
  moveNodes: (ids: string[], dx: number, dy: number) => void;
  addNode: (type: NodeType, x: number, y: number, patch?: Partial<NodeDef>) => void;
  addLink: (from: string, to: string) => void;
  /** Bloco novo já ligado a partir de outro, num passo só de desfazer. */
  addAfter: (from: string, type: NodeType, x: number, y: number, patch?: Partial<NodeDef>) => void;
  updateLink: (id: string, patch: Partial<LinkDef>) => void;
  deleteSelection: () => void;
  /** Copiar/colar blocos selecionados (com as ligações entre eles). */
  copySelection: () => number;
  paste: () => void;
  select: (ids: string[], link?: string | null) => void;
  setTool: (t: Tool) => void;
  setConnectFrom: (id: string | null) => void;
  setSnap: (v: boolean) => void;
  toggleLayer: (k: keyof Layers) => void;
  updateSettings: (patch: Partial<Model['settings']>) => void;
  /** Troca partes do modelo (recursos, planta) sem mexer na seleção. */
  patchModel: (patch: Partial<Model>) => void;
  /** Posto de referência do UPH (só visual: não zera a simulação). */
  setRefStation: (id: string | undefined) => void;
  undo: () => void;
  redo: () => void;
  /** Rótulos da próxima ação de desfazer/refazer ('' = nada a fazer). */
  undoLabel: string;
  redoLabel: string;
  /** Ordem e visibilidade dos postos nos gráficos: muda o modelo sem reiniciar a simulação. */
  setChartView: (order: string[] | undefined, hidden: string[] | undefined) => void;
  showOrder: boolean;
  /** Janela de operações e atividades aberta (id do posto, '' = primeiro). */
  opsFor: string | null;
  /** Posto com a janela Curva do tempo aberta e janela do Mix de modelos. */
  fitFor: string | null;
  showMix: boolean;
  setFitFor: (id: string | null) => void;
  setShowMix: (v: boolean) => void;
  /** Ctrl+clique: operador/veículo e seta escolhidos para o vínculo de transporte. */
  bindPick: { poolId?: string; linkId?: string } | null;
  /** Janela de vínculo de transporte aberta. */
  transportFor: { poolId?: string; linkId?: string } | null;
  setTransportFor: (v: { poolId?: string; linkId?: string } | null) => void;
  /** Ctrl+clique num operador/veículo ou numa seta: com os dois escolhidos, abre a janela. */
  ctrlPick: (p: { poolId?: string; linkId?: string }) => void;
  showSoe: boolean;
  setShowSoe: (v: boolean) => void;
  setOpsFor: (id: string | null) => void;
  showStart: boolean;
  /** Esta aba faz papel da linha física e transmite os ciclos para o gêmeo digital. */
  physical: boolean;
  setPhysical: (v: boolean) => void;
  /** Último estado recebido da linha física (gêmeo digital). */
  twin: TwinState | null;
  setTwin: (t: TwinState | null) => void;
  /** Equipe criada esperando o clique no posto que vai atender. */
  pendingPool: string | null;
  setPendingPool: (id: string | null) => void;
  /** Liga uma equipe a um posto e deixa a casa dela ao lado do posto. */
  assignPool: (nodeId: string, poolId: string) => void;
  setShowStart: (v: boolean) => void;
  setShowOrder: (v: boolean) => void;
  setRun: (r: RunState) => void;
  setSpeed: (s: number) => void;
  /** Recria o simulador a partir do modelo (Stop/Replay). */
  resetSim: () => void;
  refresh: (withKpi?: boolean) => void;
  setMessage: (m: string) => void;
  /** Modelo salvo que está aberto (para Salvar sobrescrever) e a versão gravada (para saber se mudou). */
  saved: { id: string; model: Model } | null;
  setSaved: (s: { id: string; model: Model } | null) => void;
  showSaved: boolean;
  setShowSaved: (v: boolean) => void;
}

/** Exemplo da linha real, embutido só no build privado. */
export function privateExample(kind: 'real' | 'main' = 'real'): Model | null {
  const real = typeof __EXAMPLE__ !== 'undefined' ? __EXAMPLE__ : null;
  if (kind === 'real') return real ? structuredClone(real) : null;
  const main = typeof __EXAMPLE_MAIN__ !== 'undefined' ? __EXAMPLE_MAIN__ : null;
  if (!main) return null;
  const m = structuredClone(main);
  if (!m.background && real?.background) m.background = structuredClone(real.background);
  return m;
}

const fresh = (m: Model) => {
  const sim = new Simulator(structuredClone(m));
  return { sim, kpi: lineKpi(sim) };
};

// Abre em branco; a tela de início oferece trabalhos salvos, novo ou exemplos.
// A versão offline já abre com a linha de 10 postos.
const OFFLINE = typeof __OFFLINE__ !== 'undefined' && __OFFLINE__;
const initial: Model = OFFLINE ? tenStationModel() : { name: 'Novo trabalho', nodes: [], links: [], settings: { ...DEFAULT_SETTINGS } };

/** Área de transferência interna (blocos copiados). */
let clip: { nodes: NodeDef[]; links: LinkDef[]; times: number } | null = null;

export const useStore = create<State>((set, get) => {
  const history = new History<Model>();
  const labels = () => ({ undoLabel: history.canUndo ? history.undoLabel ?? 'edição' : '', redoLabel: history.canRedo ? history.redoLabel ?? 'edição' : '' });
  /** Toda edição do modelo invalida a simulação em andamento e entra no desfazer. `key` junta edições seguidas (arrastar, digitar). */
  const edit = (model: Model, extra: Partial<State> = {}, label = 'edição', key?: string) => {
    history.push(get().model, key, Date.now(), label);
    set({ model, ...fresh(model), run: 'idle', ...extra, ...labels() });
  };
  const restore = (model: Model | undefined, verb: string, label: string) => {
    if (!model) return;
    const ids = new Set(model.nodes.map((n) => n.id));
    const { selected, selectedLink } = get();
    set({
      model,
      ...fresh(model),
      run: 'idle',
      selected: selected.filter((id) => ids.has(id)),
      selectedLink: model.links.some((l) => l.id === selectedLink) ? selectedLink : null,
      connectFrom: null,
      message: `${verb}: ${label}.`,
      ...labels(),
    });
  };

  return {
    model: initial,
    selected: [],
    selectedLink: null,
    selectedPool: null,
    selectPool: (selectedPool) => set({ selectedPool, selected: [], selectedLink: null }),
    tool: 'select',
    connectFrom: null,
    snap: true,
    gridSize: 20,
    layers: { grid: true, links: true, entities: true, labels: true, heat: false, plant: true, people: true, top5: false, co2: false, counts: true },
    run: 'idle',
    speed: 10,
    ...fresh(initial),
    tick: 0,
    viewCenter: { x: 200, y: 200 },
    message: OFFLINE ? 'Versão offline: linha de 10 postos pronta (takt 36 s, meta 100 UPH). Clique em ▶ Start.' : 'Escolha um trabalho salvo, comece um novo ou abra um exemplo.',
    showStart: !OFFLINE,
    pendingPool: null,
    setPendingPool: (pendingPool) => set({ pendingPool }),
    assignPool: (nodeId, poolId) => {
      const m = get().model;
      const n = m.nodes.find((x) => x.id === nodeId);
      if (!n) return;
      const alone = !m.nodes.some((x) => x.poolId === poolId && x.id !== nodeId);
      edit(
        {
          ...m,
          nodes: m.nodes.map((x) => (x.id === nodeId ? { ...x, poolId } : x)),
          pools: (m.pools ?? []).map((p) => (p.id === poolId && alone ? { ...p, x: n.x, y: n.y - 34 } : p)),
        },
        { pendingPool: null, message: `Equipe ligada a "${n.name}".` },
        'ligar equipe',
      );
    },
    setShowStart: (showStart) => set({ showStart }),
    physical: false,
    setPhysical: (physical) => set({ physical }),
    twin: null,
    setTwin: (twin) => set({ twin }),

    // Abrir trabalho (novo, exemplo, salvo, importado): a meta começa zerada e o takt vem da operação (gargalo).
    openModel: (m, message) => get().setModel({ ...m, settings: { ...m.settings, takt: 0 } }, message),
    setModel: (m, message) =>
      edit(m, { selected: [], selectedLink: null, selectedPool: null, connectFrom: null, saved: null, message: message ?? `Modelo "${m.name}" carregado.` }, `abrir "${m.name}"`),

    updateNode: (id, patch) => {
      const m = get().model;
      const name = m.nodes.find((n) => n.id === id)?.name ?? id;
      const keys = Object.keys(patch).sort().join(',');
      edit({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }, {}, `alterar ${name}`, `node:${id}:${keys}`);
    },

    moveNodes: (ids, dx, dy) => {
      const m = get().model;
      const set_ = new Set(ids);
      const g = get().gridSize;
      const snap = (v: number) => (get().snap ? Math.round(v / g) * g : v);
      // trilha de seta entre blocos que andam juntos anda junto
      const links = ids.length > 1 ? m.links.map((l) => (l.path && set_.has(l.from) && set_.has(l.to) ? { ...l, path: l.path.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : l)) : m.links;
      edit({ ...m, links, nodes: m.nodes.map((n) => (set_.has(n.id) ? { ...n, x: snap(n.x + dx), y: snap(n.y + dy) } : n)) }, {}, ids.length > 1 ? `mover ${ids.length} blocos` : 'mover bloco');
    },

    addNode: (type, x, y, patch = {}) => {
      const m = get().model;
      const g = get().gridSize;
      const count = m.nodes.filter((n) => n.type === type).length + 1;
      const node = makeNode(type, {
        x: get().snap ? Math.round(x / g) * g : x,
        y: get().snap ? Math.round(y / g) * g : y,
      });
      node.name = `${node.name} ${count}`;
      if (patch.name) patch = { ...patch, name: `${patch.name} ${count}` };
      Object.assign(node, patch);
      edit({ ...m, nodes: [...m.nodes, node] }, { selected: [node.id], selectedLink: null }, `adicionar ${node.name}`);
    },

    addAfter: (from, type, x, y, patch = {}) => {
      const m = get().model;
      const g = get().gridSize;
      const count = m.nodes.filter((n) => n.type === type).length + 1;
      const node = makeNode(type, { x: get().snap ? Math.round(x / g) * g : x, y: get().snap ? Math.round(y / g) * g : y });
      node.name = `${node.name} ${count}`;
      if (patch.name) patch = { ...patch, name: `${patch.name} ${count}` };
      Object.assign(node, patch);
      const link: LinkDef = { id: newId('L'), from, to: node.id, weight: 1 };
      edit({ ...m, nodes: [...m.nodes, node], links: [...m.links, link] }, { selected: [node.id], selectedLink: null }, `adicionar ${node.name}`);
    },

    addLink: (from, to) => {
      const m = get().model;
      if (from === to || m.links.some((l) => l.from === from && l.to === to)) return;
      const a = m.nodes.find((n) => n.id === from);
      const b = m.nodes.find((n) => n.id === to);
      if (b?.type === 'source') {
        set({ message: 'Um Source só tem saída: ligue o Source ao posto, e não o posto ao Source.' });
        return;
      }
      if (a?.type === 'sink') {
        set({ message: 'Finished Goods é o fim do fluxo e não tem saída.' });
        return;
      }
      const link: LinkDef = { id: newId('L'), from, to, weight: 1 };
      edit({ ...m, links: [...m.links, link] }, { selectedLink: link.id, selected: [] }, 'ligar postos');
    },

    updateLink: (id, patch) => {
      const m = get().model;
      edit({ ...m, links: m.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) }, {}, 'alterar ligação', `link:${id}:${Object.keys(patch).sort().join(',')}`);
    },

    copySelection: () => {
      const { model: m, selected } = get();
      const ids = new Set(selected);
      if (!ids.size) return 0;
      clip = { nodes: m.nodes.filter((n) => ids.has(n.id)), links: m.links.filter((l) => ids.has(l.from) && ids.has(l.to)), times: 0 };
      set({ message: `${clip.nodes.length} bloco(s) copiado(s). Ctrl+V cola.` });
      return clip.nodes.length;
    },
    paste: () => {
      if (!clip?.nodes.length) return;
      clip.times++;
      const m = get().model;
      const off = 40 * clip.times;
      const map = new Map<string, string>();
      const names = new Set(m.nodes.map((n) => n.name));
      const nodes = clip.nodes.map((n) => {
        const id = newId('N');
        map.set(n.id, id);
        let name = `${n.name} (cópia)`;
        for (let i = 2; names.has(name); i++) name = `${n.name} (cópia ${i})`;
        names.add(name);
        return { ...structuredClone(n), id, name, x: n.x + off, y: n.y + off, outputPoint: undefined };
      });
      const links = clip.links.map((l) => ({ ...l, id: newId('L'), from: map.get(l.from)!, to: map.get(l.to)! }));
      edit(
        { ...m, nodes: [...m.nodes, ...nodes], links: [...m.links, ...links] },
        { selected: nodes.map((n) => n.id), selectedLink: null, message: `${nodes.length} bloco(s) colado(s). Arraste para posicionar.` },
        `colar ${nodes.length} bloco(s)`,
      );
    },
    deleteSelection: () => {
      const { model: m, selected, selectedLink, selectedPool } = get();
      if (selectedPool) {
        const p = m.pools?.find((x) => x.id === selectedPool);
        edit(
          {
            ...m,
            pools: (m.pools ?? []).filter((x) => x.id !== selectedPool),
            nodes: m.nodes.map((n) => (n.poolId === selectedPool ? { ...n, poolId: undefined } : n)),
            links: m.links.map((l) => (l.poolId === selectedPool ? { ...l, poolId: undefined } : l)),
          },
          { selectedPool: null, message: `"${p?.name}" apagado. Os postos e trechos dele voltaram ao padrão (Ctrl+Z desfaz).` },
          `apagar ${p?.name ?? 'recurso'}`,
        );
        return;
      }
      const del = new Set(selected);
      edit(
        {
          ...m,
          nodes: m.nodes.filter((n) => !del.has(n.id)),
          links: m.links.filter((l) => l.id !== selectedLink && !del.has(l.from) && !del.has(l.to)),
        },
        { selected: [], selectedLink: null },
        selected.length ? `apagar ${selected.length} bloco(s)` : 'apagar ligação',
      );
    },

    select: (ids, link = null) => set({ selected: ids, selectedLink: link, selectedPool: null }),
    setTool: (tool) => set({ tool, connectFrom: null }),
    setConnectFrom: (connectFrom) => set({ connectFrom }),
    setSnap: (snap) => set({ snap }),
    toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
    updateSettings: (patch) => {
      const m = get().model;
      edit({ ...m, settings: { ...m.settings, ...patch } }, {}, 'alterar configuração', `settings:${Object.keys(patch).sort().join(',')}`);
    },
    patchModel: (patch) => edit({ ...get().model, ...patch }, {}, 'alterar modelo', `model:${Object.keys(patch).sort().join(',')}`),
    // Só muda a vista dos gráficos: não zera a simulação.
    setChartView: (chartOrder, chartHidden) => {
      history.push(get().model, undefined, Date.now(), 'sequência dos postos');
      set({ model: { ...get().model, chartOrder, chartHidden }, ...labels() });
    },
    setRefStation: (refStation) => {
      history.push(get().model, undefined, Date.now(), 'posto de referência');
      set({ model: { ...get().model, refStation }, ...labels() });
    },
    undoLabel: '',
    redoLabel: '',
    undo: () => {
      const label = history.undoLabel ?? 'edição';
      restore(history.undo(get().model), 'Desfeito', label);
    },
    redo: () => {
      const label = history.redoLabel ?? 'edição';
      restore(history.redo(get().model), 'Refeito', label);
    },
    showOrder: false,
    opsFor: null,
    fitFor: null,
    showMix: false,
    setFitFor: (fitFor) => set({ fitFor }),
    setShowMix: (showMix) => set({ showMix }),
    bindPick: null,
    transportFor: null,
    setTransportFor: (transportFor) => set({ transportFor, bindPick: null }),
    ctrlPick: (p) => {
      const cur = { ...(get().bindPick ?? {}), ...p };
      if (cur.poolId && cur.linkId) {
        set({ bindPick: null, transportFor: cur });
        return;
      }
      set({
        bindPick: cur,
        message: cur.poolId ? 'Recurso escolhido. Agora segure Ctrl e clique na seta do trecho que ele vai transportar (Esc cancela).' : 'Seta escolhida. Agora segure Ctrl e clique no operador ou veículo (Esc cancela).',
      });
    },
    showSoe: false,
    setShowSoe: (showSoe) => set({ showSoe }),
    setOpsFor: (opsFor) => set({ opsFor }),
    setShowOrder: (showOrder) => set({ showOrder }),
    setRun: (run) => set({ run }),
    setSpeed: (speed) => set({ speed }),
    resetSim: () => set({ ...fresh(get().model), run: 'idle', tick: get().tick + 1 }),
    refresh: (withKpi = false) =>
      set(withKpi ? { tick: get().tick + 1, kpi: lineKpi(get().sim) } : { tick: get().tick + 1 }),
    setViewCenter: (viewCenter) => set({ viewCenter }),
    analysis: null,
    detailId: null,
    setAnalysis: (analysis) => set({ analysis }),
    setDetail: (detailId) => set({ detailId }),
    real: {},
    realSource: '',
    setReal: (real, realSource) => set({ real, realSource }),
    realEvents: [],
    realEventsSource: '',
    setRealEvents: (realEvents, realEventsSource) => set({ realEvents, realEventsSource }),
    setMessage: (message) => set({ message }),
    saved: null,
    setSaved: (saved) => set({ saved }),
    showSaved: false,
    setShowSaved: (showSaved) => set({ showSaved }),
  };
});
