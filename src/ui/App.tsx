// Layout principal e laço de animação (requestAnimationFrame).

import { useEffect } from 'react';
import { useStore } from '../store';
import { CanvasView } from './CanvasView';
import { Dashboard } from './Dashboard';
import { Palette } from './Palette';
import { PropertiesPanel } from './PropertiesPanel';
import { Toolbar } from './Toolbar';

export function App() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastKpi = 0;
    const loop = (t: number) => {
      const st = useStore.getState();
      if (st.run === 'running') {
        const dt = Math.min(0.1, (t - last) / 1000);
        st.sim.advanceTo(st.sim.now + dt * st.speed);
        const done = st.sim.finished;
        if (done) st.setRun('done');
        const kpiDue = done || t - lastKpi > 300;
        if (kpiDue) lastKpi = t;
        st.refresh(kpiDue);
      }
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const st = useStore.getState();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.selected.length || st.selectedLink) st.deleteSelection();
      } else if (e.key === 'Escape') {
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
    <div className="app">
      <Toolbar />
      <Palette />
      <CanvasView />
      <PropertiesPanel />
      <Dashboard />
    </div>
  );
}
