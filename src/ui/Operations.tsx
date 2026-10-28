// Operações e atividades de um posto: a soma vira o tempo de ciclo e alimenta o Yamazumi.

import { ACTIVITY_LABEL, operationsTime, type ActivityKind, type NodeDef, type Operation } from '../engine/types';
import { useStore } from '../store';
import { fmt } from './theme';

const KINDS = Object.keys(ACTIVITY_LABEL) as ActivityKind[];

export function Operations({ n }: { n: NodeDef }) {
  const ops = n.operations ?? [];
  const elements = useStore((s) => s.model.settings.studyMode === 'elements');
  const total = operationsTime(ops);
  const save = (next: Operation[], fromOps = n.cycleFromOps ?? true) => {
    const t = operationsTime(next);
    useStore.getState().updateNode(n.id, {
      operations: next.length ? next : undefined,
      cycleFromOps: next.length ? fromOps : undefined,
      ...(fromOps && next.length && t > 0 ? { cycleTime: Math.round(t * 100) / 100 } : {}),
    });
  };
  const setOp = (i: number, op: Operation) => save(ops.map((o, j) => (j === i ? op : o)));

  return (
    <div className="section ops">
      <p className="label">
        Operações e atividades
        {ops.length > 0 && <span className="muted"> · total {fmt(total, 1)} s</span>}
      </p>
      {ops.map((op, i) => (
        <div key={i} className="op">
          <div className="op-head">
            <input aria-label="Nome da operação" value={op.name} onChange={(e) => setOp(i, { ...op, name: e.target.value })} />
            <span className="muted">{fmt(op.activities.reduce((s, a) => s + (a.time || 0), 0), 1)} s</span>
            <button className="btn icon" aria-label={`Apagar operação ${op.name}`} onClick={() => save(ops.filter((_, j) => j !== i))}>×</button>
          </div>
          {op.activities.map((a, k) => {
            const setAct = (patch: Partial<typeof a>) => setOp(i, { ...op, activities: op.activities.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
            return (
              <div key={k} className="act">
                <input aria-label="Atividade" value={a.name} onChange={(e) => setAct({ name: e.target.value })} />
                <input aria-label="Tempo (s)" type="number" min={0} step={0.5} value={a.time} onChange={(e) => setAct({ time: Math.max(0, Number(e.target.value)) })} />
                <select aria-label="Tipo da atividade" value={a.kind} onChange={(e) => setAct({ kind: e.target.value as ActivityKind })} className={`k-${a.kind}`}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{ACTIVITY_LABEL[k]}</option>
                  ))}
                </select>
                <button className="btn icon" aria-label={`Apagar atividade ${a.name}`} onClick={() => setOp(i, { ...op, activities: op.activities.filter((_, j) => j !== k) })}>×</button>
              </div>
            );
          })}
          <button className="btn ghost small" onClick={() => setOp(i, { ...op, activities: [...op.activities, { name: `Atividade ${op.activities.length + 1}`, time: 5, kind: 'va' }] })}>
            + atividade
          </button>
        </div>
      ))}
      <div className="row-btns">
        <button className="btn" onClick={() => save([...ops, { name: `Operação ${ops.length + 1}`, activities: [{ name: 'Atividade 1', time: ops.length ? 5 : n.cycleTime || 5, kind: 'va' }] }])}>
          + operação
        </button>
      </div>
      {ops.length > 0 && elements && <p className="hint">Estudo por elemento: a simulação usa a soma das atividades ({fmt(total, 1)} s).</p>}
      {ops.length > 0 && !elements && (
        <label className="check">
          <input type="checkbox" checked={n.cycleFromOps ?? true} onChange={(e) => save(ops, e.target.checked)} />
          <span>Tempo de ciclo = soma das atividades ({fmt(total, 1)} s)</span>
        </label>
      )}
      {ops.length === 0 && <p className="hint">Quebre o posto em operações e atividades (agrega valor, deslocamento, espera…) para ver o Yamazumi em Análises.</p>}
    </div>
  );
}
