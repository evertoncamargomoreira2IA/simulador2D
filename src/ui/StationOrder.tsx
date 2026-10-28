// Sequência dos postos nos gráficos: arrastar para ordenar e marcar o que aparece.

import { useMemo, useState } from 'react';
import { chartSequence, isAssembly, TYPE_LABEL } from '../engine/types';
import { useStore } from '../store';
import { cycleRows } from './CycleTakt';
import { Modal } from './Modal';

export function StationOrder({ onClose }: { onClose: () => void }) {
  const model = useStore((s) => s.model);
  // Postos de processo na ordem do fluxo; é a base do "Ordem do fluxo".
  const flow = useMemo(() => {
    // linha principal primeiro, depois os off-lines
    const rows = cycleRows(model);
    const ids = [...rows.filter((r) => !r.offline), ...rows.filter((r) => r.offline)].map((r) => r.id);
    const extra = model.nodes.filter((n) => n.type === 'buffer' && !ids.includes(n.id)).map((n) => n.id);
    return [...ids, ...extra].map((id) => model.nodes.find((n) => n.id === id)!);
  }, [model]);
  const offline = useMemo(() => new Set(cycleRows(model).filter((r) => r.offline).map((r) => r.id)), [model]);
  const [order, setOrder] = useState(() => chartSequence(model, flow, true).map((n) => n.id));
  const [hidden, setHidden] = useState(() => new Set(model.chartHidden ?? []));
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= order.length) return;
    const next = [...order];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setOrder(next);
  };
  const toggle = (id: string) => {
    const h = new Set(hidden);
    if (h.has(id)) h.delete(id);
    else h.add(id);
    setHidden(h);
  };
  const apply = () => {
    const flowIds = flow.map((n) => n.id);
    const same = order.every((id, i) => id === flowIds[i]);
    useStore.getState().setChartView(same ? undefined : order, hidden.size ? [...hidden] : undefined);
    useStore.getState().setMessage(`Sequência dos gráficos atualizada: ${order.length - hidden.size} de ${order.length} postos visíveis.`);
    onClose();
  };

  return (
    <Modal title="Sequência dos postos" sub="Arraste para mudar a ordem nos gráficos e desmarque o que não quer ver. Vale para Cycle × Takt, Throughput e Estados por posto." onClose={onClose}>
      <div className="row-btns">
        <button className="btn" onClick={() => setOrder(flow.map((n) => n.id))}>Ordem do fluxo</button>
        <button className="btn" onClick={() => setHidden(new Set())}>Mostrar todos</button>
        <button className="btn" onClick={() => setHidden(new Set(order.filter((id) => offline.has(id))))}>Só linha principal</button>
        <button className="btn" onClick={() => setHidden(new Set(order.filter((id) => !offline.has(id))))}>Só off-lines</button>
      </div>
      <ol className="seq section">
        {order.map((id, i) => {
          const n = byId.get(id);
          if (!n) return null;
          return (
            <li
              key={id}
              draggable
              className={`${drag === i ? 'dragging' : ''}${over === i && drag !== null && drag !== i ? ' over' : ''}${hidden.has(id) ? ' off' : ''}`}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) move(drag, i);
                setDrag(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
            >
              <span className="grip" aria-hidden="true">⋮⋮</span>
              <span className="num">{i + 1}</span>
              <label>
                <input type="checkbox" checked={!hidden.has(id)} onChange={() => toggle(id)} />
                <b>{n.name}</b>
                <small>{isAssembly(n, model.links) ? 'Montagem' : TYPE_LABEL[n.type]}{offline.has(id) ? ' · off-line' : ''}</small>
              </label>
              <button className="btn icon" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Subir ${n.name}`}>↑</button>
              <button className="btn icon" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label={`Descer ${n.name}`}>↓</button>
            </li>
          );
        })}
      </ol>
      <div className="row-btns section">
        <button className="btn primary" onClick={apply}>Aplicar</button>
        <button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
