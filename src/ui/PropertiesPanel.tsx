import { effLabel } from '../engine/types';
import { effectiveTakt } from '../engine/balance';
// Painel de propriedades: bloco selecionado, link selecionado ou configuração do modelo.

import { useState } from 'react';
import { nodeKpi } from '../engine/metrics';
import type { LinkDef, NodeDef, NodeState, NodeType, PoolDef, PoolKind } from '../engine/types';
import { isAssembly, makePool, MANUAL_PATCH, newId, POOL_LABEL, TYPE_LABEL } from '../engine/types';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { fmt, pct, STATE_LABEL } from './theme';

/** `machine`: só faz sentido com máquina (some no posto manual). `assembly`: só na montagem. */
type FieldDef = { k: keyof NodeDef; label: string; step?: number; scale?: number; types?: NodeType[]; machine?: boolean; assembly?: boolean };

const PROCESS: NodeType[] = ['machine', 'inspection', 'rework', 'buffer'];
const FIELDS: FieldDef[] = [
  { k: 'cycleTime', label: 'Tempo de ciclo (s)', step: 0.5, types: PROCESS },
  { k: 'cv', label: 'Variação CV (%)', scale: 100, types: PROCESS },
  { k: 'efficiency', label: 'Eficiência (%)', scale: 100, types: ['machine', 'inspection', 'rework'] },
  { k: 'capacity', label: 'Número de gigas', step: 1, types: PROCESS },
  { k: 'queueCap', label: 'Fila de entrada', step: 1, types: ['machine', 'inspection', 'rework'] },
  { k: 'setupTime', label: 'Setup (s)', step: 10, types: PROCESS, machine: true },
  { k: 'availability', label: 'Disponibilidade (%)', scale: 100, types: ['machine', 'inspection', 'rework'], machine: true },
  { k: 'mttr', label: 'MTTR (s)', step: 10, types: ['machine', 'inspection', 'rework'], machine: true },
  { k: 'interarrival', label: 'Intervalo chegadas (s, 0 = ilimitado)', step: 1, types: ['source'] },
  { k: 'maxArrivals', label: 'Limite de peças (0 = sem)', step: 1, types: ['source'] },
  { k: 'operators', label: 'Operadores', step: 1 },
  { k: 'handlingTime', label: 'Carga+descarga operador (s)', step: 5, types: PROCESS, machine: true },
  { k: 'partBuffer', label: 'Estoque de componentes', step: 1, types: PROCESS, assembly: true },
  { k: 'batchSize', label: 'Agrupar N peças (carrinho/pallet)', step: 1, types: ['machine', 'inspection', 'buffer'] },
  { k: 'shifts', label: 'Turnos', step: 1 },
  { k: 'oeeTarget', label: 'OEE meta (%)', scale: 100, types: PROCESS },
  { k: 'powerKw', label: 'Potência (kW)', step: 0.1, types: ['machine', 'inspection', 'rework'], machine: true },
  { k: 'idlePowerKw', label: 'Potência espera (kW)', step: 0.1, types: ['machine', 'inspection', 'rework'], machine: true },
  { k: 'costPerHour', label: 'Custo máquina/hora (R$)', step: 1, types: PROCESS, machine: true },
  { k: 'co2Factor', label: 'Fator CO2e (kg/kWh)', step: 0.01, types: ['machine', 'inspection', 'rework'], machine: true },
  { k: 'x', label: 'X', step: 20 },
  { k: 'y', label: 'Y', step: 20 },
];

const STATES: NodeState[] = ['working', 'starved', 'blocked', 'resource', 'down', 'setup', 'off'];

export function PropertiesPanel() {
  const model = useStore((s) => s.model);
  const selected = useStore((s) => s.selected);
  const selectedLink = useStore((s) => s.selectedLink);
  useStore((s) => s.kpi);
  const sim = useStore((s) => s.sim);
  const selectedPool = useStore((s) => s.selectedPool);

  const pool = selectedPool ? model.pools?.find((p) => p.id === selectedPool) : undefined;
  if (pool) return <PoolPanel p={pool} />;

  if (selectedLink) {
    const l = model.links.find((x) => x.id === selectedLink);
    if (l) {
      const from = model.nodes.find((n) => n.id === l.from);
      const to = model.nodes.find((n) => n.id === l.to);
      const rt = sim.links.find((x) => x.def.id === l.id);
      return (
        <aside className="props">
          <h2>Fluxo</h2>
          <p className="sub">{from?.name} → {to?.name}</p>
          <div className="fields">
            <label className="field full">
              <span>Peso de roteamento (proporção entre saídas)</span>
              <input id="link-weight" type="number" min={0} step={1} value={l.weight} onChange={(e) => useStore.getState().updateLink(l.id, { weight: Number(e.target.value) })} />
            </label>
            <label className="field full">
              <span>Distância real (m, vazio = medida no desenho)</span>
              <input id="link-length" type="number" min={0} step={10} value={l.length ?? ''} placeholder={fmt(rt?.distance ?? 0, 1)} onChange={(e) => {
                const v = Number(e.target.value);
                useStore.getState().updateLink(l.id, { length: e.target.value === '' || !(v > 0) ? undefined : v });
              }} />
            </label>
            <div className="field full trail">
              <span>Trilha do transporte {l.path?.length ? `(${l.path.length} ponto${l.path.length > 1 ? 's' : ''} de curva)` : '(reta)'}</span>
              <p className="muted small">Arraste o <b>＋</b> no meio da seta para criar uma curva. Arraste o ponto azul para mover; duplo clique apaga. A peça e o operador seguem a trilha e a distância passa a ser medida por ela.</p>
              <div className="row-btns">
                {from && to && (
                  <button className="btn" onClick={() => useStore.getState().updateLink(l.id, { path: [{ x: to.x, y: from.y }] })} title="Uma curva de 90°: anda na horizontal e depois na vertical">
                    ↱ Trilha em L
                  </button>
                )}
                {from && to && (
                  <button className="btn" onClick={() => useStore.getState().updateLink(l.id, { path: [{ x: from.x, y: to.y }] })} title="Anda na vertical e depois na horizontal">
                    ↳ L invertido
                  </button>
                )}
                {!!l.path?.length && (
                  <button className="btn ghost" onClick={() => useStore.getState().updateLink(l.id, { path: undefined })}>
                    Deixar reta
                  </button>
                )}
              </div>
            </div>
            <button className="btn primary full" onClick={() => useStore.getState().setTransportFor({ linkId: l.id, poolId: l.poolId })}>
              🚚 Vincular transporte (operador, AGV, AMR)…
            </button>
            {!!l.poolId && (l.tripQty ?? 1) > 1 && (
              <label className="field full">
                <span>Carrinhos/bins deste item atrás de {to?.name} ({l.tripQty} peças cada)</span>
                <input id="link-bins" type="number" min={1} step={1} value={l.bins ?? 2} onChange={(e) => {
                  const v = Math.max(1, Math.round(Number(e.target.value)));
                  useStore.getState().updateLink(l.id, { bins: v === 2 ? undefined : v });
                }} />
              </label>
            )}
            <label className="field full check">
              <input id="link-once" type="checkbox" checked={!!l.once} onChange={(e) => useStore.getState().updateLink(l.id, { once: e.target.checked || undefined })} />
              <span>Cada peça passa só uma vez (amostra que volta ao posto, ex.: OBA)</span>
            </label>
            <label className="field full">
              <span>Papel do fluxo</span>
              <select id="link-role" value={l.role ?? 'flow'} onChange={(e) => useStore.getState().updateLink(l.id, { role: e.target.value as LinkDef['role'] })}>
                <option value="flow">Fluxo principal (a peça segue)</option>
                <option value="part">Componente (consumido na montagem)</option>
              </select>
            </label>
            <label className="field full">
              <span>Transporte</span>
              <TransportSelect linkId={l.id} />
            </label>
          </div>
          <dl className="kv section">
            <dt>Distância</dt><dd>{fmt(rt?.distance ?? 0, 1)} m</dd>
            <dt>Tempo de transporte</dt><dd>{fmt(rt?.travelTime ?? 0, 1)} s</dd>
            <dt>Peças movimentadas</dt><dd>{rt?.moved ?? 0}</dd>
          </dl>
          <div className="section">
            <button className="btn" onClick={() => useStore.getState().deleteSelection()}>Apagar fluxo</button>
          </div>
        </aside>
      );
    }
  }

  if (selected.length === 1) {
    const n = model.nodes.find((x) => x.id === selected[0]);
    const rt = sim.byId.get(selected[0]);
    if (n && rt) {
      const k = nodeKpi(sim, rt);
      const total = STATES.reduce((s, x) => s + k.states[x], 0) || 1;
      const upd = (patch: Partial<NodeDef>) => useStore.getState().updateNode(n.id, patch);
      return (
        <aside className="props">
          <h2>{n.name}</h2>
          <p className="sub">{isAssembly(n, model.links) ? 'Montagem' : n.manual ? 'Posto manual' : TYPE_LABEL[n.type]} · ID {n.id}</p>
          {(n.type === 'machine' || n.type === 'inspection' || n.type === 'rework') && (
            <button className="btn primary ops-btn" onClick={() => useStore.getState().setOpsFor(n.id)}>
              Operações e atividades{n.operations?.length ? ` (${n.operations.reduce((s, o) => s + o.activities.length, 0)})` : ''}
            </button>
          )}
          <div className="fields">
            <label className="field full">
              <span>Nome</span>
              <input id="node-name" value={n.name} onChange={(e) => upd({ name: e.target.value })} />
            </label>
            <label className="field full">
              <span>Tipo</span>
              <select
                id="node-type"
                value={isAssembly(n, model.links) ? 'assembly' : n.manual ? 'manual' : n.type}
                onChange={(e) =>
                  e.target.value === 'assembly'
                    ? upd({ type: 'machine', assembly: true, manual: false, partBuffer: n.partBuffer ?? 2 })
                    : e.target.value === 'manual'
                      ? upd({ ...MANUAL_PATCH, type: 'machine', operators: Math.max(1, n.operators) })
                      : upd({ type: e.target.value as NodeType, assembly: false, manual: false })
                }
              >
                {(Object.keys(TYPE_LABEL) as NodeType[]).flatMap((t) => [
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>,
                  ...(t === 'machine'
                    ? [<option key="manual" value="manual">Posto manual (só operador)</option>, <option key="assembly" value="assembly">Montagem (junta kits)</option>]
                    : []),
                ])}
              </select>
            </label>
            {isAssembly(n, model.links) && (
              <p className="hint full">
                {model.links.some((l) => l.to === n.id && l.role === 'part')
                  ? `Recebe ${model.links.filter((l) => l.to === n.id && l.role === 'part').length} componente(s). Só começa com o produto e um kit de cada.`
                  : 'Ligue os off-lines a este posto e, na ligação, escolha "Componente (consumido na montagem)".'}
              </p>
            )}
            {PROCESS.includes(n.type) && (
              <>
                <label className="field full">
                  <span>Operadores compartilhados (pool)</span>
                  <select id="node-pool" value={n.poolId ?? ''} onChange={(e) => upd({ poolId: e.target.value || undefined })}>
                    <option value="">Nenhum (operador fixo no posto)</option>
                    {(model.pools ?? []).filter((p) => p.kind === 'operator').map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.count})</option>
                    ))}
                  </select>
                </label>
                {!n.poolId && (n.operators ?? 0) > 0 && (
                  <>
                    <label className="field full">
                      <span>Posição do colaborador</span>
                      <select id="node-crew" value={n.crewOffset ? 'livre' : n.crewSide ?? 'top'} onChange={(e) => e.target.value !== 'livre' && upd({ crewSide: e.target.value as NodeDef['crewSide'], crewOffset: undefined })}>
                        <option value="top">Em cima do bloco</option>
                        <option value="bottom">Embaixo (na frente)</option>
                        <option value="left">À esquerda</option>
                        <option value="right">À direita</option>
                        {n.crewOffset && <option value="livre">Posição livre (arrastada)</option>}
                      </select>
                    </label>
                    <p className="hint full">Também dá para arrastar o bonequinho no layout para qualquer lugar em volta do posto.</p>
                  </>
                )}
                <label className="field">
                  <span>Área das gigas L (px)</span>
                  <input id="node-area-w" type="number" min={0} step={10} value={n.area?.w ?? 0} onChange={(e) => {
                    const w = Number(e.target.value);
                    upd({ area: w > 0 ? { w, h: n.area?.h ?? 40 } : undefined });
                  }} />
                </label>
                <label className="field">
                  <span>Área das gigas A (px)</span>
                  <input id="node-area-h" type="number" min={0} step={10} value={n.area?.h ?? 0} disabled={!n.area} onChange={(e) => n.area && upd({ area: { ...n.area, h: Math.max(0, Number(e.target.value)) } })} />
                </label>
              </>
            )}
            {n.type !== 'source' && n.type !== 'sink' && (
              <label className="field full check">
                <input id="node-fixed" type="checkbox" checked={!!n.fixedTime} onChange={(e) => upd({ fixedTime: e.target.checked || undefined })} />
                <span>Tempo fixo (a calibração para o takt não altera)</span>
              </label>
            )}
            {n.type !== 'source' && (
              <label className="field full check">
                <input id="node-output" type="checkbox" checked={!!n.outputPoint} onChange={(e) => upd({ outputPoint: e.target.checked || undefined })} />
                <span>Medir a produção da linha aqui (throughput, lead time e takt)</span>
              </label>
            )}
            {FIELDS.filter(
              (f) =>
                (!f.types || f.types.includes(n.type)) &&
                !(f.machine && n.manual) &&
                !(f.assembly && !isAssembly(n, model.links)),
            ).map((f) => {
              const raw = (n[f.k] as number | undefined) ?? (f.k === 'efficiency' ? 1 : 0);
              const scale = f.scale ?? 1;
              return (
                <label key={f.k} className="field">
                  <span>{f.k === 'capacity' && n.type === 'buffer' ? 'Capacidade (peças)' : f.label}{f.k === 'capacity' && n.type !== 'buffer' && <GigasInfo />}</span>
                  <input
                    id={`node-${f.k}`}
                    type="number"
                    step={f.step ?? (scale === 100 ? 1 : 1)}
                    value={Math.round(raw * scale * 1000) / 1000}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) upd({ [f.k]: f.k === 'efficiency' ? (v > 0 && v < 100 ? v / scale : undefined) : v / scale } as Partial<NodeDef>);
                    }}
                  />
                </label>
              );
            })}
          </div>

          <Combine nodeId={n.id} />
          <Supply nodeId={n.id} />

          <div className="section">
            <p className="label">Resultado no momento</p>
            <span className="pill" style={{ background: `var(--st-${k.state})` }}>{STATE_LABEL[k.state]}</span>
            <div className="statebar" aria-label="Distribuição de estados">
              {STATES.map((s) => (
                <div key={s} style={{ width: `${(k.states[s] / total) * 100}%`, background: `var(--st-${s})` }} title={`${STATE_LABEL[s]}: ${pct(k.states[s] / total)}`} />
              ))}
            </div>
            <dl className="kv">
              <dt>Processadas</dt><dd>{k.processed}</dd>
              <dt>Utilização</dt><dd>{pct(k.utilization, 1)}</dd>
              <dt>Disponibilidade</dt><dd>{pct(k.availability, 1)}</dd>
              <dt>Performance</dt><dd>{pct(k.performance, 1)}</dd>
              <dt>Qualidade</dt><dd>{pct(k.quality, 1)}</dd>
              <dt title={n.manual ? 'Overall labor effectiveness: disponibilidade × desempenho × qualidade da mão de obra' : 'Overall equipment effectiveness'}>{effLabel(n)}</dt><dd>{pct(k.oee, 1)}</dd>
              <dt>WIP no posto</dt><dd>{k.wip}</dd>
              <dt>Falhas</dt><dd>{k.failures}</dd>
            </dl>
          </div>
          <div className="section row-btns">
            <button className="btn primary" onClick={() => useStore.getState().setDetail(n.id)}>Todos os indicadores</button>
            <button className="btn" onClick={() => useStore.getState().deleteSelection()}>Apagar bloco</button>
          </div>
        </aside>
      );
    }
  }

  const s = model.settings;
  const updS = useStore.getState().updateSettings;
  return (
    <aside className="props">
      <h2>Modelo</h2>
      <p className="sub">
        {model.nodes.length} blocos · {model.links.length} fluxos
        {selected.length > 1 ? ` · ${selected.length} selecionados` : ''}
      </p>
      <div className="fields">
        <label className="field full">
          <span>Nome</span>
          <input id="model-name" value={model.name} onChange={(e) => useStore.getState().setModel({ ...model, name: e.target.value }, 'Nome atualizado.')} />
        </label>
        <label className="field">
          <span>Duração (h)</span>
          <input id="set-duration" type="number" min={0.1} step={0.5} value={s.duration / 3600} onChange={(e) => updS({ duration: Math.max(60, Number(e.target.value) * 3600) })} />
        </label>
        <label className="field">
          <span>Aquecimento (min)</span>
          <input id="set-warmup" type="number" min={0} step={5} value={s.warmup / 60} onChange={(e) => updS({ warmup: Math.max(0, Number(e.target.value) * 60) })} />
        </label>
        <label className="field">
          <span>Meta UPH (peças/h)</span>
          <input
            id="set-uph"
            type="number"
            min={0}
            step={1}
            value={s.takt > 0 ? Math.round((3600 / s.takt) * 10) / 10 : ''}
            placeholder="auto"
            onChange={(e) => {
              const u = Number(e.target.value);
              updS({ takt: u > 0 ? Math.round((3600 / u) * 1000) / 1000 : 0 });
            }}
          />
        </label>
        <label className="field">
          <span>Takt (s)</span>
          <input id="set-takt" type="number" min={0} step={0.5} value={s.takt || ''} placeholder={`auto ${effectiveTakt(model).toFixed(1)}`} onChange={(e) => updS({ takt: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Semente</span>
          <input id="set-seed" type="number" step={1} value={s.seed} onChange={(e) => updS({ seed: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Transporte (m/s)</span>
          <input id="set-speed" type="number" min={0} step={0.1} value={s.transportSpeed} onChange={(e) => updS({ transportSpeed: Number(e.target.value) })} />
        </label>
        <label className="field full">
          <span>Estudo por</span>
          <select id="set-study" value={s.studyMode ?? 'cycle'} onChange={(e) => updS({ studyMode: e.target.value as 'cycle' | 'elements' })}>
            <option value="cycle">Cycle time do posto</option>
            <option value="elements">Elemento (soma das atividades)</option>
          </select>
        </label>
        <label className="field full check">
          <input id="set-full" type="checkbox" checked={!!s.startFull} onChange={(e) => updS({ startFull: e.target.checked })} />
          <span>Linha cheia desde o início (ignora a rampa e mostra o UPH real)</span>
        </label>
        <button className="btn full shift-btn" onClick={() => useStore.getState().setAnalysis('turnos')}>
          ⏱ Turno e paradas{s.stops?.length ? ` (${s.stops.length}: ${s.stops.reduce((a, x) => a + x.duration, 0)} min)` : ' (almoço, ginástica, troca)'}
        </button>
        <label className="field">
          <span>Escala (px/m)</span>
          <input id="set-ppm" type="number" min={1} step={5} value={s.pxPerMeter} onChange={(e) => updS({ pxPerMeter: Math.max(1, Number(e.target.value)) })} />
        </label>
      </div>
      {model.background && <PlantControls />}
      <Resources pools={model.pools ?? []} />
      <TransportTasks />
      <p className="hint section">
        Selecione um bloco para editar tempo de ciclo, gigas, disponibilidade e os dados de custo, energia e CO2e
        (usados nas próximas sprints). Qualquer edição reinicia a simulação.
      </p>
    </aside>
  );
}

const KINDS: PoolKind[] = ['operator', 'forklift', 'agv', 'amr'];

function Resources({ pools }: { pools: PoolDef[] }) {
  const st = useStore.getState;
  const set = (next: PoolDef[]) => st().patchModel({ pools: next });
  const upd = (id: string, patch: Partial<PoolDef>) => set(pools.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = (kind: PoolKind) => {
    const m = st().model;
    const xs = m.nodes.map((n) => n.x);
    const ys = m.nodes.map((n) => n.y);
    const x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 200;
    const y = ys.length ? Math.max(...ys) + 80 : 200;
    set([...pools, makePool(kind, { name: `${POOL_LABEL[kind]} ${pools.filter((p) => p.kind === kind).length + 1}`, x: Math.round(x), y: Math.round(y) })]);
  };
  const remove = (id: string) => {
    const m = st().model;
    st().patchModel({
      pools: pools.filter((p) => p.id !== id),
      nodes: m.nodes.map((n) => (n.poolId === id ? { ...n, poolId: undefined } : n)),
      links: m.links.map((l) => (l.poolId === id ? { ...l, poolId: undefined } : l)),
    });
  };
  return (
    <div className="section">
      <p className="label">Recursos (pessoas e veículos)</p>
      {pools.length === 0 && <p className="hint">Nenhum recurso. Adicione um grupo de operadores e ligue-o aos postos, ou um veículo e ligue-o a um fluxo.</p>}
      {pools.map((p) => (
        <div key={p.id} className="pool">
          <div className="pool-head">
            <i className={`kind ${p.kind}`} />
            <input aria-label="Nome do recurso" value={p.name} onChange={(e) => upd(p.id, { name: e.target.value })} />
            <button className="btn icon" onClick={() => remove(p.id)} title="Remover recurso" aria-label="Remover recurso">×</button>
          </div>
          <div className="fields">
            <label className="field">
              <span>Quantidade</span>
              <input type="number" min={1} step={1} value={p.count} onChange={(e) => upd(p.id, { count: Math.max(1, Math.round(Number(e.target.value))) })} />
            </label>
            <label className="field">
              <span>Velocidade (m/s)</span>
              <input type="number" min={0.1} step={0.1} value={p.speed} onChange={(e) => upd(p.id, { speed: Math.max(0.1, Number(e.target.value)) })} />
            </label>
            {p.kind !== 'operator' && (
              <>
                <label className="field">
                  <span>Custo (R$/h)</span>
                  <input type="number" min={0} step={1} value={p.costPerHour ?? 0} onChange={(e) => upd(p.id, { costPerHour: Math.max(0, Number(e.target.value)) })} />
                </label>
                <label className="field">
                  <span>Potência (kW)</span>
                  <input type="number" min={0} step={0.1} value={p.powerKw ?? 0} onChange={(e) => upd(p.id, { powerKw: Math.max(0, Number(e.target.value)) })} />
                </label>
                <label className="field">
                  <span>Combustível (kg CO2e/h)</span>
                  <input type="number" min={0} step={0.1} value={p.fuelCo2 ?? 0} onChange={(e) => upd(p.id, { fuelCo2: Math.max(0, Number(e.target.value)) })} />
                </label>
              </>
            )}
            {p.kind !== 'operator' && (
              <label className="field">
                <span>Carga/descarga (s)</span>
                <input type="number" min={0} step={5} value={p.loadTime} onChange={(e) => upd(p.id, { loadTime: Math.max(0, Number(e.target.value)) })} />
              </label>
            )}
          </div>
        </div>
      ))}
      <div className="row-btns">
        {KINDS.map((k) => (
          <button key={k} className="btn" onClick={() => add(k)}>+ {POOL_LABEL[k]}</button>
        ))}
      </div>
    </div>
  );
}

/** Operador, empilhadeira, AGV ou AMR selecionado no layout: editar tudo, ver vínculos e apagar. */
function PoolPanel({ p }: { p: PoolDef }) {
  const model = useStore((s) => s.model);
  const st = useStore.getState;
  const upd = (patch: Partial<PoolDef>) => st().patchModel({ pools: (model.pools ?? []).map((x) => (x.id === p.id ? { ...x, ...patch } : x)) });
  const name = (id: string) => model.nodes.find((n) => n.id === id)?.name ?? id;
  const posts = model.nodes.filter((n) => n.poolId === p.id);
  const trips = model.links.filter((l) => l.poolId === p.id);
  const num = (k: keyof PoolDef, label: string, min: number, step: number, int = false) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} step={step} value={Number(p[k] ?? 0)} onChange={(e) => upd({ [k]: Math.max(min, int ? Math.round(Number(e.target.value)) : Number(e.target.value)) } as Partial<PoolDef>)} />
    </label>
  );
  return (
    <aside className="props">
      <h2>{POOL_LABEL[p.kind]}</h2>
      <p className="sub">Recurso compartilhado · {posts.length} posto(s) · {trips.length} trecho(s) de transporte</p>
      <div className="fields">
        <label className="field full">
          <span>Nome</span>
          <input value={p.name} onChange={(e) => upd({ name: e.target.value })} />
        </label>
        <label className="field full">
          <span>Tipo</span>
          <select value={p.kind} onChange={(e) => upd({ kind: e.target.value as PoolKind })}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{POOL_LABEL[k]}</option>
            ))}
          </select>
        </label>
        {num('count', 'Quantidade', 1, 1, true)}
        {num('speed', 'Velocidade (m/s)', 0.05, 0.1)}
        {num('loadTime', 'Pegar/soltar (s)', 0, 1)}
        {num('costPerHour', 'Custo (R$/h)', 0, 1)}
        {p.kind !== 'operator' && num('powerKw', 'Potência (kW)', 0, 0.1)}
        {p.kind !== 'operator' && num('fuelCo2', 'Combustível (kg CO2e/h)', 0, 0.1)}
      </div>
      <div className="section">
        <p className="label">Postos que ele opera</p>
        {posts.length === 0 && <p className="hint">Nenhum. Arraste o recurso até um posto para ele operar o posto.</p>}
        {posts.map((n) => (
          <div key={n.id} className="bind-row">
            <span>{n.name}</span>
            <button className="btn icon" aria-label={`Desvincular de ${n.name}`} onClick={() => st().updateNode(n.id, { poolId: undefined })}>×</button>
          </div>
        ))}
        <p className="label">Transportes (entrada → saída)</p>
        {trips.length === 0 && <p className="hint">Nenhum. Ctrl+clique no recurso e na seta, ou use o botão abaixo.</p>}
        {trips.map((l) => (
          <div key={l.id} className="bind-row">
            <button className="link" onClick={() => st().setTransportFor({ poolId: p.id, linkId: l.id })}>{name(l.from)} → {name(l.to)}{l.role === 'part' ? ' (kit)' : ''}</button>
            <button className="btn icon" aria-label="Tirar este transporte" onClick={() => st().updateLink(l.id, { poolId: undefined })}>×</button>
          </div>
        ))}
      </div>
      <div className="row-btns section">
        <button className="btn primary" onClick={() => st().setTransportFor({ poolId: p.id })}>Vincular a um transporte…</button>
        <button className="btn danger" onClick={() => st().deleteSelection()}>Apagar {POOL_LABEL[p.kind].toLowerCase()}</button>
      </div>
      <p className="hint">Delete também apaga. Ctrl+Z desfaz. Clique no fundo do layout para voltar ao painel do modelo.</p>
    </aside>
  );
}

/** Ajuste da planta de fundo (DXF ou imagem): tamanho, posição e transparência, sem mexer nos blocos. */
function PlantControls() {
  const bg = useStore((s) => s.model.background)!;
  const ppm = useStore((s) => s.model.settings.pxPerMeter) || 40;
  const set = (patch: Partial<NonNullable<typeof bg>>) => useStore.getState().patchModel({ background: { ...bg, ...patch } });
  const scale = bg.scale ?? 1;
  const zoom = (f: number) => {
    // mantém o centro da planta no lugar
    const k = Math.min(20, Math.max(0.05, scale * f));
    const cx = (bg.dx ?? 0) + (bg.width * scale) / 2;
    const cy = (bg.dy ?? 0) + (bg.height * scale) / 2;
    set({ scale: k, dx: cx - (bg.width * k) / 2, dy: cy - (bg.height * k) / 2 });
  };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return (
    <div className="section">
      <p className="label">Planta de fundo</p>
      <div className="fields">
        <label className="field full">
          <span>Tamanho (%)</span>
          <span className="stepper">
            <button className="btn icon" onClick={() => zoom(1 / 1.1)} aria-label="Diminuir planta">−</button>
            <input id="bg-scale" type="number" min={5} step={5} value={r1(scale * 100)} onChange={(e) => Number(e.target.value) > 0 && zoom(Number(e.target.value) / 100 / scale)} />
            <button className="btn icon" onClick={() => zoom(1.1)} aria-label="Aumentar planta">+</button>
          </span>
        </label>
        <label className="field">
          <span>Mover X (m)</span>
          <input id="bg-dx" type="number" step={0.5} value={r1((bg.dx ?? 0) / ppm)} onChange={(e) => set({ dx: Number(e.target.value) * ppm })} />
        </label>
        <label className="field">
          <span>Mover Y (m)</span>
          <input id="bg-dy" type="number" step={0.5} value={r1((bg.dy ?? 0) / ppm)} onChange={(e) => set({ dy: Number(e.target.value) * ppm })} />
        </label>
        <label className="field">
          <span>Opacidade (%)</span>
          <input id="bg-op" type="number" min={5} max={100} step={5} value={Math.round((bg.opacity ?? (bg.image ? 0.55 : 1)) * 100)} onChange={(e) => set({ opacity: Math.min(1, Math.max(0.05, Number(e.target.value) / 100)) })} />
        </label>
        <label className="field">
          <span>Largura (m)</span>
          <input readOnly value={r1((bg.width * scale) / ppm)} />
        </label>
        <div className="row-btns full">
          <button className="btn" onClick={() => set({ scale: 1, dx: 0, dy: 0, opacity: undefined })}>Original</button>
          <button className="btn danger" onClick={() => useStore.getState().patchModel({ background: undefined })}>Remover planta</button>
        </div>
      </div>
      <p className="hint">Ajusta só o desenho de fundo; os blocos ficam onde estão. Ctrl+Z desfaz.</p>
    </div>
  );
}

const QUICK: PoolKind[] = ['agv', 'amr', 'forklift', 'operator'];
const NEW_LABEL: Record<PoolKind, string> = { agv: '+ Novo AGV', amr: '+ Novo AMR', forklift: '+ Nova empilhadeira', operator: '+ Novo operador (busca a pé)' };

/**
 * Tarefas de transporte: um recurso busca a peça num ponto (source, posto, máquina)
 * e leva até outro (kanban, buffer, FGI, posto). Cada tarefa é uma ligação com transporte.
 */
function TransportTasks() {
  const model = useStore((s) => s.model);
  const pools = model.pools ?? [];
  const [pool, setPool] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const name = (id: string) => model.nodes.find((n) => n.id === id)?.name ?? id;
  const tasks = model.links.filter((l) => l.poolId);
  const froms = model.nodes.filter((n) => n.type !== 'sink');
  const tos = model.nodes.filter((n) => n.type !== 'source' && n.id !== from);
  const add = () => {
    const st = useStore.getState();
    let pid = pool;
    const a = model.nodes.find((n) => n.id === from);
    if (!a || !to) return;
    if (pid.startsWith('+')) pid = newPoolNear(pid.slice(1) as PoolKind, a.x, a.y);
    if (!pid) return;
    const m = useStore.getState().model;
    const l = m.links.find((x) => x.from === from && x.to === to);
    if (l) st.updateLink(l.id, { poolId: pid });
    else {
      st.patchModel({ links: [...m.links, { id: newId('L'), from, to, weight: 1, poolId: pid }] });
      st.setMessage(`Tarefa criada: ${name(from)} → ${name(to)}. Como é um fluxo novo, "${name(from)}" divide as peças entre as saídas pelo peso (ajuste clicando na ligação).`);
    }
    setFrom('');
    setTo('');
  };
  return (
    <div className="section tasks">
      <p className="label">Tarefas de transporte (pick-up e entrega)</p>
      {tasks.length === 0 && <p className="hint">Nenhuma. Escolha quem leva, onde busca e onde entrega (kanban, buffer, FGI, outro posto).</p>}
      {tasks.map((l) => {
        const p = pools.find((x) => x.id === l.poolId);
        return (
          <div key={l.id} className="task">
            <i className={`kind ${p?.kind ?? ''}`} />
            <button className="link" onClick={() => useStore.getState().select([], l.id)} title="Abrir a ligação">
              <b>{p?.name ?? '?'}</b> · {name(l.from)} → {name(l.to)}
            </button>
            <button className="btn icon" aria-label="Tirar o transporte desta ligação" title="Volta a ser esteira/automático" onClick={() => useStore.getState().updateLink(l.id, { poolId: undefined })}>×</button>
          </div>
        );
      })}
      <div className="fields">
        <label className="field full">
          <span>Quem leva</span>
          <select id="task-pool" value={pool} onChange={(e) => setPool(e.target.value)}>
            <option value="">Escolha…</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({POOL_LABEL[p.kind].toLowerCase()}, {p.count})</option>
            ))}
            {QUICK.map((k) => (
              <option key={k} value={`+${k}`}>{NEW_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Busca em</span>
          <select id="task-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Origem…</option>
            {froms.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Entrega em</span>
          <select id="task-to" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Destino…</option>
            {tos.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn primary" disabled={!pool || !from || !to} onClick={add}>Criar tarefa</button>
    </div>
  );
}

/** Cria um recurso perto do posto e devolve o id. */
function newPoolNear(kind: PoolKind, x: number, y: number): string {
  const st = useStore.getState();
  const pools = st.model.pools ?? [];
  const p = makePool(kind, { name: `${POOL_LABEL[kind]} ${pools.filter((q) => q.kind === kind).length + 1}`, x: Math.round(x), y: Math.round(y + 70) });
  st.patchModel({ pools: [...pools, p] });
  return p.id;
}

/** Quem leva a peça neste fluxo: esteira (automático) ou um recurso (AGV, empilhadeira, operador). */
function TransportSelect({ linkId }: { linkId: string }) {
  const model = useStore((s) => s.model);
  const l = model.links.find((x) => x.id === linkId);
  if (!l) return null;
  const from = model.nodes.find((n) => n.id === l.from);
  const pools = model.pools ?? [];
  return (
    <select
      id={`link-pool-${l.id}`}
      value={l.poolId ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        const st = useStore.getState();
        if (v.startsWith('+')) {
          const id = newPoolNear(v.slice(1) as PoolKind, from?.x ?? 200, from?.y ?? 200);
          st.updateLink(l.id, { poolId: id });
        } else st.updateLink(l.id, { poolId: v || undefined });
      }}
    >
      <option value="">Esteira / automático</option>
      {pools.map((p) => (
        <option key={p.id} value={p.id}>{p.name} ({POOL_LABEL[p.kind].toLowerCase()}, {p.count})</option>
      ))}
      {QUICK.map((k) => (
        <option key={k} value={`+${k}`}>{NEW_LABEL[k]}</option>
      ))}
    </select>
  );
}

/** Entradas do posto: de onde vem cada peça e quem busca (AGV, empilhadeira, operador ou esteira). */
function Supply({ nodeId }: { nodeId: string }) {
  const model = useStore((s) => s.model);
  const ins = model.links.filter((l) => l.to === nodeId);
  if (ins.length === 0) return null;
  const name = (id: string) => model.nodes.find((n) => n.id === id)?.name ?? id;
  return (
    <div className="section">
      <p className="label">Busca de peça / transporte</p>
      <div className="fields">
        {ins.map((l) => (
          <label key={l.id} className="field full">
            <span>
              De {name(l.from)}
              {l.role === 'part' ? ' (componente)' : ''}
            </span>
            <TransportSelect linkId={l.id} />
          </label>
        ))}
      </div>
      <p className="hint">Com AGV, empilhadeira ou operador, a peça espera pronta no posto de origem até alguém buscar; a distância sai do desenho (ou do campo Distância na ligação).</p>
    </div>
  );
}

/** Combinar peças: o posto recebe peças de vários postos e junta tudo em um produto. */
function Combine({ nodeId }: { nodeId: string }) {
  const model = useStore((s) => s.model);
  const n = model.nodes.find((x) => x.id === nodeId);
  const ins = model.links.filter((l) => l.to === nodeId);
  if (!n || n.type !== 'machine' || ins.length < 2) return null;
  const st = useStore.getState;
  const name = (id: string) => model.nodes.find((x) => x.id === id)?.name ?? id;
  const parts = ins.filter((l) => l.role === 'part');
  const mains = ins.filter((l) => l.role !== 'part');
  const setRole = (l: LinkDef, part: boolean) => {
    st().updateLink(l.id, { role: part ? 'part' : undefined, partQty: part ? l.partQty : undefined });
    if (part && n.partBuffer === undefined) st().updateNode(n.id, { partBuffer: 2 });
  };
  return (
    <div className="section combine">
      <p className="label">Combinar peças neste posto</p>
      <HowTo
        title="Juntar peças de vários postos em um produto"
        why="Quando o posto recebe peças de postos diferentes (ex.: peça 1, 2 e 3) e integra tudo em um produto, ele só pode começar quando tiver uma de cada. Aqui você diz qual entrada vira o produto e quais são consumidas."
        steps={[
          'Ligue no layout cada posto fornecedor a este posto (uma seta por peça).',
          'Escolha uma entrada como Principal: é a peça que segue como produto (a base, a carcaça).',
          'Marque as outras como Componente e diga quantas de cada vão em um produto.',
          'Se as três viram uma peça nova, escolha qualquer uma como Principal e as outras como Componente: o resultado é 1 produto.',
          'Ajuste "Estoque de componentes" (kits que cabem no posto) e rode ▶ Start. O posto fica Esperando peça quando falta algum componente.',
        ]}
        tip="Quem chega primeiro espera na entrada; o posto só começa com o kit completo. O gargalo costuma ser o fornecedor mais lento: veja o estado Esperando peça."
        open={parts.length === 0}
      />
      <p className="hint">Principal = a peça que segue como produto. Componente = consumida na montagem.</p>
      <table className="grid-table combine-table">
        <thead>
          <tr>
            <th>Entrada</th>
            <th>Papel</th>
            <th title="Quantas peças desta entrada vão em 1 produto">Qtd/produto</th>
          </tr>
        </thead>
        <tbody>
          {ins.map((l) => (
            <tr key={l.id}>
              <td>{name(l.from)}</td>
              <td>
                <select aria-label={`Papel da peça de ${name(l.from)}`} value={l.role === 'part' ? 'part' : 'main'} onChange={(e) => setRole(l, e.target.value === 'part')}>
                  <option value="main">Principal</option>
                  <option value="part">Componente</option>
                </select>
              </td>
              <td>
                {l.role === 'part' ? (
                  <input aria-label={`Quantidade de ${name(l.from)} por produto`} type="number" min={1} step={1} value={l.partQty ?? 1} onChange={(e) => {
                    const q = Math.max(1, Math.round(Number(e.target.value)));
                    st().updateLink(l.id, { partQty: q > 1 ? q : undefined });
                  }} />
                ) : (
                  <span className="muted">1</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {parts.length > 0 && mains.length === 0 && <p className="hint auto-note bad">Falta uma entrada Principal: sem ela o posto nunca começa. Troque uma das peças para Principal.</p>}
      {parts.length > 0 && mains.length > 0 && (
        <p className="hint">
          Receita: 1 × {mains.map((l) => name(l.from)).join(' ou ')} + {parts.map((l) => `${l.partQty ?? 1} × ${name(l.from)}`).join(' + ')} → 1 produto. Cabem {n.partBuffer ?? 2} kits no posto.
        </p>
      )}
      {parts.length === 0 && <p className="hint">Hoje as entradas só se somam (cada peça que chega é processada sozinha). Marque Componente para juntar.</p>}
    </div>
  );
}

/** Pop-up do número de gigas: o que é, como calcular e diferença para buffer. */
function GigasInfo() {
  const [open, setOpen] = useState(false);
  return (
    <span className="info-tip">
      <button type="button" className="info-btn" aria-label="O que é número de gigas" aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen(!open); }}>i</button>
      {open && (
        <span className="info-pop" role="dialog">
          <b>Número de gigas</b>
          <span>Quantas peças o posto processa ao mesmo tempo (fixtures / posições paralelas). Não é buffer: a espera antes do posto é a <b>Fila de entrada</b>.</span>
          <span className="info-calc">Gigas = arredondar para cima (ciclo ÷ eficiência ÷ takt)</span>
          <span>Exemplo: 150 s ÷ 0,9 ÷ 32 s = 5,2 → <b>6 gigas</b>.</span>
          <span>Fila de entrada: comece com 2 (ou tempo de reparo ÷ takt) e confirme simulando.</span>
          <button type="button" className="btn small" onClick={(e) => { e.preventDefault(); setOpen(false); }}>Entendi</button>
        </span>
      )}
    </span>
  );
}
