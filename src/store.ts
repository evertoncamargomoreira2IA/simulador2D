// Estado global da interface (Zustand). O simulador fica fora do estado reativo
// e a tela é redesenhada por `tick` durante a animação.

import { create } from 'zustand';
import { lineKpi, type LineKpi } from './engine/metrics';
import { Simulator } from './engine/simulator';
import { makeNode, newId, type LinkDef, type Model, type NodeDef, type NodeType } from './engine/types';
import { lp2Model } from './model/builder';

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

export type AnalysisTab = 'gargalos' | 'spaghetti' | 'custos' | 'energia' | 'carbono' | 'cenarios' | 'real' | 'ia';

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
  addNode: (type: NodeType, x: number, y: number) => void;
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
  setRun: (r: RunState) => void;
  setSpeed: (s: number) => void;
  /** Recria o simulador a partir do modelo (Stop/Replay). */
  resetSim: () => void;
  refresh: (withKpi?: boolean) => void;
  setMessage: (m: string) => void;
}

/** Exemplo da linha real, embutido só no build privado. */
export function privateExample(): Model | null {
  return typeof __EXAMPLE__ !== 'undefined' && __EXAMPLE__ ? structuredClone(__EXAMPLE__) : null;
}

const fresh = (m: Model) => {
  const sim = new Simulator(structuredClone(m));
  return { sim, kpi: lineKpi(sim) };
};

const initial = privateExample() ?? lp2Model();

export const useStore = create<State>((set, get) => {
  /** Toda edição do modelo invalida a simulação em andamento. */
  const edit = (model: Model, extra: Partial<State> = {}) =>
    set({ model, ...fresh(model), run: 'idle', ...extra });

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
    message: privateExample()
      ? 'Linha real carregada sobre o layout DXF (PST 6 gigas/2 operadores, Final Test 28 gigas/6 operadores). Clique em ▶ Start.'
      : 'Modelo exemplo LP2 carregado (70 postos, 12 s por posto). Clique em ▶ Start.',

    setModel: (m, message) =>
      edit(m, { selected: [], selectedLink: null, connectFrom: null, message: message ?? `Modelo "${m.name}" carregado.` }),

    updateNode: (id, patch) => {
      const m = get().model;
      edit({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
    },

    moveNodes: (ids, dx, dy) => {
      const m = get().model;
      const set_ = new Set(ids);
      const g = get().gridSize;
      const snap = (v: number) => (get().snap ? Math.round(v / g) * g : v);
      edit({ ...m, nodes: m.nodes.map((n) => (set_.has(n.id) ? { ...n, x: snap(n.x + dx), y: snap(n.y + dy) } : n)) });
    },

    addNode: (type, x, y) => {
      const m = get().model;
      const g = get().gridSize;
      const count = m.nodes.filter((n) => n.type === type).length + 1;
      const node = makeNode(type, {
        x: get().snap ? Math.round(x / g) * g : x,
        y: get().snap ? Math.round(y / g) * g : y,
      });
      node.name = `${node.name} ${count}`;
      edit({ ...m, nodes: [...m.nodes, node] }, { selected: [node.id], selectedLink: null });
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
      edit({ ...m, links: [...m.links, link] }, { selectedLink: link.id, selected: [] });
    },

    updateLink: (id, patch) => {
      const m = get().model;
      edit({ ...m, links: m.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
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
      );
    },

    select: (ids, link = null) => set({ selected: ids, selectedLink: link }),
    setTool: (tool) => set({ tool, connectFrom: null }),
    setConnectFrom: (connectFrom) => set({ connectFrom }),
    setSnap: (snap) => set({ snap }),
    toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
    updateSettings: (patch) => {
      const m = get().model;
      edit({ ...m, settings: { ...m.settings, ...patch } });
    },
    patchModel: (patch) => edit({ ...get().model, ...patch }),
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
  };
});
