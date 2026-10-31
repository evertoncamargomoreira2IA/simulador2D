// Os 3 tipos de estudo, sempre visíveis na barra: Simulação (e se?), Reprodução histórica (o que aconteceu?)
// e Monitoramento real (o que está acontecendo agora?).

import { useEffect, useState } from 'react';
import { replayModel, simulationModel, STUDY_LABEL, STUDY_WHY } from '../engine/replay';
import type { StudyKind } from '../engine/types';
import { fetchEvents } from '../io/realFeed';
import type { RealEvent } from '../engine/timeStudy';
import { prevStations, followTwin, listHistory, twinCmd, type HistItem, loadHistory, saveHistory, startVirtualLine, stopVirtualLine, type TwinCmd, type TwinState } from './Twin';
import { carryOver, scansToEvents, stationsFromScans, type ScanRead } from '../engine/scans';
import { tenStationModel } from '../model/builder';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Modal } from './Modal';
import { loadRealEvents } from './realLoad';
import { fmt, fmtTime } from './theme';

const ICON: Record<StudyKind, string> = { simulacao: '🎲', historico: '⏪', monitoramento: '📡' };
const URL_KEY = 'sim2d.monitorUrl';
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* navegador sem armazenamento: só não lembra o endereço */
  }
};

type MonCfg = {
  kind: 'api' | 'gemeo' | 'virtual';
  url: string;
  every: number;
  speed?: number;
  /** Sessão gravada no histórico (a API grava a cada leitura). */
  sessao?: string;
  inicio?: number;
  /** Scans de uma coleta retomada: somam com os novos. */
  base?: ScanRead[];
  /** Muda a cada 🔄 Atualizar para reconectar. */
  n?: number;
};

/** Scans a partir das leituras da API (o scan é o fim de cada leitura). */
const eventsToScans = (ev: RealEvent[]): ScanRead[] => ev.map((e) => ({ posto: e.posto, serie: e.serie, hora: e.fim }));
/** Junta scans antigos (retomada) com os novos, sem repetir posto + série. */
function mergeScans(a: ScanRead[], b: ScanRead[]): ScanRead[] {
  const seen = new Set<string>();
  const out: ScanRead[] = [];
  for (const x of [...a, ...b]) {
    const k = `${x.posto}|${x.serie}|${x.hora}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out.sort((x, y) => x.hora - y.hora);
}

/** Estado dos postos a partir dos scans da API (quando a fonte não manda o estado pronto). */
function twinFromScans(scans: ScanRead[], sessao: string): TwinState | null {
  const m = useStore.getState().model;
  if (!scans.length) return null;
  const t0 = Math.min(...scans.map((e) => e.hora));
  const now = Math.max(...scans.map((e) => e.hora));
  const key = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const sc = new Map([...stationsFromScans(scans)].map(([k, v]) => [key(k), v]));
  const wip = new Map([...carryOver(scans, prevStations(m))].map(([k, v]) => [key(k), v]));
  const lastIds = new Set(m.links.filter((l) => m.nodes.find((n) => n.id === l.to)?.type === 'sink').map((l) => l.from));
  const postos: TwinState['postos'] = {};
  let pecas = 0;
  for (const n of m.nodes) {
    if (!(n.type === 'machine' || n.type === 'inspection' || n.type === 'rework')) continue;
    const c = sc.get(key(n.name));
    if (!c) continue;
    // sem scan há mais de 3 ciclos: o posto está parado (ou esperando peça)
    const idle = c.ult !== undefined && now - c.ult > 3 * (c.ciclo || n.cycleTime || 30);
    postos[n.id] = { state: idle ? 'starved' : 'working', fila: 0, fazendo: idle ? 0 : 1, feitas: c.feitas, ciclo: c.ciclo, fora: c.fora, ult: c.ult !== undefined ? c.ult - t0 : undefined, paradoMin: c.paradoMin, wip: wip.get(key(n.name)) ?? 0 };
    if (lastIds.has(n.id)) pecas += c.feitas;
  }
  const span = Math.max(1, now - t0);
  return { sessao, fonte: 'API dos postos', nome: m.name, relogio: span, rodando: true, pecas, uph: (pecas * 3600) / span, em: Date.now(), postos };
}

export function StudyBar({ onPanel }: { onPanel: () => void }) {
  const model = useStore((s) => s.model);
  const study: StudyKind = model.settings.study ?? (model.settings.replay ? 'historico' : 'simulacao');
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [mon, setMon] = useState<MonCfg | null>(null);
  const [last, setLast] = useState<{ at: number; n: number; err?: string; text?: string } | null>(null);

  // monitoramento: só espelha a linha real (API ou linha física), não simula nada
  useEffect(() => {
    if (!mon) return;
    if (mon.kind === 'gemeo' || mon.kind === 'virtual') return followTwin((text) => setLast({ at: Date.now(), n: 0, text }));
    let alive = true;
    const sessao = mon.sessao ?? `api${Date.now().toString(36)}`;
    const inicio = mon.inicio ?? Date.now();
    const tick = async () => {
      try {
        const scans = mergeScans(mon.base ?? [], eventsToScans(await fetchEvents(mon.url)));
        if (!alive) return;
        const t0 = scans.length ? scans[0].hora : 0;
        loadRealEvents(scansToEvents(scans.map((x) => ({ ...x, hora: x.hora - t0 }))), `monitoramento ${mon.url}`);
        const t = twinFromScans(scans, sessao);
        useStore.getState().setTwin(t);
        setLast({ at: Date.now(), n: scans.length });
        // coleta histórica: cada leitura da API fica gravada; dá para retomar depois de uma queda
        if (scans.length) void saveHistory({ sessao, fonte: 'API dos postos', model: useStore.getState().model, inicio, relogio: t?.relogio ?? 0, scans, retomar: { kind: 'api', url: mon.url, every: mon.every } });
      } catch (e) {
        if (alive) setLast({ at: Date.now(), n: 0, err: (e as Error).message });
      }
    };
    void tick();
    const id = setInterval(tick, mon.every * 1000);
    return () => {
      alive = false;
      clearInterval(id);
      useStore.getState().setTwin(null);
    };
  }, [mon]);

  // ordens do painel: 🔄 atualizar, ⟲ zerar turno, ⟳ retomar uma coleta gravada
  useEffect(() => {
    const on = (e: Event) => {
      const c = (e as CustomEvent<TwinCmd>).detail;
      const st = useStore.getState();
      if (c.cmd === 'refresh') {
        setMon((m) => (m ? { ...m, n: (m.n ?? 0) + 1 } : m));
        st.setMessage('🔄 Conexão com a linha atualizada.');
        return;
      }
      if (c.cmd === 'reset') {
        if (!mon) return;
        if (mon.kind === 'virtual') void startVirtualLine(st.model, mon.speed ?? 10);
        setMon({ ...mon, sessao: undefined, inicio: undefined, base: undefined, n: (mon.n ?? 0) + 1 });
        st.setMessage('⟲ Turno zerado: a coleta começa do zero numa sessão nova (a anterior continua no 📼 Histórico).');
        return;
      }
      void loadHistory(c.sessao).then((h) => {
        if (!h || !h.model) return st.setMessage('Não achei essa coleta no histórico.');
        const r = h.retomar ?? { kind: 'virtual' as const, speed: 10 };
        st.setRun('idle');
        st.setModel({ ...h.model, settings: { ...h.model.settings, study: 'monitoramento' } }, `⟳ Retomando a coleta de ${fmtTime(h.relogio)}: ${h.scans.length} scans recuperados do histórico.`);
        if (r.kind === 'virtual') {
          void startVirtualLine(h.model, r.speed ?? 10, { sessao: c.sessao, inicio: h.inicio, relogio: h.relogio, scans: h.scans });
          setMon({ kind: 'virtual', url: '', every: 60, speed: r.speed ?? 10, n: Date.now() });
        } else if (r.kind === 'api' && r.url) {
          setMon({ kind: 'api', url: r.url, every: r.every ?? 60, sessao: c.sessao, inicio: h.inicio, base: h.scans, n: Date.now() });
        } else {
          setMon({ kind: 'gemeo', url: '', every: 60, n: Date.now() });
          st.setMessage('Coleta da linha física: ligue a 🏭 Linha física na outra janela de novo; o histórico anterior continua no 📼.');
        }
      });
    };
    window.addEventListener('twin-cmd', on);
    return () => window.removeEventListener('twin-cmd', on);
  }, [mon]);

  const choose = (k: StudyKind) => {
    const st = useStore.getState();
    const m = st.model;
    if (k !== 'monitoramento') {
      setMon(null);
      stopVirtualLine();
    }
    if (k === 'simulacao') {
      if (m.settings.replay) st.setModel(simulationModel(m), 'Simulação: os tempos voltam a ser sorteados das curvas de cada posto.');
      else st.updateSettings({ study: 'simulacao' });
      st.setMessage(`Simulação. ${STUDY_WHY.simulacao}`);
      return;
    }
    if (k === 'historico') {
      if (!st.realEvents.length) {
        st.setMessage('Reprodução histórica precisa das leituras do período: carregue um arquivo ou a API em Dados reais e clique de novo em ⏪.');
        st.setAnalysis('coleta');
        return;
      }
      const r = replayModel(m.settings.replay ? simulationModel(m) : m, st.realEvents, st.realEventsSource);
      if (!r) {
        st.setMessage('Os nomes dos postos das leituras não batem com os blocos do modelo. Confira os nomes (ou use 🧱 Montar linha a partir das leituras).');
        st.setAnalysis('coleta');
        return;
      }
      st.setModel(
        r.model,
        `Reprodução histórica de ${st.realEventsSource || 'leituras'}: ${r.matched.length} postos com os tempos gravados, ${fmt(r.span / 3600, 1)} h. ` +
          `Real: ${r.realOut} peças (${fmt((r.realOut * 3600) / r.span, 1)}/h). Clique em ⏭ Fim e compare com a Produção.` +
          (r.missing.length ? ` Sem leituras (seguem pela curva): ${r.missing.join(', ')}.` : ''),
      );
      return;
    }
    setMonitorOpen(true);
  };

  return (
    <>
      <div className={`study-bar s-${study}`} role="radiogroup" aria-label="Tipo de estudo">
        {(Object.keys(STUDY_LABEL) as StudyKind[]).map((k) => (
          <button key={k} role="radio" aria-checked={study === k} className={`study-opt${study === k ? ' on' : ''}`} title={`${STUDY_LABEL[k]}: ${STUDY_WHY[k]}`} onClick={() => choose(k)}>
            <span aria-hidden>{ICON[k]}</span> {STUDY_LABEL[k]}
            {k === 'monitoramento' && mon && <i className="study-live" aria-label="ao vivo" />}
          </button>
        ))}
      </div>
      {monitorOpen && (
        <MonitorModal
          running={mon}
          last={last}
          onStart={(cfg) => {
            const st = useStore.getState();
            // monitorar é só espelhar: para a simulação e tira os tempos gravados
            st.setRun('idle');
            st.resetSim();
            if (st.model.settings.replay) st.setModel(simulationModel(st.model, 'monitoramento'), 'Monitoramento real ligado.');
            else st.updateSettings({ study: 'monitoramento' });
            if (cfg.kind === 'virtual') {
              // servidor de teste: roda a linha aberta (ou a de 10 postos, se o trabalho estiver vazio)
              const hasStations = st.model.nodes.some((n) => n.type === 'machine' || n.type === 'inspection' || n.type === 'rework');
              void startVirtualLine(hasStations ? st.model : tenStationModel(), cfg.speed ?? 10).then((ok) => {
                if (!ok) st.setMessage('A linha virtual usa o banco do artefato: só funciona no link online.');
              });
            }
            setMon(cfg);
            setMonitorOpen(false);
            st.setMessage(
              cfg.kind === 'api'
                ? 'Monitoramento pela API: os blocos mostram as peças feitas em cada posto. A simulação fica desligada no monitoramento.'
                : 'Gêmeo digital: cada posto escaneia as peças; os blocos mostram o estado real e o ciclo pelo intervalo entre scans (selo 🏭). A simulação fica desligada no monitoramento.',
            );
          }}
          onStop={() => {
            setMon(null);
            stopVirtualLine();
          }}
          onClose={() => setMonitorOpen(false)}
          onPanel={() => {
            setMonitorOpen(false);
            onPanel();
          }}
        />
      )}
    </>
  );
}

function MonitorModal({ running, last, onStart, onStop, onClose, onPanel }: {
  running: MonCfg | null;
  last: { at: number; n: number; err?: string; text?: string } | null;
  onStart: (c: MonCfg) => void;
  onStop: () => void;
  onClose: () => void;
  onPanel: () => void;
}) {
  const [url, setUrl] = useState(() => running?.url || lsGet(URL_KEY));
  const [every, setEvery] = useState(running?.every ?? 60);
  const [speed, setSpeed] = useState(running?.speed ?? 10);
  const ok = /^https?:\/\//.test(url);
  return (
    <Modal title="📡 Monitoramento real" sub="Gêmeo digital: espelha a linha real (scans de cada posto). Não simula nada." onClose={onClose}>
      <HowTo
        title="Os 3 tipos de estudo"
        why="Deixe claro em todo estudo qual dos três você está fazendo: os números querem dizer coisas diferentes."
        steps={[`🎲 Simulação: ${STUDY_WHY.simulacao}`, `⏪ Reprodução histórica: ${STUDY_WHY.historico}`, `📡 Monitoramento real: ${STUDY_WHY.monitoramento}`]}
        tip="Ordem natural: monte e valide o modelo com a reprodução histórica, use a simulação para decidir e o monitoramento para acompanhar."
      />
      <ResumeLast onPick={onClose} />
      <div className="mon-src">
        <p className="label">1 · Linha virtual (servidor de teste) — comece por aqui</p>
        <p className="hint">Roda a linha em segundo plano como se fosse a fábrica: cada posto escaneia a peça quando ela sai, os scans vão para o servidor (banco do artefato) e este gêmeo mostra tudo. Ciclo de cada posto = intervalo entre scans, sem os que ficam fora de média ± 2 desvios.</p>
        <div className="row-btns">
          <label className="field inline">
            <span>Velocidade</span>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[1, 10, 60].map((v) => <option key={v} value={v}>{v === 1 ? 'tempo real (1×)' : `${v}× (1 min = ${v} min de turno)`}</option>)}
            </select>
          </label>
          <button className="btn primary" onClick={() => onStart({ kind: 'virtual', url: '', every, speed })}>▶ Ligar linha virtual e acompanhar</button>
        </div>
      </div>
      <div className="mon-src">
        <p className="label">2 · Linha física em outra janela ou computador</p>
        <p className="hint">Na outra janela: abra a linha, clique em 🏭 Linha física e ▶ Start. Aqui:</p>
        <button className="btn" onClick={() => onStart({ kind: 'gemeo', url: '', every })}>🏭 Seguir a linha física</button>
      </div>
      <div className="mon-src">
        <p className="label">3 · API dos postos (linha de verdade)</p>
        <label className="field">
          <span>Endereço (GET que devolve os scans: posto, serie, hora — ou inicio e fim)</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://servidor-da-ti/api/scans?linha=1" />
        </label>
        <div className="row-btns">
          <label className="field inline">
            <span>Atualizar a cada</span>
            <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
              {[10, 30, 60, 300].map((v) => <option key={v} value={v}>{v < 60 ? `${v} s` : `${v / 60} min`}</option>)}
            </select>
          </label>
          <button
            className="btn"
            disabled={!ok}
            title={ok ? 'Começa a buscar os scans na API' : 'Informe o endereço da API (começa com http:// ou https://)'}
            onClick={() => {
              lsSet(URL_KEY, url);
              onStart({ kind: 'api', url, every });
            }}
          >
            ▶ Ligar com a API
          </button>
        </div>
      </div>
      {running && (
        <div className="row-btns section">
          <span className="study-live" aria-hidden />
          <span>
            Ligado ({running.kind === 'virtual' ? `linha virtual, ${running.speed ?? 10}×` : running.kind === 'gemeo' ? 'gêmeo digital da linha física' : `${running.url}, a cada ${running.every < 60 ? `${running.every} s` : `${running.every / 60} min`}`}).
            {last && (last.text ? ` ${last.text}` : last.err ? ` Última tentativa falhou: ${last.err}.` : ` Última leitura às ${new Date(last.at).toLocaleTimeString('pt-BR')}: ${last.n} leituras.`)}
          </span>
          <button className="btn" onClick={onPanel}>📊 Ver painel</button>
          <button className="btn" onClick={onStop}>■ Desligar</button>
        </div>
      )}
      <p className="hint">A API precisa liberar acesso a partir do navegador (CORS). Nenhum nome de operador é lido (LGPD).</p>
    </Modal>
  );
}

/** Retomar de onde parou: a última coleta gravada que dá para continuar (queda de energia, página fechada). */
function ResumeLast({ onPick }: { onPick: () => void }) {
  const [h, setH] = useState<HistItem | null>(null);
  useEffect(() => {
    void listHistory().then((l) => setH(l?.find((x) => x.retomar && x.retomar.kind !== 'gemeo' && x.scans > 0) ?? null));
  }, []);
  if (!h) return null;
  return (
    <div className="mon-src resume">
      <p className="label">⟳ Retomar de onde parou</p>
      <p className="hint">
        Última coleta: {h.nome} · {h.fonte} · {fmtTime(h.relogio)} de turno · {h.scans} scans (gravada às {new Date(h.em).toLocaleTimeString('pt-BR')}). Acabou a energia ou fechou a página? Continue daqui: os scans gravados somam com os novos.
      </p>
      <button
        className="btn primary"
        onClick={() => {
          twinCmd({ cmd: 'resume', sessao: h.sessao });
          onPick();
        }}
      >
        ⟳ Retomar esta coleta
      </button>
    </div>
  );
}
