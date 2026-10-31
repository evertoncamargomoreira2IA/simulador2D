// Dados reais da operação: leituras de cada posto (API do computador do posto, arquivo ou a
// linha simulada no lugar da real), estudo de tempos com descarte de discrepantes, número
// mínimo de amostras, ritmo e tolerâncias, e alerta contra o SOE.

import { Fragment, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { studyEvents, STUDY_DEFAULTS, type StationStudy, type Stat, type StudyOptions } from '../engine/timeStudy';
import { download } from '../io/exporter';
import { eventsFromRows, eventsToRows, fetchEvents, simulatedFeed, FEED_DEFAULTS } from '../io/realFeed';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Kpi } from './Modal';
import { fmt, pct } from './theme';
import { curveRows, StationCurves } from './StationCurves';
import { effectiveTakt } from '../engine/balance';
import { DiscoverLine } from './DiscoverLine';
import { loadRealEvents } from './realLoad';
import { discoveryDemoModel } from '../model/builder';

export function RealData() {
  const model = useStore((s) => s.model);
  const events = useStore((s) => s.realEvents);
  const source = useStore((s) => s.realEventsSource);
  const [o, setO] = useState<StudyOptions>(STUDY_DEFAULTS);
  const [hours, setHours] = useState(FEED_DEFAULTS.hours);
  const [drift, setDrift] = useState(FEED_DEFAULTS.drift);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => studyEvents(events, model, o), [events, model, o]);
  const [view, setView] = useState<'tabela' | 'curvas'>('tabela');
  const curves = useMemo(() => (view === 'curvas' ? curveRows(rows, events, model, o.sigma, o.alertPct, effectiveTakt(model)) : []), [view, rows, events, model, o]);
  const alerts = rows.filter((r) => r.alert).length;
  const discarded = rows.reduce((a, r) => a + r.out.length, 0);
  const short = rows.filter((r) => r.kept < r.needed).length;

  /** Novas leituras: guarda e alimenta a aba Real × simulado (produzidas e ciclo padrão por posto). */
  function load(ev: typeof events, src: string) {
    const n = loadRealEvents(ev, src, o);
    setStatus(`${ev.length} leituras de ${n} postos (${src}).`);
  }

  /** Leituras de uma linha que o simulador não conhece (exemplo para montar a linha a partir delas). */
  function fromDemo() {
    setBusy(true);
    setStatus('Gerando 4 h de leituras da linha de exemplo…');
    setTimeout(() => {
      load(simulatedFeed(discoveryDemoModel(), { ...FEED_DEFAULTS, hours: 4, drift: 0 }), 'exemplo: linha nova, 4 h');
      setBusy(false);
    }, 30);
  }

  function fromSim() {
    setBusy(true);
    setStatus('Rodando a linha simulada…');
    setTimeout(() => {
      try {
        load(simulatedFeed(useStore.getState().model, { ...FEED_DEFAULTS, hours, drift }), `linha simulada, ${hours} h, até ±${Math.round(drift * 100)}% do SOE`);
      } catch (e) {
        setStatus(`Não deu para gerar: ${(e as Error).message}`);
      }
      setBusy(false);
    }, 30);
  }

  async function fromApi() {
    setBusy(true);
    setStatus('Buscando na API…');
    try {
      const ev = await fetchEvents(url);
      if (!ev.length) setStatus('A API respondeu, mas sem leituras no formato esperado (posto, serie, inicio, fim).');
      else load(ev, `API ${url}`);
    } catch (e) {
      setStatus(`Não conectou (${(e as Error).message}). Confira o endereço e se a API libera acesso a partir do navegador (CORS).`);
    }
    setBusy(false);
  }

  async function fromFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const ev = eventsFromRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]));
      if (!ev.length) setStatus(`${f.name}: nenhuma leitura. Colunas esperadas: posto, serie, inicio, fim (ou duracao), operacao, turno.`);
      else load(ev, `arquivo ${f.name}`);
    } catch (err) {
      setStatus(`Não foi possível ler ${f.name}: ${(err as Error).message}`);
    }
  }

  function exportEvents() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eventsToRows(events)), 'Leituras');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        rows.flatMap((r) => [studyRow(r.name, '', r), ...r.ops.map((op) => studyRow(r.name, op.name, op))]),
      ),
      'Estudo',
    );
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    void download('leituras_e_estudo.xlsx', out, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  function apply(list: StationStudy[]) {
    const st = useStore.getState();
    const ok = list.filter((r) => r.id && r.kept > 0);
    if (!ok.length) return;
    const ids = new Map(ok.map((r) => [r.id!, r]));
    st.setModel(
      {
        ...st.model,
        nodes: st.model.nodes.map((n) => {
          const r = ids.get(n.id);
          return r ? { ...n, cycleTime: Math.round(r.standard * 10) / 10, cv: r.mean > 0 ? Math.round((r.sd / r.mean) * 100) / 100 : n.cv, cycleFromOps: false } : n;
        }),
      },
      ok.length === 1 ? `${ok[0].name}: tempo e variação reais aplicados.` : `${ok.length} postos com tempo e variação reais.`,
    );
    if (st.model.settings.studyMode === 'elements') setStatus('Atenção: o estudo está por elementos; para usar o tempo real, mude o estudo para tempo de ciclo do posto.');
  }

  const num = (k: keyof StudyOptions, v: string, scale = 1) => setO({ ...o, [k]: Number(v.replace(',', '.')) / scale });

  return (
    <>
      <HowTo
        title="Dados reais: o tempo que a linha está fazendo de verdade"
        why="Cada posto manda uma leitura por peça: em que posto, número de série, início e fim (e a operação, se houver). Daqui sai o ciclo real por posto e por operação, já sem os valores fora da curva, comparado com o SOE."
        steps={[
          'Escolha a fonte: a API dos computadores dos postos, um arquivo exportado ou a linha simulada (enquanto a API não existe). Na simulada, cada posto sai um pouco acima ou abaixo do SOE, como na linha real, e 3% das peças têm uma parada curta.',
          'Ajuste a regra de descarte (padrão: fora de média ± 2 desvios), o fator de ritmo e as tolerâncias.',
          'Leia a tabela: amostras usadas, descartadas, mínimo de amostras, tempo padrão e desvio contra o SOE. Vermelho = desvio acima do limite.',
          'Clique no posto para ver as operações e os valores descartados.',
          'Use "Aplicar no modelo" para simular com o tempo e a variação reais. A aba Real × simulado já recebe esses números.',
        ]}
        tip="Nenhum dado de pessoa é guardado: só posto, turno e número de série da peça (LGPD). Colunas com nome ou matrícula são ignoradas na leitura."
      />

      <p className="label section">Fonte das leituras</p>
      <div className="row-btns">
        <label className="field inline">
          <span>Linha simulada</span>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={busy} aria-label="Horas de operação">
            {[1, 2, 4, 8].map((h) => (
              <option key={h} value={h}>{h} h</option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Diferença do SOE</span>
          <select value={drift} onChange={(e) => setDrift(Number(e.target.value))} disabled={busy} aria-label="Diferença da linha simulada contra o SOE">
            {[0, 0.1, 0.15, 0.25].map((d) => (
              <option key={d} value={d}>{d ? `até ±${Math.round(d * 100)}%` : 'igual ao SOE'}</option>
            ))}
          </select>
        </label>
        <button className="btn primary" onClick={fromSim} disabled={busy}>▶ Gerar leituras</button>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>Importar leituras</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={fromFile} />
        {events.length > 0 && <button className="btn" onClick={exportEvents}>Baixar leituras e estudo</button>}
      </div>
      <div className="row-btns section">
        <input className="url" placeholder="https://api.fabrica/linha/leituras" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Endereço da API dos postos" />
        <button className="btn" onClick={fromApi} disabled={busy || !/^https?:\/\//.test(url)}>Buscar da API</button>
        <span className="muted">GET que devolve uma lista JSON: posto, serie, inicio, fim, operacao, turno.</span>
      </div>
      <div className="row-btns">
        <button className="btn" onClick={fromDemo} disabled={busy} title="Leituras de uma linha que não está no simulador, como viriam da API: use para testar Montar linha a partir das leituras">Exemplo: leituras de uma linha nova</button>
      </div>
      {(status || source) && <p className="hint">{status || `Fonte: ${source}`}</p>}
      <DiscoverLine events={events} source={source} />

      <p className="label section">Regras do estudo</p>
      <div className="row-btns">
        <label className="field inline">
          <span>Descartar fora de ±</span>
          <select value={o.sigma} onChange={(e) => num('sigma', e.target.value)}>
            <option value={0}>não descartar</option>
            {[1.5, 2, 2.5, 3].map((v) => (
              <option key={v} value={v}>{fmt(v, 1)} desvios</option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Ritmo (%)</span>
          <input type="number" min={50} max={150} step={5} value={Math.round(o.rating * 100)} onChange={(e) => num('rating', e.target.value, 100)} />
        </label>
        <label className="field inline">
          <span>Tolerâncias (%)</span>
          <input type="number" min={0} max={50} step={1} value={Math.round(o.allowance * 100)} onChange={(e) => num('allowance', e.target.value, 100)} />
        </label>
        <label className="field inline">
          <span>Alerta acima de (%)</span>
          <input type="number" min={1} max={100} step={1} value={Math.round(o.alertPct * 100)} onChange={(e) => num('alertPct', e.target.value, 100)} />
        </label>
        <label className="field inline">
          <span>Erro (%)</span>
          <input type="number" min={1} max={20} step={1} value={Math.round(o.errorPct * 100)} onChange={(e) => num('errorPct', e.target.value, 100)} />
        </label>
        <label className="field inline">
          <span>Confiança</span>
          <select value={o.confidence} onChange={(e) => setO({ ...o, confidence: Number(e.target.value) as StudyOptions['confidence'] })}>
            <option value={0.9}>90%</option>
            <option value={0.95}>95%</option>
            <option value={0.99}>99%</option>
          </select>
        </label>
      </div>

      {rows.length > 0 && (
        <>
          <div className="tiles section">
            <Kpi k="Leituras" v={fmt(events.length, 0)} u={`${rows.length} postos`} />
            <Kpi k="Descartadas" v={fmt(discarded, 0)} u={o.sigma ? `fora de ± ${fmt(o.sigma, 1)} desvios` : 'descarte desligado'} />
            <Kpi k="Postos em alerta" v={fmt(alerts, 0)} u={`desvio > ${pct(o.alertPct)} do SOE`} tone={alerts ? 'bad' : undefined} />
            <Kpi k="Amostras insuficientes" v={fmt(short, 0)} u={`erro ${pct(o.errorPct)}, confiança ${pct(o.confidence)}`} tone={short ? 'bad' : undefined} />
          </div>
          <div className="row-btns section">
            <button className="btn" onClick={() => apply(rows)}>Aplicar todos no modelo</button>
            <span className="muted">Troca o tempo de ciclo pelo tempo padrão real e o cv pela variação medida.</span>
          </div>
          <div className="row-btns section" role="group" aria-label="Ver o estudo como">
            <button className={`btn${view === 'tabela' ? ' on' : ''}`} aria-pressed={view === 'tabela'} onClick={() => setView('tabela')}>Tabela</button>
            <button className={`btn${view === 'curvas' ? ' on' : ''}`} aria-pressed={view === 'curvas'} onClick={() => setView('curvas')}>📈 Curva normal por posto</button>
            <span className="muted">Média, desvio em segundos e em %, faixas de 68% e 95% das peças e confiabilidade de cada posto.</span>
          </div>
          {view === 'curvas' && <StationCurves rows={curves} />}
          {view === 'tabela' && <table className="grid-table section">
            <thead>
              <tr>
                <th>Posto / operação</th><th>Usadas</th><th>Descartadas</th><th>Média (s)</th><th>Desvio (s)</th><th>Mín. amostras</th><th>Tempo padrão (s)</th><th>SOE (s)</th><th>Desvio</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.name}>
                  <tr>
                    <td>
                      <button className="link" aria-expanded={open === r.name} onClick={() => setOpen(open === r.name ? null : r.name)}>
                        {open === r.name ? '▾' : '▸'} {r.name}
                      </button>
                      {!r.id && <small className="muted"> (não está no modelo)</small>}
                    </td>
                    <StatCells s={r} />
                    <td>{r.id && r.kept > 0 && <button className="btn" onClick={() => apply([r])}>Aplicar no modelo</button>}</td>
                  </tr>
                  {open === r.name &&
                    r.ops.map((op) => (
                      <tr key={op.name} className="sub">
                        <td style={{ paddingLeft: 22 }}>{op.name}</td>
                        <StatCells s={op} />
                        <td />
                      </tr>
                    ))}
                  {open === r.name && (
                    <tr className="sub">
                      <td colSpan={10} className="muted">
                        {r.out.length ? `Descartadas (s): ${r.out.map((x) => fmt(x, 1)).join(', ')}` : 'Nenhuma leitura descartada neste posto.'}
                        {r.ops.length === 0 && ' Sem leituras por operação: o posto mandou só o ciclo inteiro.'}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>}
        </>
      )}
      {!rows.length && <p className="hint section">Sem leituras ainda. Comece por ▶ Gerar leituras para ver o estudo com a linha simulada.</p>}
    </>
  );
}

function StatCells({ s }: { s: Stat }) {
  return (
    <>
      <td>{s.kept}/{s.n}</td>
      <td>{s.out.length || '–'}</td>
      <td>{fmt(s.mean, 1)}</td>
      <td>{fmt(s.sd, 1)}</td>
      <td className={s.kept < s.needed ? 'bad' : 'good'} title={s.kept < s.needed ? `Faltam ${s.needed - s.kept} leituras` : 'Amostras suficientes'}>{s.needed}</td>
      <td>{fmt(s.standard, 1)}</td>
      <td>{s.plan > 0 ? fmt(s.plan, 1) : '–'}</td>
      <td className={s.dev === null ? '' : s.alert ? 'bad' : 'good'}>{s.dev === null ? '–' : `${s.dev > 0 ? '+' : ''}${pct(s.dev, 1)}`}</td>
    </>
  );
}

function studyRow(posto: string, operacao: string, s: Stat) {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    posto,
    operacao,
    leituras: s.n,
    usadas: s.kept,
    descartadas: s.out.length,
    media_s: r1(s.mean),
    desvio_s: r1(s.sd),
    min_amostras: s.needed,
    tempo_normal_s: r1(s.normal),
    tempo_padrao_s: r1(s.standard),
    soe_s: r1(s.plan),
    desvio_soe: s.dev === null ? '' : Math.round(s.dev * 1000) / 10,
    alerta: s.alert ? 'sim' : '',
  };
}
