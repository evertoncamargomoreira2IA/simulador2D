// Paleta de blocos (arrastar para o canvas ou clicar para adicionar), legenda e camadas.

import type { NodeType, NodeState } from '../engine/types';
import { useStore, type Layers } from '../store';
import { DRAG_MIME } from './CanvasView';
import { STATE_LABEL } from './theme';

const BLOCKS: { type: NodeType; label: string; desc: string }[] = [
  { type: 'source', label: 'Source', desc: 'Entrada de material' },
  { type: 'machine', label: 'Machine', desc: 'Posto / máquina' },
  { type: 'buffer', label: 'Buffer', desc: 'Estoque / WIP' },
  { type: 'inspection', label: 'Inspection', desc: 'QC / teste' },
  { type: 'rework', label: 'Rework', desc: 'Retrabalho' },
  { type: 'sink', label: 'Finished Goods', desc: 'Produto acabado' },
];

/** Posição livre perto de (x, y): desce 100 px até não encostar em outro bloco. */
function freeSpot(x: number, y: number): { x: number; y: number } {
  const nodes = useStore.getState().model.nodes;
  let yy = y;
  for (let i = 0; i < 30 && nodes.some((n) => Math.abs(n.x - x) < 90 && Math.abs(n.y - yy) < 80); i++) yy += 100;
  return { x, y: yy };
}

/**
 * Clique na paleta. Com um bloco selecionado: Source entra à esquerda e alimenta o bloco;
 * os demais entram à direita, ligados a partir dele. Sem seleção: no centro da tela.
 */
function addFromPalette(type: NodeType) {
  const st = useStore.getState();
  const prev = st.selected.length === 1 ? st.model.nodes.find((n) => n.id === st.selected[0]) : undefined;
  const c = st.viewCenter;
  let pos: { x: number; y: number };
  if (prev && type === 'source' && prev.type !== 'source') pos = freeSpot(prev.x - 120, prev.y);
  else if (prev) pos = freeSpot(prev.x + 120, prev.y);
  else pos = freeSpot(Math.round(c.x), Math.round(c.y));
  st.addNode(type, pos.x, pos.y);
  const added = useStore.getState().selected[0];
  if (!prev || !added) return;
  if (type === 'source') {
    if (prev.type !== 'source') {
      useStore.getState().addLink(added, prev.id);
      useStore.getState().select([added]);
      useStore.getState().setMessage(`Source ligado a "${prev.name}". Ajuste o intervalo de chegadas no painel (0 = sempre abastecido).`);
    }
  } else if (prev.type !== 'sink') {
    useStore.getState().addLink(prev.id, added);
    useStore.getState().select([added]);
  }
}

const LAYERS: { k: keyof Layers; label: string }[] = [
  { k: 'plant', label: 'Planta (DXF)' },
  { k: 'people', label: 'Operadores e veículos' },
  { k: 'grid', label: 'Grid' },
  { k: 'links', label: 'Fluxos' },
  { k: 'entities', label: 'Peças em transporte' },
  { k: 'labels', label: 'Nomes' },
  { k: 'heat', label: 'Intensidade de fluxo' },
];

const STATES: NodeState[] = ['working', 'starved', 'blocked', 'resource', 'down', 'setup', 'off'];

export function Palette() {
  const layers = useStore((s) => s.layers);
  return (
    <aside className="palette">
      <section>
        <p className="label">Blocos</p>
        <div className="blocks">
          {BLOCKS.map((b) => (
            <button
              key={b.type}
              className="block"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, b.type);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => addFromPalette(b.type)}
              title={b.type === 'source' ? 'Entrada de material. Com um posto selecionado, o clique cria o Source à esquerda já alimentando o posto.' : `${b.desc}. Arraste para o canvas, ou clique para adicionar ligado ao bloco selecionado.`}
            >
              <Icon type={b.type} />
              <span>
                {b.label}
                <br />
                <small style={{ color: 'var(--muted)' }}>{b.desc}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <p className="label">Estados</p>
        <div className="legend">
          {STATES.map((s) => (
            <div key={s}>
              <i style={{ background: `var(--st-${s})` }} />
              {STATE_LABEL[s]}
            </div>
          ))}
          <div>
            <i style={{ background: 'var(--st-transport)', borderRadius: 6 }} />
            Transporte
          </div>
        </div>
      </section>
      <section>
        <p className="label">Camadas</p>
        <div className="checks">
          {LAYERS.map((l) => (
            <label key={l.k}>
              <input id={`layer-${l.k}`} type="checkbox" checked={layers[l.k]} onChange={() => useStore.getState().toggleLayer(l.k)} />
              {l.label}
            </label>
          ))}
        </div>
      </section>
      <p className="hint">
        Clique num bloco da paleta para adicioná-lo já ligado ao bloco selecionado. Roda do mouse: zoom. Arrastar o fundo: mover. Shift+arrastar: selecionar área. Delete: apagar seleção.
      </p>
    </aside>
  );
}

function Icon({ type }: { type: NodeType }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const;
  return (
    <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden="true">
      {type === 'source' && <polygon points="3,3 17,3 23,10 17,17 3,17" {...s} />}
      {type === 'machine' && <rect x="3" y="3" width="20" height="14" rx="2" {...s} />}
      {type === 'buffer' && <polyline points="3,3 3,17 23,17 23,3" {...s} />}
      {type === 'inspection' && <polygon points="8,2 18,2 23,10 18,18 8,18 3,10" {...s} />}
      {type === 'rework' && <rect x="3" y="3" width="20" height="14" rx="2" {...s} strokeDasharray="3 2" />}
      {type === 'sink' && (
        <>
          <rect x="3" y="3" width="20" height="14" {...s} />
          <rect x="6" y="6" width="14" height="8" {...s} strokeWidth={1} />
        </>
      )}
    </svg>
  );
}
