// Barra superior: arquivo (modelos, importar, exportar) e controle da simulação.

import { useRef, useState } from 'react';
import { lineKpi } from '../engine/metrics';
import { exportModelCsv, exportModelJson, exportResultsXlsx } from '../io/exporter';
import { ACCEPT, importAnyFile } from './fileImport';
import { elementsModel, lp2Model, simpleModel } from '../model/builder';
import { privateExample, useStore } from '../store';
import { fmtTime } from './theme';
import { effectiveTakt } from '../engine/balance';
import { Tutorial, downloadTemplate } from './Tutorial';
import { RecentSelect, SavedModels, saveCurrent } from './SaveDialog';

const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300, 600];

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [help, setHelp] = useState(false);
  const showSaved = useStore((s) => s.showSaved);
  const saved = useStore((s) => s.saved);
  const undoLabel = useStore((s) => s.undoLabel);
  const redoLabel = useStore((s) => s.redoLabel);
  const model = useStore((s) => s.model);
  const dirty = !saved || saved.model !== model;
  const run = useStore((s) => s.run);
  const speed = useStore((s) => s.speed);
  const sim = useStore((s) => s.sim);
  useStore((s) => s.tick);
  const tool = useStore((s) => s.tool);
  const snap = useStore((s) => s.snap);
  const st = useStore.getState;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) await importAnyFile(f);
  }

  const start = () => {
    if (st().run === 'done') st().resetSim();
    st().setRun('running');
  };
  const runToEnd = () => {
    st().sim.runToEnd();
    st().setRun('done');
    if (st().sim.error) st().setMessage(st().sim.error!);
    st().refresh(true);
  };
  const replay = () => {
    st().resetSim();
    st().setRun('running');
  };

  return (
    <header className="topbar">
      <div className="brand">
        <b>{__APP_NAME__}</b>
        <span className="tag" title="Gêmeo digital centrado nas pessoas">Indústria 5.0</span>
        <span title={model.name}>{model.name}</span>
      </div>

      <div className="group" role="group" aria-label="Arquivo">
        <button className="btn" onClick={() => st().setShowStart(true)} title="Novo trabalho, trabalhos salvos ou exemplos">
          Início
        </button>
        <select
          className="btn"
          aria-label="Modelos de exemplo"
          value=""
          onChange={(e) => {
            const ex = privateExample();
            if (e.target.value === 'real' && ex) st().setModel(ex, 'Linha real carregada sobre o layout DXF.');
            const main = e.target.value === 'main' ? privateExample('main') : null;
            if (main) st().setModel(main, 'Main line com operações e atividades de cada posto. Veja Análises → Yamazumi.');
            if (e.target.value === 'lp2') st().setModel(lp2Model(), 'Exemplo LP2 carregado (70 postos, 12 s por posto).');
            if (e.target.value === 'elements') st().setModel(elementsModel(), 'Linha exemplo com operações e atividades: estudo por elemento. Veja Análises → Yamazumi.');
            if (e.target.value === 'simple') st().setModel(simpleModel(), 'Linha exemplo simples carregada.');
          }}
        >
          <option value="" disabled>Exemplos…</option>
          {__EXAMPLE__ && <option value="real">Linha real (layout DXF)</option>}
          {__EXAMPLE_MAIN__ && <option value="main">Linha real: main line com atividades</option>}
          <option value="lp2">Linha LP2 (70 postos)</option>
          <option value="simple">Linha simples</option>
          <option value="elements">Linha com atividades (Yamazumi)</option>
        </select>
        <button className="btn icon" disabled={!undoLabel} onClick={() => st().undo()} title={undoLabel ? `Desfazer ${undoLabel} (Ctrl+Z)` : 'Nada para desfazer'} aria-label="Desfazer">↶</button>
        <button className="btn icon" disabled={!redoLabel} onClick={() => st().redo()} title={redoLabel ? `Refazer ${redoLabel} (Ctrl+Y)` : 'Nada para refazer'} aria-label="Refazer">↷</button>
        <button
          className={`btn${dirty ? ' dirty' : ''}`}
          onClick={() => (saved ? saveCurrent() : st().setShowSaved(true))}
          title={saved ? 'Grava por cima do modelo salvo (Ctrl+S)' : 'Dar um nome e salvar (Ctrl+S)'}
        >
          {dirty ? 'Salvar •' : 'Salvo ✓'}
        </button>
        <button className="btn" onClick={() => st().setShowSaved(true)} title="Abrir, salvar como novo ou apagar modelos salvos">
          Salvos
        </button>
        <RecentSelect />
        <button className="btn" onClick={() => fileRef.current?.click()} title="Planilha padrão preenchida, Excel (.xlsx), CSV, JSON do simulador, planta DXF (AutoCAD) ou imagem do layout. Também dá para arrastar o arquivo para a tela.">
          Importar
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={onFile} />
        <select
          className="btn"
          aria-label="Exportar"
          value=""
          onChange={(e) => {
            const m = st().model;
            if (e.target.value === 'json') exportModelJson(m);
            if (e.target.value === 'csv') exportModelCsv(m);
            if (e.target.value === 'xlsx') exportResultsXlsx(m, lineKpi(st().sim));
            if (e.target.value === 'tpl') downloadTemplate(false);
            if (e.target.value === 'tplm') downloadTemplate(true);
          }}
        >
          <option value="" disabled>Exportar…</option>
          <option value="tpl">Planilha padrão (para preencher)</option>
          <option value="tplm">Planilha do modelo atual</option>
          <option value="xlsx">Resultados (Excel)</option>
          <option value="csv">Modelo (CSV)</option>
          <option value="json">Modelo (JSON)</option>
        </select>
      </div>

      <span className="sep" />

      <div className="group" role="group" aria-label="Edição">
        <button className={`btn${tool === 'select' ? ' on' : ''}`} onClick={() => st().setTool('select')} title="Arraste no fundo para selecionar vários e mova todos juntos. Botão direito/meio arrasta a tela; roda do mouse dá zoom.">
          Selecionar
        </button>
        <button className={`btn${tool === 'connect' ? ' on' : ''}`} onClick={() => st().setTool(tool === 'connect' ? 'select' : 'connect')} title="Clique na origem e depois no destino">
          Conectar
        </button>
        <button className={`btn${snap ? ' on' : ''}`} onClick={() => st().setSnap(!snap)} title="Encaixar no grid">
          Snap
        </button>
      </div>

      <span className="sep" />

      <div className="group" role="group" aria-label="Simulação">
        {run === 'running' ? (
          <button className="btn primary" onClick={() => st().setRun('paused')}>❚❚ Pause</button>
        ) : (
          <button className="btn primary" onClick={start} disabled={model.nodes.length === 0}>▶ Start</button>
        )}
        <button className="btn" onClick={() => st().resetSim()} disabled={sim.clock === 0}>■ Stop</button>
        <button className="btn" onClick={replay} disabled={sim.clock === 0} title="Reinicia com a mesma semente: mesma sequência de eventos">↺ Replay</button>
        <button className="btn" onClick={runToEnd} disabled={model.nodes.length === 0 || run === 'done'} title="Calcula até o fim do turno sem animação">⏭ Fim</button>
        <select className="btn" aria-label="Velocidade" value={speed} onChange={(e) => st().setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
      </div>

      <label className={`chip-toggle${model.settings.startFull ? ' on' : ''}`} title="Começa com a linha cheia, como na produção: ignora a rampa de enchimento e mostra o UPH real">
        <input type="checkbox" checked={!!model.settings.startFull} onChange={(e) => st().updateSettings({ startFull: e.target.checked })} />
        Linha cheia
      </label>
      <div className="group" role="group" aria-label="Análises">
        <button className="btn" onClick={() => st().setAnalysis('ciclo')} title="Cycle × takt, gargalos, spaghetti, custos, energia, carbono, cenários e real × simulado">Análises</button>
        <button className="btn" onClick={() => st().setOpsFor(st().selected[0] ?? '')} title="Operações e atividades de cada posto (estudo por elemento e Yamazumi)">Operações</button>
        <button className="btn ai" onClick={() => st().setAnalysis('ia')} title="Sugestões de melhoria com IA">✦ IA</button>
        <button className="btn" onClick={() => setHelp(true)} title="Procedimento de uso e planilha padrão">? Como usar</button>
      </div>
      {help && <Tutorial onClose={() => setHelp(false)} />}
      {showSaved && <SavedModels onClose={() => st().setShowSaved(false)} />}
      <span className={`live${run === 'running' ? ' on' : ''}`}><i />{run === 'running' ? 'Ao vivo' : run === 'done' ? 'Concluído' : run === 'paused' ? 'Pausado' : 'Pronto'}</span>
      <UphField />
      <div className="clock" aria-live="off">
        {fmtTime(sim.clock)} <small>/ {fmtTime(sim.duration - sim.t0)}</small>
      </div>
    </header>
  );
}

/** Meta UPH na barra: o takt sai daqui (takt = 3600 / UPH). */
function UphField() {
  const model = useStore((s) => s.model);
  const takt = model.settings.takt;
  const eff = effectiveTakt(model);
  const uph = takt > 0 ? Math.round((3600 / takt) * 10) / 10 : 0;
  return (
    <label className="uph" title="Peças por hora esperadas. O takt é calculado sozinho (3600 / UPH) e aparece como linha nos gráficos.">
      <span>Meta UPH</span>
      <input
        id="bar-uph"
        type="number"
        min={0}
        step={1}
        value={uph}
        onChange={(e) => {
          const u = Number(e.target.value);
          useStore.getState().updateSettings({ takt: u > 0 ? Math.round((3600 / u) * 1000) / 1000 : 0 });
        }}
      />
      <small title={takt > 0 ? '' : 'Sem meta: o takt de referência é o tempo do posto gargalo (planejado).'}>
        {takt > 0 ? `takt ${takt.toFixed(1)} s` : eff > 0 ? `takt do gargalo ${eff.toFixed(1)} s` : 'takt –'}
      </small>
    </label>
  );
}
