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
