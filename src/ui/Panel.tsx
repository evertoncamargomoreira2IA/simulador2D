// Painel real × simulado. No editor: monta a foto da simulação com os dados reais e publica para
// leitores. Quem abre o link só como leitor cai direto no painel (sem editor), lendo a foto publicada.

import { useEffect, useMemo, useState } from 'react';
import { buildPanel, devOf, type PanelSnapshot, type PanelStation } from '../engine/panel';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Kpi, Modal } from './Modal';
import { fmt, pct } from './theme';

type View = 'lado' | 'sim' | 'real';

interface DocSnap {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface Db {
  doc(path: string): {
    set(d: Record<string, unknown>): Promise<void>;
    get(): Promise<DocSnap>;
    onSnapshot(next: (s: DocSnap) => void, err?: (e: unknown) => void): () => void;
  };
}
type Host = { use?: (name: string) => Promise<unknown> };
const host = () => (window as unknown as { claude?: Host }).claude;
const PANEL_DOC = 'painel/atual';

async function getDb(): Promise<Db | null> {
  const h = host();
  return h?.use ? ((await h.use('db').catch(() => null)) as Db | null) : null;
}

const parse = (s: DocSnap): PanelSnapshot | null => {
  const d = s.exists ? s.data() : undefined;
  try {
    return d?.json ? (JSON.parse(String(d.json)) as PanelSnapshot) : null;
  } catch {
    return null;
  }
};

/** Quem só pode ler o artefato (sem edição) abre direto no painel. Fora do claude.ai: editor. */
export async function isReader(): Promise<boolean> {
  const h = host();
  if (!h?.use) return false;
  const user = (await h.use('user').catch(() => null)) as { canEdit(): Promise<boolean> } | null;
  if (!user) return false;
  return !(await user.canEdit().catch(() => true));
}

/** Página do leitor: só o painel publicado, atualizado ao vivo quando o dono publica de novo. */
export function ReaderPage({ preview, onExit }: { preview?: PanelSnapshot; onExit?: () => void }) {
  const [snap, setSnap] = useState<PanelSnapshot | null | undefined>(preview ?? undefined);
  useEffect(() => {
    if (preview) return;
    let stop: (() => void) | undefined;
    void getDb().then((db) => {
      if (!db) return setSnap(null);
      stop = db.doc(PANEL_DOC).onSnapshot(
        (s) => setSnap(parse(s)),
        () => setSnap(null),
      );
    });
    return () => stop?.();
  }, [preview]);
  return (
    <div className="reader">
      <header className="reader-head">
        <div>
          <h1>{__APP_NAME__} · Painel</h1>
          <p className="sub">Somente leitura: indicadores da simulação e dos dados reais publicados pela engenharia.</p>
        </div>
        {onExit && <button className="btn" onClick={onExit}>Voltar ao editor</button>}
      </header>
      {snap === undefined && <p className="hint">Carregando o painel…</p>}
      {snap === null && <p className="hint">Ainda não há painel publicado. Peça para quem edita o modelo abrir 📊 Painel e clicar em Publicar para leitores.</p>}
      {snap && <PanelView snap={snap} />}
    </div>
  );
}

/** Janela do painel no editor. */
export function PanelModal({ onClose }: { onClose: () => void }) {
  const model = useStore((s) => s.model);
  const real = useStore((s) => s.real);
  const events = useStore((s) => s.realEvents);
  const source = useStore((s) => s.realSource);
  const [snap, setSnap] = useState<PanelSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('');
  const [published, setPublished] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);

  const build = () => {
    setBusy(true);
    setTimeout(() => {
      try {
        setSnap(buildPanel(model, real, events, source || 'sem dados reais'));
      } catch (e) {
        setStatus(`Não deu para montar o painel: ${(e as Error).message}`);
      }
      setBusy(false);
    }, 30);
  };
  useEffect(build, [model, real, events, source]);
  useEffect(() => {
    void getDb().then(async (db) => {
      const s = db ? parse(await db.doc(PANEL_DOC).get()) : null;
      if (s) setPublished(s.geradoEm);
    });
  }, []);

  const publish = async () => {
    if (!snap) return;
    const db = await getDb();
    if (!db) return setStatus('Publicar só funciona dentro do artefato no claude.ai (o banco do artefato guarda o painel).');
    try {
      await db.doc(PANEL_DOC).set({ json: JSON.stringify(snap), atualizado: snap.geradoEm });
      setPublished(snap.geradoEm);
      setStatus('Publicado. Quem tem o link como leitor já vê este painel (atualiza sozinho quando você publicar de novo).');
    } catch (e) {
      setStatus(`Não publicou (${(e as { code?: string }).code ?? (e as Error).message}).`);
    }
  };

  if (preview && snap) return <div className="reader-overlay"><ReaderPage preview={snap} onExit={() => setPreview(false)} /></div>;

  return (
    <Modal title="📊 Painel real × simulado" sub="Indicadores da linha e de cada posto: SOE, simulado e real lado a lado." onClose={onClose} wide>
      <HowTo
        title="Painel: o que a gerência vê"
        why="Junta a simulação do turno com os dados reais (aba Dados reais ou Real × simulado) e mostra onde cada posto desvia. Publicado, vira o que o leitor do link enxerga, sem poder editar."
        steps={[
          'Carregue os dados reais em Análises → Dados reais (linha simulada, arquivo ou API).',
          'Abra este painel: ele roda o turno simulado e junta com o real por posto.',
          'Leia os cartões (UPH meta, simulado e real) e o gráfico: barra azul = simulado, laranja = real, traço = SOE, linha = takt. Vermelho = real fora do limite de alerta.',
          'Publicar para leitores grava a foto do painel. Compartilhe o artefato como Leitor: a pessoa abre direto no painel.',
          '👁 Ver como leitor mostra exatamente o que essa pessoa vai ver.',
        ]}
        tip="Publique de novo sempre que mudar o modelo ou os dados reais: o leitor recebe a versão nova sem recarregar."
      />
      <div className="row-btns section">
        <button className="btn" onClick={build} disabled={busy}>↻ Atualizar</button>
        <button className="btn primary" onClick={() => void publish()} disabled={!snap || busy}>Publicar para leitores</button>
        <button className="btn" onClick={() => setPreview(true)} disabled={!snap}>👁 Ver como leitor</button>
        <span className="muted">{published ? `Última publicação: ${new Date(published).toLocaleString('pt-BR')}` : 'Ainda não publicado.'}</span>
      </div>
      {status && <p className="hint">{status}</p>}
      {busy && <p className="hint">Rodando o turno simulado…</p>}
      {snap && !busy && (snap.postos.length ? <PanelView snap={snap} /> : <p className="hint">O modelo ainda não tem postos. Monte a linha ou abra um exemplo (Exemplos… → Abastecimento e FGI) e volte aqui.</p>)}
    </Modal>
  );
}

/** O painel em si (igual no editor e no leitor). */
export function PanelView({ snap }: { snap: PanelSnapshot }) {
  const [view, setView] = useState<View>('lado');
  const hasReal = snap.postos.some((p) => p.real !== null);
  const alerts = snap.postos.filter((p) => Math.abs(devOf(p.real, p.soe) ?? 0) > snap.alerta);
  const v = hasReal ? view : 'sim';
  return (
    <>
      <div className="tiles section">
        <Kpi k="Meta" v={fmt(snap.metaUph, 1)} u={`pç/h · takt ${fmt(snap.takt, 1)} s`} />
        <Kpi k="UPH simulado" v={fmt(snap.sim.uph, 1)} u={`turno de ${fmt(snap.horas, 0)} h`} tone={snap.sim.uph < snap.metaUph * 0.98 ? 'bad' : undefined} />
        <Kpi k="UPH real" v={snap.real.uph !== null ? fmt(snap.real.uph, 1) : '–'} u={hasReal ? snap.real.fonte : 'sem dados reais'} tone={snap.real.uph !== null && snap.real.uph < snap.metaUph * 0.98 ? 'bad' : undefined} />
        <Kpi k="Gargalo simulado" v={snap.sim.gargalo} u={`OEE ${pct(snap.sim.oee)}`} />
        <Kpi k="Gargalo real" v={snap.real.gargalo ?? '–'} u="maior tempo real" />
        <Kpi k="Postos em alerta" v={String(alerts.length)} u={`real × SOE > ${pct(snap.alerta)}`} tone={alerts.length ? 'bad' : undefined} />
      </div>
      <div className="row-btns section" role="group" aria-label="O que mostrar">
        {(['lado', 'sim', 'real'] as View[]).map((k) => (
          <button key={k} className={`btn${v === k ? ' on' : ''}`} aria-pressed={v === k} disabled={k !== 'sim' && !hasReal} onClick={() => setView(k)}>
            {k === 'lado' ? 'Real × simulado' : k === 'sim' ? 'Só simulado' : 'Só real'}
          </button>
        ))}
        <span className="muted">Segundos por peça da linha (÷ gigas). Gerado em {new Date(snap.geradoEm).toLocaleString('pt-BR')} · {snap.modelo}</span>
      </div>
      <PanelChart snap={snap} view={v} />
      <table className="grid-table section">
        <thead>
          <tr>
            <th>Posto</th><th>SOE (s)</th>{v !== 'real' && <th>Simulado (s)</th>}{v !== 'sim' && <th>Real (s)</th>}{v !== 'sim' && <th>Real × SOE</th>}{v === 'lado' && <th>Real × simulado</th>}<th>Peças sim.</th>{v !== 'sim' && <th>Leituras</th>}
          </tr>
        </thead>
        <tbody>
          {snap.postos.map((p) => (
            <tr key={p.id}>
              <td>{p.name}{p.offline && <small className="muted"> (off-line)</small>}</td>
              <td>{fmt(p.soe, 1)}</td>
              {v !== 'real' && <td>{fmt(p.sim, 1)}</td>}
              {v !== 'sim' && <td>{p.real !== null ? fmt(p.real, 1) : '–'}</td>}
              {v !== 'sim' && <DevCell d={devOf(p.real, p.soe)} limit={snap.alerta} />}
              {v === 'lado' && <DevCell d={devOf(p.real, p.sim)} limit={snap.alerta} />}
              <td>{p.simCount}</td>
              {v !== 'sim' && <td>{p.realCount ?? '–'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function DevCell({ d, limit }: { d: number | null; limit: number }) {
  if (d === null) return <td>–</td>;
  return <td className={Math.abs(d) > limit ? 'bad' : 'good'}>{d > 0 ? '+' : ''}{pct(d, 1)}</td>;
}

/** Colunas por posto: simulado (azul) e real (laranja; vermelho se fora do alerta), traço do SOE e linha do takt. */
function PanelChart({ snap, view }: { snap: PanelSnapshot; view: View }) {
  const ps: PanelStation[] = snap.postos;
  const W = Math.max(640, ps.length * 46 + 60);
  const H = 240;
  const top = 16;
  const base = 190;
  const max = useMemo(() => Math.max(snap.takt * 1.2, ...ps.map((p) => Math.max(p.soe, p.sim, p.real ?? 0))) || 1, [snap, ps]);
  const y = (s: number) => base - (s / max) * (base - top);
  const step = (W - 60) / Math.max(1, ps.length);
  const bw = view === 'lado' ? Math.min(14, step * 0.32) : Math.min(24, step * 0.55);
  return (
    <div className="chart-scroll section">
      <svg className="panel-chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Tempo por posto: simulado, real e SOE">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={44} x2={W - 8} y1={y(max * f)} y2={y(max * f)} className="pc-grid" />
            <text x={40} y={y(max * f) + 3} textAnchor="end" className="pc-label">{fmt(max * f, 0)}</text>
          </g>
        ))}
        {snap.takt > 0 && (
          <>
            <line x1={44} x2={W - 8} y1={y(snap.takt)} y2={y(snap.takt)} className="pc-takt" />
            <text x={W - 10} y={y(snap.takt) - 4} textAnchor="end" className="pc-label">takt {fmt(snap.takt, 1)} s</text>
          </>
        )}
        {ps.map((p, i) => {
          const cx = 52 + step * (i + 0.5);
          const bad = Math.abs(devOf(p.real, p.soe) ?? 0) > snap.alerta;
          const bars: { v: number; cls: string; label: string }[] = [];
          if (view !== 'real') bars.push({ v: p.sim, cls: 'pc-sim', label: 'Simulado' });
          if (view !== 'sim' && p.real !== null) bars.push({ v: p.real, cls: bad ? 'pc-real bad' : 'pc-real', label: 'Real' });
          const x0 = cx - (bars.length * bw + (bars.length - 1) * 2) / 2;
          return (
            <g key={p.id}>
              {bars.map((b, j) => (
                <rect key={b.cls} x={x0 + j * (bw + 2)} y={y(b.v)} width={bw} height={Math.max(0, base - y(b.v))} className={b.cls} rx={2}>
                  <title>{`${p.name} · ${b.label}: ${fmt(b.v, 1)} s · SOE ${fmt(p.soe, 1)} s`}</title>
                </rect>
              ))}
              <line x1={cx - step * 0.36} x2={cx + step * 0.36} y1={y(p.soe)} y2={y(p.soe)} className="pc-soe" />
              <text x={cx} y={base + 12} textAnchor="end" transform={`rotate(-35 ${cx} ${base + 12})`} className="pc-label">{p.name.length > 16 ? `${p.name.slice(0, 15)}…` : p.name}</text>
            </g>
          );
        })}
      </svg>
      <p className="hint pc-legend">
        <span className="sw pc-sim" /> Simulado <span className="sw pc-real" /> Real <span className="sw pc-real bad" /> Real fora do alerta <span className="sw soe" /> SOE <span className="sw takt" /> Takt
      </p>
    </div>
  );
}
