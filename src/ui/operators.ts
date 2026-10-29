// Equipes de operadores criadas pela paleta.

import { makePool, type NodeDef } from '../engine/types';
import { useStore } from '../store';

/** Cria uma equipe de operadores; se houver posto, já liga e deixa a equipe parada ao lado dele. */
export function createOperator(station?: NodeDef, at?: { x: number; y: number }) {
  const st = useStore.getState();
  const m = st.model;
  const pools = m.pools ?? [];
  const ok = station && station.type !== 'source' && station.type !== 'sink' ? station : undefined;
  const c = at ?? st.viewCenter;
  const pool = makePool('operator', {
    name: `Operadores ${pools.filter((p) => p.kind === 'operator').length + 1}`,
    count: 1,
    x: Math.round(ok ? ok.x : c.x),
    y: Math.round(ok ? ok.y - 34 : c.y),
  });
  st.patchModel({ pools: [...pools, pool], ...(ok ? { nodes: m.nodes.map((n) => (n.id === ok.id ? { ...n, poolId: pool.id } : n)) } : {}) });
  if (ok) {
    st.setMessage(`"${pool.name}" ligado a "${ok.name}". Para a mesma equipe atender outros postos, escolha o grupo em "Operadores compartilhados" no posto.`);
  } else {
    st.setPendingPool(pool.id);
    st.setMessage(`"${pool.name}" criado. Agora clique no posto que ele vai atender (Esc cancela).`);
  }
}

