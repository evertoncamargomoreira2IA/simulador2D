// Paleta de blocos (arrastar para o canvas ou clicar para adicionar), legenda e camadas.

import type { NodeType, NodeState } from '../engine/types';
import { useStore, type Layers } from '../store';
import { DRAG_MIME } from './CanvasView';
import { STATE_LABEL } from './theme';

const BLOCKS: { type: NodeType; label: string; desc: string }[] = [
  { type: 'source', label: 'Source', desc: 'Matéria-prima' },
  { type: 'machine', label: 'Machine', desc: 'Posto / máquina' },
  { type: 'buffer', label: 'Buffer', desc: 'Estoque / WIP' },
  { type: 'inspection', label: 'Inspection', desc: 'QC / teste' },
  { type: 'rework', label: 'Rework', desc: 'Retrabalho' },
  { type: 'sink', label: 'Finished Goods', desc: 'Produto acabado' },
];

const LAYERS: { k: keyof Layers; label: string }[] = [
  { k: 'grid', label: 'Grid' },
  { k: 'links', label: 'Fluxos' },
  { k: 'entities', label: 'Peças em transporte' },
  { k: 'labels', label: 'Nomes' },
  { k: 'heat', label: 'Intensidade de fluxo' },
];

const STATES: NodeState[] = ['working', 'starved', 'blocked', 'down', 'setup', 'off'];

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
              onClick={() => {
                const nodes = useStore.getState().model.nodes;
                const x = nodes.length ? Math.max(...nodes.map((n) => n.x)) + 120 : 160;
                const y = nodes.length ? nodes[nodes.length - 1].y : 160;
                useStore.getState().addNode(b.type, x, y);
              }}
              title={`${b.desc}. Arraste para o canvas.`}
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
        Roda do mouse: zoom. Arrastar o fundo: mover. Shift+arrastar: selecionar área. Delete: apagar seleção.
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
