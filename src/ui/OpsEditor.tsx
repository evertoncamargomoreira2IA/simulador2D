// Janela de operações e atividades: escolhe o posto à esquerda e edita as atividades à direita.

import { useState } from 'react';
import { effectiveTakt } from '../engine/balance';
import { operationsTime } from '../engine/types';
import { useStore } from '../store';
import { lineSequence } from './CycleTakt';
import { Modal } from './Modal';
import { Operations } from './Operations';
import { fmt } from './theme';
import { StudyMode } from './Yamazumi';

export function OpsEditor({ start, onClose }: { start: string; onClose: () => void }) {
  const model = useStore((s) => s.model);
  const takt = effectiveTakt(model);
  const posts = lineSequence(model, model.nodes.filter((n) => n.type === 'machine' || n.type === 'inspection' || n.type === 'rework'));
  const [id, setId] = useState(start && posts.some((n) => n.id === start) ? start : posts[0]?.id ?? '');
  const n = posts.find((x) => x.id === id);
  return (
    <Modal title="Operações e atividades" sub="Escolha o posto e quebre o trabalho em operações e atividades. A soma vira o tempo do posto e aparece no Yamazumi." onClose={onClose} wide>
      <div className="row-btns">
        <span className="muted">Estudo</span>
        <StudyMode />
        <button className="btn" onClick={() => (onClose(), useStore.getState().setAnalysis('yamazumi'))}>Ver Yamazumi</button>
      </div>
      {posts.length === 0 ? (
        <p className="hint section">Nenhum posto no modelo ainda. Adicione postos pela paleta.</p>
      ) : (
        <div className="ops-editor section">
          <ul className="ops-list" role="listbox" aria-label="Postos">
            {posts.map((p) => {
              const t = operationsTime(p.operations);
              const n = p.operations?.reduce((s, o) => s + o.activities.length, 0) ?? 0;
              return (
                <li key={p.id}>
                  <button role="option" aria-selected={p.id === id} className={p.id === id ? 'on' : ''} onClick={() => setId(p.id)}>
                    <b>{p.name}</b>
                    <small className={takt > 0 && (n ? t : p.cycleTime) / Math.max(1, p.capacity) > takt ? 'bad' : 'muted'}>
                      {n ? `${n} atividades · ${fmt(t, 1)} s` : `sem atividades · ciclo ${fmt(p.cycleTime, 1)} s`}
                      {p.capacity > 1 ? ` ÷ ${p.capacity} gigas` : ''}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="ops-pane">{n && <Operations key={n.id} n={n} />}</div>
        </div>
      )}
    </Modal>
  );
}
