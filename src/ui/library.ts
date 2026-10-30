// Biblioteca de soluções: as dúvidas mais comuns, cada uma com passo a passo em imagens e um exemplo pronto.

import type { AnalysisTab } from '../store';

export type LibExample = 'transport' | 'combine' | 'elements' | 'simple';

export interface LibStep {
  text: string;
  /** nome do print em src/assets/library (sem extensão) */
  img?: string;
}

export interface LibItem {
  id: string;
  /** a dúvida, do jeito que a pessoa pergunta */
  q: string;
  tag: string;
  why: string;
  steps: LibStep[];
  tip?: string;
  example?: LibExample;
  screen?: AnalysisTab;
  /** palavras-chave extras para a busca (sinônimos, siglas) */
  keys?: string;
}

export const LIBRARY: LibItem[] = [
  {
    id: 'dados-reais',
    q: 'Como uso os dados reais da linha (tempo de cada posto) no estudo?',
    tag: 'Dados reais',
    why: 'Cada posto manda uma leitura por peça: posto, número de série, início e fim (e a operação, se houver). Com elas o simulador calcula o ciclo real, tira os valores fora da curva e compara com o SOE. Enquanto a API dos postos não existe, a linha simulada faz o papel da linha real.',
    steps: [
      { text: 'Abra um exemplo (ou a sua linha) e vá em Análises → Dados reais.', img: 'reais-1' },
      { text: 'Escolha as horas e a diferença do SOE e clique em ▶ Gerar leituras. Com a API pronta, cole o endereço e clique em Buscar da API; ou importe um Excel com posto, serie, inicio, fim, operacao.', img: 'reais-2' },
      { text: 'Ajuste as regras: descartar fora de ± 2 desvios, ritmo, tolerâncias, alerta (10%), erro e confiança do número mínimo de amostras.', img: 'reais-3' },
      { text: 'Leia a tabela: amostras usadas, descartadas, mínimo de amostras (vermelho = faltam leituras), tempo padrão, SOE e desvio (vermelho = acima do alerta). Clique no posto para ver as operações e os valores descartados.', img: 'reais-4' },
      { text: 'Clique em Aplicar no modelo (no posto ou em todos) para simular com o tempo e a variação reais. A aba Real × simulado recebe os mesmos números.', img: 'reais-5' },
    ],
    tip: 'Nenhum dado de pessoa é guardado (LGPD): só posto, turno e número de série. Se o estudo estiver por elementos, mude para tempo de ciclo do posto para usar o tempo real.',
    example: 'elements',
    screen: 'coleta',
    keys: 'api coleta cronometragem cronoanalise tempo real leitura scan scanner serie discrepante outlier desvio padrao sigma amostras ritmo tolerancia allowance tempo padrao soe alerta lgpd integracao digital twin',
  },
  {
    id: 'vincular',
    q: 'Como vinculo um operador, AGV ou AMR a um transporte?',
    tag: 'Transporte',
    why: 'O recurso só leva peças no trecho (seta) em que foi vinculado. Sem vínculo, a peça anda sozinha como se fosse esteira.',
    steps: [
      { text: 'Na paleta, clique em Operador (Equipe compartilhada). Ele aparece no layout; arraste para perto do trecho.', img: 'vincular-1' },
      { text: 'Segure Ctrl e clique no operador.', img: 'vincular-2' },
      { text: 'Ainda com Ctrl, clique na seta do trecho que ele vai atender.', img: 'vincular-3' },
      { text: 'Na janela de vínculo, confira o posto de saída e o de entrada, as peças por viagem e a distância. Clique em Salvar vínculo.', img: 'vincular-4' },
      { text: 'O trecho fica tracejado com a distância. Dê ▶ Start: o operador busca e leva a peça.', img: 'vincular-5' },
    ],
    tip: 'Também dá para arrastar o operador e soltar em cima da seta. Clique no operador para editar ou apagar.',
    example: 'transport',
  },
  {
    id: 'bins',
    q: 'O AMR leva um carrinho de 50 peças do item B e 20 do item A. Onde ficam no posto?',
    tag: 'Transporte',
    why: 'Sem viagem, a regra é one piece flow: uma peça por vez na fila do posto. Com Peças por viagem maior que 1, cada item ganha os seus carrinhos/bins atrás do posto de destino, do tamanho da viagem.',
    steps: [
      { text: 'Dê duplo clique na seta do item (ou no AMR). Abre o vínculo de transporte.', img: 'bins-1' },
      { text: 'Em Peças por viagem coloque o tamanho do carrinho (ex.: 50) e em Carrinhos/bins quantos ficam atrás do posto (2 = um em uso e um cheio esperando).', img: 'bins-2' },
      { text: 'No layout aparece cada carrinho ao lado do posto com o nível (ex.: 37/100). O AMR traz um carrinho cheio quando há lugar para ele.', img: 'bins-3' },
    ],
    tip: 'Com 1 carrinho a montagem para enquanto o AMR busca o próximo. Se o nível chega a 0 com frequência, aumente os carrinhos ou o número de AMRs.',
    example: 'combine',
  },
  {
    id: 'trilha',
    q: 'Como faço o operador ou o AGV seguir um caminho (corredor) e não a linha reta?',
    tag: 'Transporte',
    why: 'Toda seta pode ter pontos de curva. A peça e o recurso vinculado andam pela trilha, e a distância e o tempo de transporte passam a ser medidos por ela.',
    steps: [
      { text: 'Clique na seta. Aparece um ＋ no meio de cada trecho.', img: 'trilha-1' },
      { text: 'Arraste o ＋ até o corredor: vira um ponto de curva (azul). Repita para cada esquina. Duplo clique no ponto apaga.', img: 'trilha-2' },
      { text: 'Ou use ↱ Trilha em L no painel para uma curva de 90° na hora. Dê ▶ Start: o operador vai e volta pela trilha.', img: 'trilha-3' },
    ],
    tip: 'Se o trecho real é maior que o desenho (outro prédio), preencha a Distância real: ela vale mais que a trilha.',
    example: 'transport',
  },
  {
    id: 'nao-leva',
    q: 'O operador não está levando a peça para o outro posto',
    tag: 'Transporte',
    why: 'As causas comuns são três. O trecho não tem vínculo. O posto de destino está sem lugar na fila. Ou o posto está com "Agrupar N peças" e espera juntar um lote que nunca completa.',
    steps: [
      { text: 'Ligue a camada Números (paleta → camadas). Embaixo de cada posto aparece fila, fazendo e prontas.', img: 'naoleva-1' },
      { text: 'Clique na seta: em "Busca de peça / transporte" tem que aparecer o operador. Se estiver "Esteira / automático", faça o vínculo.', img: 'naoleva-2' },
      { text: 'Clique no posto de destino: aumente a Fila de entrada para caber pelo menos uma viagem.', img: 'naoleva-3' },
      { text: 'Se aparecer "0/2" ao lado do posto, é o Agrupar N peças do posto. Zere esse campo: peças por viagem se ajusta no vínculo.', img: 'naoleva-4' },
    ],
    tip: 'Dois postos abastecendo o mesmo destino dividem a fila dele. Quando não cabe a viagem cheia, o operador leva o que tem pronto.',
    example: 'transport',
  },
  {
    id: 'travada',
    q: 'A simulação parou com "Linha travada". O que faço?',
    tag: 'Simulação',
    why: 'O simulador percebeu peças paradas por causa da configuração: um componente que nunca chega, um agrupamento que não completa, um recurso sem unidades ou um destino cheio. Ele pausa e diz qual bloco ajustar.',
    steps: [
      { text: 'Leia o motivo de cada bloco e o "O que fazer".', img: 'travada-1' },
      { text: 'Clique no botão verde para ajustar na hora (ou em Mostrar no layout para ir até o bloco). Depois, Fechar e rodar de novo → ▶ Start.', img: 'travada-2' },
    ],
    tip: 'Continuar mesmo assim ignora o aviso até você mudar o modelo.',
  },
  {
    id: 'combinar',
    q: 'Recebo peças de vários postos e junto tudo em um produto',
    tag: 'Montagem',
    why: 'O posto de montagem só começa quando tem o produto (entrada Principal) e as peças de cada Componente na quantidade certa.',
    steps: [
      { text: 'Ligue cada posto fornecedor ao posto de montagem (uma seta por peça).', img: 'combinar-1' },
      { text: 'Clique no posto de montagem. Em "Combinar peças neste posto", deixe uma entrada como Principal e as outras como Componente, com a quantidade por produto.', img: 'combinar-2' },
      { text: 'Dê ▶ Start. Se faltar componente, o posto fica Esperando peça; o fornecedor mais lento aparece como gargalo.', img: 'combinar-3' },
    ],
    tip: 'A Principal tem que vir de um bloco que recebe material. Se ela vem de um bloco sem seta de entrada, os componentes enchem a fila e o posto nunca começa: aumentar a fila não resolve.',
    example: 'combine',
  },
  {
    id: 'gigas',
    q: 'Número de gigas é a mesma coisa que buffer? Como calculo?',
    tag: 'Postos',
    why: 'Não. Gigas são as posições em que o posto trabalha ao mesmo tempo. Buffer é a Fila de entrada, onde a peça espera antes do posto.',
    steps: [
      { text: 'Clique no posto e no ⓘ ao lado de Número de gigas.', img: 'gigas-1' },
      { text: 'Gigas = arredondar para cima (ciclo ÷ eficiência ÷ takt). Ex.: 150 s ÷ 0,9 ÷ 32 s = 5,2, ou seja, 6 gigas.' },
      { text: 'Fila de entrada: comece com 2 (ou tempo de reparo ÷ takt) e confirme simulando. Fila cheia antes do posto = gargalo.' },
    ],
  },
  {
    id: 'meta',
    q: 'De onde vem a Meta UPH e o takt?',
    tag: 'Takt',
    why: 'Com a meta em branco (auto), o takt é o do posto gargalo planejado: a linha mede quanto consegue entregar. Digite uma meta só quando a demanda for fixa.',
    steps: [
      { text: 'No topo, a caixa META UPH mostra "auto" e o takt da operação ao lado.', img: 'meta-1' },
      { text: 'Para usar a demanda do cliente, digite a meta (peças/h) no painel Modelo. Apague para voltar ao automático.' },
    ],
  },
  {
    id: 'formulario',
    q: 'Como baixo o formulário do Yamazumi e crio os blocos sozinho?',
    tag: 'Balanceamento',
    why: 'O formulário segue o padrão do SOE: uma linha por atividade. Ao importar, cada posto da planilha vira um bloco da linha, já com as atividades, na ordem em que aparecem.',
    steps: [
      { text: 'Em Começar (ou Exportar → Formulário Yamazumi), clique em 📥 Formulário Yamazumi (SOE). Se a linha aberta já tem atividades, ele vem preenchido com elas.', img: 'soe-1' },
      { text: 'No Excel, preencha a aba SOE: POSTO, OPERAÇÃO, ATIVIDADE, TEMPO e TIPO (VA, NVA, Deslocamento, Espera, Máquina). Feche cada posto com a linha de Total. O allowance (E1) calcula o tempo com folga.', img: 'soe-2' },
      { text: 'Volte ao simulador: Abrir arquivo (ou Importar), escolha a planilha e marque "Criar uma linha nova com estes postos".', img: 'soe-3' },
      { text: 'Pronto: os blocos são criados sozinhos, ligados do material ao produto pronto, com as atividades de cada posto.', img: 'soe-4' },
      { text: 'Veja o Yamazumi em Análises → Yamazumi e, se quiser, ⚡ Balancear automático.', img: 'soe-5' },
    ],
    tip: 'O simulador usa a coluna TEMPO C/ ALLOWANCE. Para ajustar, edite a planilha e importe de novo, ou mexa direto em Operações e atividades.',
  },
  {
    id: 'yamazumi',
    q: 'Como monto o Yamazumi ou subo as atividades por tabela?',
    tag: 'Balanceamento',
    why: 'O Yamazumi soma as atividades de cada posto. Elas entram coladas do Excel, por posto, ou todas de uma vez pela planilha padrão.',
    steps: [
      { text: 'Clique no posto e em "Operações e atividades".', img: 'yamazumi-1' },
      { text: 'Clique em 📋 Colar tabela do Excel e cole as colunas operação | atividade | tempo | tipo.', img: 'yamazumi-2' },
      { text: 'Veja em Análises → Yamazumi.', img: 'yamazumi-3' },
    ],
    tip: 'Para todos os postos: Exportar → Planilha padrão, aba Atividades, e estudo = elemento na aba Parâmetros.',
    example: 'elements',
    screen: 'yamazumi',
  },
  {
    id: 'balancear',
    q: 'Como balanceio a linha automaticamente?',
    tag: 'Balanceamento',
    why: 'O balanceamento automático reparte as atividades, na ordem em que acontecem, enchendo cada posto até o takt.',
    steps: [
      { text: 'Análises → Rebalancear → ⚡ Balancear automático.', img: 'balancear-1' },
      { text: 'Compare postos, pessoas e UPH antes e depois. Use Desfazer (Ctrl+Z) se não gostar.' },
    ],
    example: 'elements',
    screen: 'rebalancear',
  },
  {
    id: 'turnos',
    q: 'Como coloco almoço, ginástica e troca de modelo?',
    tag: 'Turnos',
    why: 'As paradas param os postos nos horários do turno e o UPH real cai na proporção do tempo parado.',
    steps: [
      { text: 'Análises → Turnos e paradas → Usar paradas padrão ou + parada.', img: 'turnos-1' },
      { text: 'Pausa para só as pessoas; Troca de modelo para a linha toda.' },
    ],
    screen: 'turnos',
  },
  {
    id: 'replicas',
    q: 'O UPH muda a cada simulação. Qual número uso?',
    tag: 'Resultados',
    why: 'Com variação e falhas, cada turno simulado é um sorteio. As réplicas rodam o turno várias vezes e dão a faixa de confiança.',
    steps: [
      { text: 'Análises → Réplicas → ▶ Rodar réplicas. Use o UPH médio e a faixa de 95%.', img: 'replicas-1' },
    ],
    screen: 'replicas',
  },
  {
    id: 'oee-ole',
    q: 'Por que posto manual mostra OLE e não OEE?',
    tag: 'Indicadores',
    why: 'OEE mede máquina. Em posto só com pessoa, o indicador certo é o OLE (eficácia da mão de obra): disponibilidade × desempenho × qualidade da pessoa.',
    steps: [{ text: 'Clique num posto manual: o painel mostra OLE no lugar de OEE.', img: 'ole-1' }],
  },
  {
    id: 'tema',
    q: 'Meu fundo ficou branco. Como volto para o escuro?',
    tag: 'Tela',
    why: 'O fundo escuro é o padrão. O botão no topo alterna entre claro e escuro e a escolha fica salva no navegador.',
    steps: [{ text: 'Clique em ☀ Claro / 🌙 Escuro, ao lado do Snap.', img: 'tema-1' }],
  },
];
