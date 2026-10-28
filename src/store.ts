// Estado global da interface (Zustand). O simulador fica fora do estado reativo
// e a tela é redesenhada por `tick` durante a animação.

import { create } from 'zustand';
import { History } from './engine/history';
import { lineKpi, type LineKpi } from './engine/metrics';
import { Simulator } from './engine/simulator';
import { DEFAULT_SETTINGS, makeNode, newId, type LinkDef, type Model, type NodeDef, type NodeType } from './engine/types';

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
}

export type AnalysisTab = 'ciclo' | 'throughput' | 'gargalos' | 'spaghetti' | 'custos' | 'energia' | 'carbono' | 'cenarios' | 'real' | 'ia';

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

  setModel: (m: Model, message?: string) => void;
  updateNode: (id: string, patch: Partial<NodeDef>) => void;
  moveNodes: (ids: string[], dx: number, dy: number) => void;
  addNode: (type: NodeType, x: number, y: number, patch?: Partial<NodeDef>) => void;
  addLink: (from: string, to: string) => void;
  updateLink: (id: string, patch: Partial<LinkDef>) => void;
  deleteSelection: () => void;
  select: (ids: string[], link?: string | null) => void;
  setTool: (t: Tool) => void;
  setConnectFrom: (id: string | null) => void;
  setSnap: (v: boolean) => void;
  toggleLayer: (k: keyof Layers) => void;
  updateSettings: (patch: Partial<Model['settings']>) => void;
  /** Troca partes do modelo (recursos, planta) sem mexer na seleção. */
  patchModel: (patch: Partial<Model>) => void;
  /** Ordem e visibilidade dos postos nos gráficos: muda o modelo sem reiniciar a simulação. */
  undo: () => void;
  redo: () => void;
  /** Rótulos da próxima ação de desfazer/refazer ('' = nada a fazer). */
  undoLabel: string;
  redoLabel: string;
  setChartView: (order: string[] | undefined, hidden: string[] | undefined) => void;
  showOrder: boolean;
  showStart: boolean;
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
export function privateExample(): Model | null {
  return typeof __EXAMPLE__ !== 'undefined' && __EXAMPLE__ ? structuredClone(__EXAMPLE__) : null;
}

const fresh = (m: Model) => {
  const sim = new Simulator(structuredClone(m));
  return { sim, kpi: lineKpi(sim) };
};

// Abre em branco; a tela de início oferece trabalhos salvos, novo ou exemplos.
const initial: Model = { name: 'Novo trabalho', nodes: [], links: [], settings: { ...DEFAULT_SETTINGS } };

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
    tool: 'select',
    connectFrom: null,
    snap: true,
    gridSize: 20,
    layers: { grid: true, links: true, entities: true, labels: true, heat: false, plant: true, people: true, top5: false, co2: false },
    run: 'idle',
    speed: 10,
    ...fresh(initial),
    tick: 0,
    viewCenter: { x: 200, y: 200 },
    message: 'Escolha um trabalho salvo, comece um novo ou abra um exemplo.',
    showStart: true,
    setShowStart: (showStart) => set({ showStart }),

    setModel: (m, message) =>
      edit(m, { selected: [], selectedLink: null, connectFrom: null, saved: null, message: message ?? `Modelo "${m.name}" carregado.` }, `abrir "${m.name}"`),

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
      edit({ ...m, nodes: m.nodes.map((n) => (set_.has(n.id) ? { ...n, x: snap(n.x + dx), y: snap(n.y + dy) } : n)) }, {}, ids.length > 1 ? `mover ${ids.length} blocos` : 'mover bloco');
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

    deleteSelection: () => {
      const { model: m, selected, selectedLink } = get();
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

    select: (ids, link = null) => set({ selected: ids, selectedLink: link }),
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
    setMessage: (message) => set({ message }),
    saved: null,
    setSaved: (saved) => set({ saved }),
    showSaved: false,
    setShowSaved: (showSaved) => set({ showSaved }),
  };
});
