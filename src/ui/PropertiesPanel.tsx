// Painel de propriedades: bloco selecionado, link selecionado ou configuração do modelo.

import { nodeKpi } from '../engine/metrics';
import type { LinkDef, NodeDef, NodeState, NodeType, PoolDef, PoolKind } from '../engine/types';
import { isAssembly, makePool, MANUAL_PATCH, POOL_LABEL, TYPE_LABEL } from '../engine/types';
import { useStore } from '../store';
import { fmt, pct, STATE_LABEL } from './theme';

/** `machine`: só faz sentido com máquina (some no posto manual). `assembly`: só na montagem. */
type FieldDef = { k: keyof NodeDef; label: string; step?: number; scale?: number; types?: NodeType[]; machine?: boolean; assembly?: boolean };

const PROCESS: NodeType[] = ['machine', 'inspection', 'rework', 'buffer'];
const FIELDS: FieldDef[] = [
  { k: 'cycleTime', label: 'Tempo de ciclo (s)', step: 0.5, types: PROCESS },
  { k: 'cv', label: 'Variação CV (%)', scale: 100, types: PROCESS },
  { k: 'efficiency', label: 'Eficiência (%)', scale: 100, types: ['machine', 'inspection', 'rework'] },
  { k: 'capacity', label: 'Capacidade', step: 1, types: PROCESS },
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
              <select id="link-pool" value={l.poolId ?? ''} onChange={(e) => useStore.getState().updateLink(l.id, { poolId: e.target.value || undefined })}>
                <option value="">Esteira / automático</option>
                {(model.pools ?? []).filter((p) => p.kind !== 'operator').map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
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
                  <span>{f.label}</span>
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
              <dt>OEE</dt><dd>{pct(k.oee, 1)}</dd>
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
            value={s.takt > 0 ? Math.round((3600 / s.takt) * 10) / 10 : 0}
            onChange={(e) => {
              const u = Number(e.target.value);
              updS({ takt: u > 0 ? Math.round((3600 / u) * 1000) / 1000 : 0 });
            }}
          />
        </label>
        <label className="field">
          <span>Takt (s)</span>
          <input id="set-takt" type="number" min={0} step={0.5} value={s.takt} onChange={(e) => updS({ takt: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Semente</span>
          <input id="set-seed" type="number" step={1} value={s.seed} onChange={(e) => updS({ seed: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Transporte (m/s)</span>
          <input id="set-speed" type="number" min={0} step={0.1} value={s.transportSpeed} onChange={(e) => updS({ transportSpeed: Number(e.target.value) })} />
        </label>
        <label className="field full check">
          <input id="set-full" type="checkbox" checked={!!s.startFull} onChange={(e) => updS({ startFull: e.target.checked })} />
          <span>Linha cheia desde o início (ignora a rampa e mostra o UPH real)</span>
        </label>
        <label className="field">
          <span>Escala (px/m)</span>
          <input id="set-ppm" type="number" min={1} step={5} value={s.pxPerMeter} onChange={(e) => updS({ pxPerMeter: Math.max(1, Number(e.target.value)) })} />
        </label>
      </div>
      <Resources pools={model.pools ?? []} />
      <p className="hint section">
        Selecione um bloco para editar tempo de ciclo, capacidade, disponibilidade e os dados de custo, energia e CO2e
        (usados nas próximas sprints). Qualquer edição reinicia a simulação.
      </p>
    </aside>
  );
}

const KINDS: PoolKind[] = ['operator', 'forklift', 'agv'];

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
