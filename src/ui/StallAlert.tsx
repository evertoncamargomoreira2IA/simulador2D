// Pop-up de linha travada: pausa a simulação e mostra o que ajustar em cada bloco parado.

import { useEffect, useRef, useState } from 'react';
import { stallIssues, staticIssues, type FixAction, type Issue } from '../engine/diagnose';
import { useStore } from '../store';
import { Modal } from './Modal';
import { fmtTime } from './theme';

export function StallAlert() {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [at, setAt] = useState(0);
  const [fixed, setFixed] = useState<string[]>([]);
  const ignored = useRef(new Set<string>());
  const model = useStore((s) => s.model);
  // modelo novo ou editado: avisos voltam a valer
  useEffect(() => ignored.current.clear(), [model]);

  useEffect(() => {
    const t = setInterval(() => {
      const st = useStore.getState();
      if (st.run !== 'running' || issues) return;
      const all = [...staticIssues(st.model), ...stallIssues(st.model, st.sim)].filter((x) => !ignored.current.has(x.key));
      if (!all.length) return;
      st.setRun('paused');
      setAt(st.sim.now);
      setFixed([]);
      setIssues(all);
    }, 600);
    return () => clearInterval(t);
  }, [issues]);

  if (!issues) return null;
  const st = useStore.getState;
  const close = (resume: boolean) => {
    for (const x of issues) ignored.current.add(x.key);
    setIssues(null);
    if (resume && st().run === 'paused') st().setRun('running');
  };
  const apply = (x: Issue, a: FixAction) => {
    const s = st();
    if (a.node) s.updateNode(a.node.id, a.node.patch);
    if (a.link) s.updateLink(a.link.id, a.link.patch);
    if (a.pool) s.patchModel({ pools: (s.model.pools ?? []).map((p) => (p.id === a.pool!.id ? { ...p, ...a.pool!.patch } : p)) });
    setFixed((f) => [...f, x.key]);
  };
  const show = (x: Issue) => {
    if (x.nodeId) st().select([x.nodeId]);
    else if (x.linkId) st().select([], x.linkId);
    close(false);
  };
  const anyFixed = fixed.length > 0;

  return (
    <Modal title="⚠ Linha travada" sub={`A simulação parou em ${fmtTime(at)} porque ${issues.length > 1 ? 'alguns blocos não andam' : 'um bloco não anda'} por causa da configuração. Veja o que fazer:`} onClose={() => close(false)}>
      <ol className="stall-list">
        {issues.map((x) => (
          <li key={x.key} className={fixed.includes(x.key) ? 'done' : ''}>
            <b>{x.title}</b>
            <p className="muted">{x.why}</p>
            <p>
              <span aria-hidden>👉</span> <b>O que fazer:</b> {x.fix}
            </p>
            <div className="row-btns">
              {x.action && !fixed.includes(x.key) && (
                <button className="btn primary" onClick={() => apply(x, x.action!)}>
                  ✔ {x.action.label}
                </button>
              )}
              {fixed.includes(x.key) && <span className="stall-ok">Ajustado</span>}
              {(x.nodeId || x.linkId) && (
                <button className="btn" onClick={() => show(x)}>
                  Mostrar no layout
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="row-btns section">
        {anyFixed ? (
          <button className="btn primary" onClick={() => { close(false); st().setMessage('Ajuste feito. Clique em ▶ Start para rodar de novo.'); }}>
            Fechar e rodar de novo
          </button>
        ) : (
          <button className="btn" onClick={() => close(true)}>Continuar mesmo assim</button>
        )}
        <button className="btn ghost" onClick={() => close(false)}>Fechar</button>
      </div>
    </Modal>
  );
}
