// Guarda leituras novas e alimenta o Real × simulado e o painel (usado por Dados reais e pelo Monitoramento real).

import { studyEvents, STUDY_DEFAULTS, type RealEvent, type StudyOptions } from '../engine/timeStudy';
import { useStore } from '../store';
import { norm } from './StationDetail';

export function loadRealEvents(ev: RealEvent[], src: string, o: StudyOptions = STUDY_DEFAULTS): number {
  const st = useStore.getState();
  st.setRealEvents(ev, src);
  const study = studyEvents(ev, st.model, o);
  // peças reais levadas para a duração do turno simulado (2 h de leituras × 8 h de simulação comparam por ritmo)
  const span = ev.length ? Math.max(...ev.map((e) => e.fim)) - Math.min(...ev.map((e) => e.inicio)) : 0;
  const scale = span > 0 ? (st.model.settings.duration - (st.model.settings.warmup ?? 0)) / span : 1;
  st.setReal(Object.fromEntries(study.map((r) => [norm(r.name), { name: r.name, produced: Math.round((r.kept + r.out.length) * scale), cycle: r.standard }])), src);
  return study.length;
}
