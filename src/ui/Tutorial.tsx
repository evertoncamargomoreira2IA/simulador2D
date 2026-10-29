// Tutorial: procedimento de uso do simulador, passo a passo.

import { useState } from "react";
import { download } from "../io/exporter";
import { templateBytes } from "../io/template";
import { useStore } from "../store";
import { FUNCOES, SIGLAS } from "./glossary";
import { Modal } from "./Modal";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function downloadTemplate(fromModel: boolean) {
  const m = useStore.getState().model;
  const name = fromModel
    ? `${m.name.replace(/[^\w-]+/g, "_") || "linha"}_planilha.xlsx`
    : "planilha_padrao_simulador.xlsx";
  return download(name, templateBytes(fromModel ? m : undefined), XLSX_MIME);
}

const STEPS: { t: string; body: string[] }[] = [
  {
    t: "1. Monte a linha",
    body: [
      "Jeito mais rápido: Exportar → Planilha padrão. Preencha as abas Postos, Ligações, Pessoas e veículos e Parâmetros no Excel e suba em Importar.",
      "Para mudar uma linha que já está aberta: Exportar → Planilha do modelo atual, edite no Excel e importe de volta. Se todos os postos tiverem x_m e y_m, a planta DXF continua na tela.",
      "Também dá para desenhar: clique nos blocos da paleta à esquerda. Cada bloco novo sai ligado ao que está selecionado. Use Conectar para ligar dois blocos.",
    ],
  },
  {
    t: "2. Coloque a planta (opcional)",
    body: [
      "Importar → arquivo .dxf do AutoCAD. Os blocos com o mesmo nome de um texto do desenho vão para cima dele; os outros você arrasta.",
    ],
  },
  {
    t: "3. Ajuste postos, pessoas e veículos",
    body: [
      "Clique num posto para editar tempo de ciclo, gigas (capacidade), fila, operadores, falhas, lote e energia no painel da direita.",
      'Clique numa ligação para dar peso (yield, amostra), distância real, transporte por empilhadeira ou AGV e marcar "uma vez" para amostras que voltam.',
      "Em Pessoas e veículos (painel da direita, sem nada selecionado) você cadastra operadores compartilhados, empilhadeiras e AGVs.",
      "Yamazumi: Operações → escolha o posto → 📋 Colar tabela do Excel (operação | atividade | tempo | tipo). Para todos os postos de uma vez, preencha a aba Atividades da planilha padrão e ponha estudo = elemento na aba Parâmetros.",
    ],
  },
  {
    t: "4. Rode a simulação",
    body: [
      "Ligue Linha cheia para ver o UPH de produção, sem a rampa de enchimento.",
      "▶ Start anima; a velocidade fica ao lado. ⏭ Fim calcula o turno inteiro sem animação. ↺ Replay repete com a mesma sequência de eventos.",
    ],
  },
  {
    t: "5. Leia os resultados",
    body: [
      "O painel de baixo mostra UPH, lead time, total cycle time, FPY, expedido e o top 5 gargalos.",
      "Duplo clique em qualquer posto abre todos os indicadores dele.",
      "Análises → Cycle × Takt mostra o tempo de cada posto contra o takt: vermelho passa do takt, amarelo está acima de 90%.",
    ],
  },
  {
    t: "6. Melhore a linha",
    body: [
      "Análises → Gargalos → Calibrar tempos para o takt escala os tempos na mesma proporção até atingir o UPH alvo (postos com tempo fixo ficam como estão).",
      "✦ IA lista sugestões testadas na própria simulação, com o ganho em UPH. Aplicar muda o modelo; o chat responde dúvidas sobre a linha.",
      "Análises → Cenários guarda a linha atual para comparar Current × Future A × Future B.",
      "Análises → Rebalancear → ⚡ Balancear automático reparte as atividades para caber no takt com menos postos e pessoas.",
      "Análises → Réplicas roda o turno 10 a 30 vezes e mostra o UPH com faixa de confiança. Análises → Turnos e paradas coloca almoço, ginástica e troca de modelo no UPH real.",
    ],
  },
  {
    t: "7. Compare com o real e exporte",
    body: [
      "Análises → Real × simulado recebe uma planilha (posto, contagem, ciclo, estado) ou um WebSocket com dados ao vivo.",
      "Exportar → Resultados (Excel) leva os KPIs da linha e de cada posto para relatório ou Power BI.",
    ],
  },
];

const FAQ: [string, string][] = [
  [
    "Lead time × total cycle time",
    "Lead time é o tempo que a peça leva da entrada à saída, com filas e transporte. Total cycle time é só a soma do trabalho em todos os postos (e kits) que ela passou.",
  ],
  [
    "Por que o UPH muda com a semente?",
    "Os tempos variam pelo cv de cada posto. Rode 3 sementes antes de decidir; diferença menor que 1 UPH é ruído.",
  ],
  [
    "Tempo de ciclo com gigas",
    "tempo_ciclo_s é de uma peça numa giga. Com 6 gigas e 150 s, o posto entrega uma peça a cada 25 s.",
  ],
];

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"passos" | "siglas" | "funcoes">("passos");
  const get = async (fromModel: boolean) => {
    setBusy(true);
    await downloadTemplate(fromModel);
    setBusy(false);
  };
  return (
    <Modal
      title="Como usar o simulador"
      sub="Procedimento passo a passo, da planilha ao relatório."
      onClose={onClose}
      wide
    >
      <nav className="tabs" role="tablist">
        {(
          [
            ["passos", "Passo a passo"],
            ["siglas", "Siglas"],
            ["funcoes", "Funções"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`tab${tab === k ? " on" : ""}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </nav>
      {tab === "siglas" && (
        <table className="grid-table section glossary">
          <thead>
            <tr>
              <th>Sigla</th>
              <th>Significado</th>
              <th>Para que serve no simulador</th>
            </tr>
          </thead>
          <tbody>
            {SIGLAS.map(([s, m, f]) => (
              <tr key={s}>
                <td>
                  <b>{s}</b>
                </td>
                <td>{m}</td>
                <td>{f}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === "funcoes" && (
        <table className="grid-table section glossary">
          <thead>
            <tr>
              <th>Onde</th>
              <th>Função</th>
              <th>O que faz</th>
            </tr>
          </thead>
          <tbody>
            {FUNCOES.map(([o, f, d]) => (
              <tr key={o + f}>
                <td>{o}</td>
                <td>
                  <b>{f}</b>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === "passos" && (
        <>
          <div className="row-btns section">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => get(false)}
            >
              Baixar planilha padrão
            </button>
            <button className="btn" disabled={busy} onClick={() => get(true)}>
              Baixar planilha do modelo atual
            </button>
          </div>
          <ol className="tutorial section">
            {STEPS.map((s) => (
              <li key={s.t}>
                <b>{s.t}</b>
                {s.body.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </li>
            ))}
          </ol>
          <p className="label section">Dúvidas comuns</p>
          <dl className="faq">
            {FAQ.map(([q, a]) => (
              <div key={q}>
                <dt>{q}</dt>
                <dd>{a}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Modal>
  );
}
