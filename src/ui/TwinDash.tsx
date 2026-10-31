// Rodapé do Monitoramento real: indicadores e gráficos de barras para bater o olho e entender a linha.
// 1) Produção por posto × meta até agora  2) Ciclo por posto × takt  3) Produção por hora × meta
// 4) OEE por posto  5) Andon: paradas com motivo e o Pareto das perdas. Mais a previsão de fim de turno.
// Tudo vem dos scans (nada é simulado). Também abre o histórico das coletas para o estudo depois.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { scansToEvents } from '../engine/scans';
import { download } from '../io/exporter';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Modal } from './Modal';
import { loadRealEvents } from './realLoad';
import { fmt, fmtTime } from './theme';
import { listHistory, loadAndon, loadHistory, saveAndon, twinCmd, type HistItem, type TwinState } from './Twin';
import { ANDON_MOTIVOS, forecast, oee, pareto, recentRate, type AndonStop } from '../engine/twinKpi';
import type { NodeDef } from '../engine/types';

const STATION = (t: string) => t === 'machine' || t === 'inspection' || t === 'rework';

interface Bar {
  label: string;
  value: number;
  ref?: number;
  tone: 'ok' | 'good' | 'warn' | 'bad' | 'mute';
  text?: string;
}

/** Barras verticais simples em SVG, com linha de referência (meta/takt) opcional. */
function Bars({ bars, line, lineLabel, unit, pair }: { bars: Bar[]; line?: number; lineLabel?: string; unit: string; pair?: boolean }) {
  const W = Math.max(320, bars.length * (pair ? 56 : 44) + 40);
  const H = 170;
  const L = 34;
  const B = 140;
  const max = Math.max(1, line ?? 0, ...bars.map((b) => Math.max(b.value, b.ref ?? 0))) * 1.15;
  const y = (v: number) => B - (v / max) * (B - 14);
  const step = (W - L - 6) / Math.max(1, bars.length);
  const bw = Math.min(pair ? 18 : 26, step * (pair ? 0.36 : 0.6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Gráfico em ${unit}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - 4} y1={y(max * f / 1.15)} y2={y(max * f / 1.15)} className="pc-grid" />
          <text x={L - 4} y={y(max * f / 1.15) + 3} textAnchor="end" className="pc-label">{fmt((max * f) / 1.15, 0)}</text>
        </g>
      ))}
      {bars.map((b, i) => {
        const cx = L + step * (i + 0.5);
        const x = pair ? cx - bw - 1 : cx - bw / 2;
        return (
          <g key={b.label + i}>
            {pair && b.ref !== undefined && <rect x={cx + 1} y={y(b.ref)} width={bw} height={B - y(b.ref)} rx={2} className="tb tb-ref"><title>{`Meta ${fmt(b.ref, 0)}`}</title></rect>}
            <rect x={x} y={y(b.value)} width={bw} height={Math.max(0, B - y(b.value))} rx={2} className={`tb tb-${b.tone}`}>
              <title>{`${b.label}: ${b.text ?? fmt(b.value, 1)} ${unit}`}</title>
            </rect>
            <text x={pair ? x + bw / 2 : cx} y={y(b.value) - 4} textAnchor="middle" className={`pc-label tb-v tb-v-${b.tone}`}>{b.text ?? fmt(b.value, b.value < 10 ? 1 : 0)}</text>
            <text x={cx} y={B + 13} textAnchor="middle" className="pc-label">{b.label}</text>
          </g>
        );
      })}
      {line !== undefined && line > 0 && (
        <>
          <line x1={L} x2={W - 4} y1={y(line)} y2={y(line)} className="pc-takt" />
          <text x={W - 6} y={y(line) - 4} textAnchor="end" className="pc-label">{lineLabel}</text>
        </>
      )}
    </svg>
  );
}

/** Posto parado: em pane ou sem scan há mais de 3 ciclos (já escaneou alguma vez). */
function isStopped(twin: TwinState, n: NodeDef): boolean {
  const p = twin.postos[n.id];
  if (!p) return false;
  if (p.state === 'down') return true;
  if (p.ult === undefined) return false;
  return twin.relogio - p.ult > 3 * (p.ciclo || n.cycleTime || 30);
}

const short = (n: string) => n.replace(/^Posto\s*/i, 'P').replace(/\s*·.*$/, '');

export function TwinDash() {
  const twin = useStore((s) => s.twin);
  const model = useStore((s) => s.model);
  const events = useStore((s) => s.realEvents);
  const [hist, setHist] = useState(false);
  const takt = model.settings.takt;
  const stations = model.nodes.filter((n) => STATION(n.type) && twin?.postos[n.id]);
  const lastIds = new Set(model.links.filter((l) => model.nodes.find((n) => n.id === l.to)?.type === 'sink').map((l) => l.from));
  const lastName = model.nodes.find((n) => lastIds.has(n.id))?.name;

  // produção por hora: scans do último posto agrupados pela hora do turno
  const hourly = useMemo(() => {
    if (!lastName) return [];
    const by = new Map<number, number>();
    for (const e of events) if (e.posto === lastName) by.set(Math.floor(e.fim / 3600), (by.get(Math.floor(e.fim / 3600)) ?? 0) + 1);
    const hs = [...by.keys()];
    if (!hs.length) return [];
    const out: { h: number; n: number }[] = [];
    for (let h = Math.min(...hs); h <= Math.max(...hs); h++) out.push({ h, n: by.get(h) ?? 0 });
    return out.slice(-12);
  }, [events, lastName]);

  const meta = takt > 0 ? 3600 / takt : 0;
  const metaNow = twin && takt > 0 ? twin.relogio / takt : 0;
  const ader = metaNow > 0 && twin ? (twin.pecas / metaNow) * 100 : 0;
  const worst = stations.reduce<{ name: string; load: number } | null>((acc, n) => {
    const c = twin?.postos[n.id]?.ciclo ?? 0;
    const load = c / Math.max(1, n.capacity);
    return !acc || load > acc.load ? { name: n.name, load } : acc;
  }, null);
  const paradas = stations.reduce((a, n) => a + (twin?.postos[n.id]?.fora ?? 0), 0);
  const paradoMin = stations.reduce((a, n) => a + (twin?.postos[n.id]?.paradoMin ?? 0), 0);

  // OEE por posto: ciclo padrão do bloco ÷ capacidade; o da linha é o do posto que limita (maior ciclo padrão)
  const ideal = (n: NodeDef) => (n.cycleTime || 0) / Math.max(1, n.capacity);
  const oees = stations.map((n) => ({ n, o: oee({ relogio: twin?.relogio ?? 0, feitas: twin?.postos[n.id]?.feitas ?? 0, ideal: ideal(n), paradoMin: twin?.postos[n.id]?.paradoMin ?? 0 }) }));
  const limit = oees.reduce<(typeof oees)[number] | null>((a, x) => (!a || ideal(x.n) > ideal(a.n) ? x : a), null);
  const lastHours = useMemo(() => (lastName ? events.filter((e) => e.posto === lastName).map((e) => e.fim) : []), [events, lastName]);
  const prev = twin ? forecast({ pecas: twin.pecas, relogio: twin.relogio, duracao: model.settings.duration, takt, recente: recentRate(lastHours, twin.relogio) }) : null;

  // andon: paradas marcadas pelo operador (ficam no histórico da sessão)
  const [andon, setAndon] = useState<AndonStop[]>([]);
  const sessao = twin?.sessao ?? '';
  useEffect(() => {
    setAndon([]);
    if (sessao) void loadAndon(sessao).then(setAndon);
  }, [sessao]);
  const putAndon = (list: AndonStop[]) => {
    setAndon(list);
    if (sessao) void saveAndon(sessao, list);
  };
  // posto parado = sem scan há mais de 3 ciclos (ou em pane); fecha a parada aberta quando ele volta a escanear
  const stopped = twin ? stations.filter((n) => isStopped(twin, n)) : [];
  const andonRef = useRef(andon);
  andonRef.current = andon;
  useEffect(() => {
    if (!twin) return;
    const open = andonRef.current.filter((a) => a.fim === undefined);
    if (!open.length) return;
    let changed = false;
    const list = andonRef.current.map((a) => {
      const n = stations.find((x) => x.name === a.posto);
      if (a.fim !== undefined || !n || isStopped(twin, n)) return a;
      changed = true;
      return { ...a, fim: Math.max(a.inicio, twin.postos[n.id]?.ult ?? twin.relogio) };
    });
    if (changed) putAndon(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twin]);
  const par = twin ? pareto(andon, twin.relogio, paradoMin) : [];

  return (
    <section className="dash twin-dash" aria-label="Monitoramento real">
      <div className="twin-head">
        <p className="label">📡 Monitoramento real · tudo vem dos scans dos postos (nada é simulado)</p>
        {twin && (
          <span className="twin-src">
            <i className="study-live" /> {twin.fonte} · {twin.rodando ? 'coletando' : 'parada'} · {fmtTime(twin.relogio)} de turno · <span className={Date.now() - twin.em > 10000 ? 'bad' : ''}>atraso {fmt(Math.max(0, (Date.now() - twin.em) / 1000), 0)} s</span>
          </span>
        )}
        <span className="row-btns">
          <button className="btn" onClick={() => twinCmd({ cmd: 'refresh' })} title="Atualizar: reconecta com a linha (use se os números pararem ou algo ficar estranho)">🔄 Atualizar</button>
          <button
            className="btn"
            disabled={!twin}
            onClick={() => {
              if (confirm('Zerar o turno? A coleta recomeça do zero numa sessão nova; a atual continua guardada no 📼 Histórico.')) twinCmd({ cmd: 'reset' });
            }}
            title="Começa um turno novo do zero (a coleta atual fica no histórico)"
          >
            ⟲ Zerar turno
          </button>
          <button className="btn" onClick={() => setHist(true)} title="Coletas gravadas: estudar, baixar em Excel ou retomar o monitoramento de onde parou (queda de energia)">📼 Histórico · ⟳ Retomar</button>
        </span>
      </div>
      {!twin ? (
        <p className="hint">Esperando a linha. Em 📡 Monitoramento real, ligue a linha virtual (servidor de teste), siga a linha física ou ligue a API.</p>
      ) : (
        <>
          <div className="twin-kpis">
            <Kpi k="Produção real" v={`${twin.pecas} pç`} u={`${fmtTime(twin.relogio)} de turno`} />
            <Kpi k="Meta até agora" v={metaNow ? `${fmt(metaNow, 0)} pç` : '–'} u={meta ? `${fmt(meta, 0)} pç/h` : 'sem takt'} />
            <Kpi k="Aderência" v={ader ? `${fmt(ader, 1)}%` : '–'} tone={ader >= 95 ? 'good' : ader >= 85 ? 'warn' : 'bad'} />
            <Kpi k="UPH real" v={fmt(twin.uph, 1)} tone={meta && twin.uph >= meta ? 'good' : 'bad'} u={meta ? `meta ${fmt(meta, 0)}` : ''} />
            <Kpi k="Gargalo real" v={worst?.name ?? '–'} tone="bad" u={worst && takt ? `${fmt((worst.load / takt) * 100, 0)}% do takt` : ''} />
            <Kpi k="Paradas" v={`${paradas}`} tone={paradas ? 'warn' : 'good'} u={`${fmt(paradoMin, 1)} min perdidos (soma dos postos)`} />
            <Kpi
              k="OEE da linha"
              v={limit ? `${fmt(limit.o.oee * 100, 0)}%` : '–'}
              tone={!limit ? undefined : limit.o.oee >= 0.85 ? 'good' : limit.o.oee >= 0.65 ? 'warn' : 'bad'}
              u={limit ? `D ${fmt(limit.o.a * 100, 0)} × P ${fmt(limit.o.p * 100, 0)} × Q ${fmt(limit.o.q * 100, 0)} · ${short(limit.n.name)}` : ''}
            />
            <Kpi
              k="Previsão fim de turno"
              v={prev && twin.relogio > 60 ? `${fmt(prev.fim, 0)} pç` : '–'}
              tone={!prev || !prev.meta ? undefined : prev.fim >= prev.meta ? 'good' : prev.fim >= prev.meta * 0.9 ? 'warn' : 'bad'}
              u={prev && prev.meta ? (prev.fim >= prev.meta ? `no ritmo de ${fmt(prev.ritmo, 0)}/h bate a meta de ${fmt(prev.meta, 0)}` : `meta ${fmt(prev.meta, 0)} · precisa de ${fmt(prev.precisa, 0)}/h`) : 'sem takt'}
            />
          </div>
          <div className="twin-charts">
            <div className="twin-chart">
              <p className="label">1 · Produção por posto × meta até agora</p>
              <Bars
                pair
                unit="peças"
                bars={stations.map((n) => {
                  const v = twin.postos[n.id].feitas;
                  const r = metaNow;
                  return { label: short(n.name), value: v, ref: r || undefined, tone: !r ? 'ok' : v >= r ? 'good' : v >= r * 0.9 ? 'ok' : 'bad' };
                })}
              />
              <p className="legend"><i className="tb-good" /> acima da meta <i className="tb-ok" /> até 10% abaixo <i className="tb-bad" /> abaixo <i className="tb-ref" /> meta</p>
            </div>
            <div className="twin-chart">
              <p className="label">2 · Ciclo por posto (scans) × takt</p>
              <Bars
                unit="s"
                line={takt || undefined}
                lineLabel={`takt ${fmt(takt, 1)} s`}
                bars={stations.map((n) => {
                  const c = (twin.postos[n.id].ciclo ?? 0) / Math.max(1, n.capacity);
                  const f = takt ? c / takt : 0;
                  return { label: short(n.name), value: c, tone: !c ? 'mute' : f > 1 ? 'bad' : f > 0.9 ? 'warn' : 'ok' };
                })}
              />
              <p className="legend"><i className="tb-ok" /> folga <i className="tb-warn" /> perto do limite (90–100%) <i className="tb-bad" /> acima do takt (gargalo)</p>
            </div>
            <div className="twin-chart">
              <p className="label">3 · Produção por hora × meta</p>
              {hourly.length ? (
                <Bars
                  unit="peças"
                  line={meta || undefined}
                  lineLabel={`meta ${fmt(meta, 0)}/h`}
                  bars={hourly.map((x, i) => {
                    const partial = i === hourly.length - 1;
                    return { label: `${x.h + 1}ª h`, value: x.n, tone: partial ? 'mute' : !meta ? 'ok' : x.n >= meta ? 'good' : x.n >= meta * 0.9 ? 'warn' : 'bad' };
                  })}
                />
              ) : (
                <p className="hint">Aparece quando o último posto começar a escanear.</p>
              )}
              <p className="legend"><i className="tb-good" /> bateu a meta <i className="tb-warn" /> até 10% abaixo <i className="tb-bad" /> abaixo <i className="tb-mute" /> hora em andamento</p>
            </div>
            <div className="twin-chart">
              <p className="label">4 · OEE por posto (disponibilidade × performance × qualidade)</p>
              <Bars
                unit="%"
                line={85}
                lineLabel="classe mundial 85%"
                bars={oees.map(({ n, o }) => ({ label: short(n.name), value: o.oee * 100, text: `${fmt(o.oee * 100, 0)}`, tone: o.oee >= 0.85 ? 'good' : o.oee >= 0.65 ? 'warn' : 'bad' }))}
              />
              <p className="legend"><i className="tb-good" /> ≥ 85% <i className="tb-warn" /> 65–85% <i className="tb-bad" /> abaixo de 65% · qualidade 100% enquanto não houver dado de refugo</p>
            </div>
            <div className="twin-chart andon">
              <p className="label">5 · 🚨 Andon · Pareto das perdas</p>
              {stopped.length ? (
                <ul className="andon-open">
                  {stopped.map((n) => {
                    const p = twin.postos[n.id];
                    const open = andon.find((a) => a.posto === n.name && a.fim === undefined);
                    const since = p?.ult ?? 0;
                    return (
                      <li key={n.id}>
                        <i className="andon-led" aria-hidden />
                        <b>{n.name}</b> parado há {fmt(Math.max(0, twin.relogio - since) / 60, 0)} min
                        <select
                          aria-label={`Motivo da parada de ${n.name}`}
                          value={open?.motivo ?? ''}
                          onChange={(e) => {
                            const motivo = e.target.value;
                            if (!motivo) return;
                            putAndon(open ? andon.map((a) => (a === open ? { ...a, motivo } : a)) : [...andon, { id: `a${Date.now().toString(36)}`, posto: n.name, motivo, inicio: since }]);
                          }}
                        >
                          <option value="">Qual o motivo?</option>
                          {ANDON_MOTIVOS.map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="hint">Nenhum posto parado agora. Quando um posto ficar sem escanear, ele aparece aqui para marcar o motivo.</p>
              )}
              {par.length > 0 ? (
                <div className="pareto" role="table" aria-label="Pareto das perdas">
                  {par.map((r) => (
                    <div key={r.motivo} className="pareto-row" role="row">
                      <span role="cell">{r.motivo}</span>
                      <span role="cell" className="pareto-bar"><i style={{ width: `${(r.min / par[0].min) * 100}%` }} /></span>
                      <span role="cell">{fmt(r.min, 1)} min</span>
                      <span role="cell" className="muted">{fmt(r.acum, 0)}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="hint">Sem perdas ainda.</p>
              )}
            </div>
          </div>
        </>
      )}
      {hist && <HistoryModal onClose={() => setHist(false)} />}
    </section>
  );
}

function Kpi({ k, v, u, tone }: { k: string; v: string; u?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={`tkpi${tone ? ` t-${tone}` : ''}`}>
      <span>{k}</span>
      <b>{v}</b>
      {u && <small>{u}</small>}
    </div>
  );
}

/** Histórico das coletas: abre uma sessão para o estudo (reprodução histórica, curvas, dados reais) ou baixa em Excel. */
function HistoryModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<HistItem[] | null | undefined>(undefined);
  const [busy, setBusy] = useState('');
  useMemo(() => {
    void listHistory()
      .then(setItems)
      .catch(() => setItems(null));
  }, []);
  const open = async (h: HistItem, excel: boolean) => {
    setBusy(h.sessao);
    const d = await loadHistory(h.sessao).catch(() => null);
    setBusy('');
    if (!d) return;
    if (excel) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.scans.map((x) => ({ posto: x.posto, serie: x.serie, hora_s: x.hora }))), 'Scans');
      const ev = scansToEvents(d.scans);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ev.map((e) => ({ posto: e.posto, serie: e.serie, inicio_s: e.inicio, fim_s: e.fim, ciclo_s: Math.round((e.fim - e.inicio) * 10) / 10 }))), 'Ciclos');
      void download(`coleta-${h.nome.replace(/\W+/g, '-')}-${new Date(h.inicio).toISOString().slice(0, 16).replace(/\D/g, '')}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return;
    }
    const st = useStore.getState();
    if (d.model) st.setModel({ ...d.model, settings: { ...d.model.settings, study: 'simulacao' } }, `Coleta de ${new Date(h.inicio).toLocaleString('pt-BR')} aberta para estudo.`);
    loadRealEvents(scansToEvents(d.scans), `histórico: ${h.nome}, ${new Date(h.inicio).toLocaleString('pt-BR')}`);
    st.setMessage(`Coleta aberta: ${d.scans.length} scans. Agora use ⏪ Reprodução histórica (o modelo roda com os tempos reais) ou Análises → Dados reais (curvas, desvio por posto, montar a linha).`);
    onClose();
  };
  return (
    <Modal title="📼 Histórico das coletas" sub="Cada vez que a linha transmite, a coleta fica guardada para o estudo da manufatura." onClose={onClose}>
      <HowTo
        title="Estudar o que rodou"
        why="O monitoramento mostra o agora; o histórico guarda os scans de cada turno para estudar depois, com calma."
        steps={['Escolha a coleta (data, linha e fonte).', 'Abrir para estudo: carrega o modelo e os scans. Depois use ⏪ Reprodução histórica ou Análises → Dados reais (curva normal por posto, desvio, montar a linha).', 'Excel: baixa os scans e os ciclos de cada posto para trabalhar na planilha.', '⟳ Retomar daqui: acabou a energia ou fechou a página? Retoma o monitoramento de onde parou, somando os scans gravados com os novos.']}
      />
      {items === undefined && <p className="hint">Carregando…</p>}
      {items === null && <p className="hint">Não consegui ler o histórico.</p>}
      {items && !items.length && <p className="hint">Nenhuma coleta gravada ainda. Ligue a linha virtual, a linha física ou a API no 📡 Monitoramento real: a coleta é gravada sozinha.</p>}
      {items && items.length > 0 && (
        <table className="grid-table">
          <thead><tr><th>Início</th><th>Linha</th><th>Fonte</th><th>Turno rodado</th><th>Scans</th><th /></tr></thead>
          <tbody>
            {items.map((h) => (
              <tr key={h.sessao}>
                <td>{new Date(h.inicio).toLocaleString('pt-BR')}</td>
                <td>{h.nome}</td>
                <td>{h.fonte}</td>
                <td>{fmtTime(h.relogio)}</td>
                <td>{h.scans}</td>
                <td className="row-btns">
                  <button className="btn primary" disabled={!!busy} onClick={() => void open(h, false)}>Abrir para estudo</button>
                  <button className="btn" disabled={!!busy} onClick={() => void open(h, true)}>Excel</button>
                  {h.retomar && h.retomar.kind !== 'gemeo' && (
                    <button
                      className="btn"
                      title="Continua o monitoramento a partir desta coleta (ex.: depois de uma queda de energia): os scans antigos somam com os novos"
                      onClick={() => {
                        twinCmd({ cmd: 'resume', sessao: h.sessao });
                        onClose();
                      }}
                    >
                      ⟳ Retomar daqui
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
