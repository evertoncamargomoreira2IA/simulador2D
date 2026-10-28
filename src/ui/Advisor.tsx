// Assistente de IA: sugestões explicáveis (regras + simulação automática) e conversa com o Claude.

import { useEffect, useRef, useState } from 'react';
import { applyAction, describeAction, digest, evaluateOne, lineBalance, suggest, type Suggestion } from '../engine/advisor';
import { useStore } from '../store';
import { fmt, pct } from './theme';

type SampleFn = ((input: string | { role: 'user' | 'assistant'; content: string }[], opts?: Record<string, unknown>) => Promise<{ text: string }>) | null;

declare global {
  interface Window {
    claude?: { use: (name: string) => Promise<unknown> };
  }
}

function useSample(): SampleFn | undefined {
  const [fn, setFn] = useState<SampleFn | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!window.claude?.use) {
      setFn(null);
      return;
    }
    window.claude
      .use('sample')
      .then((s) => alive && setFn(() => (s as SampleFn) ?? null))
      .catch(() => alive && setFn(null));
    return () => {
      alive = false;
    };
  }, []);
  return fn;
}

const RULES = `Você é um engenheiro de manufatura sênior (Lean, balanceamento de linha, simulação de eventos discretos).
Responda em português do Brasil, direto, em no máximo 10 linhas ou 6 tópicos curtos.
Baseie-se SOMENTE nos dados da simulação abaixo; cite os números que sustentam cada recomendação e diga o ganho esperado.
Se faltar dado, diga qual dado falta. Não invente postos nem valores.`;

export function Advisor() {
  const model = useStore((s) => s.model);
  const sim = useStore((s) => s.sim);
  const kpi = useStore((s) => s.kpi);
  const [list, setList] = useState<Suggestion[]>(() => suggest(model, sim, kpi));
  const [running, setRunning] = useState(false);
  const sample = useSample();
  const [q, setQ] = useState('');
  const [chat, setChat] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [answer, setAnswer] = useState('');
  const [aiErr, setAiErr] = useState('');
  const ctl = useRef<AbortController | null>(null);
  const lb = lineBalance(model);

  const refresh = () => setList(suggest(useStore.getState().model, useStore.getState().sim, useStore.getState().kpi));

  // Simulação automática: avalia uma ação por vez sem travar a tela.
  const autoSim = () => {
    setRunning(true);
    const m = useStore.getState().model;
    const todo = list.filter((s) => s.action && s.action.kind !== 'move');
    let i = 0;
    const step = () => {
      if (i >= todo.length) {
        setRunning(false);
        return;
      }
      evaluateOne(m, todo[i++]);
      setList((l) => [...l]);
      setTimeout(step, 10);
    };
    setTimeout(step, 10);
  };

  const apply = (s: Suggestion) => {
    const m = useStore.getState().model;
    useStore.getState().setModel(applyAction(m, s.action!), `Aplicado: ${describeAction(m, s.action!)}. Rode a simulação para ver o efeito (ou salve como cenário para comparar).`);
    useStore.getState().setAnalysis(null);
  };

  async function ask(text: string) {
    if (!sample || !text.trim()) return;
    ctl.current?.abort();
    const c = (ctl.current = new AbortController());
    const st = useStore.getState();
    const context = `${RULES}\n\nDADOS DA SIMULAÇÃO\n${digest(st.model, st.sim, st.kpi)}\n\nSUGESTÕES DAS REGRAS (com ganho simulado quando houver)\n${list
      .map((s) => `- [${s.area}] ${s.title}. ${s.evidence}${s.gain !== undefined ? ` Ganho simulado: ${fmt(s.gain, 1)} pç/h.` : ''}`)
      .join('\n')}`;
    const turns = [...chat, { role: 'user' as const, content: text }];
    setChat(turns);
    setQ('');
    setAnswer('Pensando…');
    setAiErr('');
    try {
      const r = await sample([{ role: 'user', content: context }, ...turns], {
        signal: c.signal,
        cache: false,
        onText: ({ text: t }: { text: string }) => setAnswer(t),
      });
      setChat([...turns, { role: 'assistant', content: r.text }]);
      setAnswer('');
    } catch (e) {
      const err = e as { code?: string; text?: string };
      setAnswer(err.text ?? '');
      if (err.code === 'not_granted' || err.code === 'sampling_disabled') setAiErr('O uso do Claude não foi permitido nesta página.');
      else if (err.code === 'rate_limited') setAiErr('Muitas perguntas seguidas. Tente de novo em alguns minutos.');
      else if (err.code !== 'cancelled') setAiErr('Não foi possível obter a resposta agora. Tente de novo.');
    }
  }

  return (
    <>
      <div className="tiles">
        <div className="tile"><div className="k">Balanceamento</div><div className="v">{pct(lb.efficiency)}</div></div>
        <div className="tile"><div className="k">Sugestões</div><div className="v">{list.length}</div></div>
        <div className="tile"><div className="k">Produção</div><div className="v">{fmt(kpi.throughputPerHour, 1)}<small>pç/h</small></div></div>
      </div>
      <div className="row-btns section">
        <button className="btn primary" onClick={autoSim} disabled={running || !list.some((s) => s.action && s.action.kind !== 'move')}>{running ? 'Simulando cenários…' : 'Simulação automática dos ganhos'}</button>
        <button className="btn" onClick={refresh}>Recalcular sugestões</button>
      </div>
      {kpi.completed === 0 && <p className="hint">Rode a simulação (⏭ Fim) para sugestões com base nos resultados.</p>}
      <ul className="advice">
        {list.map((s) => (
          <li key={s.id}>
            <span className={`chip a-${s.area.toLowerCase()}`}>{s.area}</span>
            <div>
              <b>{s.title}</b>
              <p>{s.evidence}</p>
              <p className="sub">{s.impact}</p>
              {s.gain !== undefined && (
                <p className={s.gain > 0.3 ? 'good' : s.gain < -0.3 ? 'bad' : 'sub'}>
                  Simulado ({describeAction(model, s.action!)}): {s.gain > 0 ? '+' : ''}{fmt(s.gain, 1)} pç/h em regime
                </p>
              )}
            </div>
            {s.action && <button className="btn" onClick={() => apply(s)} title={describeAction(model, s.action)}>Aplicar</button>}
          </li>
        ))}
      </ul>

      <p className="label section">Pergunte ao Claude</p>
      {sample === null && <p className="hint">O assistente conversacional funciona quando o simulador é aberto no Claude. As sugestões acima funcionam em qualquer lugar.</p>}
      {sample && (
        <div className="ask">
          {chat.map((t, i) => (
            <div key={i} className={`msg ${t.role}`}>{t.content}</div>
          ))}
          {answer && <div className="msg assistant">{answer}</div>}
          {aiErr && <p className="bad">{aiErr}</p>}
          <div className="row-btns">
            {chat.length === 0 &&
              ['Como chegar a 71 UPH com menos pessoas?', 'Qual o plano de balanceamento da main line?', 'Onde reduzir energia e CO2e?'].map((p) => (
                <button key={p} className="btn" onClick={() => ask(p)}>{p}</button>
              ))}
          </div>
          <form
            className="ask-row"
            onSubmit={(e) => {
              e.preventDefault();
              ask(q);
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: o que acontece se eu tirar um operador do PST?" aria-label="Pergunta para o Claude" />
            <button className="btn primary" type="submit" disabled={!q.trim()}>Perguntar</button>
            {answer && <button className="btn" type="button" onClick={() => ctl.current?.abort()}>Parar</button>}
          </form>
        </div>
      )}
    </>
  );
}
