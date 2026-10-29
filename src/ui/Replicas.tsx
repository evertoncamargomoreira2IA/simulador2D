// Réplicas com variabilidade: o mesmo turno rodado 10 a 30 vezes, com faixa de confiança do UPH.

import { useEffect, useRef, useState } from 'react';
import { effectiveTakt } from '../engine/balance';
import { replicaStats, runReplica, type ReplicaRun } from '../engine/replicas';
import { stopMinutes } from '../engine/types';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Kpi } from './Modal';
import { fmt, pct } from './theme';

export function Replicas() {
  const model = useStore((s) => s.model);
  const [n, setN] = useState(20);
  const [runs, setRuns] = useState<ReplicaRun[]>([]);
  const [busy, setBusy] = useState(false);
  const stop = useRef(false);
  const takt = effectiveTakt(model);
  const stops = stopMinutes(model.settings);
  // com paradas, a meta do turno cai na mesma proporção do tempo disponível
  const target = takt > 0 ? (3600 / takt) * (1 - stops / (model.settings.duration / 60)) : 0;
  useEffect(() => () => void (stop.current = true), []);

  const start = () => {
    stop.current = false;
    setRuns([]);
    setBusy(true);
    const m = structuredClone(model);
    const out: ReplicaRun[] = [];
    // uma réplica por vez para a tela não travar
    const step = () => {
      if (stop.current || out.length >= n) return setBusy(false);
      out.push(runReplica(m, m.settings.seed + out.length));
      setRuns([...out]);
      setTimeout(step, 0);
    };
    setTimeout(step, 30);
  };

  const s = replicaStats(runs.map((r) => r.uph));
  const hit = target > 0 && runs.length ? runs.filter((r) => r.uph >= target * 0.999).length / runs.length : 0;
  return (
    <>
      <HowTo
        title="Réplicas: o UPH com faixa, não um número só"
        why="Os tempos de cada posto variam (cv), as falhas caem em horas diferentes. Um turno simulado é só um sorteio. Rodando várias vezes você vê o UPH médio e quanto ele pode oscilar."
        steps={[
          'Escolha quantas réplicas rodar (20 é um bom padrão; 30 dá mais precisão).',
          'Clique em Rodar réplicas. Cada uma é o turno inteiro com uma semente diferente.',
          'Leia o UPH médio e a faixa de 95%: o UPH verdadeiro da linha está dentro dela.',
          'Compare com a meta: "Turnos na meta" diz em quantos turnos a linha bateu o takt.',
        ]}
        tip="Se a faixa for larga, a linha é instável: olhe os postos com cv alto ou falhas frequentes. Diferença entre cenários menor que a faixa é ruído."
      />
      <div className="row-btns section">
        <label className="field inline">
          <span>Réplicas</span>
          <select value={n} onChange={(e) => setN(Number(e.target.value))} disabled={busy}>
            {[10, 20, 30].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        {busy ? (
          <button className="btn" onClick={() => (stop.current = true)}>Parar</button>
        ) : (
          <button className="btn primary" onClick={start}>▶ Rodar réplicas</button>
        )}
        <span className="muted">
          Turno de {fmt(model.settings.duration / 3600, 1)} h{stops ? ` com ${fmt(stops, 0)} min de paradas` : ''} · sementes {model.settings.seed} a {model.settings.seed + n - 1}
        </span>
      </div>
      {busy && (
        <div className="progress section" aria-label="Progresso das réplicas">
          <span style={{ width: `${(runs.length / n) * 100}%` }} />
          <small>{runs.length} de {n}</small>
        </div>
      )}
      {runs.length > 0 && (
        <>
          <div className="tiles section">
            <Kpi k="UPH médio" v={fmt(s.mean, 1)} u={`${s.n} réplicas`} />
            <Kpi k="Faixa de 95%" v={`± ${fmt(s.half, 1)}`} u={`${fmt(s.mean - s.half, 1)} a ${fmt(s.mean + s.half, 1)}`} />
            <Kpi k="90% dos turnos" v={`${fmt(s.p5, 1)}–${fmt(s.p95, 1)}`} u="pç/h (P5 a P95)" />
            <Kpi k="Pior / melhor" v={`${fmt(s.min, 1)} / ${fmt(s.max, 1)}`} u="pç/h" />
            <Kpi k="Desvio padrão" v={fmt(s.sd, 2)} u="pç/h" />
            {target > 0 && <Kpi k="Turnos na meta" v={pct(hit)} u={`meta ${fmt(target, 1)} pç/h${stops ? ' (com paradas)' : ''}`} tone={hit < 0.5 ? 'bad' : undefined} />}
          </div>
          <Strip runs={runs} mean={s.mean} half={s.half} target={target} />
          <p className="hint">
            Leitura: com 95% de confiança, o UPH médio da linha está entre <b>{fmt(s.mean - s.half, 1)}</b> e <b>{fmt(s.mean + s.half, 1)}</b> pç/h. Turno a turno, 90% caem entre {fmt(s.p5, 1)} e {fmt(s.p95, 1)}.
          </p>
        </>
      )}
    </>
  );
}

/** Cada réplica é um ponto; faixa azul = intervalo de 95% da média; linha tracejada = meta. */
function Strip({ runs, mean, half, target }: { runs: ReplicaRun[]; mean: number; half: number; target: number }) {
  const vals = runs.map((r) => r.uph);
  const lo = Math.min(...vals, target || Infinity, mean - half);
  const hi = Math.max(...vals, target || 0, mean + half);
  const pad = (hi - lo) * 0.1 || 1;
  const x = (v: number) => 30 + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 640;
  const ticks = 5;
  return (
    <svg className="strip section" viewBox="0 0 700 110" role="img" aria-label="UPH de cada réplica">
      <rect x={x(mean - half)} y={18} width={Math.max(2, x(mean + half) - x(mean - half))} height={52} className="strip-ci" />
      <line x1={x(mean)} x2={x(mean)} y1={14} y2={74} className="strip-mean" />
      {target > 0 && <line x1={x(target)} x2={x(target)} y1={8} y2={80} className="strip-target" />}
      {target > 0 && <text x={x(target)} y={8} textAnchor="middle" className="strip-label">meta</text>}
      {runs.map((r, i) => (
        <circle key={r.seed} cx={x(r.uph)} cy={30 + ((i * 7) % 30)} r={4.5} className="strip-dot">
          <title>Semente {r.seed}: {fmt(r.uph, 1)} pç/h</title>
        </circle>
      ))}
      <line x1={30} x2={670} y1={86} y2={86} className="strip-axis" />
      {Array.from({ length: ticks + 1 }, (_, i) => lo - pad + ((hi - lo + 2 * pad) * i) / ticks).map((v) => (
        <text key={v} x={x(v)} y={102} textAnchor="middle" className="strip-label">{fmt(v, 1)}</text>
      ))}
    </svg>
  );
}
