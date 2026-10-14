# Arquitetura inicial

## Decisões do MVP

| Tema | Decisão inicial |
| --- | --- |
| Interface | React + TypeScript + Vite, com PWA instalável |
| Componentes | PrimeReact e Tailwind CSS |
| Identidade visual | Variáveis carregadas de `https://gamberine.com.br/arquivos_publicos/gamb_variables_geral.css` |
| Ícones | Flaticon UIcons, somente glifos usados no bundle |
| Dados | Batidas oficiais normalizadas e pendências em SQLite local via `better-sqlite3` (`.data/rhid.sqlite`), cache de interface em `localStorage`; resposta bruta somente em memória; sessão RHiD em cookie `HttpOnly` criptografado |
| Integração | Backend Node que intermedeia login do portal e consultas RHiD; local no desenvolvimento e mesma origem em produção |
| Qualidade | GitHub Actions: auditoria, lint, testes e build |
| Publicação | Build Vite servido pelo backend Node em produção; GitHub Pages só é válido para frontend estático sem a integração funcional |

## Regra de jornada

1. A primeira entrada inicia a contagem de trabalho e calcula uma saída prevista considerando horas trabalhadas mais intervalo configurado; o padrão de `08:00 + 01:00` resulta em `09:00` de permanência.
2. A saída para intervalo inicia um contador e agenda aviso quando faltarem 2 minutos para o retorno planejado.
3. A entrada após o intervalo recalcula a saída prevista usando o tempo efetivamente trabalhado.
4. Com 5 minutos restantes é emitido um lembrete; ao atingir a meta é emitido o aviso de saída.
5. A execução padrão realiza marcação oficial após confirmação do usuário e captura de localização; o launcher de produção força `ALLOW_OFFICIAL_RHID_PUNCH=true` e o launcher de teste define `false` para testes sem envio.
6. Após quatro marcações que totalizam pelo menos 8 horas trabalhadas, a tela exibe o total e o saldo do dia e a API bloqueia novas marcações durante 4 horas.

## RHiD

Há dois fluxos distintos identificados:

1. O Swagger oficial em `https://www.rhid.com.br/v2/swagger.svc/index.html?url=/v2/swagger.svc/swagger.json` documenta a API de integração `/v2/api.svc`, incluindo `POST /login`, `GET /person` e `GET /apuracao_ponto`.
2. O bundle JavaScript servido pelo portal web em 25/05/2026 (`https://rhidv2.s3-sa-east-1.amazonaws.com/bundles/app.bundle.min.js.gz?v=20260520`) autentica o usuário em `/v2/login.svc/`, injeta `Authorization: Bearer <token>` e `X-Cid-RHiD` e, quando `accessType=1` (funcionário), consulta `https://repp.rhid.com.br/ponto_diario`.
3. Na tela `ponto_funcionario`, o bundle envia `POST /v2/report.svc/apuracao_ponto_salva_tabela` com `idPerson`, `ini`, `fim` e `afdChanges` para carregar a apuração histórica.
4. O modal `pendenciasModalController` do bundle consulta `POST /v2/report.svc/list_alteracoes_ponto` com funcionário e data para listar as pendências de aprovação.
4. Na tela de marcação web, o mesmo bundle obtém localização por `navigator.geolocation.getCurrentPosition` e envia `POST https://repp.rhid.com.br/marcacao_web` com `position`, `latitude` e `longitude`; o campo `photo` é enviado somente quando a configuração web exige foto.

A recusa recebida na API de integração não é consequência de executar em `localhost`: a chamada é feita pelo backend e já contém o token. Ela é consistente com utilizar a API de integração para uma conta que possui acesso ao portal do funcionário, sem permissão para os recursos administrativos. Publicar o frontend em GitHub Pages não cria essa permissão e também não hospeda o backend.

O backend em `server/index.mjs` envia usuário/senha ao mesmo login do portal e mantém somente o token recebido em cookie criptografado, `HttpOnly` e encerrável pelo botão `Sair`. Quando o login pede empresa em `listCustomer`, o frontend seleciona a empresa e repete a autenticação nesse contexto. Para contas de funcionário, a aplicação consulta `ponto_diario`, registra via `marcacao_web` e atualiza a jornada e os alertas somente com marcações oficiais reconhecidas no retorno. A variável `ALLOW_OFFICIAL_RHID_PUNCH=false` desativa o POST apenas no modo de teste explícito.

O normalizador em `src/services/rhidParser.ts` importa datas/horários em formato brasileiro, ISO e no formato compacto `yyyyMMddHHmm`. Nas consultas do portal do funcionário, somente campos `dateTimeStr` são importados como batidas, para não transformar metadados do relatório em registro de ponto. Linhas históricas com `possuiPendencias` são armazenadas separadamente como indicação do dia, sem criarem batida ou saldo. Em sessão de funcionário, anotações locais não são apresentadas como parte da jornada oficial.

O conjunto padrão da jornada contém quatro marcações diárias. Batidas oficiais adicionais não são descartadas: continuam compondo o cálculo e são rotuladas como excedentes na jornada e no banco de horas. A indicação visual corresponde à intenção de `.entrada-sem-saida` observada no CSS do portal, mas utiliza `--gamb-warning`/`--gamb-warning-900` e fundo translúcido do design system CDN, sem importar estilos globais externos.

A tela atualiza o relógio local uma vez por segundo; esse pulso alimenta o texto e a barra de progresso da meta trabalhada. O temporizador da sincronização automática mantém o próximo disparo em estado separado, de modo que a barra secundária representa somente o ciclo de 5 minutos e não consultas manuais.

Quando a API de geolocalização do navegador não existe ou nega a posição, a marcação entra em recuperação: a aplicação direciona o usuário ao perfil de locais em **Ajustes**, converte o endereço informado em coordenadas pelo backend e persiste o resultado por conta. Após salvar, retorna à tela inicial, consulta primeiro a marcação diária para evitar duplicidade e só então tenta o envio com a coordenada cadastrada. O bloqueio de segurança usa exclusivamente uma marcação confirmada na consulta diária; respostas aceitas ainda não confirmadas são verificadas a cada 5 minutos, com aviso ao usuário sem novo POST.

A atualização diária ocorre ao carregar uma sessão de funcionário, ao focar novamente a janela, pelo botão de refresh e a cada 5 minutos enquanto o aplicativo estiver aberto. Cada consulta registra data, hora e resultado no painel RHiD. Ao carregar a sessão e pelo refresh, uma consulta histórica separada envia o período de `01/05/2026` até a data atual para a rota de relatório do portal; ela alimenta o banco de horas e os indicadores de pendência, sem participar da autorização de uma marcação de hoje. O detalhe de uma pendência é carregado somente após clique e não oferece aprovar ou rejeitar. Após validação do formato, o backend persiste as batidas normalizadas, indicadores por data, o horário do último envio aceito, as coordenadas das marcações feitas por esta aplicação e o perfil de locais autorizados, sempre associados à conta em SQLite. Uma nova resposta substitui os dados dentro do período consultado, e o JSON bruto fica somente em memória para diagnóstico da sessão. O navegador mantém cache para renderização imediata e recupera o arquivo persistido do backend após autenticar. O saldo exibido é calculado pela aplicação a partir das batidas reconhecidas, não um saldo oficial devolvido pelo RHiD. Não há endpoint documentado de renovação de token; quando o RHiD expira a sessão, o aplicativo solicita novo login.

O Swagger consultado em 25/05/2026 não documenta endpoint para criar uma marcação de ponto. O envio utiliza a rota e o formato empregados pelo portal web oficial, exige confirmação do funcionário e sempre envia localização. A própria aplicação permite a primeira batida, consulta `ponto_diario` após o POST para trazer o horário efetivado e impede nova batida por 25 minutos. Entre 25 e 51 minutos, exige uma consulta diária posterior ao intervalo antes de liberar a ação. O backend consulta as marcações antes do POST e recusa qualquer intervalo inferior a 25 minutos.

O retorno do almoço possui uma proteção adicional. Aos 58 minutos após a `Saída 1`, o frontend atualiza o `ponto_diario` e bloqueia a marcação manual. Aos 59 minutos, tenta uma única marcação automática; a janela termina 25 minutos depois. O backend refaz a consulta diária antes do POST, exige exatamente duas marcações e valida a posição real do navegador em raio de 100 metros. Quando as duas coordenadas anteriores estão disponíveis, elas formam as faixas prioritárias. Caso contrário, o backend seleciona o local pré-cadastrado conforme o calendário presencial: trabalho para datas selecionadas e residência para as demais. A falta de referência ou precisão adequada interrompe o envio.

Para executar localmente:

1. Para um teste protegido no Git Bash, rodar `./scripts/dev-test.sh`, que valida o Node da `.nvmrc`, define `ALLOW_OFFICIAL_RHID_PUNCH=false` e inicia frontend e API de integração.
2. Abrir `http://127.0.0.1:5173/gamb_rhid/`.
3. Inserir as credenciais diretamente no login da aplicação e permitir notificações; não é preciso iniciar sessão separadamente no portal.
4. Para uma conta de funcionário, a aplicação consulta as batidas do dia, carrega o histórico desde `01/05/2026` e mantém atualização periódica da jornada de hoje.
5. No modo operacional (`npm run dev`), usar `Registrar ... no RHiD`, confirmar a ação e permitir localização; a confirmação oficial e o bloqueio temporal aparecem na mesma tela.
6. Para testar notificações sem risco de marcação, iniciar exclusivamente por `./scripts/dev-test.sh`.

Para executar o build de produção:

1. Rodar `npm ci`, `npm run build` e `npm start`.
2. Abrir `http://127.0.0.1:8787/gamb_rhid/` para uma prévia local.
3. Em servidor, definir `HOST=0.0.0.0`, `DATA_DIR` persistente, `SESSION_SECRET` fixo e publicar atrás de HTTPS.
4. Manter frontend e API na mesma origem sempre que possível, com `/api` reservado ao backend e o restante servido a partir do `dist/`.

## Notificações no celular

O MVP usa a API de notificações do navegador. Ela funciona com permissão do usuário e com o PWA aberto ou ativo; não garante disparo agendado quando o aplicativo foi encerrado.

Para alertas confiáveis em segundo plano, a evolução indicada é:

1. Backend pequeno com banco de marcações e agenda de eventos.
2. Web Push com chaves VAPID ou Firebase Cloud Messaging.
3. Service worker recebendo push no PWA instalado.
4. Preferências de aviso e cancelamento quando uma marcação ocorrer.

Uma opção de baixo custo é Supabase para banco/funções agendadas e Web Push; a escolha deve ser validada quando houver hospedagem e domínio definidos.

## Versionamento e deploy

O fluxo previsto para novas funcionalidades é:

1. Criar branch `feature/<nome>`.
2. Abrir pull request para `main`.
3. Exigir resultado verde do workflow `CI`.
4. Mesclar somente após revisão.
5. Com a variável `ENABLE_PAGES_DEPLOY=true`, o workflow `Deploy Pages` publica automaticamente a revisão aprovada, mas isso publica somente arquivos estáticos e não substitui uma hospedagem com backend.

Em 24/05/2026, a API do GitHub recusou a ativação de Pages e a proteção obrigatória de `main` para este repositório privado no plano atual, indicando upgrade para GitHub Pro ou mudança para público. Mesmo que Pages seja habilitado depois, o app funcional em produção precisa do backend Node para autenticar, proteger cookie `HttpOnly`, consultar o RHiD e persistir SQLite.

## MCP, Gemini e Copilot

Nenhum conector Gemini ou Copilot está disponível neste ambiente. Um MCP não deve receber acesso ao repositório ou segredos sem autenticação, limites de escrita e revisão humana definidos.

Quando um provedor for escolhido, a integração recomendada é somente para tarefas auxiliares, como geração de testes ou revisão de pull requests, sempre submetendo o resultado à mesma CI e à aprovação antes do deploy.
