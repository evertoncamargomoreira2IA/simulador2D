// Painel de propriedades: bloco selecionado, link selecionado ou configuração do modelo.

import { nodeKpi } from '../engine/metrics';
import type { NodeDef, NodeState, NodeType } from '../engine/types';
import { TYPE_LABEL } from '../engine/types';
import { useStore } from '../store';
import { fmt, pct, STATE_LABEL } from './theme';

type FieldDef = { k: keyof NodeDef; label: string; step?: number; scale?: number; types?: NodeType[] };

const PROCESS: NodeType[] = ['machine', 'inspection', 'rework', 'buffer'];
const FIELDS: FieldDef[] = [
  { k: 'cycleTime', label: 'Tempo de ciclo (s)', step: 0.5, types: PROCESS },
  { k: 'cv', label: 'Variação CV (%)', scale: 100, types: PROCESS },
  { k: 'capacity', label: 'Capacidade', step: 1, types: PROCESS },
  { k: 'queueCap', label: 'Fila de entrada', step: 1, types: ['machine', 'inspection', 'rework'] },
  { k: 'setupTime', label: 'Setup (s)', step: 10, types: PROCESS },
  { k: 'availability', label: 'Disponibilidade (%)', scale: 100, types: ['machine', 'inspection', 'rework'] },
  { k: 'mttr', label: 'MTTR (s)', step: 10, types: ['machine', 'inspection', 'rework'] },
  { k: 'interarrival', label: 'Intervalo chegadas (s, 0 = ilimitado)', step: 1, types: ['source'] },
  { k: 'maxArrivals', label: 'Limite de peças (0 = sem)', step: 1, types: ['source'] },
  { k: 'operators', label: 'Operadores', step: 1 },
  { k: 'shifts', label: 'Turnos', step: 1 },
  { k: 'oeeTarget', label: 'OEE meta (%)', scale: 100 },
  { k: 'powerKw', label: 'Potência (kW)', step: 0.1 },
  { k: 'idlePowerKw', label: 'Potência espera (kW)', step: 0.1 },
  { k: 'costPerHour', label: 'Custo/hora (R$)', step: 1 },
  { k: 'co2Factor', label: 'Fator CO2e (kg/kWh)', step: 0.01 },
  { k: 'x', label: 'X', step: 20 },
  { k: 'y', label: 'Y', step: 20 },
];

const STATES: NodeState[] = ['working', 'starved', 'blocked', 'down', 'setup', 'off'];

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
          <p className="sub">{TYPE_LABEL[n.type]} · ID {n.id}</p>
          <div className="fields">
            <label className="field full">
              <span>Nome</span>
              <input id="node-name" value={n.name} onChange={(e) => upd({ name: e.target.value })} />
            </label>
            <label className="field full">
              <span>Tipo</span>
              <select id="node-type" value={n.type} onChange={(e) => upd({ type: e.target.value as NodeType })}>
                {(Object.keys(TYPE_LABEL) as NodeType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </label>
            {FIELDS.filter((f) => !f.types || f.types.includes(n.type)).map((f) => {
              const raw = n[f.k] as number;
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
                      if (Number.isFinite(v)) upd({ [f.k]: v / scale } as Partial<NodeDef>);
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
          <div className="section">
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
        <label className="field">
          <span>Escala (px/m)</span>
          <input id="set-ppm" type="number" min={1} step={5} value={s.pxPerMeter} onChange={(e) => updS({ pxPerMeter: Math.max(1, Number(e.target.value)) })} />
        </label>
      </div>
      <p className="hint section">
        Selecione um bloco para editar tempo de ciclo, capacidade, disponibilidade e os dados de custo, energia e CO2e
        (usados nas próximas sprints). Qualquer edição reinicia a simulação.
      </p>
    </aside>
  );
}
