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
  pan (arrastar o fundo), grid com snap, seleção múltipla (arrastar no fundo ou Shift+clique), pan com botão direito/meio, camadas,
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
- **Salvar / Salvar como…**: Salvar grava na lista de trabalhos salvos (Ctrl+S); Salvar como… grava o modelo em arquivo `.sim2d.json` escolhendo a pasta (Ctrl+Shift+S), ou baixa pelo navegador quando a janela de pasta não é permitida.
- **Controles**: Start, Pause, Stop (mantém os resultados), Reset (zera), Replay, Fim (calcula o turno inteiro) e velocidade de 1× a 600×.
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
- **Carrinhos/bins por item** (`bins` no link): transporte com viagem de várias peças entrega num buffer próprio do item atrás do posto (carrinhos × peças por viagem), separado da fila de entrada. Sem viagem continua one piece flow.
- **Trilha customizada** (`path` no link): pontos de curva na seta (arrastar o ＋, ou Trilha em L). Desenho, distância e o caminho do operador/AGV seguem a trilha, nos dois sentidos.
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
- **Exemplo de abastecimento e FGI**: linha de 100 UPH (10 montagem, 5 off-line, 4 teste, 5 packing) com supermercado, kitting, milk run por rebocador no corredor, FGI e expedição por empilhadeira, sobre uma planta vetorial genérica.
- **Mix de modelos**: produtos com % ou sequência fixa, tempo por posto e modelo (ou fator), tempo de troca de modelo; roda o turno com o mix e cada modelo sozinho. Exemplo: mix de 3 modelos.
- **Curva do tempo**: lognormal (padrão), normal, triangular, uniforme, exponencial, constante ou empírica por posto; *Ajustar curva* a partir de tempos colados ou dos dados reais, com teste de Kolmogorov-Smirnov.
- **Painel real × simulado**: UPH meta, simulado e real, gargalos e postos em alerta; gráfico e tabela por posto com SOE, simulado e real lado a lado. No artefato, *Publicar para leitores* grava a foto no banco e quem abre o link só como leitor vê apenas o painel, atualizado ao vivo.
- **Dados reais**: leituras por posto (API dos computadores dos postos, Excel/CSV ou linha simulada no lugar da real) com estudo de tempos: descarte de discrepantes (média ± k desvios), número mínimo de amostras, fator de ritmo, tolerâncias, alerta de desvio contra o SOE e aplicação do tempo e da variação reais no modelo. Sem dados de pessoa (LGPD).
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

## Montagem, colaborador e sequência dos gráficos

- **Montagem**: tipo próprio na paleta e no campo Tipo. O posto só começa quando tem o produto e um kit de cada ligação marcada como "Componente".
- **Operador**: o bloco da paleta cria uma equipe compartilhada e a liga ao posto selecionado.
- **Colaborador do posto**: escolha em cima, embaixo (na frente), à esquerda ou à direita no painel, ou arraste o boneco no layout.
- **Throughput por intervalo**: aba de Análises com 15 min, 30 min ou 1 h, total da linha contra a meta do takt e média por posto.
- **Sequência dos postos**: pop-up para arrastar a ordem e marcar quais postos aparecem nos gráficos (Cycle × Takt, Throughput, Estados por posto). Fica salvo no modelo.
- **Posto manual**: variação de Machine só com operador; esconde disponibilidade, MTTR, setup, potência, CO2 e custo de máquina.
- **Desfazer/refazer**: Ctrl+Z / Ctrl+Y ou ↶ ↷ na barra (60 passos; arrastar e digitar no mesmo campo contam como um passo). Módulo `src/engine/history.ts` escrito pelo Codex.
- **Recentes**: campo na barra com os 10 últimos trabalhos salvos; Salvos → Baixar arquivo guarda uma cópia `.sim2d.json` (abre em Importar).
- **Meta UPH** ao lado do takt na configuração do modelo.
- **Gráfico da frente**: ordem da linha principal por padrão (off-lines depois) e chave Estados / vs Takt (carga de cada posto em % do takt, passa de 100% quando estoura).
- **Eficiência (%)** por posto (padrão 100%): o ciclo real fica tempo ÷ eficiência; coluna `eficiencia` na planilha padrão.
- **Arrastar arquivo para a tela**: DXF ou imagem (PNG/JPG) do layout vira a planta de fundo (pede a largura real em metros); planilha ou JSON abre o modelo.
- **Planta de fundo**: no painel Modelo, tamanho (−/+), mover X/Y, opacidade, voltar ao original ou remover, sem mexer nos blocos.
- **Ligar arrastando**: passe o mouse no bloco, puxe a bolinha ➜ da lateral até o destino e solte. No modo Conectar, arrastar do próprio bloco também liga.
- **Tela de início**: o simulador abre em branco e pergunta: trabalho novo (com nome), um dos 10 salvos, abrir arquivo ou exemplo. O botão Início reabre essa tela.
- **Selecionar vários**: arraste com o botão esquerdo no fundo (Shift soma à seleção) e arraste um dos blocos para mover todos. Botão direito/meio (ou Alt + esquerdo) move a tela.
- **Busca de peça / transporte** no painel do posto: escolha AGV, empilhadeira, operador ou esteira para cada entrada, ou crie um novo ali mesmo.
- **Ajustar planta** (botão na tela): puxe os cantos para mudar o tamanho e arraste para posicionar.
- **Copiar e colar**: Ctrl+C / Ctrl+V (leva as ligações entre os blocos copiados), Ctrl+X recorta, Ctrl+D duplica, Ctrl+A seleciona tudo.
- **Meta UPH na barra**: digite o UPH esperado e o takt é calculado (3600 / UPH).
- **Gráfico inicial**: abre em Performance por posto × takt, ao vivo (barra clara = ainda planejado, cheia = medido), com a linha do takt; ⇅ Sequência dos postos ao lado.
- **Takt zero**: sem meta UPH, o takt usa a carga do posto gargalo da linha principal.
- **Indicadores**: OEE do posto gargalo; UPH real × meta (sem teto) e utilização na meta (carga média em % do takt, já com a ineficiência).
- **Top 5 gargalos** com o UPH de cada posto; clique no Throughput para escolher um posto de referência (fica roxo com "REF" no layout).
- **Adição rápida**: puxe a seta de um bloco e solte no vazio para criar Posto manual, Machine, Montagem, Buffer, Inspection, Rework ou Finished Goods já ligado.
- **Tarefas de transporte** (painel Modelo): operador, AGV, AMR ou empilhadeira busca num ponto e entrega em outro (kanban, buffer, FGI, posto).
- **Operações e atividades** por posto (agrega valor, não agrega, deslocamento, espera, máquina); a soma pode virar o tempo de ciclo.
- **Yamazumi** em Análises: atividades empilhadas por posto contra o takt, com escolha dos postos e a ineficiência no topo.
- **Estudo por cycle time ou por elemento** (painel Modelo ou Yamazumi): por elemento, a simulação usa a soma das atividades de cada posto; por cycle time, usa o tempo do posto e o Yamazumi reparte as atividades na proporção. Exemplo pronto: Exemplos → Linha com atividades (Yamazumi).
- **Operações** (barra de cima, painel do posto ou Yamazumi): janela com os postos à esquerda e operações/atividades à direita.
- **Setas**: clique numa seta e arraste a bolinha da ponta ou da origem para outro posto; duplo clique num bloco liga a seta ao bloco mais próximo ainda sem ligação.
- **Importar SOE**: Importar (ou arrastar) uma planilha com colunas Posto / Atividade / Tempo (ou Station / Task Description / Basic cycle time). Escolha a aba, aplique as atividades nos postos de mesmo nome do modelo aberto ou crie uma linha nova.
- **Rebalancear** (Análises): arraste atividades entre postos e veja UPH estimado, UPH simulado (2 h), balanceamento e pessoas na hora; aplique no modelo ou mande Atual × Proposto para Cenários (UPH, meta, gargalo, pessoas, custo).
- **Yamazumi arrastável**: botão ✋ Arrastar para balancear no Yamazumi liga o arrasto de atividades entre postos.
- **Atividades em tabela**: no posto, 📋 Colar tabela do Excel (operação | atividade | tempo | tipo) e Copiar como tabela; na planilha padrão, aba Atividades para todos os postos e parâmetro estudo = ciclo/elemento.
- **Operador e veículo arrastáveis**: solte num posto para virar a equipe dele, numa seta para fazer o transporte do trecho, ou no vazio para mudar o ponto de espera.
- **Balanceamento automático** (Rebalancear → ⚡): reparte as atividades na ordem, enchendo cada posto até o takt; postos que sobram ficam sem pessoa.
- **Réplicas**: 10 a 30 turnos com sementes diferentes; UPH médio com intervalo de 95%, P5–P95 e turnos na meta.
- **Turnos e paradas**: almoço, ginástica laboral (param os postos com gente) e troca de modelo (para a linha) entram na simulação e no UPH real.
- **Vínculo de transporte**: Ctrl+clique no operador/AGV/AMR e na seta abre a janela com posto de entrada (output), posto de saída (input), produto ou componente de montagem, peças por viagem e ocupação estimada. Operador também faz transporte de trecho.
- **Recursos editáveis**: clique no operador/AGV/AMR para editar tudo no painel, ver os vínculos e apagar (Delete).
- **OLE** no lugar de OEE para posto manual.
- **Meta UPH zerada** ao abrir um trabalho: o takt vem da operação (gargalo planejado).
- **Como usar** didático em cada tela nova e moldura azul cintilante.
- **Como usar → Siglas / Funções**: tabelas com todas as siglas (significado e uso) e as funções da aplicação.
