// Barra superior: arquivo (modelos, importar, exportar) e controle da simulação.

import { useRef } from 'react';
import { lineKpi } from '../engine/metrics';
import { exportModelCsv, exportModelJson, exportResultsXlsx } from '../io/exporter';
import { parseDxf, snapNodesToLabels } from '../io/dxf';
import { importFile } from '../io/importer';
import { lp2Model, simpleModel } from '../model/builder';
import { DEFAULT_SETTINGS } from '../engine/types';
import { privateExample, useStore } from '../store';
import { fmtTime } from './theme';

const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300, 600];

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const model = useStore((s) => s.model);
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
    if (!f) return;
    try {
      if (/\.dxf$/i.test(f.name)) {
        const m = st().model;
        const bg = parseDxf(await f.text(), m.settings.pxPerMeter || 40);
        const nodes = m.nodes.map((n) => ({ ...n }));
        const moved = snapNodesToLabels(bg, nodes);
        st().setModel(
          { ...m, nodes, background: bg },
          `Planta "${f.name}" carregada (${(bg.width / bg.pxPerMeter).toFixed(0)} × ${(bg.height / bg.pxPerMeter).toFixed(0)} m). ${moved ? `${moved} blocos posicionados pelo nome no desenho.` : 'Arraste os blocos sobre a planta.'}`,
        );
        return;
      }
      const r = await importFile(f, st().model.settings.takt || 12);
      st().setModel(r.model, r.info);
    } catch (err) {
      st().setMessage(`Não foi possível importar "${f.name}": ${(err as Error).message}`);
    }
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
        <b>Simulador 2D</b>
        <span className="tag" title="Gêmeo digital centrado nas pessoas">Indústria 5.0</span>
        <span title={model.name}>{model.name}</span>
      </div>

      <div className="group" role="group" aria-label="Arquivo">
        <button className="btn" onClick={() => st().setModel({ name: 'Novo modelo', nodes: [], links: [], settings: { ...DEFAULT_SETTINGS } }, 'Modelo vazio. Clique em Source na paleta e depois em Machine, Buffer… Cada bloco novo já sai ligado ao anterior.')}>
          Novo
        </button>
        <select
          className="btn"
          aria-label="Modelos de exemplo"
          value=""
          onChange={(e) => {
            const ex = privateExample();
            if (e.target.value === 'real' && ex) st().setModel(ex, 'Linha real carregada sobre o layout DXF.');
            if (e.target.value === 'lp2') st().setModel(lp2Model(), 'Exemplo LP2 carregado (70 postos, 12 s por posto).');
            if (e.target.value === 'simple') st().setModel(simpleModel(), 'Linha exemplo simples carregada.');
          }}
        >
          <option value="" disabled>Exemplos…</option>
          {__EXAMPLE__ && <option value="real">Linha real (layout DXF)</option>}
          <option value="lp2">Linha LP2 (70 postos)</option>
          <option value="simple">Linha simples</option>
        </select>
        <button className="btn" onClick={() => fileRef.current?.click()} title="Excel (.xlsx), CSV, JSON do simulador ou planta DXF (AutoCAD)">
          Importar
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt,.json,.dxf" hidden onChange={onFile} />
        <select
          className="btn"
          aria-label="Exportar"
          value=""
          onChange={(e) => {
            const m = st().model;
            if (e.target.value === 'json') exportModelJson(m);
            if (e.target.value === 'csv') exportModelCsv(m);
            if (e.target.value === 'xlsx') exportResultsXlsx(m, lineKpi(st().sim));
          }}
        >
          <option value="" disabled>Exportar…</option>
          <option value="xlsx">Resultados (Excel)</option>
          <option value="csv">Modelo (CSV)</option>
          <option value="json">Modelo (JSON)</option>
        </select>
      </div>

      <span className="sep" />

      <div className="group" role="group" aria-label="Edição">
        <button className={`btn${tool === 'select' ? ' on' : ''}`} onClick={() => st().setTool('select')} title="Selecionar e mover (Shift+arrastar = seleção por área)">
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
        <button className="btn" onClick={() => st().resetSim()} disabled={sim.now === 0}>■ Stop</button>
        <button className="btn" onClick={replay} disabled={sim.now === 0} title="Reinicia com a mesma semente: mesma sequência de eventos">↺ Replay</button>
        <button className="btn" onClick={runToEnd} disabled={model.nodes.length === 0 || run === 'done'} title="Calcula até o fim do turno sem animação">⏭ Fim</button>
        <select className="btn" aria-label="Velocidade" value={speed} onChange={(e) => st().setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
      </div>

      <span className={`live${run === 'running' ? ' on' : ''}`}><i />{run === 'running' ? 'Ao vivo' : run === 'done' ? 'Concluído' : run === 'paused' ? 'Pausado' : 'Pronto'}</span>
      <div className="clock" aria-live="off">
        {fmtTime(sim.now)} <small>/ {fmtTime(sim.duration)}</small>
      </div>
    </header>
  );
}
