// Aba Experimentos: Experimentador (variáveis × réplicas, UPH com intervalo de 95%) e Otimizador
// (menos pessoas que atingem a meta de UPH com folga estatística).

import { useMemo, useRef, useState } from 'react';
import { applyFactor, combos, evaluate, FACTOR_LABEL, metaUph, optimize, peopleIn, type ExpResult, type Factor, type FactorKind, type OptResult, type OptStep } from '../engine/experiment';
import type { Model } from '../engine/types';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Kpi } from './Modal';
import { fmt } from './theme';

const STATION = (t: string) => t === 'machine' || t === 'inspection' || t === 'rework';

function targetsFor(m: Model, kind: FactorKind): { id: string; name: string }[] {
  if (kind === 'frota') return (m.pools ?? []).map((p) => ({ id: p.id, name: p.name }));
  if (kind === 'buffer') return m.nodes.filter((n) => n.type === 'buffer').map((n) => ({ id: n.id, name: n.name }));
  return m.nodes.filter((n) => STATION(n.type)).map((n) => ({ id: n.id, name: n.name }));
}

/** Valores sugeridos a partir do valor atual. */
function suggest(m: Model, kind: FactorKind, target: string): string {
  if (kind === 'frota') {
    const c = m.pools?.find((p) => p.id === target)?.count ?? 1;
    return [Math.max(1, c - 1), c, c + 1].filter((v, i, a) => a.indexOf(v) === i).join(' ');
  }
  const n = m.nodes.find((x) => x.id === target);
  if (!n) return '';
  if (kind === 'gigas') return [n.capacity, n.capacity + 1, n.capacity + 2].join(' ');
  if (kind === 'tempo') return [0.9, 1, 1.1].map((f) => fmt(n.cycleTime * f, 1)).join(' ');
  if (kind === 'fila') return [1, Math.max(2, n.queueCap), Math.max(4, n.queueCap * 2)].filter((v, i, a) => a.indexOf(v) === i).join(' ');
  return [Math.max(1, Math.round(n.capacity / 2)), n.capacity, n.capacity * 2].join(' ');
}

const parseValues = (t: string) => t.split(/[\s;]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => Number.isFinite(x) && x > 0).slice(0, 8);

export function Experiments() {
  const model = useStore((s) => s.model);
  const meta = metaUph(model);
  return (
    <>
      <HowTo
        title="Experimentos: testar e otimizar sem mexer na linha"
        why="Uma simulação é um turno; outro turno, com outras falhas e variações, dá outro UPH. Aqui cada configuração roda várias vezes (réplicas) e o resultado vem com a faixa de 95%: só conta como atingir a meta quando até o pior caso da faixa chega lá."
        steps={[
          'Experimentador: escolha 1 ou 2 variáveis (gigas, tempo de ciclo, fila, buffer ou frota), o posto e os valores a testar (ex.: 1 2 3).',
          'Escolha as réplicas (5 é um bom começo) e as horas por réplica, e clique em ▶ Rodar experimento.',
          'Leia o gráfico: cada barra é uma combinação, o traço é a faixa de 95% e a linha tracejada é a meta. Verde = atinge a meta com folga.',
          'Otimizador: informe a meta de UPH e o máximo de gigas por posto. Ele põe gigas no gargalo até atingir a meta e depois tira as que sobram.',
          'Aplicar no modelo leva a melhor configuração para o trabalho aberto (dá para desfazer com Ctrl+Z).',
        ]}
        tip="Faixas que se cruzam querem dizer que a diferença pode ser só sorte: aumente as réplicas antes de decidir."
      />
      <p className="hint">Meta da linha: {meta > 0 ? `${fmt(meta, 1)} peças/h` : 'sem meta (informe a Meta UPH no painel Modelo)'} · {peopleIn(model)} pessoas hoje.</p>
      <Experimenter model={model} meta={meta} />
      <Optimizer model={model} meta={meta} />
    </>
  );
}

function Experimenter({ model, meta }: { model: Model; meta: number }) {
  const first = targetsFor(model, 'gigas')[0]?.id ?? '';
  const [rows, setRows] = useState<{ kind: FactorKind; target: string; text: string }[]>(() => [{ kind: 'gigas', target: first, text: suggest(model, 'gigas', first) }]);
  const [reps, setReps] = useState(5);
  const [hours, setHours] = useState(4);
  const [res, setRes] = useState<ExpResult[] | null>(null);
  const [prog, setProg] = useState<[number, number] | null>(null);
  const cancel = useRef(false);
  const factors: Factor[] = rows.map((r) => ({ kind: r.kind, target: r.target, values: parseValues(r.text) })).filter((f) => f.target && f.values.length);
  const total = factors.length ? combos(factors).length : 0;
  const nameOf = (f: Factor) => (f.kind === 'frota' ? model.pools?.find((p) => p.id === f.target)?.name : model.nodes.find((n) => n.id === f.target)?.name) ?? f.target;

  const upd = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows(rows.map((r, j) => {
      if (j !== i) return r;
      const n = { ...r, ...patch };
      if (patch.kind) n.target = targetsFor(model, patch.kind)[0]?.id ?? '';
      if (patch.kind || patch.target) n.text = suggest(model, n.kind, n.target);
      return n;
    }));

  const run = () => {
    const list = combos(factors);
    const out: ExpResult[] = [];
    cancel.current = false;
    setRes(null);
    setProg([0, list.length]);
    const step = (i: number) => {
      if (cancel.current || i >= list.length) {
        setRes(out);
        setProg(null);
        return;
      }
      const values = list[i];
      const mm = factors.reduce((acc, f, j) => applyFactor(acc, f, values[j]), model);
      const e = evaluate(mm, reps, hours);
      out.push({ values, uph: e.uph, lead: e.lead, wip: e.wip, people: peopleIn(mm), meets: meta > 0 && e.uph.mean - e.uph.half >= meta });
      setProg([i + 1, list.length]);
      setTimeout(() => step(i + 1), 0);
    };
    setTimeout(() => step(0), 30);
  };

  // melhor: atinge a meta com menos pessoas e, no empate, mais UPH; sem nenhuma que atinja, a de maior UPH
  const best = useMemo(() => {
    if (!res?.length) return -1;
    const ok = res.map((r, i) => ({ r, i })).filter((x) => x.r.meets);
    const pool = ok.length ? ok.sort((a, b) => a.r.people - b.r.people || b.r.uph.mean - a.r.uph.mean) : res.map((r, i) => ({ r, i })).sort((a, b) => b.r.uph.mean - a.r.uph.mean);
    return pool[0].i;
  }, [res]);

  const apply = (r: ExpResult) => {
    const mm = factors.reduce((acc, f, j) => applyFactor(acc, f, r.values[j]), model);
    useStore.getState().setModel(mm, `Experimento aplicado: ${factors.map((f, j) => `${FACTOR_LABEL[f.kind].toLowerCase()} de ${nameOf(f)} = ${fmt(r.values[j], 1)}`).join(', ')}.`);
  };

  return (
    <section className="section exp">
      <p className="label">Experimentador</p>
      {rows.map((r, i) => (
        <div key={i} className="row-btns exp-row">
          <label className="field inline">
            <span>Variável {i + 1}</span>
            <select value={r.kind} onChange={(e) => upd(i, { kind: e.target.value as FactorKind })}>
              {(Object.keys(FACTOR_LABEL) as FactorKind[]).map((k) => (
                <option key={k} value={k} disabled={!targetsFor(model, k).length}>{FACTOR_LABEL[k]}</option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>{r.kind === 'frota' ? 'Frota' : 'Posto'}</span>
            <select value={r.target} onChange={(e) => upd(i, { target: e.target.value })}>
              {targetsFor(model, r.kind).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field inline">
            <span>Valores</span>
            <input value={r.text} onChange={(e) => upd(i, { text: e.target.value })} aria-label={`Valores da variável ${i + 1}`} style={{ width: 140 }} />
          </label>
          {rows.length > 1 && <button className="btn" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Tirar variável">×</button>}
        </div>
      ))}
      <div className="row-btns">
        {rows.length < 2 && <button className="btn" onClick={() => setRows([...rows, { kind: 'fila', target: first, text: suggest(model, 'fila', first) }])}>+ Variável</button>}
        <label className="field inline">
          <span>Réplicas</span>
          <select value={reps} onChange={(e) => setReps(Number(e.target.value))}>
            {[3, 5, 10, 20].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="field inline">
          <span>Horas por réplica</span>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {[1, 2, 4, 8].map((v) => <option key={v} value={v}>{v} h</option>)}
          </select>
        </label>
        {!prog && <button className="btn primary" onClick={run} disabled={!total}>▶ Rodar experimento ({total} combinações × {reps})</button>}
        {prog && (
          <>
            <span className="muted">Rodando {prog[0]}/{prog[1]}…</span>
            <button className="btn" onClick={() => (cancel.current = true)}>Parar</button>
          </>
        )}
      </div>
      {res && res.length > 0 && (
        <>
          <ExpChart res={res} meta={meta} best={best} labels={res.map((r) => r.values.map((v) => fmt(v, v % 1 ? 1 : 0)).join(' · '))} />
          <table className="grid-table section">
            <thead>
              <tr>
                {factors.map((f, j) => <th key={j}>{FACTOR_LABEL[f.kind].replace(' do posto', '')} · {nameOf(f)}</th>)}
                <th>UPH médio</th><th>Faixa 95%</th><th>Lead time</th><th>WIP</th><th>Pessoas</th><th>Meta</th><th />
              </tr>
            </thead>
            <tbody>
              {res.map((r, i) => (
                <tr key={i} className={i === best ? 'sel' : ''}>
                  {r.values.map((v, j) => <td key={j}>{fmt(v, v % 1 ? 1 : 0)}</td>)}
                  <td><b>{fmt(r.uph.mean, 1)}</b></td>
                  <td>{fmt(r.uph.mean - r.uph.half, 1)} a {fmt(r.uph.mean + r.uph.half, 1)}</td>
                  <td>{fmt(r.lead / 60, 1)} min</td>
                  <td>{fmt(r.wip, 0)}</td>
                  <td>{r.people}</td>
                  <td className={r.meets ? 'good' : 'bad'}>{meta > 0 ? (r.meets ? 'Atinge' : 'Não garante') : '–'}{i === best && <b> · melhor</b>}</td>
                  <td><button className="btn" onClick={() => apply(r)}>Aplicar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function ExpChart({ res, meta, best, labels }: { res: ExpResult[]; meta: number; best: number; labels: string[] }) {
  const W = Math.max(520, res.length * 70 + 60);
  const H = 230;
  const L = 44;
  const B = 180;
  const hi = Math.max(meta * 1.1, ...res.map((r) => r.uph.mean + r.uph.half)) || 1;
  const lo = Math.max(0, Math.min(meta * 0.8 || Infinity, ...res.map((r) => r.uph.mean - r.uph.half)) * 0.9);
  const y = (v: number) => B - ((v - lo) / (hi - lo)) * (B - 14);
  const step = (W - L - 10) / res.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
  return (
    <div className="chart-scroll section">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="UPH por combinação com faixa de 95%">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 10} y1={y(t)} y2={y(t)} className="pc-grid" />
            <text x={L - 4} y={y(t) + 3} textAnchor="end" className="pc-label">{fmt(t, 0)}</text>
          </g>
        ))}
        {meta > 0 && (
          <>
            <line x1={L} x2={W - 10} y1={y(meta)} y2={y(meta)} className="pc-takt" />
            <text x={W - 12} y={y(meta) - 4} textAnchor="end" className="pc-label">meta {fmt(meta, 1)}</text>
          </>
        )}
        {res.map((r, i) => {
          const cx = L + step * (i + 0.5);
          const bw = Math.min(36, step * 0.55);
          return (
            <g key={i}>
              <rect x={cx - bw / 2} y={y(r.uph.mean)} width={bw} height={Math.max(0, B - y(r.uph.mean))} rx={3} className={r.meets ? 'exp-bar ok' : 'exp-bar'} strokeWidth={i === best ? 2 : 0}>
                <title>{`${labels[i]}: ${fmt(r.uph.mean, 1)} UPH (${fmt(r.uph.mean - r.uph.half, 1)} a ${fmt(r.uph.mean + r.uph.half, 1)})`}</title>
              </rect>
              <line x1={cx} x2={cx} y1={y(r.uph.mean + r.uph.half)} y2={y(Math.max(lo, r.uph.mean - r.uph.half))} className="exp-whisker" />
              <line x1={cx - 6} x2={cx + 6} y1={y(r.uph.mean + r.uph.half)} y2={y(r.uph.mean + r.uph.half)} className="exp-whisker" />
              <line x1={cx - 6} x2={cx + 6} y1={y(Math.max(lo, r.uph.mean - r.uph.half))} y2={y(Math.max(lo, r.uph.mean - r.uph.half))} className="exp-whisker" />
              <text x={cx} y={B + 14} textAnchor="middle" className="pc-label">{labels[i]}</text>
              {i === best && <text x={cx} y={B + 27} textAnchor="middle" className="pc-label good">melhor</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Optimizer({ model, meta }: { model: Model; meta: number }) {
  const [target, setTarget] = useState(() => Math.round(meta || 60));
  const [maxG, setMaxG] = useState(4);
  const [reps, setReps] = useState(5);
  const [hours, setHours] = useState(4);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<OptResult | null>(null);
  const run = () => {
    setBusy(true);
    setRes(null);
    setTimeout(() => {
      setRes(optimize(model, { target, maxGigas: maxG, reps, hours }));
      setBusy(false);
    }, 30);
  };
  const last: OptStep | undefined = res?.steps.at(-1);
  const firstStep: OptStep | undefined = res?.steps[0];
  return (
    <section className="section exp">
      <p className="label">Otimizador: atingir a meta com menos pessoas</p>
      <div className="row-btns">
        <label className="field inline">
          <span>Meta (UPH)</span>
          <input type="number" min={1} value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))} style={{ width: 80 }} />
        </label>
        <label className="field inline">
          <span>Máx. gigas por posto</span>
          <select value={maxG} onChange={(e) => setMaxG(Number(e.target.value))}>
            {[2, 3, 4, 6, 8].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="field inline">
          <span>Réplicas</span>
          <select value={reps} onChange={(e) => setReps(Number(e.target.value))}>
            {[3, 5, 10].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="field inline">
          <span>Horas por réplica</span>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {[2, 4, 8].map((v) => <option key={v} value={v}>{v} h</option>)}
          </select>
        </label>
        <button className="btn primary" onClick={run} disabled={busy}>{busy ? 'Otimizando…' : '▶ Otimizar'}</button>
      </div>
      {res && firstStep && last && (
        <>
          <div className="tiles section">
            <Kpi k="Resultado" v={res.meets ? 'Meta atingida' : 'Meta não garantida'} tone={res.meets ? 'good' : 'bad'} u={res.meets ? 'mesmo no pior caso da faixa de 95%' : 'o limite de gigas ou outro gargalo (transporte, abastecimento) segura a linha'} />
            <Kpi k="UPH" v={`${fmt(firstStep.uph, 1)} → ${fmt(last.uph, 1)}`} u={`± ${fmt(last.half, 1)} · meta ${fmt(target, 1)}`} />
            <Kpi k="Pessoas" v={`${firstStep.people} → ${last.people}`} u={`gigas ${firstStep.gigas} → ${last.gigas}`} />
          </div>
          <table className="grid-table section">
            <thead><tr><th>Passo</th><th>O que mudou</th><th>UPH</th><th>Faixa 95%</th><th>Pessoas</th></tr></thead>
            <tbody>
              {res.steps.map((s, i) => (
                <tr key={i}>
                  <td>{i}</td>
                  <td>{s.action}</td>
                  <td>{fmt(s.uph, 1)}</td>
                  <td>{fmt(s.uph - s.half, 1)} a {fmt(s.uph + s.half, 1)}</td>
                  <td>{s.people}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-btns">
            <button className="btn primary" disabled={!res.changes.length} onClick={() => useStore.getState().setModel(res.model, `Otimização aplicada: ${res.changes.map((c) => `${c.name} ${c.before}→${c.after} gigas`).join(', ')}.`)}>
              Aplicar no modelo
            </button>
            <span className="muted">{res.changes.length ? `Muda: ${res.changes.map((c) => `${c.name} ${c.before} → ${c.after} gigas`).join(' · ')}` : 'Nenhuma mudança: a linha atual já é a melhor que o otimizador encontrou.'}</span>
          </div>
        </>
      )}
    </section>
  );
}
