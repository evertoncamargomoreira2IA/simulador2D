// Layout principal e laço de animação (requestAnimationFrame).

import { useEffect, useState } from 'react';
import { importAnyFile } from './fileImport';
import { useStore } from '../store';
import { PhysicalSource } from './Twin';
import { TwinDash } from './TwinDash';
import { CanvasView } from './CanvasView';
import { Dashboard } from './Dashboard';
import { Palette } from './Palette';
import { PropertiesPanel } from './PropertiesPanel';
import { Toolbar } from './Toolbar';
import { saveAsLocal, saveCurrent } from './SaveDialog';
import { setDownloadNotice } from '../io/exporter';

setDownloadNotice((m) => useStore.getState().setMessage(m));
import { Analysis } from './Analysis';
import { StationDetail } from './StationDetail';
import { TransportBind } from './TransportBind';
import { OpsEditor } from './OpsEditor';
import { FitCurve } from './FitCurve';
import { MixModal } from './Mix';
import { SoeImport } from './SoeImport';
import { StationOrder } from './StationOrder';
import { StartScreen } from './StartScreen';
import { StallAlert } from './StallAlert';
import { PasteImport } from './OfflineBridge';

export function App() {
  const showOrder = useStore((s) => s.showOrder);
  const opsFor = useStore((s) => s.opsFor);
  const fitFor = useStore((s) => s.fitFor);
  const showMix = useStore((s) => s.showMix);
  const transportFor = useStore((s) => s.transportFor);
  const showSoe = useStore((s) => s.showSoe);
  const showStart = useStore((s) => s.showStart);
  const monitoring = useStore((s) => s.model.settings.study === 'monitoramento');
  const hideLeft = useStore((s) => s.hideLeft);
  const hideRight = useStore((s) => s.hideRight);
  const simDash = useStore((s) => s.simDash);
  // monitoramento: laterais escondidas para a linha e os gráficos ocuparem a tela (dá para abrir de novo)
  useEffect(() => {
    useStore.getState().setSides({ hideLeft: monitoring, hideRight: monitoring });
  }, [monitoring]);
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastKpi = 0;
    let slow = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop); // agenda antes: nada abaixo consegue parar o laço
      const st = useStore.getState();
      if (st.run === 'running') {
        const dt = Math.min(0.1, (t - last) / 1000);
        // um erro dentro da simulação não pode parar o laço da tela (antes a aplicação ficava congelada)
        try {
          const a = performance.now();
          st.sim.advanceTo(st.sim.now + dt * st.speed);
          slow = performance.now() - a > 200 ? slow + 1 : 0;
        } catch (e) {
          st.setRun('paused');
          st.setMessage(`A simulação parou por um erro (${(e as Error).message}). Clique em ⟲ Reset ou em 🔄 Atualizar; o modelo continua aberto.`);
        }
        if (slow > 5 && st.speed > 1) {
          slow = 0;
          st.setSpeed(Math.max(1, Math.floor(st.speed / 4)));
          st.setMessage('A simulação estava pesada para esta velocidade: baixei a velocidade para a tela não travar.');
        }
        const done = st.sim.finished;
        if (done) st.setRun('done');
        if (st.sim.error) st.setMessage(st.sim.error);
        const kpiDue = done || t - lastKpi > 300;
        if (kpiDue) lastKpi = t;
        st.refresh(kpiDue);
      }
      last = t;
    };
    raf = requestAnimationFrame(loop);
    // aba escondida (ex.: a linha física atrás do gêmeo): o navegador pausa a animação, então avança por relógio
    const bg = setInterval(() => {
      if (!document.hidden) return;
      const t = performance.now();
      const st = useStore.getState();
      if (st.run === 'running') {
        try {
          st.sim.advanceTo(st.sim.now + ((t - last) / 1000) * st.speed);
        } catch {
          st.setRun('paused');
        }
        if (st.sim.finished) st.setRun('done');
        st.refresh(true);
      }
      last = t;
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(bg);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const st = useStore.getState();
        if (e.shiftKey) saveAsLocal();
        else if (st.saved) saveCurrent();
        else st.setShowSaved(true);
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        const h = useStore.getState();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) h.redo();
        else h.undo();
        return;
      }
      const st = useStore.getState();
      const k = e.key.toLowerCase();
      // blocos congelados (ou monitoramento): sem colar, recortar, duplicar nem apagar blocos
      const lock = !!st.model.settings.frozen || st.model.settings.study === 'monitoramento';
      if (lock && (e.key === 'Delete' || e.key === 'Backspace' || ((e.ctrlKey || e.metaKey) && (k === 'x' || k === 'v' || k === 'd')))) return;
      if ((e.ctrlKey || e.metaKey) && (k === 'c' || k === 'x' || k === 'v' || k === 'd' || k === 'a')) {
        e.preventDefault();
        if (k === 'c') st.copySelection();
        if (k === 'x' && st.copySelection()) st.deleteSelection();
        if (k === 'v') st.paste();
        if (k === 'd' && st.copySelection()) st.paste();
        if (k === 'a') st.select(st.model.nodes.map((n) => n.id));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selected.length || st.selectedLink || st.selectedPool) st.deleteSelection();
      } else if (e.key === 'Escape') {
        st.setPendingPool(null);
        useStore.setState({ bindPick: null });
        st.setTool('select');
        st.select([]);
      } else if (e.key === ' ') {
        e.preventDefault();
        st.setRun(st.run === 'running' ? 'paused' : 'running');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className={`app${hideLeft ? ' no-left' : ''}${hideRight ? ' no-right' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null || !(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        const f = e.dataTransfer.files?.[0];
        setDropping(false);
        if (!f) return;
        e.preventDefault();
        importAnyFile(f);
      }}
    >
      {dropping && (
        <div className="drop-hint" aria-hidden="true">
          <div>
            <b>Solte para carregar</b>
            <span>DXF ou imagem do layout vira a planta de fundo · planilha ou JSON abre o modelo</span>
          </div>
        </div>
      )}
      <Toolbar />
      <Palette />
      <CanvasView />
      <PhysicalSource />
      <PropertiesPanel />
      {monitoring ? <TwinDash /> : simDash ? <TwinDash simMode /> : <Dashboard />}
      <StationDetail />
      <Analysis />
      {showStart && <StartScreen onClose={() => useStore.getState().setShowStart(false)} />}
      {showOrder && <StationOrder onClose={() => useStore.getState().setShowOrder(false)} />}
      {showSoe && <SoeImport onClose={() => useStore.getState().setShowSoe(false)} />}
      {transportFor && <TransportBind start={transportFor} onClose={() => useStore.getState().setTransportFor(null)} />}
      <StallAlert />
      {!__OFFLINE__ && <PasteImport />}
      {fitFor !== null && <FitCurve nodeId={fitFor} onClose={() => useStore.getState().setFitFor(null)} />}
      {showMix && <MixModal onClose={() => useStore.getState().setShowMix(false)} />}
      {opsFor !== null && <OpsEditor start={opsFor} onClose={() => useStore.getState().setOpsFor(null)} />}
    </div>
  );
}
