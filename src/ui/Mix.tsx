// Mix de modelos: produtos com % (ou sequência fixa), tempo de cada posto por modelo e troca de modelo.
// Roda o turno com o mix e compara com cada modelo rodando sozinho.

import { useMemo, useState } from 'react';
import { effectiveTakt } from '../engine/balance';
import { lineKpi } from '../engine/metrics';
import { Simulator } from '../engine/simulator';
import { baseCycle, type Model, type NodeDef, type ProductDef } from '../engine/types';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Kpi, Modal } from './Modal';
import { fmt, pct } from './theme';

const COLORS = ['#22d3ee', '#e8913a', '#a78bfa', '#4ade80', '#f472b6', '#facc15'];
const isStation = (n: NodeDef) => n.type === 'machine' || n.type === 'inspection' || n.type === 'rework';

/** Tempo do posto para o modelo: próprio ou ciclo × fator. */
export function timeFor(m: Model, n: NodeDef, p: ProductDef): number {
  const own = n.productTimes?.[p.id];
  return own !== undefined && own > 0 ? own : baseCycle(n, m.settings) * p.factor;
}

/** Sequência fixa digitada com os nomes (ou letras) dos modelos: "A A B" → ids. */
export function parseSequence(text: string, ps: ProductDef[]): string[] {
  const by = new Map(ps.flatMap((p) => [[p.name.toLowerCase(), p.id], [p.id.toLowerCase(), p.id]]));
  return text.split(/[\s,;]+/).map((t) => by.get(t.trim().toLowerCase())).filter((x): x is string => !!x);
}

interface RunResult {
  uph: number;
  takt: number;
  share: Record<string, number>;
  changeovers: number;
  changeoverTime: number;
  bottleneck: string;
  pure: { id: string; uph: number }[];
}

function run(m: Model): RunResult {
  const sim = new Simulator(m);
  sim.runToEnd();
  const k = lineKpi(sim);
  const tot = Object.values(sim.producedBy).reduce((a, b) => a + b, 0) || 1;
  const share = Object.fromEntries(Object.entries(sim.producedBy).map(([id, c]) => [id, c / tot]));
  const pure = (m.products ?? []).map((p) => {
    const s = new Simulator({ ...m, sequence: [p.id] });
    s.runToEnd();
    return { id: p.id, uph: lineKpi(s).throughputPerHour };
  });
  return {
    uph: k.throughputPerHour,
    takt: effectiveTakt(m),
    share,
    changeovers: sim.nodes.reduce((a, n) => a + n.changeovers, 0),
    changeoverTime: sim.nodes.reduce((a, n) => a + n.changeoverTime, 0),
    bottleneck: m.nodes.find((n) => n.id === k.bottleneckId)?.name ?? '–',
    pure,
  };
}

export function MixModal({ onClose }: { onClose: () => void }) {
  const model = useStore((s) => s.model);
  const ps = model.products ?? [];
  const st = useStore.getState;
  const stations = model.nodes.filter(isStation);
  const total = ps.reduce((a, p) => a + Math.max(0, p.share), 0) || 1;
  const [seqText, setSeqText] = useState(() => (model.sequence ?? []).map((id) => ps.find((p) => p.id === id)?.name ?? id).join(' '));
  const [res, setRes] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fixed = !!model.sequence?.length;

  const setProducts = (products: ProductDef[]) => {
    const ids = new Set(products.map((p) => p.id));
    st().patchModel({ products: products.length ? products : undefined, sequence: (model.sequence ?? []).filter((id) => ids.has(id)) });
    setRes(null);
  };
  const upd = (id: string, patch: Partial<ProductDef>) => setProducts(ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = () => {
    const used = new Set(ps.map((p) => p.id));
    const id = 'ABCDEFGHIJ'.split('').find((c) => !used.has(c)) ?? `P${ps.length + 1}`;
    setProducts([...ps, { id, name: id, color: COLORS[ps.length % COLORS.length], share: ps.length ? 20 : 60, factor: 1 }]);
  };
  const remove = (id: string) => {
    setProducts(ps.filter((p) => p.id !== id));
    for (const n of model.nodes) if (n.productTimes?.[id] !== undefined) {
      const { [id]: _, ...rest } = n.productTimes;
      st().updateNode(n.id, { productTimes: Object.keys(rest).length ? rest : undefined });
    }
  };
  const setTime = (n: NodeDef, pid: string, v: string) => {
    const num = Number(v.replace(',', '.'));
    const next = { ...(n.productTimes ?? {}) };
    if (v.trim() === '' || !Number.isFinite(num) || num <= 0) delete next[pid];
    else next[pid] = num;
    st().updateNode(n.id, { productTimes: Object.keys(next).length ? next : undefined });
    setRes(null);
  };

  // tempo ponderado pelo mix e pior modelo em cada posto, contra o takt
  const takt = effectiveTakt(model);
  const load = useMemo(
    () =>
      stations.map((n) => {
        const cap = Math.max(1, n.capacity);
        const ts = ps.map((p) => timeFor(model, n, p) / cap);
        const w = ps.length ? ps.reduce((a, p, i) => a + (Math.max(0, p.share) / total) * ts[i], 0) : baseCycle(n, model.settings) / cap;
        return { n, w, worst: ts.length ? Math.max(...ts) : w };
      }),
    [model, ps, stations, total],
  );

  const doRun = () => {
    setBusy(true);
    setTimeout(() => {
      setRes(run(st().model));
      setBusy(false);
    }, 30);
  };

  return (
    <Modal title="🎨 Mix de modelos" sub="Vários modelos de produto na mesma linha: % de cada um ou sequência fixa, tempo por modelo e troca de modelo." onClose={onClose} wide>
      <HowTo
        title="Mix de modelos: como montar"
        why="Quando a linha faz mais de um modelo, o gargalo muda conforme o mix. Um posto pode estar folgado no modelo A e estourar o takt no modelo B, e cada troca de modelo para o posto."
        steps={[
          'Crie os modelos em + Modelo. Dê nome, cor (as peças aparecem nessa cor no layout) e a participação no mix (%).',
          'Fator: multiplica o tempo de todos os postos para o modelo (1,2 = 20% mais lento). Use quando não tiver tempo por posto.',
          'Na tabela de postos, digite o tempo do modelo no posto (vazio = SOE × fator) e o tempo de troca quando o modelo muda.',
          'Escolha Sorteio pelo % (mix aleatório) ou Sequência fixa (ex.: A A B, repetida o turno inteiro).',
          'Clique em ▶ Rodar turno com o mix: veja o UPH do mix, quanto saiu de cada modelo, as trocas e o UPH de cada modelo sozinho.',
        ]}
        tip="Sequência fixa com modelos alternados (A B A B) gera mais trocas que blocos (A A A B B B). Teste as duas e compare o UPH."
      />
      <div className="row-btns section">
        <button className="btn primary" onClick={add}>+ Modelo</button>
        {ps.length > 0 && <button className="btn" onClick={() => setProducts([])}>Voltar para produto único</button>}
        <span className="muted">{ps.length ? `${ps.length} modelos no mix.` : 'Sem mix: a linha faz um produto só. Clique em + Modelo para começar.'}</span>
      </div>
      {ps.length > 0 && (
        <>
          <table className="grid-table section mix-products">
            <thead>
              <tr><th>Cor</th><th>Modelo</th><th>Mix (%)</th><th>Fator de tempo</th><th>Participação</th><th /></tr>
            </thead>
            <tbody>
              {ps.map((p) => (
                <tr key={p.id}>
                  <td><input type="color" value={p.color} onChange={(e) => upd(p.id, { color: e.target.value })} aria-label={`Cor de ${p.name}`} /></td>
                  <td><input value={p.name} onChange={(e) => upd(p.id, { name: e.target.value })} aria-label="Nome do modelo" /></td>
                  <td><input type="number" min={0} step={5} value={p.share} onChange={(e) => upd(p.id, { share: Math.max(0, Number(e.target.value) || 0) })} aria-label={`Mix de ${p.name}`} /></td>
                  <td><input type="number" min={0.1} step={0.05} value={p.factor} onChange={(e) => upd(p.id, { factor: Math.max(0.05, Number(e.target.value) || 1) })} aria-label={`Fator de ${p.name}`} /></td>
                  <td>{fixed ? `${pct((model.sequence ?? []).filter((x) => x === p.id).length / (model.sequence?.length || 1))} da sequência` : pct(Math.max(0, p.share) / total)}</td>
                  <td><button className="btn" onClick={() => remove(p.id)} aria-label={`Remover ${p.name}`}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-btns section" role="group" aria-label="Como a linha escolhe o próximo modelo">
            <button className={`btn${!fixed ? ' on' : ''}`} aria-pressed={!fixed} onClick={() => { st().patchModel({ sequence: undefined }); setRes(null); }}>Sorteio pelo %</button>
            <button className={`btn${fixed ? ' on' : ''}`} aria-pressed={fixed} onClick={() => { const s = parseSequence(seqText || ps.map((p) => p.name).join(' '), ps); st().patchModel({ sequence: s }); setSeqText(s.map((id) => ps.find((p) => p.id === id)?.name ?? id).join(' ')); setRes(null); }}>Sequência fixa</button>
            {fixed && (
              <input className="url" value={seqText} onChange={(e) => { setSeqText(e.target.value); const s = parseSequence(e.target.value, ps); if (s.length) st().patchModel({ sequence: s }); setRes(null); }} aria-label="Sequência de produção" placeholder="ex.: A A B" />
            )}
          </div>

          <p className="label section">Tempo de cada posto por modelo (s por giga; vazio = SOE × fator)</p>
          <div className="chart-scroll">
            <table className="grid-table mix-grid">
              <thead>
                <tr>
                  <th>Posto</th><th>SOE</th>
                  {ps.map((p) => <th key={p.id}><i className="sw" style={{ background: p.color }} /> {p.name}</th>)}
                  <th>Troca de modelo (s)</th><th>Ponderado pelo mix</th><th>Pior modelo</th>
                </tr>
              </thead>
              <tbody>
                {load.map(({ n, w, worst }) => (
                  <tr key={n.id}>
                    <td>{n.name}</td>
                    <td>{fmt(baseCycle(n, model.settings), 1)}</td>
                    {ps.map((p) => (
                      <td key={p.id}>
                        <input type="number" min={0} step={0.5} value={n.productTimes?.[p.id] ?? ''} placeholder={fmt(baseCycle(n, model.settings) * p.factor, 1)} onChange={(e) => setTime(n, p.id, e.target.value)} aria-label={`Tempo de ${n.name} no modelo ${p.name}`} />
                      </td>
                    ))}
                    <td><input type="number" min={0} step={5} value={n.changeover ?? ''} placeholder="0" onChange={(e) => { const v = Number(e.target.value); st().updateNode(n.id, { changeover: v > 0 ? v : undefined }); setRes(null); }} aria-label={`Troca de modelo em ${n.name}`} /></td>
                    <td className={takt > 0 && w > takt ? 'bad' : ''}>{fmt(w, 1)}</td>
                    <td className={takt > 0 && worst > takt ? 'bad' : ''}>{fmt(worst, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Ponderado e pior modelo já divididos pelas gigas. Vermelho = acima do takt de {fmt(takt, 1)} s.</p>

          <div className="row-btns section">
            <button className="btn primary" onClick={doRun} disabled={busy}>▶ Rodar turno com o mix</button>
            {busy && <span className="muted">Rodando o mix e cada modelo sozinho…</span>}
          </div>
          {res && (
            <>
              <div className="tiles section">
                <Kpi k="UPH do mix" v={fmt(res.uph, 1)} u={`meta ${fmt(res.takt > 0 ? 3600 / res.takt : 0, 1)}`} tone={res.takt > 0 && res.uph < (3600 / res.takt) * 0.98 ? 'bad' : 'good'} />
                <Kpi k="Gargalo" v={res.bottleneck} />
                <Kpi k="Trocas de modelo" v={String(res.changeovers)} u={`${fmt(res.changeoverTime / 60, 0)} min parados no total`} />
              </div>
              <table className="grid-table section">
                <thead><tr><th>Modelo</th><th>Saiu no turno</th><th>Planejado</th><th>UPH se rodasse sozinho</th></tr></thead>
                <tbody>
                  {ps.map((p) => (
                    <tr key={p.id}>
                      <td><i className="sw" style={{ background: p.color }} /> {p.name}</td>
                      <td>{pct(res.share[p.id] ?? 0)}</td>
                      <td>{fixed ? pct((model.sequence ?? []).filter((x) => x === p.id).length / (model.sequence?.length || 1)) : pct(Math.max(0, p.share) / total)}</td>
                      <td>{fmt(res.pure.find((x) => x.id === p.id)?.uph ?? 0, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
