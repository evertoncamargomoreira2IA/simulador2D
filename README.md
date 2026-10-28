# Simulador 2D

Simulador industrial 2D de eventos discretos (DES) com canvas estilo FlexSim, para analisar fluxo,
gargalos e WIP de linhas de montagem. MVP da Sprint 1.

## Como rodar

```bash
npm install
npm run dev          # abre em http://localhost:5173
npm test             # testes do motor e da importação
npm run build:single # gera dist-single/index.html (arquivo único, abre direto no navegador)
```

## O que tem na Sprint 1

- **Canvas 2D** (React + TypeScript + Konva): arrastar blocos da paleta, mover, zoom (roda do mouse),
  pan (arrastar o fundo), grid com snap, seleção múltipla (Shift+clique ou Shift+arrastar), camadas,
  conectar blocos (botão *Conectar*), apagar com Delete.
- **Blocos**: Source, Machine, Buffer, Inspection, Rework, Finished Goods. Cada bloco guarda nome, ID,
  capacidade, tempo de ciclo, variação, setup, turnos, disponibilidade/MTTR, operadores, OEE meta,
  potência, custo/hora, fator de CO2e e posição X,Y.
- **Motor DES próprio** (`src/engine`): fila de eventos, bloqueio após serviço, filas de entrada,
  roteamento por pesos (ex.: 97% aprovado / 3% retrabalho), falhas aleatórias por disponibilidade e
  MTTR, setup, aquecimento e semente fixa (Replay idêntico).
- **Indicadores**: throughput, cycle time real, lead time, tempo em fila, bloqueado e transporte,
  WIP atual e médio, utilização, OEE por posto e da linha, aderência ao takt, first pass yield e
  gargalo (método do período ativo).
- **Controles**: Start, Pause, Stop, Replay, Fim (calcula o turno inteiro) e velocidade de 1× a 600×.
- **Animação**: cor do posto pelo estado (verde operando, amarelo espera, laranja bloqueado,
  vermelho parado, roxo setup, cinza sem produção) e peças em azul durante o transporte.
- **Importação**: Excel (.xlsx), CSV e JSON. Reconhece tabelas simples e o formato PCP
  (cabeçalho com *Station* e *Manpower*, aba *Top Level*).
- **Exportação**: resultados em Excel, modelo em CSV ou JSON.

## O que tem na Sprint 2

- **Planta DXF**: Importar aceita `.dxf` (AutoCAD). Linhas, polilinhas, arcos, círculos, textos e blocos viram a planta de fundo, em escala (px/m do modelo). Blocos cujo nome coincide com um texto do desenho são posicionados sobre ele.
- **Operadores compartilhados**: grupos de operadores (quantidade, velocidade) ligados a postos. O operador anda até o posto, faz carga/descarga (`handlingTime`) e fica livre enquanto a máquina/teste roda. Espera por operador aparece como estado próprio.
- **Gigas (fixtures)**: posto com capacidade N e `area` desenha N gigas lado a lado, cada uma com seu estado (livre, testando, pronta).
- **Montagem**: fluxos do tipo "Componente" entregam peças consumidas no posto de destino (estoque de componentes por posto).
- **Veículos**: empilhadeira e AGV/AMR ligados a um fluxo buscam e levam a peça, com tempo de carga e deslocamento vazio.
- **Painel de pessoas**: ocupação por grupo (ocioso / equilibrado / sobrecarga), distância percorrida e ranking dos 5 gargalos.
- Modelo de exemplo privado opcional: se existir `private/example.json` (fora do git), ele vira o modelo inicial do build.

## O que tem na Sprint 3

- **Agrupamento** (`batchSize`): o posto junta N peças numa carga (carrinho de 15, pallet de 48) e quebra cargas maiores quando preciso. Tempos e distâncias são somados por unidade.
- **Ponto de medição** (`outputPoint`): throughput, lead time e takt medidos no fim da linha, mesmo com expedição depois.
- **Distância real no link** (`length`): trechos fora de escala no desenho (ex.: AGV de 200 m até a expedição).
- **Áreas** (`zones`): regiões desenhadas no canvas, como a expedição fora do layout.
- **Bonequinhos** nos postos com operador fixo (animados quando o posto trabalha) e nos grupos de operadores; empilhadeira e AGV mostram a carga.
- **Total cycle time** (conteúdo de trabalho por unidade, com submontagens) separado do lead time (com esperas). Tile de cargas expedidas.
- Paleta: Source com um posto selecionado entra à esquerda já alimentando o posto; blocos sem seleção entram no centro da tela; ligações inválidas (entrada em Source, saída de Finished Goods) são recusadas.

## Sprints 4 a 8

- **Linha cheia** (`startFull`): a linha enche antes do turno visível; o UPH mostrado é o de regime.
- **Calibrar para o takt**: escala na mesma proporção os tempos de ciclo (menos os marcados como tempo fixo) até a linha cheia entregar o takt (`src/engine/calibrate.ts`).
- **Amostragem que volta ao posto** (`once` no link): ex.: OBA de 10% que sai e volta ao mesmo posto, com pista de retorno sem travamento; montagem não consome componentes de novo na volta.
- **Top 5 gargalos** no layout e no painel; **pop-up de indicadores** por posto (duplo clique no bloco).
- **Análises** (`src/engine/analytics.ts`): spaghetti (distâncias, cruzamentos, fluxo de volta), custos diretos e indiretos (por peça, processo e turno), energia (kWh por peça, processo e turno; consumo em espera), carbono (escopos 1, 2 e 3; mapa de calor) e cenários Current State × Future State A/B.
- **Real × simulado**: importação de dados reais por posto (Excel/CSV) ou WebSocket ao vivo (gateway OPC-UA/MQTT), com desvios destacados.
- **IA** (`src/engine/advisor.ts`): sugestões explicáveis com a evidência numérica, balanceamento, otimização de layout, simulação automática do ganho de cada ação e conversa com o Claude dentro do artefato.

## Formato da tabela de importação

Uma linha por bloco. Só a coluna `nome` é obrigatória; sem `proximo`, os blocos são ligados em
sequência e o simulador cria Source e Finished Goods.

| coluna | exemplo | observação |
| --- | --- | --- |
| id | M01 | opcional |
| nome | Montagem base | ou `name`, `posto`, `station` |
| tipo | machine | source, machine, buffer, inspection, rework, sink (também em português) |
| tempo_ciclo | 12 | segundos |
| capacidade | 1 | postos em paralelo (buffer: capacidade total) |
| fila | 1 | peças aguardando na entrada |
| operadores | 2 | ou `manpower` |
| disponibilidade | 98 | % ou fração |
| mttr | 90 | segundos |
| x, y | 160, 120 | posição no canvas (opcional) |
| proximo | M02 ou QC:97,RW:3 | destinos e pesos |

Sem `tipo`, o tipo é deduzido do nome: QC/AOI/teste = Inspection, Repair/retrabalho = Rework,
buffer/estoque = Buffer. Uma inspeção seguida de um retrabalho vira um loop (3% vai para o
retrabalho e volta para reteste).

## Estrutura

```
src/engine   motor DES, RNG, indicadores
src/model    modelos de exemplo e montagem/layout automático de linhas
src/io       importação e exportação
src/ui       canvas, paleta, propriedades, dashboard
tests        testes (vitest)
```

## Roadmap

| Sprint | Escopo |
| --- | --- |
| 1 | MVP: canvas, blocos básicos, motor DES, animação, importação Excel/CSV, dashboard |
| 2 | Operadores, empilhadeiras, filas, layout completo, gargalos detalhados |
| 3 | Spaghetti chart: heatmap, distâncias, rotas, cruzamentos |
| 4 | Custos e cenários (atual × futuro A × futuro B) |
| 5 | Energia (kWh por peça/processo/turno) |
| 6 | Carbono (CO2e escopos 1-3) e dashboard ESG |
| 7 | Digital Twin (OPC-UA, MQTT, real × simulado) |
| 8 | IA: sugestões Lean, balanceamento e otimização de layout |

## Planilha padrão, tutorial e cycle × takt

- **Exportar → Planilha padrão** baixa um Excel com as abas Leia-me, Postos, Ligações, Pessoas e veículos e Parâmetros. Preencha e suba em **Importar** para montar a linha inteira. **Exportar → Planilha do modelo atual** sai preenchida com a linha aberta, para editar no Excel e importar de volta (com `x_m`/`y_m` em todos os postos, a planta DXF é mantida).
- **? Como usar** abre o procedimento de uso passo a passo, com os botões para baixar a planilha.
- **Análises → Cycle × Takt** mostra o cycle time de cada posto (tempo da giga ÷ gigas, ajustado por amostra, reparo e lote) contra o takt e 90% do takt, com o tempo medido na simulação ao lado.

## Salvar modelos

- **Salvar** (ou Ctrl+S) grava o modelo aberto; o botão mostra **Salvar •** quando há mudança não salva e **Salvo ✓** quando está tudo gravado.
- **Salvos** lista os modelos para abrir, salvar como novo ou apagar.
- Dentro do artefato do claude.ai os modelos ficam na conta de cada pessoa (banco do artefato, área privada), divididos em partes quando a planta DXF é grande. Fora dele, ou sem permissão de escrita, ficam no navegador.
