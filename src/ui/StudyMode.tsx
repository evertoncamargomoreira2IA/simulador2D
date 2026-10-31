// Os 3 tipos de estudo, sempre visíveis na barra: Simulação (e se?), Reprodução histórica (o que aconteceu?)
// e Monitoramento real (o que está acontecendo agora?).

import { useEffect, useRef, useState } from 'react';
import { replayModel, simulationModel, STUDY_LABEL, STUDY_WHY } from '../engine/replay';
import type { StudyKind } from '../engine/types';
import { fetchEvents, simulatedFeed, FEED_DEFAULTS } from '../io/realFeed';
import { tenStationModel } from '../model/builder';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Modal } from './Modal';
import { loadRealEvents } from './realLoad';
import { fmt } from './theme';

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

export function StudyBar({ onPanel }: { onPanel: () => void }) {
  const model = useStore((s) => s.model);
  const study: StudyKind = model.settings.study ?? (model.settings.replay ? 'historico' : 'simulacao');
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [mon, setMon] = useState<{ url: string; every: number; demo: boolean } | null>(null);
  const [last, setLast] = useState<{ at: number; n: number; err?: string } | null>(null);
  const demoHours = useRef(0);

  // monitoramento: busca as leituras de tempos em tempos (continua com a janela fechada)
  useEffect(() => {
    if (!mon) return;
    let alive = true;
    const tick = async () => {
      try {
        let ev;
        if (mon.demo) {
          demoHours.current = Math.min(8, demoHours.current + 0.25);
          ev = simulatedFeed(useStore.getState().model, { ...FEED_DEFAULTS, hours: demoHours.current });
        } else ev = await fetchEvents(mon.url);
        if (!alive) return;
        loadRealEvents(ev, mon.demo ? `monitoramento (demonstração): ${fmt(demoHours.current, 2)} h de turno` : `monitoramento ${mon.url}`);
        setLast({ at: Date.now(), n: ev.length });
      } catch (e) {
        if (alive) setLast({ at: Date.now(), n: 0, err: (e as Error).message });
      }
    };
    void tick();
    const id = setInterval(tick, mon.every * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mon]);

  const choose = (k: StudyKind) => {
    const st = useStore.getState();
    const m = st.model;
    if (k !== 'monitoramento') setMon(null);
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
            demoHours.current = 0;
            const st = useStore.getState();
            const hasStations = st.model.nodes.some((n) => n.type === 'machine' || n.type === 'inspection' || n.type === 'rework');
            if (!hasStations) {
              // sem linha não há o que comparar: a demonstração abre a linha de 10 postos; com API, pede a linha
              if (!cfg.demo) {
                st.setMessage('Monitoramento precisa da linha montada (os nomes dos postos iguais aos da API). Abra o trabalho da linha ou use 🧱 Montar linha a partir das leituras em Dados reais.');
                return;
              }
              st.setModel({ ...tenStationModel(), settings: { ...tenStationModel().settings, study: 'monitoramento' } }, 'Demonstração do monitoramento: linha de 10 postos aberta; a linha simulada faz papel da real e manda 15 min de turno a cada 10 s.');
            }
            setMon(cfg);
            if (!hasStations) {
              setMonitorOpen(false);
              onPanel();
              return;
            }
            if (st.model.settings.replay) st.setModel(simulationModel(st.model, 'monitoramento'), 'Monitoramento real ligado.');
            else st.updateSettings({ study: 'monitoramento' });
            setMonitorOpen(false);
            onPanel();
          }}
          onStop={() => setMon(null)}
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
  running: { url: string; every: number; demo: boolean } | null;
  last: { at: number; n: number; err?: string } | null;
  onStart: (c: { url: string; every: number; demo: boolean }) => void;
  onStop: () => void;
  onClose: () => void;
  onPanel: () => void;
}) {
  const [url, setUrl] = useState(() => running?.url || lsGet(URL_KEY));
  const [every, setEvery] = useState(running?.every ?? 60);
  const ok = /^https?:\/\//.test(url);
  return (
    <Modal title="📡 Monitoramento real" sub="Leituras da linha chegando de tempos em tempos; o painel compara o real com o simulado." onClose={onClose}>
      <HowTo
        title="Os 3 tipos de estudo"
        why="Deixe claro em todo estudo qual dos três você está fazendo: os números querem dizer coisas diferentes."
        steps={[`🎲 Simulação: ${STUDY_WHY.simulacao}`, `⏪ Reprodução histórica: ${STUDY_WHY.historico}`, `📡 Monitoramento real: ${STUDY_WHY.monitoramento}`]}
        tip="Ordem natural: monte e valide o modelo com a reprodução histórica, use a simulação para decidir e o monitoramento para acompanhar."
      />
      <label className="field">
        <span>Endereço da API (GET que devolve as leituras: posto, serie, inicio, fim)</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://servidor-da-ti/api/leituras?linha=1" />
      </label>
      <div className="row-btns">
        <label className="field inline">
          <span>Atualizar a cada</span>
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
            {[10, 30, 60, 300].map((v) => <option key={v} value={v}>{v < 60 ? `${v} s` : `${v / 60} min`}</option>)}
          </select>
        </label>
        <button
          className="btn primary"
          disabled={!ok}
          title={ok ? 'Começa a buscar as leituras na API' : 'Informe o endereço da API (começa com http:// ou https://)'}
          onClick={() => {
            lsSet(URL_KEY, url);
            onStart({ url, every, demo: false });
          }}
        >
          ▶ Ligar com a API
        </button>
        <button className={`btn${ok ? '' : ' primary'}`} onClick={() => onStart({ url: '', every: Math.min(every, 10), demo: true })} title="Sem API ainda: a linha simulada faz papel da linha real e manda 15 min de turno a cada atualização">
          ▶ Demonstração (linha simulada)
        </button>
      </div>
      {running && (
        <div className="row-btns section">
          <span className="study-live" aria-hidden />
          <span>
            Ligado ({running.demo ? 'demonstração' : running.url}), a cada {running.every < 60 ? `${running.every} s` : `${running.every / 60} min`}.
            {last && (last.err ? ` Última tentativa falhou: ${last.err}.` : ` Última leitura às ${new Date(last.at).toLocaleTimeString('pt-BR')}: ${last.n} leituras.`)}
          </span>
          <button className="btn" onClick={onPanel}>📊 Ver painel</button>
          <button className="btn" onClick={onStop}>■ Desligar</button>
        </div>
      )}
      {!ok && <p className="hint">Ainda sem API? Clique em <b>▶ Demonstração</b>: o painel abre e se atualiza sozinho a cada 10 s (se o trabalho estiver vazio, abre a linha de 10 postos).</p>}
      <p className="hint">A API precisa liberar acesso a partir do navegador (CORS). Sem API, use a demonstração para ver como funciona. Nenhum nome de operador é lido (LGPD).</p>
    </Modal>
  );
}
