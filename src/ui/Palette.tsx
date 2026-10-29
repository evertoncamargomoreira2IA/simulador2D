// Paleta de blocos (arrastar para o canvas ou clicar para adicionar), legenda e camadas.

import { variantPatch, type BlockVariant, type NodeType, type NodeState } from '../engine/types';
import { useStore, type Layers } from '../store';
import { DRAG_MIME } from './CanvasView';
import { createOperator } from './operators';
import { STATE_LABEL } from './theme';

type Block = NodeType | BlockVariant | 'operator';

const BLOCKS: { type: Block; label: string; desc: string }[] = [
  { type: 'source', label: 'Source', desc: 'Entrada de material' },
  { type: 'machine', label: 'Machine', desc: 'Posto / máquina' },
  { type: 'manual', label: 'Posto manual', desc: 'Só operador, sem máquina' },
  { type: 'assembly', label: 'Montagem', desc: 'Junta produto + kits' },
  { type: 'operator', label: 'Operador', desc: 'Equipe compartilhada' },
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
function addFromPalette(block: Block) {
  if (block === 'operator') return addOperator();
  const type: NodeType = block === 'assembly' || block === 'manual' ? 'machine' : block;
  const st = useStore.getState();
  const prev = st.selected.length === 1 ? st.model.nodes.find((n) => n.id === st.selected[0]) : undefined;
  const c = st.viewCenter;
  let pos: { x: number; y: number };
  if (prev && type === 'source' && prev.type !== 'source') pos = freeSpot(prev.x - 120, prev.y);
  else if (prev) pos = freeSpot(prev.x + 120, prev.y);
  else pos = freeSpot(Math.round(c.x), Math.round(c.y));
  const variant = block === 'assembly' || block === 'manual' ? block : null;
  st.addNode(type, pos.x, pos.y, variant ? variantPatch(variant, 1) : {});
  const added = useStore.getState().selected[0];
  if (variant && added) {
    useStore.getState().setMessage(
      variant === 'assembly'
        ? 'Montagem criada. Ligue os off-lines a ela e, em cada ligação, escolha "Componente (consumido na montagem)".'
        : 'Posto manual criado: só tempo de ciclo, operadores e custo, sem quebra nem energia de máquina.',
    );
  }
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

/** Cria um grupo de operadores. Com um posto selecionado, o grupo já passa a atender esse posto. */
function addOperator() {
  const st = useStore.getState();
  const sel = st.selected.length === 1 ? st.model.nodes.find((n) => n.id === st.selected[0]) : undefined;
  createOperator(sel);
}

const LAYERS: { k: keyof Layers; label: string }[] = [
  { k: 'plant', label: 'Planta (DXF)' },
  { k: 'people', label: 'Operadores e veículos' },
  { k: 'grid', label: 'Grid' },
  { k: 'links', label: 'Fluxos' },
  { k: 'entities', label: 'Peças em transporte' },
  { k: 'labels', label: 'Nomes' },
  { k: 'heat', label: 'Intensidade de fluxo' },
  { k: 'top5', label: 'Top 5 gargalos' },
  { k: 'co2', label: 'Mapa de calor de CO2e' },
];

const STATES: NodeState[] = ['working', 'starved', 'blocked', 'resource', 'down', 'setup', 'break', 'off'];

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

function Icon({ type }: { type: Block }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const;
  return (
    <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden="true">
      {type === 'source' && <polygon points="3,3 17,3 23,10 17,17 3,17" {...s} />}
      {type === 'machine' && <rect x="3" y="3" width="20" height="14" rx="2" {...s} />}
      {type === 'assembly' && (
        <>
          <rect x="8" y="3" width="15" height="14" rx="2" {...s} />
          <polyline points="1,6 8,10 1,14" {...s} />
        </>
      )}
      {type === 'manual' && (
        <>
          <rect x="3" y="3" width="20" height="14" rx="2" {...s} strokeDasharray="3 2" />
          <circle cx="13" cy="8" r="2.4" {...s} />
          <path d="M8.5 15 C8.5 11.5, 17.5 11.5, 17.5 15" {...s} />
        </>
      )}
      {type === 'operator' && (
        <>
          <circle cx="13" cy="6" r="3.2" {...s} />
          <path d="M6 18 C6 12, 20 12, 20 18" {...s} />
        </>
      )}
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
