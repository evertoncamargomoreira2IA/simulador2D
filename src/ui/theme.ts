// Cores do canvas lidas dos tokens CSS (acompanham tema claro/escuro).
import { useEffect, useState } from 'react';
import type { NodeState } from '../engine/types';

export interface CanvasColors {
  canvas: string;
  grid: string;
  gridMajor: string;
  ink: string;
  muted: string;
  raised: string;
  line: string;
  accent: string;
  transport: string;
  human: string;
  cad: string;
  cadText: string;
  state: Record<NodeState, string>;
}

function read(): CanvasColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string) => cs.getPropertyValue(k).trim();
  return {
    canvas: v('--canvas'),
    grid: v('--grid'),
    gridMajor: v('--grid-major'),
    ink: v('--ink'),
    muted: v('--muted'),
    raised: v('--raised'),
    line: v('--line'),
    accent: v('--accent'),
    transport: v('--st-transport'),
    human: v('--human'),
    cad: v('--cad'),
    cadText: v('--cad-text'),
    state: {
      working: v('--st-working'),
      starved: v('--st-starved'),
      blocked: v('--st-blocked'),
      resource: v('--st-resource'),
      down: v('--st-down'),
      setup: v('--st-setup'),
      break: v('--st-break'),
      off: v('--st-off'),
    },
  };
}

export function useCanvasColors(): CanvasColors {
  const [c, setC] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setC(read());
    mq.addEventListener('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => {
      mq.removeEventListener('change', update);
      mo.disconnect();
    };
  }, []);
  return c;
}

export const STATE_LABEL: Record<NodeState, string> = {
  working: 'Operando',
  starved: 'Espera (sem peça)',
  blocked: 'Espera (bloqueado)',
  resource: 'Espera (operador/transporte)',
  down: 'Parado (falha)',
  setup: 'Setup',
  break: 'Parada planejada',
  off: 'Sem produção',
};

export const fmtTime = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

export const fmt = (v: number, d = 1): string =>
  Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';

export const pct = (v: number, d = 0): string => `${fmt(v * 100, d)}%`;

/** Mistura duas cores hex (t = peso da primeira). */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const x = h.replace('#', '');
    const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x;
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
  };
  try {
    const [ca, cb] = [p(a), p(b)];
    if (ca.some(Number.isNaN) || cb.some(Number.isNaN)) return b;
    return `rgb(${ca.map((v, i) => Math.round(v * t + cb[i] * (1 - t))).join(',')})`;
  } catch {
    return b;
  }
}

/** Tema escolhido pela pessoa (escuro é o padrão, independente do Windows/navegador). */
export type ThemePref = 'dark' | 'light';
const THEME_KEY = 'sim2d-theme';
export function loadTheme(): ThemePref {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
export function applyTheme(t: ThemePref) {
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}
