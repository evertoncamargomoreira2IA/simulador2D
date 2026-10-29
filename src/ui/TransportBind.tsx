// Vínculo de transporte: quem leva a peça, de qual posto (entrada) para qual (saída),
// que peça vai (produto ou componente de montagem) e quantas por viagem.

import { useMemo, useState } from 'react';
import { effectiveTakt } from '../engine/balance';
import { makePool, newId, type LinkDef, type PoolKind } from '../engine/types';
import { polyLength, polyline } from '../engine/path';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Kpi, Modal } from './Modal';
import { fmt, pct } from './theme';

const KIND_PT: Record<PoolKind, string> = { operator: 'Operador', forklift: 'Empilhadeira', agv: 'AGV', amr: 'AMR' };

export function TransportBind({ start, onClose }: { start: { poolId?: string; linkId?: string }; onClose: () => void }) {
  const model = useStore((s) => s.model);
  const pools = model.pools ?? [];
  const link0 = model.links.find((l) => l.id === start.linkId);
  const [poolId, setPoolId] = useState(start.poolId ?? link0?.poolId ?? pools[0]?.id ?? '__new');
  const [from, setFrom] = useState(link0?.from ?? '');
  const [to, setTo] = useState(link0?.to ?? '');
  const [role, setRole] = useState<'flow' | 'part'>(link0?.role === 'part' ? 'part' : 'flow');
  const fromNode = model.nodes.find((n) => n.id === from);
  const [batch, setBatch] = useState(link0?.tripQty ?? 1);
  const [partQty, setPartQty] = useState(link0?.partQty ?? 1);
  const pool0 = pools.find((p) => p.id === poolId);
  const [count, setCount] = useState(pool0?.count ?? 1);
  const [speed, setSpeed] = useState(pool0?.speed ?? 1);
  const [load, setLoad] = useState(pool0?.loadTime ?? 5);
  const [length, setLength] = useState<number | ''>(link0?.length ?? '');
  const [newKind, setNewKind] = useState<PoolKind>('operator');

  const pick = (id: string) => {
    setPoolId(id);
    const p = pools.find((x) => x.id === id);
    if (p) [setCount, setSpeed, setLoad].forEach((f, i) => f([p.count, p.speed, p.loadTime][i]));
  };
  const outs = model.nodes.filter((n) => n.type !== 'sink');
  const ins = model.nodes.filter((n) => n.type !== 'source' && n.id !== from);
  const ppm = model.settings.pxPerMeter || 40;
  const a = model.nodes.find((n) => n.id === from);
  const b = model.nodes.find((n) => n.id === to);
  const drawn = a && b ? polyLength(polyline(a, b, link0 && link0.from === from && link0.to === to ? link0.path : undefined)) / ppm : 0;
  const dist = length === '' ? drawn : Number(length);

  // conta de bolso: viagens por hora que a linha pede × que o recurso aguenta
  const takt = effectiveTakt(model);
  const est = useMemo(() => {
    const trip = (2 * dist) / Math.max(0.05, speed) + 2 * load;
    const need = takt > 0 ? 3600 / takt / Math.max(1, batch) : 0;
    const cap = trip > 0 ? (3600 / trip) * Math.max(1, count) : 0;
    return { trip, need, cap, use: cap > 0 ? need / cap : 0 };
  }, [dist, speed, load, takt, batch, count]);

  const existing = model.links.find((l) => l.from === from && l.to === to);
  const ok = !!from && !!to && from !== to && (poolId !== '__new' || !!newKind);

  const save = () => {
    const st = useStore.getState();
    let m = structuredClone(model);
    let pid = poolId;
    if (pid === '__new') {
      const p = makePool(newKind, { name: `${KIND_PT[newKind]} ${(m.pools ?? []).filter((x) => x.kind === newKind).length + 1}`, count, speed, loadTime: load, x: a?.x ?? 0, y: (a?.y ?? 0) + 40 });
      m.pools = [...(m.pools ?? []), p];
      pid = p.id;
    } else {
      m.pools = (m.pools ?? []).map((p) => (p.id === pid ? { ...p, count, speed, loadTime: load } : p));
    }
    const patch: Partial<LinkDef> = {
      poolId: pid,
      role: role === 'part' ? 'part' : undefined,
      length: length === '' ? undefined : Number(length),
      tripQty: batch > 1 ? batch : undefined,
      partQty: role === 'part' && partQty > 1 ? partQty : undefined,
    };
    const target = existing ?? (link0 && !model.links.some((l) => l.id !== link0.id && l.from === from && l.to === to) ? link0 : undefined);
    if (target) m.links = m.links.map((l) => (l.id === target.id ? { ...l, from, to, ...patch } : l));
    else m.links = [...m.links, { id: newId('L'), from, to, weight: 1, ...patch }];
    // o destino precisa ter lugar para a viagem inteira (fila de entrada ou estoque de componentes)
    let grew = '';
    m.nodes = m.nodes.map((n) => {
      if (n.id !== to || batch <= 1) return n;
      if (role === 'part') {
        const kits = Math.ceil(batch / Math.max(1, partQty));
        if ((n.partBuffer ?? 2) >= kits) return n;
        grew = ` Estoque de componentes de ${n.name} subiu para ${kits} kits.`;
        return { ...n, partBuffer: kits };
      }
      if (n.queueCap + Math.max(1, n.capacity) >= batch) return n;
      grew = ` Fila de entrada de ${n.name} subiu para ${batch - Math.max(1, n.capacity)} para caber a viagem.`;
      return { ...n, queueCap: batch - Math.max(1, n.capacity) };
    });
    const pname = m.pools.find((p) => p.id === pid)?.name;
    st.setModel(m, `"${pname}" leva ${role === 'part' ? 'o componente' : 'a peça'} de ${a?.name} para ${b?.name}${batch > 1 ? `, ${batch} por viagem` : ''}.${grew} Rode ▶ Start para ver.`);
    onClose();
  };
  const unbind = () => {
    if (!existing) return;
    useStore.getState().updateLink(existing.id, { poolId: undefined });
    useStore.getState().setMessage(`Trecho ${a?.name} → ${b?.name} volta a ser esteira/automático.`);
    onClose();
  };

  return (
    <Modal title="Vínculo de transporte" sub="Quem leva a peça, de onde (posto de entrada) para onde (posto de saída) e quanto por viagem." onClose={onClose} wide>
      <HowTo
        title="Como vincular um operador (ou AGV/AMR) a um transporte"
        why="O recurso fica parado no ponto de espera. Quando o posto de entrada termina a peça, ele anda até lá, pega, leva até o posto de saída e volta. Se estiver ocupado, a peça espera (estado Espera operador/transporte)."
        steps={[
          'No layout, segure Ctrl e clique no operador (ou AGV/AMR). Depois segure Ctrl e clique na seta do trecho. Esta janela abre.',
          'Confira o posto de entrada (onde ele pega) e o posto de saída (onde entrega). Pode trocar aqui.',
          'Diga se vai o produto da linha ou um componente que será montado no posto de saída.',
          'Peças por viagem: as peças prontas esperam na saída do posto de entrada até completar a viagem (o posto continua produzindo). O destino ganha lugar para a viagem inteira.',
          'Veja a conta de bolso: ocupação acima de 85% indica que vai faltar recurso. Salve e rode ▶ Start.',
        ]}
        tip="Também dá para arrastar o bonequinho e soltar na seta. Para apagar um recurso, clique nele e use Apagar no painel da direita (ou Delete)."
        open
      />
      <div className="fields section">
        <label className="field">
          <span>Quem transporta</span>
          <select value={poolId} onChange={(e) => pick(e.target.value)}>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({KIND_PT[p.kind]}, {p.count})</option>
            ))}
            <option value="__new">+ Novo recurso…</option>
          </select>
        </label>
        {poolId === '__new' && (
          <label className="field">
            <span>Tipo do novo recurso</span>
            <select value={newKind} onChange={(e) => setNewKind(e.target.value as PoolKind)}>
              {(Object.keys(KIND_PT) as PoolKind[]).map((k) => (
                <option key={k} value={k}>{KIND_PT[k]}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Posto de entrada (pega a peça: output)</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Escolha…</option>
            {outs.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Posto de saída (entrega a peça: input)</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Escolha…</option>
            {ins.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>O que leva</span>
          <select value={role} onChange={(e) => setRole(e.target.value as 'flow' | 'part')}>
            <option value="flow">Produto da linha (segue o fluxo)</option>
            <option value="part">Componente para montagem no posto de saída (kit)</option>
          </select>
        </label>
        {role === 'part' && (
          <label className="field">
            <span>Peças deste componente por produto</span>
            <input type="number" min={1} step={1} value={partQty} onChange={(e) => setPartQty(Math.max(1, Math.round(Number(e.target.value))))} />
          </label>
        )}
        <label className="field">
          <span>Peças por viagem</span>
          <input type="number" min={1} step={1} value={batch} onChange={(e) => setBatch(Math.max(1, Math.round(Number(e.target.value))))} />
        </label>
        <label className="field">
          <span>Quantidade de {poolId === '__new' ? KIND_PT[newKind].toLowerCase() : 'recursos'} no grupo</span>
          <input type="number" min={1} step={1} value={count} onChange={(e) => setCount(Math.max(1, Math.round(Number(e.target.value))))} />
        </label>
        <label className="field">
          <span>Velocidade (m/s)</span>
          <input type="number" min={0.05} step={0.1} value={speed} onChange={(e) => setSpeed(Math.max(0.05, Number(e.target.value)))} />
        </label>
        <label className="field">
          <span>Pegar + soltar (s por ponta)</span>
          <input type="number" min={0} step={1} value={load} onChange={(e) => setLoad(Math.max(0, Number(e.target.value)))} />
        </label>
        <label className="field">
          <span>Distância real (m)</span>
          <input type="number" min={0} step={1} value={length} placeholder={`desenho: ${fmt(drawn, 1)}`} onChange={(e) => setLength(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))} />
        </label>
      </div>
      {fromNode && (fromNode.batchSize ?? 0) > 1 && (
        <p className="hint auto-note bad section">
          {fromNode.name} está com "Agrupar {fromNode.batchSize} peças" no posto: ele espera juntar {fromNode.batchSize} peças na entrada e processa tudo de uma vez. Para transporte, use Peças por viagem aqui.{' '}
          <button className="btn small" onClick={() => useStore.getState().updateNode(fromNode.id, { batchSize: undefined })}>Tirar o agrupamento do posto</button>
        </p>
      )}
      {from && to && (
        <>
          <div className="bind-flow section" aria-label="Resumo do transporte">
            <span className="bind-node">{a?.name}<small>output</small></span>
            <span className="bind-arrow">
              {poolId === '__new' ? `novo ${KIND_PT[newKind]}` : pools.find((p) => p.id === poolId)?.name} · {batch} pç/viagem · {fmt(dist, 1)} m
            </span>
            <span className="bind-node">{b?.name}<small>input{role === 'part' ? ' · montagem' : ''}</small></span>
          </div>
          <div className="tiles section">
            <Kpi k="Viagem ida e volta" v={fmt(est.trip, 0)} u="s" />
            <Kpi k="Viagens pedidas" v={fmt(est.need, 1)} u="por hora (no takt)" />
            <Kpi k="Viagens possíveis" v={fmt(est.cap, 1)} u="por hora" />
            <Kpi k="Ocupação estimada" v={pct(est.use)} u={est.use > 0.85 ? 'vai faltar recurso' : 'ok'} tone={est.use > 0.85 ? 'bad' : undefined} />
          </div>
        </>
      )}
      <div className="row-btns section">
        <button className="btn primary" disabled={!ok} onClick={save}>Salvar vínculo</button>
        {existing?.poolId && <button className="btn" onClick={unbind}>Remover transporte deste trecho</button>}
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
