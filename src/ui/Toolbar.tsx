// Barra superior: arquivo (modelos, importar, exportar) e controle da simulação.

import { useRef, useState } from 'react';
import { lineKpi } from '../engine/metrics';
import { exportModelCsv, exportModelJson, exportResultsXlsx } from '../io/exporter';
import { ACCEPT, importAnyFile } from './fileImport';
import { elementsModel, lp2Model, simpleModel, combineModel, mixModel, supplyModel, tenStationModel, transportModel } from '../model/builder';
import { privateExample, useStore } from '../store';
import { applyTheme, fmtTime, loadTheme } from './theme';
import { effectiveTakt } from '../engine/balance';
import { Tutorial, downloadSoeForm, downloadTemplate } from './Tutorial';
import { Library } from './Library';
import { PanelModal } from './Panel';
import { RecentSelect, SavedModels, saveAsLocal, saveCurrent } from './SaveDialog';

const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300, 600];

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [help, setHelp] = useState(false);
  const [lib, setLib] = useState(false);
  const [panel, setPanel] = useState(false);
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
  // Stop encerra a rodada e deixa os resultados na tela; Reset zera tudo
  const stop = () => {
    st().setRun('done');
    st().setMessage(`Simulação parada em ${fmtTime(st().sim.now)}. Os resultados ficam na tela; ⟲ Reset zera o relógio.`);
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
        {__OFFLINE__ && <span className="tag offline" title="Arquivo offline: salve com Exportar → JSON; painel e IA só no link online">Offline</span>}
        {__OFFLINE__ && __ONLINE_URL__ && (
          <a
            className="btn"
            href={__ONLINE_URL__}
            target="_blank"
            rel="noreferrer"
            title="Baixa o modelo desta tela (JSON) e abre o projeto online: lá, Importar esse arquivo deixa as duas versões iguais"
            onClick={() => exportModelJson(useStore.getState().model)}
          >
            🔗 Projeto online
          </a>
        )}
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
            if (e.target.value === 'real' && ex) st().openModel(ex, 'Linha real carregada sobre o layout DXF.');
            const main = e.target.value === 'main' ? privateExample('main') : null;
            if (main) st().openModel(main, 'Main line com operações e atividades de cada posto. Veja Análises → Yamazumi.');
            if (e.target.value === 'lp2') st().openModel(lp2Model(), 'Exemplo LP2 carregado (70 postos, 12 s por posto).');
            if (e.target.value === 'elements') st().openModel(elementsModel(), 'Linha exemplo com operações e atividades: estudo por elemento. Veja Análises → Yamazumi.');
            if (e.target.value === 'transport') st().openModel(transportModel(), 'Exemplo: dois buffers abastecem o Posto destino; o abastecedor leva 4 peças por viagem.');
            if (e.target.value === 'combine') st().openModel(combineModel(), 'Exemplo: 3 postos, AMR e abastecedor levam as peças ao Posto X, que junta tudo em um produto.');
            if (e.target.value === 'mix') st().setModel(mixModel(), 'Exemplo: linha com 3 modelos (A 60%, B 30%, C 10%), troca de modelo na programação e no teste. Abra 🎨 Mix e clique em ▶ Rodar turno com o mix.');
            if (e.target.value === 'supply') st().setModel(supplyModel(), 'Exemplo: supermercado → kitting → milk run → linha (10 montagem, 5 off-line, 4 teste, 5 packing) → FGI → expedição, meta 100 UPH. Clique em ▶ Start.');
            if (e.target.value === 'ten') st().openModel(tenStationModel(), 'Linha em U de 10 postos manuais, takt 36 s (meta 100 UPH), variação de 15%: a mesma que abre na versão offline. Clique em ▶ Start.');
            if (e.target.value === 'simple') st().openModel(simpleModel(), 'Linha exemplo simples carregada.');
          }}
        >
          <option value="" disabled>Exemplos…</option>
          {__EXAMPLE__ && <option value="real">Linha real (layout DXF)</option>}
          {__EXAMPLE_MAIN__ && <option value="main">Linha real: main line com atividades</option>}
          <option value="supply">Abastecimento e FGI (100 UPH)</option>
          <option value="mix">Mix de 3 modelos (A, B, C)</option>
          <option value="lp2">Linha LP2 (70 postos)</option>
          <option value="ten">Linha de 10 postos (espelho do offline)</option>
          <option value="simple">Linha simples</option>
          <option value="elements">Linha com atividades (Yamazumi)</option>
          <option value="combine">Combinar peças com AMR</option>
          <option value="transport">Operador levando peças</option>
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
        <button className="btn" onClick={() => saveAsLocal()} title="Salvar como arquivo no computador, escolhendo a pasta (Ctrl+Shift+S)">
          Salvar como…
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
            if (e.target.value === 'soe') downloadSoeForm();
          }}
        >
          <option value="" disabled>Exportar…</option>
          <option value="soe">Formulário Yamazumi (SOE)</option>
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
        <ThemeButton />
      </div>

      <span className="sep" />

      <div className="group" role="group" aria-label="Simulação">
        {run === 'running' ? (
          <button className="btn primary" onClick={() => st().setRun('paused')}>❚❚ Pause</button>
        ) : (
          <button className="btn primary" onClick={start} disabled={model.nodes.length === 0}>▶ Start</button>
        )}
        <button className="btn" onClick={stop} disabled={sim.clock === 0 || run === 'done'} title="Para a simulação e mantém os resultados">■ Stop</button>
        <button className="btn" onClick={() => st().resetSim()} disabled={sim.clock === 0} title="Zera o relógio, as peças e os indicadores (o modelo não muda)">⟲ Reset</button>
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
        <button className="btn" onClick={() => st().setShowMix(true)} title="Mix de modelos: % de cada produto ou sequência fixa, tempo por modelo e troca de modelo">🎨 Mix</button>
        <button className="btn" onClick={() => setPanel(true)} title="Painel real × simulado por posto e publicação para leitores (link só leitura)">📊 Painel</button>
        <button className="btn ai" onClick={() => st().setAnalysis('ia')} title="Sugestões de melhoria com IA">✦ IA</button>
        <button className="btn" onClick={() => setHelp(true)} title="Passo a passo, siglas e funções">? Como usar</button>
        <button className="btn lib-btn" onClick={() => setLib(true)} title="Biblioteca de soluções: dúvidas comuns com passo a passo em imagens">💡 Biblioteca</button>
      </div>
      {help && <Tutorial onClose={() => setHelp(false)} />}
      {lib && <Library onClose={() => setLib(false)} />}
      {panel && <PanelModal onClose={() => setPanel(false)} />}
      {showSaved && <SavedModels onClose={() => st().setShowSaved(false)} />}
      <span className={`live${run === 'running' ? ' on' : ''}`}><i />{run === 'running' ? 'Ao vivo' : run === 'done' ? (sim.clock < model.settings.duration ? 'Parado' : 'Concluído') : run === 'paused' ? 'Pausado' : 'Pronto'}</span>
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
        value={uph || ''}
        placeholder={eff > 0 ? `auto ${(3600 / eff).toFixed(1)}` : 'auto'}
        onChange={(e) => {
          const u = Number(e.target.value);
          useStore.getState().updateSettings({ takt: u > 0 ? Math.round((3600 / u) * 1000) / 1000 : 0 });
        }}
      />
      <small title={takt > 0 ? '' : 'Meta zerada: o takt vem da operação (tempo do posto gargalo planejado). Digite um UPH para fixar uma meta.'}>
        {takt > 0 ? `takt ${takt.toFixed(1)} s` : eff > 0 ? `takt da operação ${eff.toFixed(1)} s` : 'takt –'}
      </small>
    </label>
  );
}

function ThemeButton() {
  const [t, setT] = useState(loadTheme);
  const next = t === 'dark' ? 'light' : 'dark';
  return (
    <button className="btn" onClick={() => { applyTheme(next); setT(next); }} title={`Mudar para fundo ${next === 'dark' ? 'escuro' : 'claro'}`} aria-label="Alternar fundo claro/escuro">
      {t === 'dark' ? '☀ Claro' : '🌙 Escuro'}
    </button>
  );
}
