// Painel de análises: gargalos, spaghetti, custos, energia, carbono, cenários,
// real × simulado (digital twin) e assistente de IA.

import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { footprint, spaghetti } from '../engine/analytics';
import { calibrateToTakt } from '../engine/calibrate';
import type { Model } from '../engine/types';
import { effectiveTakt } from '../engine/balance';
import { useStore, type AnalysisTab, type RealRow } from '../store';
import { Advisor } from './Advisor';
import { CycleTakt } from './CycleTakt';
import { ThroughputTab } from './Throughput';
import { Yamazumi } from './Yamazumi';
import { Rebalance } from './Rebalance';
import { Replicas } from './Replicas';
import { RealData } from './RealData';
import { Experiments } from './Experiments';
import { Shifts } from './Shifts';
import { loadScenarios, runScenario, saveScenarios, type Scenario } from './scenarios';
import { Bars, Kpi, Modal } from './Modal';
import { norm } from './StationDetail';
import { fmt, fmtTime, pct } from './theme';

const TABS: { k: AnalysisTab; label: string }[] = [
  { k: 'ciclo', label: 'Cycle × Takt' },
  { k: 'yamazumi', label: 'Yamazumi' },
  { k: 'rebalancear', label: 'Rebalancear' },
  { k: 'replicas', label: 'Réplicas' },
  { k: 'turnos', label: 'Turnos e paradas' },
  { k: 'throughput', label: 'Throughput por intervalo' },
  { k: 'gargalos', label: 'Gargalos' },
  { k: 'spaghetti', label: 'Spaghetti' },
  { k: 'custos', label: 'Custos' },
  { k: 'energia', label: 'Energia' },
  { k: 'carbono', label: 'Carbono' },
  { k: 'cenarios', label: 'Cenários' },
  { k: 'coleta', label: 'Dados reais' },
  { k: 'experimentos', label: 'Experimentos' },
  { k: 'real', label: 'Real × simulado' },
  { k: 'ia', label: 'IA' },
];

export function Analysis() {
  const tab = useStore((s) => s.analysis);
  if (!tab) return null;
  const close = () => useStore.getState().setAnalysis(null);
  return (
    <Modal title="Análises" sub="Resultados da simulação atual. Rode a simulação (ou ⏭ Fim) para números completos." onClose={close} wide>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} className={`tab${tab === t.k ? ' on' : ''}`} onClick={() => useStore.getState().setAnalysis(t.k)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === 'ciclo' && <CycleTakt />}
        {tab === 'yamazumi' && <Yamazumi />}
        {tab === 'rebalancear' && <Rebalance />}
        {tab === 'replicas' && <Replicas />}
        {tab === 'turnos' && <Shifts />}
        {tab === 'throughput' && <ThroughputTab />}
        {tab === 'gargalos' && <Bottlenecks />}
        {tab === 'spaghetti' && <SpaghettiTab />}
        {tab === 'custos' && <Costs />}
        {tab === 'energia' && <Energy />}
        {tab === 'carbono' && <Carbon />}
        {tab === 'cenarios' && <Scenarios />}
        {tab === 'coleta' && <RealData />}
        {tab === 'experimentos' && <Experiments />}
        {tab === 'real' && <RealVsSim />}
        {tab === 'ia' && <Advisor />}
      </div>
    </Modal>
  );
}

function useResults() {
  const sim = useStore((s) => s.sim);
  const kpi = useStore((s) => s.kpi);
  useStore((s) => s.tick);
  return { sim, kpi, fp: footprint(sim, kpi) };
}

function Bottlenecks() {
  const { sim, kpi } = useResults();
  const model = useStore((s) => s.model);
  const top5 = useStore((s) => s.layers.top5);
  const [busy, setBusy] = useState(false);
  const takt = effectiveTakt(model);
  const top = kpi.ranking.slice(0, 5);
  const calibrate = () => {
    setBusy(true);
    setTimeout(() => {
      const c = calibrateToTakt(useStore.getState().model);
      useStore.getState().setModel(
        c.model,
        c.factor === 1
          ? `A linha já atende o takt sem ajuste (${fmt(c.uph, 1)} pç/h em regime).`
          : `Tempos escalados em ${pct(c.factor, 1)} (postos com tempo fixo mantidos): ${fmt(c.uph, 1)} pç/h em regime para meta de ${fmt(c.target, 1)}.`,
      );
      setBusy(false);
    }, 30);
  };
  return (
    <>
      <div className="row-btns">
        <button className={`btn${top5 ? ' on' : ''}`} onClick={() => useStore.getState().toggleLayer('top5')}>
          {top5 ? 'Ocultar top 5 no layout' : 'Mostrar top 5 no layout'}
        </button>
        <button className="btn" onClick={calibrate} disabled={busy} title="Escala na mesma proporção os tempos de ciclo (menos os de tempo fixo) até a linha cheia entregar o takt">
          {busy ? 'Calibrando…' : 'Calibrar tempos para o takt'}
        </button>
      </div>
      {kpi.completed === 0 && <p className="hint section">Rode a simulação para ver o ranking.</p>}
      <ol className="top5 section">
        {top.map((r, i) => {
          const d = model.nodes.find((n) => n.id === r.id)!;
          const k = kpi.nodes.find((n) => n.id === r.id)!;
          const e = Math.max(1, kpi.elapsed);
          const ct = d.cycleTime / Math.max(1, d.capacity);
          return (
            <li key={r.id}>
              <span className="badge">{i + 1}</span>
              <div>
                <b>{d.name}</b>
                <p className="sub">
                  {fmt(ct, 1)} s por peça ({pct(ct / (takt || 1))} do takt) · operando {pct(k.utilization)} · bloqueado {pct(k.states.blocked / e)} · sem peça {pct(k.states.starved / e)}
                </p>
                <span className="bt"><span style={{ width: `${r.active * 100}%`, background: i === 0 ? 'var(--st-down)' : 'var(--accent)' }} /></span>
              </div>
              <b>{pct(r.active)}</b>
              <button className="btn" onClick={() => useStore.getState().setDetail(r.id)}>Detalhes</button>
            </li>
          );
        })}
      </ol>
      <p className="hint">Gargalo pelo método do período ativo: fração do tempo em que o posto está trabalhando, em falha ou em setup. Simulação de {fmtTime(kpi.elapsed)}{sim.model.settings.startFull ? ', linha cheia desde o início' : ''}.</p>
    </>
  );
}

function SpaghettiTab() {
  const { sim, kpi } = useResults();
  const sp = spaghetti(sim, kpi);
  const heat = useStore((s) => s.layers.heat);
  return (
    <>
      <div className="tiles">
        <Kpi k="Material" v={fmt(sp.materialMeters / 1000, 1)} u="km no período" />
        <Kpi k="Por peça" v={fmt(sp.metersPerUnit, 0)} u="m" />
        <Kpi k="Operadores" v={fmt(sp.operatorMeters / 1000, 2)} u="km" />
        <Kpi k="Veículos" v={fmt(sp.vehicleMeters / 1000, 1)} u="km" />
        <Kpi k="Cruzamentos" v={String(sp.crossings)} tone={sp.crossings > 0 ? 'bad' : undefined} />
        <Kpi k="Sem valor (volta)" v={fmt(sp.backtrackMeters / 1000, 1)} u="km" />
        <Kpi k="Tempo em transporte" v={pct(sp.transportShare)} u="do lead time" />
      </div>
      <div className="row-btns section">
        <button className={`btn${heat ? ' on' : ''}`} onClick={() => useStore.getState().toggleLayer('heat')}>{heat ? 'Ocultar heatmap' : 'Mostrar heatmap de fluxo'}</button>
      </div>
      <p className="label section">Trechos com mais movimentação</p>
      <table className="grid-table">
        <thead><tr><th>Trecho</th><th>Distância</th><th>Viagens</th><th>Total</th><th></th></tr></thead>
        <tbody>
          {sp.legs.slice(0, 15).map((l) => (
            <tr key={l.id}>
              <td>{l.from} → {l.to}</td>
              <td>{fmt(l.distance, 1)} m</td>
              <td>{l.moved}</td>
              <td>{fmt(l.meters, 0)} m</td>
              <td>{[l.vehicle && 'veículo', l.backtrack && 'volta no fluxo', l.against && 'contra o sentido'].filter(Boolean).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const brl = (v: number) => `R$ ${fmt(v, 2)}`;

function Costs() {
  const { fp } = useResults();
  const s = useStore((st) => st.model.settings);
  const c = fp.cost;
  return (
    <>
      <div className="tiles">
        <Kpi k="Custo por peça" v={brl(c.perUnit)} />
        <Kpi k="Custo por turno" v={brl(c.perShift)} u={`${fmt(s.duration / 3600, 0)} h`} />
        <Kpi k="Custo no período" v={brl(c.total)} u={`${fp.units} pç`} />
      </div>
      <div className="cols section">
        <div>
          <p className="label">Diretos e indiretos</p>
          <Bars
            rows={[
              { label: 'Matéria-prima', value: c.material },
              { label: 'Mão de obra', value: c.labor },
              { label: 'Energia', value: c.energy },
              { label: 'Máquinas', value: c.machine },
              { label: 'Manutenção', value: c.maintenance },
              { label: 'Setup', value: c.setup },
              { label: 'Transporte', value: c.transport },
              { label: 'Estoque (WIP)', value: c.storage },
            ]}
            format={brl}
          />
        </div>
        <div>
          <p className="label">Custo por processo (top 12)</p>
          <Bars rows={[...fp.nodes].sort((a, b) => b.cost - a.cost).slice(0, 12).map((n) => ({ label: n.name, value: n.cost }))} format={brl} />
        </div>
      </div>
      <SettingsForm
        fields={[
          ['laborRate', 'Mão de obra (R$/h por operador)'],
          ['energyPrice', 'Energia (R$/kWh)'],
          ['materialCost', 'Matéria-prima (R$/peça)'],
          ['maintenanceRate', 'Manutenção (R$/h parada)'],
          ['wipCost', 'Estoque em processo (R$/peça·h)'],
        ]}
      />
      <p className="hint">Custo/hora e consumo de cada máquina ficam no painel do posto. Veículos têm custo/hora no grupo de recursos.</p>
    </>
  );
}

function Energy() {
  const { fp } = useResults();
  const e = fp.energy;
  return (
    <>
      <div className="tiles">
        <Kpi k="kWh por peça" v={fmt(e.perUnit, 3)} />
        <Kpi k="kWh por turno" v={fmt(e.perShift, 0)} />
        <Kpi k="kWh no período" v={fmt(e.kWh, 1)} />
        <Kpi k="Eficiência energética" v={pct(e.efficiency)} u="em produção" tone={e.efficiency < 0.7 ? 'bad' : undefined} />
      </div>
      <p className="label section">kWh por processo (produzindo × em espera)</p>
      <Bars
        rows={[...fp.nodes].sort((a, b) => b.kWh - a.kWh).slice(0, 14).map((n) => ({ label: n.name, value: n.kWh, color: n.kWhIdle / (n.kWh || 1) > 0.4 ? 'var(--st-blocked)' : 'var(--st-working)', note: `${fmt(n.kWh, 2)} kWh, ${pct(n.kWhIdle / (n.kWh || 1))} em espera` }))}
        format={(v) => `${fmt(v, 2)} kWh`}
      />
      <p className="hint">Laranja: mais de 40% do consumo com o posto esperando. Potência em operação e em espera fica no painel do posto (por giga quando há várias).</p>
    </>
  );
}

function Carbon() {
  const { fp } = useResults();
  const c = fp.co2;
  const co2 = useStore((s) => s.layers.co2);
  return (
    <>
      <div className="tiles">
        <Kpi k="CO2e por peça" v={fmt(c.perUnit * 1000, 0)} u="g" />
        <Kpi k="CO2e por turno" v={fmt(c.perShift, 1)} u="kg" />
        <Kpi k="Escopo 1" v={fmt(c.scope1, 2)} u="kg · combustível" />
        <Kpi k="Escopo 2" v={fmt(c.scope2, 2)} u="kg · energia" />
        <Kpi k="Escopo 3" v={fmt(c.scope3, 2)} u="kg · material" />
      </div>
      <div className="row-btns section">
        <button className={`btn${co2 ? ' on' : ''}`} onClick={() => useStore.getState().toggleLayer('co2')}>{co2 ? 'Ocultar mapa de emissão' : 'Mostrar mapa de calor de emissão'}</button>
      </div>
      <p className="label section">CO2e por processo</p>
      <Bars rows={[...fp.nodes].sort((a, b) => b.co2 - a.co2).slice(0, 12).map((n) => ({ label: n.name, value: n.co2 * 1000, color: 'var(--st-down)' }))} format={(v) => `${fmt(v, 0)} g`} />
      <SettingsForm
        fields={[
          ['gridCo2', 'Fator da rede (kg CO2e/kWh)'],
          ['materialCo2', 'Matéria-prima (kg CO2e/peça)'],
        ]}
      />
      <p className="hint">Escopo 2 usa o fator do posto quando informado; senão o da rede (padrão 0,0385 kg/kWh, matriz brasileira). Compare reduções na aba Cenários.</p>
    </>
  );
}

function SettingsForm({ fields }: { fields: [keyof Model['settings'], string][] }) {
  const s = useStore((st) => st.model.settings);
  return (
    <div className="fields section">
      {fields.map(([k, label]) => (
        <label key={k} className="field">
          <span>{label}</span>
          <input type="number" min={0} step="any" value={Number(s[k] ?? 0)} onChange={(e) => useStore.getState().updateSettings({ [k]: Math.max(0, Number(e.target.value)) })} />
        </label>
      ))}
    </div>
  );
}

// ---- Cenários (Current State, Future State A/B) ----

function Scenarios() {
  const [list, setList] = useState<Scenario[]>(loadScenarios);
  const [busy, setBusy] = useState(false);
  const save = (next: Scenario[]) => {
    setList(next);
    saveScenarios(next);
  };
  const names = ['Current State', 'Future State A', 'Future State B'];
  const add = () => {
    setBusy(true);
    setTimeout(() => {
      const model = structuredClone(useStore.getState().model);
      const name = names[list.length] ?? `Cenário ${list.length + 1}`;
      save([...list, { id: String(Date.now()), name, model, r: runScenario(model) }]);
      setBusy(false);
    }, 30);
  };
  const base = list[0]?.r;
  const delta = (v: number, b: number | undefined, d = 1, lowerIsBetter = false) => {
    if (b === undefined || b === 0 || v === b) return '';
    const p = v / b - 1;
    const good = lowerIsBetter ? p < 0 : p > 0;
    return <small className={good ? 'good' : 'bad'}> {p > 0 ? '+' : ''}{fmt(p * 100, d)}%</small>;
  };
  const rows: [string, (r: Scenario['r']) => number, (v: number) => string, boolean][] = [
    ['Produção (pç/h)', (r) => r.uph, (v) => fmt(v, 1), false],
    ['Meta atingida', (r) => r.target ?? 0, (v) => pct(v, 1), false],
    ['Maior carga de posto (s)', (r) => r.maxLoad ?? 0, (v) => fmt(v, 1), true],
    ['Balanceamento', (r) => r.balance ?? 0, (v) => pct(v, 1), false],
    ['Lead time', (r) => r.lead, (v) => fmtTime(v), true],
    ['WIP médio', (r) => r.wip, (v) => fmt(v, 0), true],
    ['Pessoas', (r) => r.people, (v) => fmt(v, 0), true],
    ['Custo por peça', (r) => r.cost, (v) => `R$ ${fmt(v, 2)}`, true],
    ['kWh por peça', (r) => r.kwh, (v) => fmt(v, 3), true],
    ['CO2e por peça (g)', (r) => r.co2 * 1000, (v) => fmt(v, 0), true],
    ['FPY', (r) => r.fpy, (v) => pct(v, 1), false],
  ];
  return (
    <>
      <p className="hint">Salve o modelo atual como cenário (a simulação roda o turno inteiro). Edite o modelo e salve de novo para comparar Current State com Future State A e B.</p>
      <div className="row-btns">
        <button className="btn primary" onClick={add} disabled={busy}>{busy ? 'Simulando…' : `Salvar modelo atual como "${names[list.length] ?? `Cenário ${list.length + 1}`}"`}</button>
        {list.length > 0 && <button className="btn" onClick={() => save([])}>Limpar cenários</button>}
      </div>
      {list.length > 0 && (
        <table className="grid-table section">
          <thead>
            <tr>
              <th>Indicador</th>
              {list.map((sc) => (
                <th key={sc.id}>
                  <input className="sc-name" value={sc.name} aria-label="Nome do cenário" onChange={(e) => save(list.map((x) => (x.id === sc.id ? { ...x, name: e.target.value } : x)))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, get, f, low]) => (
              <tr key={label}>
                <td>{label}</td>
                {list.map((sc, i) => (
                  <td key={sc.id}>{f(get(sc.r))}{i > 0 && delta(get(sc.r), base && get(base), 1, low)}</td>
                ))}
              </tr>
            ))}
            <tr>
              <td>Gargalo</td>
              {list.map((sc) => (
                <td key={sc.id}>{sc.r.bottleneck ?? '–'}</td>
              ))}
            </tr>
            <tr>
              <td></td>
              {list.map((sc) => (
                <td key={sc.id}>
                  <button className="btn" onClick={() => useStore.getState().setModel(structuredClone(sc.model), `Cenário "${sc.name}" carregado.`)}>Carregar</button>{' '}
                  <button className="btn icon" onClick={() => save(list.filter((x) => x.id !== sc.id))} aria-label="Remover cenário">×</button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </>
  );
}

// ---- Real × simulado (digital twin) ----

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const [k, v] of Object.entries(row)) if (keys.includes(norm(k))) return v;
  return undefined;
}
const num = (v: unknown) => (v === undefined || v === '' || v === null || Number.isNaN(Number(v)) ? undefined : Number(v));

export function rowsToReal(rows: Record<string, unknown>[]): Record<string, RealRow> {
  const out: Record<string, RealRow> = {};
  for (const r of rows) {
    const name = pick(r, ['posto', 'station', 'nome', 'name', 'estacao']);
    if (name === undefined || name === '') continue;
    out[norm(String(name))] = {
      name: String(name),
      produced: num(pick(r, ['produzido', 'produzidas', 'produced', 'qty', 'quantidade', 'output', 'count'])),
      cycle: num(pick(r, ['ciclo', 'ciclos', 'cycle', 'ct', 'temposdeciclo', 'tempodeciclo', 'cycletime'])),
      state: (pick(r, ['estado', 'state', 'status']) as string | undefined) ?? undefined,
    };
  }
  return out;
}

function RealVsSim() {
  const { sim, kpi } = useResults();
  const real = useStore((s) => s.real);
  const source = useStore((s) => s.realSource);
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState('');
  const elapsed = Math.max(1, kpi.elapsed);
  const rows = useMemo(
    () =>
      kpi.nodes
        .filter((k) => k.type === 'machine' || k.type === 'inspection')
        .map((k) => {
          const d = sim.byId.get(k.id)!.def;
          const r = real[norm(d.name)];
          const simCt = k.processed > 0 ? (elapsed * Math.max(1, d.capacity) * k.utilization) / k.processed : d.cycleTime;
          return { k, d, r, simCt };
        })
        .filter((x) => x.r || Object.keys(real).length === 0),
    [kpi, real, sim, elapsed],
  );
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
      const map = rowsToReal(data);
      useStore.getState().setReal(map, `arquivo ${f.name}`);
      setStatus(`${Object.keys(map).length} postos lidos de ${f.name}.`);
    } catch (err) {
      setStatus(`Não foi possível ler ${f.name}: ${(err as Error).message}`);
    }
  }
  function connect() {
    ws?.close();
    try {
      const sock = new WebSocket(url);
      sock.onopen = () => setStatus('Conectado. Aguardando mensagens…');
      sock.onerror = () => setStatus('Não conectou. Confira o endereço (ws:// ou wss://) e se o gateway aceita esta origem.');
      sock.onclose = () => setWs(null);
      sock.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          const list = Array.isArray(msg) ? msg : [msg];
          const cur = { ...useStore.getState().real, ...rowsToReal(list) };
          useStore.getState().setReal(cur, `ao vivo (${url})`);
        } catch {
          /* mensagem fora do formato: ignorada */
        }
      };
      setWs(sock);
    } catch (err) {
      setStatus((err as Error).message);
    }
  }
  const flag = (p: number | undefined) => (p === undefined ? '' : Math.abs(p) > 0.1 ? 'bad' : 'good');
  return (
    <>
      <p className="hint">
        Compare o planejado (simulação) com o real por posto. Importe um Excel/CSV com as colunas <b>posto</b>, <b>produzido</b> e <b>ciclo</b> (s), opcionalmente <b>estado</b>, ou conecte um
        gateway ao vivo (WebSocket com JSON no mesmo formato). OPC-UA e MQTT chegam por um gateway (ex.: Node-RED) que publica nesse WebSocket. Desvios acima de 10% ficam em destaque.
      </p>
      <div className="row-btns">
        <button className="btn" onClick={() => fileRef.current?.click()}>Importar dados reais</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onFile} />
        <input className="url" placeholder="wss://gateway.fabrica/linha" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Endereço do gateway ao vivo" />
        {ws ? <button className="btn" onClick={() => ws.close()}>Desconectar</button> : <button className="btn" onClick={connect} disabled={!/^wss?:\/\//.test(url)}>Conectar ao vivo</button>}
      </div>
      {(status || source) && <p className="hint">{status || `Fonte: ${source}`}</p>}
      <table className="grid-table section">
        <thead><tr><th>Posto</th><th>Produzidas sim.</th><th>Produzidas real</th><th>Desvio</th><th>Ciclo sim. (s)</th><th>Ciclo real (s)</th><th>Desvio</th></tr></thead>
        <tbody>
          {rows.slice(0, 80).map(({ k, d, r, simCt }) => {
            const dp = r?.produced !== undefined && k.processed > 0 ? r.produced / k.processed - 1 : undefined;
            const dc = r?.cycle !== undefined && simCt > 0 ? r.cycle / simCt - 1 : undefined;
            return (
              <tr key={k.id}>
                <td><button className="link" onClick={() => useStore.getState().setDetail(k.id)}>{d.name}</button></td>
                <td>{k.processed}</td>
                <td>{r?.produced ?? '–'}</td>
                <td className={flag(dp)}>{dp === undefined ? '–' : pct(dp, 1)}</td>
                <td>{fmt(simCt, 1)}</td>
                <td>{r?.cycle !== undefined ? fmt(r.cycle, 1) : '–'}</td>
                <td className={flag(dc)}>{dc === undefined ? '–' : pct(dc, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
