# PRD - Gamb RHiD Plus

## Contexto condensado

Documento de continuidade do projeto `gamb_rhid`, criado para reduzir a necessidade de recuperar conversas anteriores. Atualizado em 26/05/2026.

O produto é uma aplicação web/PWA pessoal para acompanhar a jornada de trabalho vinculada ao uso do RHiD. A visão final é facilitar o registro de ponto, calcular automaticamente o fechamento diário, avisar os momentos de retorno e saída e manter um banco de horas confiável.

Repositório: `https://github.com/gamberine/gamb_rhid`  
Aplicação RHiD de referência: `https://www.rhid.com.br/v2/#/ponto_funcionario`  
Design tokens mandatórios: `https://gamberine.com.br/arquivos_publicos/gamb_variables_geral.css`

## Objetivo

Reduzir esforço manual e risco de erro no acompanhamento da jornada diária, oferecendo:

- registro orientado dos eventos do dia;
- cálculo visível do tempo trabalhado, tempo restante e saída prevista;
- avisos amigáveis para retorno do almoço e encerramento da jornada;
- histórico com saldo de horas;
- integração com marcação web do RHiD e caminho para notificações móveis confiáveis.

## Restrições e princípios

- O projeto é conduzido por uma pessoa usuária e um agente de desenvolvimento; manutenção e custo devem permanecer baixos.
- O design deve usar Tailwind, componentes PrimeReact ou equivalente, Flaticon UIcons e as variáveis visuais fornecidas.
- Uma marcação real de ponto não deve ser realizada em testes; o backend bloqueia envio por padrão e a liberação exige configuração explícita, confirmação e localização.
- Segredos de integração nunca devem ficar no frontend.
- Mudanças devem passar por lint, testes, build e auditoria antes de publicação.

## Estado atual do MVP

Status: implementado e publicado na branch `main`.

| Capacidade | Status | Observação |
| --- | --- | --- |
| Interface responsiva | Entregue | Validada em desktop, 390 px e 320 px |
| Design system | Entregue | Tokens externos + fallback/cache PWA |
| Registro de marcações | Entregue com proteção de teste | Sessão RHiD mostra somente dados oficiais; envio requer liberação explícita, batida anterior sincronizada, confirmação e localização |
| Jornada diária | Entregue | Meta configurável, padrão de 8 horas |
| Intervalo | Entregue | Padrão de 1 hora, configurável |
| Previsão de saída | Entregue | Recalculada após retorno do intervalo |
| Alertas no navegador | Entregue | Com PWA aberto/ativo e permissão concedida; menu no header permite pausar ou testar |
| Banco de horas filtrável | Entregue | Atalhos para ontem, semana e mês; pesquisa e classificação da tabela |
| Pendências do histórico | Entregue | Importa `possuiPendencias` e consulta detalhe de aprovação sob clique |
| Marcações excedentes | Entregue | A partir da quinta marcação diária, informa quantidade e horários com destaque de aviso |
| Indicadores de progresso | Entregue | Meta trabalhada exibe percentual/tempo restante; integração exibe próximo ciclo automático |
| Banco de horas | Em validação operacional | Para funcionário, calculado com marcações oficiais carregadas desde 01/05/2026; não representa saldo oficial fornecido pelo RHiD |
| Integração RHiD | Em validação operacional | Login, leitura diária, carga histórica do portal e marcação web implementados |
| Push em segundo plano | Pendente | Requer backend e Web Push/FCM |
| Deploy público/privado | Bloqueado pelo plano | GitHub Pages privado indisponível no plano atual |

## Fluxo funcional

### Jornada diária

1. Usuário registra `Entrada`.
2. O sistema inicia o contador de tempo trabalhado.
3. O sistema prevê a saída somando as horas trabalhadas configuradas ao intervalo planejado; por padrão, `08:00 + 01:00 = 09:00` de permanência.
4. Usuário registra `Saída para almoço`.
5. Quando faltarem 2 minutos para completar o intervalo planejado, o sistema emite um lembrete.
6. Ao completar 60 minutos desde a `Saída para almoço`, o sistema registra automaticamente a `Entrada 2 - Retorno Almoço`, desde que a saída exista e a entrada ainda não tenha sido registrada.
7. O sistema recalcula a saída prevista conforme o intervalo efetivamente realizado.
8. Quando faltarem 5 minutos para a meta diária, o sistema avisa que a jornada está próxima da conclusão.
9. Ao completar a meta, o sistema orienta o usuário a conferir e registrar a saída.
10. Usuário registra `Saída`; a jornada passa a integrar o banco de horas.

### Histórico

- Listar jornadas registradas por data.
- Mostrar tempo trabalhado, intervalo, quantidade de marcações e saldo diário.
- Exibir saldo acumulado somente com jornadas encerradas.

### Ajustes

- Meta diária em horas, padrão `08:00`.
- Intervalo planejado em minutos, padrão `60`.
- Antecedência do aviso de saída, padrão `5` minutos.
- Antecedência do aviso de retorno, padrão `2` minutos.

## Requisitos de produto

### Funcionais

| ID | Requisito | Status |
| --- | --- | --- |
| RF-01 | Registrar entrada, saída para intervalo, retorno e saída final | Retorno do almoço automático após 60 minutos; demais marcações web disponíveis após sincronização oficial; contingência é o portal RHiD |
| RF-02 | Calcular tempo trabalhado e restante em tempo real | Entregue |
| RF-03 | Calcular e recalcular previsão de saída | Entregue |
| RF-04 | Emitir aviso 2 minutos antes do retorno planejado | Entregue no navegador ativo |
| RF-05 | Emitir aviso 5 minutos antes de completar a jornada | Entregue no navegador ativo |
| RF-06 | Emitir aviso ao completar a jornada | Entregue no navegador ativo |
| RF-07 | Apresentar banco de horas e histórico diário | Entregue com prioridade para marcações oficiais importadas |
| RF-08 | Persistir dados entre sessões | Entregue: batidas oficiais normalizadas são gravadas em `localStorage`, vinculadas ao funcionário |
| RF-09 | Consultar apuração real do RHiD | Implementado para marcações diárias e relatório do portal desde 01/05/2026; aguardando conferência operacional |
| RF-10 | Registrar ponto real no RHiD | Implementado, bloqueado por padrão; exige habilitação, batida anterior sincronizada, confirmação e localização |
| RF-11 | Receber notificações com app fechado no celular | Pendente de backend push |

### Não funcionais

| ID | Requisito | Status |
| --- | --- | --- |
| RNF-01 | Funcionar responsivamente em celular e desktop | Entregue |
| RNF-02 | Ser instalável como PWA | Entregue |
| RNF-03 | Usar os tokens visuais da marca | Entregue |
| RNF-04 | Evitar exposição de credenciais no browser | Regra arquitetural |
| RNF-05 | Ter CI com testes, lint, build e auditoria | Entregue |
| RNF-06 | Implantar somente após CI aprovada | Configurado, aguardando hospedagem |

## Arquitetura vigente

| Camada | Tecnologia / decisão |
| --- | --- |
| Frontend | React 18 + TypeScript + Vite |
| UI | PrimeReact + Tailwind CSS |
| Ícones | Flaticon UIcons, glifos mínimos carregados |
| Datas/cálculos | Day.js + funções puras testadas |
| Persistência MVP | Batidas oficiais normalizadas/jornada em `localStorage`; resposta bruta transitória; sessão em cookie `HttpOnly` criptografado |
| PWA | `vite-plugin-pwa`, service worker e ícones instaláveis |
| Integração RHiD | Backend Node em `server/index.mjs` e cliente em `src/services/rhidApi.ts` |
| Qualidade | Vitest, ESLint, TypeScript, `npm audit` |
| CI/CD | GitHub Actions |

Arquivos de referência:

- `src/App.tsx`: fluxo principal e telas.
- `src/domain/journey.ts`: regra de cálculo da jornada.
- `src/domain/journey.test.ts`: testes das regras centrais.
- `src/services/notifications.ts`: alertas do navegador.
- `src/services/rhidApi.ts`: cliente das rotas protegidas da integração.
- `server/index.mjs`: autenticação RHiD e proxy de consultas sem expor token ao frontend.
- `docs/arquitetura.md`: decisões técnicas complementares.

## Integrações futuras

### RHiD

O Swagger oficial documenta a API de integração `/v2/api.svc`, mas a conta de funcionário não foi autorizada nessa consulta. O bundle público do portal mostra outro fluxo: autenticação em `/v2/login.svc/`, consulta de marcações do dia em `https://repp.rhid.com.br/ponto_diario` e marcação web em `https://repp.rhid.com.br/marcacao_web`. Este fluxo foi implementado porque corresponde à navegação oficial do usuário.

Condições da marcação real, indisponível no modo de teste padrão:

1. O backend foi iniciado deliberadamente com `ALLOW_OFFICIAL_RHID_PUNCH=true`.
2. A consulta `ponto_diario` confirmou pelo menos uma batida oficial anterior no dia; a primeira batida é feita no portal oficial.
3. O usuário confirma cada envio no momento da batida, exceto a `Entrada 2 - Retorno Almoço`, enviada automaticamente ao completar 60 minutos quando ainda não existir.
4. O navegador fornece geolocalização atual para o retorno automático.
5. O backend persiste por conta as coordenadas das marcações enviadas por esta aplicação e os locais autorizados do perfil, sem expor esses dados entre usuários.
6. O fluxo web da conta foi informado como sem foto; eventual recusa do RHiD deve ser tratada usando o portal oficial.

O retorno automático é idempotente por saída de almoço: exige exatamente as duas primeiras marcações do dia, sincroniza o `ponto_diario` ao completar 58 minutos, bloqueia a marcação manual nesse momento e executa no máximo uma tentativa aos 60 minutos. A janela de proteção termina 25 minutos depois do horário automático. Se a sincronização já encontrar a `Entrada 2`, nenhum envio é feito.

A localização enviada nunca é fabricada: corresponde à posição real obtida pelo navegador no momento da automação. O backend aceita o envio somente dentro de 100 metros de uma faixa autorizada. A prioridade são as coordenadas reais da `Entrada 1` e da `Saída 1` quando ambas estiverem disponíveis. Na ausência delas, a tela `Ajustes` permite cadastrar residência e trabalho, capturando presencialmente a coordenada de cada endereço, e selecionar em calendário os dias presenciais. Dias selecionados usam trabalho; os demais usam residência. Sem referência válida, sem GPS ou com precisão superior a 100 metros, a marcação automática é bloqueada.

A aplicação importa horários em formatos completos reconhecíveis e em `yyyyMMddHHmm`, identifica sua origem como `RHiD`, prioriza esses valores nos cálculos e preserva o retorno para conferência. Nas rotas do portal do funcionário, somente campos `dateTimeStr` são tratados como batidas. O login suporta a seleção de empresa retornada em `listCustomer`, refazendo a autenticação com o domínio selecionado. Para usuário trabalhador, a consulta diária não depende do endpoint administrativo de pessoas. A atualização de hoje ocorre a cada 5 minutos com a aplicação ativa e seu resultado fica registrado no painel RHiD; token expirado exige novo login, pois não há renovação pública documentada.

O bundle referencia `report.svc/apuracao_ponto_salva_tabela` para a tela de relatório, enviando `idPerson`, `ini`, `fim` e `afdChanges`. Esse fluxo foi implementado para carregar as batidas oficiais desde `01/05/2026` até a data atual em consulta separada de `ponto_diario`; a resposta autorizada precisa ser conferida na aplicação. A mesma resposta fornece `possuiPendencias`; quando o usuário abre o alerta de um dia, a aplicação reproduz a consulta somente leitura `report.svc/list_alteracoes_ponto` utilizada pelo modal do portal. Após uma carga reconhecida, as batidas e indicadores de pendência ficam gravados localmente por funcionário e são substituídos no período de cada nova consulta, sem persistir o retorno bruto nem executar aprovação. O banco de horas é derivado localmente dessas batidas e não deve ser apresentado como saldo oficial calculado pelo RHiD.

Quando o histórico contém mais de quatro batidas no mesmo dia, a aplicação preserva todas para cálculo e conferência e sinaliza da quinta em diante como marcações excedentes. O destaque visual deriva dos tokens semânticos do design system CDN; o CSS estrutural da tela de manutenção do portal não é importado.

A barra principal da jornada representa o percentual da meta de trabalho reconhecida e informa o tempo restante em segundos. No painel RHiD, uma barra secundária de baixo contraste representa o ciclo agendado de atualização automática a cada 5 minutos; sincronizações manuais ou disparadas pelo foco da janela não alteram essa contagem.

### Notificações móveis confiáveis

O navegador atual não garante lembretes agendados com o PWA fechado. Para a meta completa:

1. Adicionar backend de baixo custo para armazenar jornadas e agendas.
2. Adotar Web Push com VAPID ou Firebase Cloud Messaging.
3. Enviar eventos ao service worker do PWA instalado.
4. Cancelar/recalcular lembretes quando houver nova marcação.

Opção a avaliar: Supabase para persistência/funções e Web Push, ou solução equivalente de baixo custo.

### Agentes/MCP

Foi solicitado aproveitar Gemini e/ou Copilot via MCP para economizar tokens. No ambiente atual não há conector desses provedores configurado.

Diretriz futura:

- delegar apenas tarefas auxiliares delimitadas, como testes e revisão;
- não compartilhar segredos de RHiD;
- exigir revisão humana e CI verde antes de merge/deploy;
- definir permissões de leitura/escrita antes de instalar qualquer conector.

## CI, versionamento e deploy

Fluxo desejado:

1. Trabalhar em branch `feature/<descricao>`.
2. Executar `npm run lint`, `npm test`, `npm run build` e `npm audit --audit-level=moderate`.
3. Abrir pull request para `main`.
4. Mesclar após CI verde e revisão.
5. Publicar automaticamente a revisão aprovada.

Implementado:

- `.github/workflows/ci.yml`: auditoria, lint, testes e build.
- `.github/workflows/deploy-pages.yml`: deploy condicionado a CI verde e à variável `ENABLE_PAGES_DEPLOY=true`.
- `.github/dependabot.yml`: atualizações periódicas.

Limitações confirmadas em 24/05/2026:

- GitHub Pages recusou ativação para o repositório privado no plano atual.
- Proteção obrigatória da branch `main` foi recusada, exigindo GitHub Pro ou repositório público.

Próxima decisão de hospedagem:

- tornar o repositório público ou alterar plano para habilitar Pages; ou
- publicar frontend e backend em Vercel/Cloudflare ou servidor próprio mantendo o repositório privado; apenas `dist/`/GitHub Pages não executa a API Node que protege o token RHiD.

## Execução local

Requisito: Node.js `>=22.12.0` (`.nvmrc`: `22.16.0`).

```bash
npm ci
npm run dev
```

O projeto usa Vite, não Angular. Portanto o comando correto para desenvolvimento é `npm run dev`, não `ng serve`.

Sem `ALLOW_OFFICIAL_RHID_PUNCH=true`, esse comando inicia o modo de teste: o login e a consulta diária são reais, mas o endpoint de envio oficial é bloqueado pelo backend. Em sessão RHiD, a jornada exibida contém somente horários oficiais reconhecidos; para testar alertas sem bater ponto, use o menu de alertas do cabeçalho.

No Git Bash, `./scripts/dev-test.sh` valida o Node `22.16.0` ativo e inicia o modo de teste bloqueado.

Comandos de validação:

```bash
npm run lint
npm test
npm run build
npm audit --audit-level=moderate
```

## Backlog priorizado

| Prioridade | Item | Dependência |
| --- | --- | --- |
| P0 | Definir hospedagem acessível para publicar o PWA | Decisão de custo/visibilidade |
| P0 | Validar a primeira marcação web real em momento apropriado | Confirmação do usuário na interface |
| P1 | Hospedar o backend seguro para acesso móvel | Escolha de infraestrutura |
| P1 | Conferir resposta real da carga histórica desde 01/05/2026 e os saldos calculados | Sessão autorizada na aplicação |
| P1 | Implementar push com app fechado | Backend + Web Push/FCM |
| P2 | Exportar relatório de banco de horas | Modelo de relatório |
| P2 | Instalar MCP externo somente com escopo e segurança definidos | Provedor escolhido |

## Critérios para próximo ciclo

O próximo incremento estará pronto quando:

- a hospedagem escolhida disponibilizar URL utilizável no celular;
- dados e credenciais de homologação do RHiD forem fornecidos ou a integração for formalmente adiada;
- qualquer funcionalidade nova preservar os testes de jornada existentes;
- CI estiver verde antes de publicação.
