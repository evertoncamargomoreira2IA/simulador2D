// Rebalanceamento: arrastar atividades entre postos (Yamazumi editável) e ver o UPH na hora.

import { useEffect, useMemo, useRef, useState } from 'react';
import { autoBalance, type AutoBalanceResult } from '../engine/autobalance';
import { cycleRows, effectiveTakt } from '../engine/balance';
import { ACTIVITY_LABEL, operationsTime, type Model, type Operation } from '../engine/types';
import { useStore } from '../store';
import { lineSequence } from './CycleTakt';
import { HowTo } from './HowTo';
import { Kpi } from './Modal';
import { KIND_COLOR } from './Yamazumi';
import { lineLoad, loadScenarios, peopleOf, runScenario, saveScenarios } from './scenarios';
import { fmt, pct } from './theme';

type Draft = Record<string, Operation[]>;
interface Drag {
  from: string;
  op: number;
  act: number;
}

/** Modelo com as operações do rascunho: o ciclo segue a soma; posto que ficou vazio sai (sem pessoa). */
function applyDraft(model: Model, draft: Draft): Model {
  return {
    ...model,
    nodes: model.nodes.map((n) => {
      const ops = draft[n.id];
      if (!ops || !n.operations?.length) return n;
      const t = operationsTime(ops);
      const kept = ops.filter((o) => o.activities.length);
      return { ...n, operations: kept.length ? kept : undefined, cycleTime: Math.round(t * 100) / 100, cycleFromOps: true, ...(t === 0 ? { operators: 0 } : {}) };
    }),
  };
}

export function Rebalance() {
  const model = useStore((s) => s.model);
  const takt = effectiveTakt(model);
  const posts = useMemo(() => lineSequence(model, cycleRows(model)).map((r) => model.nodes.find((n) => n.id === r.id)!), [model]);
  const initial = useMemo(() => Object.fromEntries(posts.filter((n) => n.operations?.length).map((n) => [n.id, structuredClone(n.operations!)])) as Draft, [posts]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [moves, setMoves] = useState(0);
  const drag = useRef<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [auto, setAuto] = useState<(AutoBalanceResult & { stations: number }) | null>(null);
  useEffect(() => {
    setDraft(initial);
    setMoves(0);
    setAuto(null);
  }, [initial]);

  const proposed = useMemo(() => applyDraft(model, draft), [model, draft]);
  const rows = useMemo(() => new Map(cycleRows(proposed).map((r) => [r.id, r])), [proposed]);
  const before = useMemo(() => lineLoad(model), [model]);
  const baseRows = useMemo(() => new Map(cycleRows(model).map((r) => [r.id, r])), [model]);
  const after = useMemo(() => lineLoad(proposed), [proposed]);
  const estUph = (max: number) => (max > 0 ? 3600 / max : 0);

  // simulação rápida do proposto (2 h), depois de cada movimento
  const [sim, setSim] = useState<{ base?: number; prop?: number; busy: boolean }>({ busy: false });
  useEffect(() => {
    setSim((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => {
      const base = runScenario(model, 7200).uph;
      const prop = moves ? runScenario(proposed, 7200).uph : base;
      setSim({ base, prop, busy: false });
    }, 350);
    return () => clearTimeout(t);
  }, [proposed, model, moves]);

  const move = (to: string, beforeAct?: { op: number; act: number }) => {
    const d = drag.current;
    drag.current = null;
    setOver(null);
    if (!d) return;
    const next = structuredClone(draft);
    const [a] = next[d.from][d.op].activities.splice(d.act, 1);
    if (!a) return;
    if (!next[to]) return;
    if (beforeAct && !(to === d.from && beforeAct.op === d.op && beforeAct.act === d.act)) {
      const ops = next[to][beforeAct.op];
      const idx = to === d.from && beforeAct.op === d.op && d.act < beforeAct.act ? beforeAct.act - 1 : beforeAct.act;
      ops.activities.splice(idx, 0, a);
    } else if (to === d.from && !beforeAct) {
      next[to][next[to].length - 1].activities.push(a);
    } else {
      // vai para a operação "Recebidas" do posto de destino (criada se não existir)
      let rec = next[to].find((o) => o.name === 'Recebidas');
      if (!rec) next[to].push((rec = { name: 'Recebidas', activities: [] }));
      rec.activities.push(a);
    }
    setDraft(next);
    setMoves(moves + 1);
  };

  /** Redistribui as atividades na ordem, enchendo cada posto até o takt; os que sobram ficam vazios (sem pessoa). */
  const runAuto = () => {
    const baseRowsNow = new Map(cycleRows(model).map((r) => [r.id, r]));
    const st = posts.filter((n) => initial[n.id] && n.capacity <= 1 && !baseRowsNow.get(n.id)?.offline);
    const r = autoBalance(st.map((n) => ({ id: n.id, ops: initial[n.id], efficiency: n.efficiency })), takt);
    const where = (d: Draft) => st.flatMap((n) => (d[n.id] ?? []).flatMap((o) => o.activities.map(() => n.id)));
    const a = where(initial);
    const b = where(r.draft);
    setDraft({ ...structuredClone(initial), ...r.draft });
    setMoves(Math.max(1, a.filter((x, i) => x !== b[i]).length));
    setAuto({ ...r, stations: st.length });
  };

  const cols = posts.filter((n) => draft[n.id] || n.cycleTime > 0);
  const tot = (id: string) => rows.get(id)?.plan ?? 0;
  const maxY = Math.max(takt * 1.15, ...cols.map((n) => tot(n.id))) || 1;
  const H = 320;
  const px = (s: number) => (s / maxY) * H;
  const emptied = posts.filter((n) => draft[n.id] && operationsTime(draft[n.id]) === 0 && n.operators > 0);
  const pplBefore = peopleOf(model);
  const pplAfter = peopleOf(proposed);

  const apply = () => {
    useStore.getState().setModel(proposed, `Rebalanceamento aplicado (${moves} movimento${moves === 1 ? '' : 's'}). Ctrl+Z desfaz.`);
  };
  const toScenarios = () => {
    const list = loadScenarios();
    const now = Date.now();
    const sc = [
      ...list,
      { id: String(now), name: 'Atual', model: structuredClone(model), r: runScenario(model) },
      { id: String(now + 1), name: `Proposto (${moves} mov.)`, model: structuredClone(proposed), r: runScenario(proposed) },
    ];
    if (!saveScenarios(sc)) useStore.getState().setMessage('Não deu para guardar os cenários neste navegador (espaço cheio); a comparação vale só nesta sessão.');
    useStore.getState().setAnalysis('cenarios');
  };

  if (Object.keys(initial).length === 0)
    return (
      <p className="hint">
        Nenhum posto tem atividades ainda. Cadastre em Operações (barra de cima) ou importe o SOE pelo Importar; depois arraste as atividades entre os postos aqui.
      </p>
    );

  const d = (a: number, b: number, lowerIsBetter = false) => {
    if (!b || Math.abs(a - b) < 1e-9) return null;
    const good = lowerIsBetter ? a < b : a > b;
    return <small className={good ? 'good' : 'bad'}> {a > b ? '+' : ''}{fmt(a - b, 1)}</small>;
  };

  return (
    <>
      <HowTo
        title="Rebalancear: menos gente, linha no takt"
        why="Mova atividades de um posto para outro e veja na hora o UPH, o maior posto e quantas pessoas a linha precisa."
        steps={[
          'Clique em ⚡ Balancear automático: o simulador reparte as atividades, na ordem em que acontecem, enchendo cada posto até o takt. Posto que sobra fica vazio e libera a pessoa.',
          'Ou arraste uma atividade (bloco colorido) para outro posto, à mão.',
          'Confira os cartões: UPH estimado e simulado, maior posto × takt, balanceamento e pessoas.',
          'Aplicar no modelo grava a proposta (Ctrl+Z desfaz). Comparar em Cenários coloca Atual × Proposto lado a lado.',
        ]}
        tip="O automático respeita a sequência das atividades. Se uma atividade precisa de ferramenta de um posto específico, ajuste à mão depois."
      />
      <div className="tiles">
        <Kpi k="UPH estimado" v={fmt(estUph(after.max), 1)} u={`antes ${fmt(estUph(before.max), 1)}`} />
        <Kpi k="UPH simulado (2 h)" v={sim.busy || sim.prop === undefined ? '…' : fmt(sim.prop, 1)} u={sim.base !== undefined ? `antes ${fmt(sim.base, 1)}` : ''} />
        <Kpi k="Maior posto" v={fmt(after.max, 1)} u={`s · takt ${fmt(takt, 1)}`} tone={after.max > takt ? 'bad' : undefined} />
        <Kpi k="Balanceamento" v={pct(after.balance)} u={`antes ${pct(before.balance)}`} />
        <Kpi k="Pessoas" v={String(pplAfter)} u={pplAfter !== pplBefore ? `antes ${pplBefore}` : 'sem mudança'} />
      </div>
      <div className="row-btns section">
        <button className="btn primary auto-btn" onClick={runAuto} disabled={!(takt > 0)} title="Redistribui as atividades na ordem para caber no takt com o menor número de postos">⚡ Balancear automático</button>
        <button className="btn" disabled={!moves} onClick={() => (setDraft(initial), setMoves(0), setAuto(null))}>Voltar ao original</button>
        <button className="btn primary" disabled={!moves} onClick={apply}>Aplicar no modelo</button>
        <button className="btn" disabled={!moves} onClick={toScenarios}>Comparar Atual × Proposto em Cenários</button>
        <span className="muted">{moves ? `${moves} movimento${moves === 1 ? '' : 's'}` : 'Arraste uma atividade para outro posto.'}</span>
      </div>
      {auto && (
        <p className={`hint auto-note${auto.used > auto.stations || auto.maxLoad > takt + 1e-6 ? ' bad' : ''}`}>
          {auto.maxLoad <= takt + 1e-6
            ? `⚡ ${auto.used} postos cabem no takt de ${fmt(takt, 1)} s (eram ${auto.stations}). Maior carga ${fmt(auto.maxLoad, 1)} s.`
            : `⚡ Mesmo redistribuindo, o maior posto fica com ${fmt(auto.maxLoad, 1)} s (takt ${fmt(takt, 1)} s): seriam precisos ${auto.needed} postos para caber no takt.`}
          {auto.tooLong.length > 0 && ` Atividade maior que o takt sozinha: ${auto.tooLong.slice(0, 3).join(', ')} (divida ou ponha em máquina/giga dupla).`}
          {' '}Confira e clique em Aplicar no modelo, ou ajuste arrastando.
        </p>
      )}
      {emptied.length > 0 && <p className="hint">Posto vazio: {emptied.map((n) => n.name).join(', ')} (sai do cálculo e libera {emptied.reduce((s, n) => s + n.operators, 0)} pessoa(s)).</p>}
      <div className="rb-scroll section">
        <div className="rb" style={{ height: H + 70 }}>
          <div className="rb-takt" style={{ bottom: 36 + px(takt) }}><span>Takt {fmt(takt, 1)} s</span></div>
          {cols.map((n) => {
            const r = rows.get(n.id);
            const ops = draft[n.id];
            // escala por peça da linha: ÷ gigas, fração e lote (igual ao Cycle × Takt)
            const k = r && ops && operationsTime(ops) > 0 ? r.plan / operationsTime(ops) : 0;
            const t = tot(n.id);
            const was = baseRows.get(n.id)?.plan ?? 0;
            return (
              <div
                key={n.id}
                className={`rb-col${over === n.id ? ' over' : ''}${ops ? '' : ' fixed'}`}
                onDragOver={(e) => {
                  if (!ops) return;
                  e.preventDefault();
                  setOver(n.id);
                }}
                onDragLeave={() => setOver((o) => (o === n.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  move(n.id);
                }}
              >
                <div className={`rb-total${t > takt ? ' bad' : ''}`}>
                  {fmt(t, 1)}
                  {d(t, was, true)}
                </div>
                <div className="rb-stack" style={{ height: H }}>
                  {ops ? (
                    ops.flatMap((o, oi) =>
                      o.activities.map((a, ai) => (
                        <div
                          key={`${oi}-${ai}-${a.name}`}
                          className="rb-act"
                          draggable
                          style={{ height: Math.max(2, px(a.time * k)), background: KIND_COLOR[a.kind] }}
                          title={`${o.name} · ${a.name}: ${fmt(a.time, 1)} s (${ACTIVITY_LABEL[a.kind]}). Arraste para outro posto.`}
                          onDragStart={(e) => {
                            drag.current = { from: n.id, op: oi, act: ai };
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            move(n.id, { op: oi, act: ai });
                          }}
                        >
                          {px(a.time * k) > 14 && <span>{a.name}</span>}
                        </div>
                      )),
                    )
                  ) : (
                    <div className="rb-act none" style={{ height: px(t) }} title="Posto sem atividades: tempo fixo do ciclo">
                      {px(t) > 14 && <span>ciclo</span>}
                    </div>
                  )}
                </div>
                <div className="rb-name" title={n.name}>{n.name}</div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="hint">
        Arraste um bloco (atividade) para outro posto: ele entra na operação "Recebidas" do destino, ou na posição do bloco onde você soltar. A altura é por peça da linha (÷ gigas, fração e lote) e já conta a ineficiência. UPH estimado = 3600 ÷ maior posto; o simulado roda 2 h do modelo proposto.
      </p>
    </>
  );
}
