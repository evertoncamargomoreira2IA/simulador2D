// Rede de proteção: se algo der erro na tela ou na simulação, o trabalho não se perde.
// 🔄 Atualizar guarda o modelo aberto, recarrega a página e abre o mesmo modelo de novo.

import { Component, type ReactNode } from 'react';
import { useStore } from '../store';
import type { Model } from '../engine/types';

const KEY = 'sim2d.recuperar';

/** Recarrega a página mantendo o modelo aberto (e o estudo em andamento). */
export function refreshKeepingWork(): void {
  try {
    const m = useStore.getState().model;
    sessionStorage.setItem(KEY, JSON.stringify({ ...m, background: m.background }));
  } catch {
    /* sem armazenamento: recarrega mesmo assim */
  }
  location.reload();
}

/** Na abertura: devolve o modelo guardado pelo 🔄 Atualizar (uma vez só). */
export function takeRecovered(): Model | null {
  try {
    const s = sessionStorage.getItem(KEY);
    if (!s) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(s) as Model;
  } catch {
    return null;
  }
}

export class Recover extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: (e as Error)?.message ?? String(e) };
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="recover" role="alert">
        <div>
          <h2>Ops, a tela travou</h2>
          <p>O seu modelo está guardado. Clique em <b>🔄 Atualizar</b>: a página recarrega e abre o mesmo modelo.</p>
          <p className="hint">Detalhe técnico: {this.state.err}</p>
          <button className="btn primary" onClick={refreshKeepingWork}>🔄 Atualizar</button>
        </div>
      </div>
    );
  }
}
