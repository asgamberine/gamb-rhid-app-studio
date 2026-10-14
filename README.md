# Gamb RHiD Plus

Aplicação de acompanhamento de jornada e registro de ponto no RHiD. A plataforma autentica no RHiD por backend local, consulta e registra marcações oficiais do funcionário, calcula carga restante e emite lembretes no navegador. Cada batida oficial exige confirmação e localização.

## Execução

Requisito: Node.js `22.16.0` ou superior compatível (`.nvmrc`).

Desenvolvimento local:

```bash
npm ci
npm run dev
```

`npm run dev` inicia o modo operacional, apto a enviar marcações reais após confirmação. Para iniciar a aplicação no Git Bash em modo de teste sem envio:

```bash
./scripts/dev-test.sh
```

O launcher de teste verifica a versão Node indicada em `.nvmrc` e define `ALLOW_OFFICIAL_RHID_PUNCH=false`. Essa variável é a desativação deliberada do envio; no fluxo normal ela não precisa ser configurada.

O comando inicia o frontend em `http://127.0.0.1:5173/gamb_rhid/` e a API local em `http://127.0.0.1:8787/api`. No login, a senha é encaminhada apenas ao backend para autenticação no RHiD real; a aplicação pode lembrar e-mail/domínio, mas não persiste a senha. A sessão autenticada fica em cookie `HttpOnly` criptografado e é encerrada pelo botão `Sair`. Não é necessário abrir nem encerrar sessão no portal antes de entrar na aplicação.

Produção ou prévia local do build:

```bash
npm ci
npm run build
npm start
```

`npm start` sobe o backend Node, serve o `dist/` gerado pelo Vite e mantém a API em `/api` na mesma origem. Com a configuração padrão, a aplicação fica em `http://127.0.0.1:8787/gamb_rhid/`. Para publicar em um servidor, use `HOST=0.0.0.0`, mantenha o serviço atrás de HTTPS e configure armazenamento persistente para `DATA_DIR`.

Esse launcher força `ALLOW_OFFICIAL_RHID_PUNCH=true` para manter o fluxo operacional ativo por padrão. Para testes sem envio, use `./scripts/dev-test.sh` ou inicie o backend diretamente com a variável desligada.

### Atalho de versão e deploy

Para publicar as alterações atuais no frontend da Hostinger:

```powershell
npm run deploy:force
```

O comando incrementa a versão patch, executa lint, dois ciclos de testes e o build, cria o commit de versão, envia `main`, salva um backup do frontend atualmente servido e publica somente `dist` em `public_html/gambrhid`. Ao final, confere o hash do `index.html`, a versão servida, a saúde da API e o bloqueio dos caminhos sensíveis. Ele não altera o backend, o SQLite, dados persistentes ou segredos.

### Registro via terminal

O comando abaixo autentica no RHiD e depois envia uma marcação pelo backend local:

```bash
npm run rhid:punch -- --email seu.email@empresa.com --domain suaempresa --profile work
```

Na primeira execução, o comando pede a senha e pode gravar e-mail/domínio e a sessão reutilizável em `.data`. Se preferir informar a posição manualmente, use `--latitude`, `--longitude` e, opcionalmente, `--accuracy`. O parâmetro `--profile work` ou `--profile home` reaproveita o ponto salvo em **Ajustes**.

### Acesso externo pessoal

Para acessar fora da rede local sem abrir portas no roteador, instale o Cloudflare Tunnel e inicie o launcher protegido:

```powershell
winget install --id Cloudflare.cloudflared --exact
npm run external
```

O launcher mantém o backend em `127.0.0.1`, gera uma URL HTTPS temporária e exige uma autenticação adicional antes da tela do RHiD. A URL, o usuário e a senha são exibidos no terminal; as credenciais ficam em `.data/external-access.json` e não entram no Git. O acesso existe somente enquanto o comando estiver em execução.

Nesse modo, a sessão RHiD dura no máximo 12 horas, cookies são obrigatoriamente `Secure`, tentativas de acesso e login são limitadas, e `.data` recebe ACL restrita ao usuário atual, `SYSTEM` e administradores no Windows. Não encaminhe a porta `8787` no roteador e não altere `HOST` para `0.0.0.0` nesse fluxo.

Variáveis úteis para produção:

```text
HOST=0.0.0.0
PORT=<porta-fornecida-pela-plataforma>
API_PORT=8787
DATA_DIR=/caminho/persistente/gamb-rhid
SESSION_SECRET=<chave-base64url-de-32-bytes>
PUBLIC_BASE=/gamb_rhid/
VITE_API_BASE=https://api.exemplo.com
TRUSTED_ORIGINS=https://jornada.exemplo.com
EXTERNAL_ACCESS_USERNAME=<usuario-adicional>
EXTERNAL_ACCESS_PASSWORD=<senha-adicional-com-16-ou-mais-caracteres>
```

`SESSION_SECRET` mantém as sessões válidas entre reinícios. Se não for informada, o backend cria uma chave privada no diretório de dados. Localmente esse diretório é `.data`; em hospedagem Linux gerenciada com `NODE_ENV=production` e `PORT` fornecida pela plataforma, o padrão persistente fica em `~/.local/share/gamb-rhid`. `PUBLIC_BASE` deve bater com o caminho público usado no build; também é possível usar `VITE_PUBLIC_BASE` com o mesmo valor. Quando frontend e backend ficam em origens diferentes, `VITE_API_BASE` define a origem HTTPS do backend; vazio mantém `/api` na mesma origem e preserva o comportamento local. Requisições mutáveis da API exigem uma origem confiável; `TRUSTED_ORIGINS` aceita origens HTTPS adicionais, separadas por vírgula, e também limita o CORS com credenciais a essas origens. O backend de produção `gambrhid-api.gamberine.com.br` confia por padrão somente no frontend `https://gamberine.com.br`; outras origens continuam dependendo de configuração explícita. Em plataformas gerenciadas, `PORT` tem precedência sobre `API_PORT`, ativa o proxy confiável e usa `0.0.0.0` quando `HOST` não foi definido. Para testes sem envio em execuções diretas do backend, defina `ALLOW_OFFICIAL_RHID_PUNCH=false`.

Na hospedagem Node da Hostinger, configure o projeto como Express/Node 22 e use `server.cjs` como arquivo de entrada. Esse adaptador CommonJS é compatível com o carregador do LiteSpeed, inicializa o backend ESM e mantém os dados fora da pasta pública em `~/domains/gambrhid-api.gamberine.com.br/nodejs-data`.

Ao sincronizar, as batidas oficiais e indicadores de pendência reconhecidos são persistidos pelo backend em SQLite (`better-sqlite3`) no arquivo local `.data/rhid.sqlite`, associado à conta autenticada, e também mantidos em cache no navegador para resposta imediata. O banco também guarda o último envio aceito para preservar a proteção contra duplicidade após reiniciar a aplicação. Uma nova carga substitui os registros do período consultado, permitindo refletir correções do RHiD sem duplicação; o retorno bruto da API e a senha não são persistidos. O RHiD continua sendo a fonte oficial dos registros.

Verificações:

```bash
npm run lint
npm test
npm run build
npm audit --audit-level=moderate
```

## Teste seguro de notificações

No launcher `scripts/dev-test.sh`, o backend bloqueia `POST /api/rhid/punch` e a interface mostra **Modo de teste ativo**. Para sessões do funcionário, a tela exibe somente marcações reais reconhecidas no retorno do RHiD; não mistura simulações locais com a jornada oficial.

Roteiro para testar sem bater ponto no Git Bash:

1. Inicie o servidor pelo launcher protegido e abra a URL local:

```bash
./scripts/dev-test.sh
```

2. Entre somente na aplicação com suas credenciais RHiD e permita notificações.
3. Confirme na tela os avisos **Modo de teste ativo** e **Envio oficial bloqueado**.
4. Clique em **Enviar notificação de teste** para validar a permissão e a exibição sem criar qualquer batida.

No modo operacional, a primeira batida e as seguintes são realizadas pela própria aplicação. Após uma resposta de envio aceita, a tela consulta `ponto_diario` até localizar a marcação e apresentar o horário confirmado pelo RHiD.

```bash
npm run dev
```

Uma nova marcação é bloqueada por no mínimo 25 minutos após a última batida. Entre 25 e 51 minutos, a aplicação exige uma nova consulta diária para liberar o botão; a sincronização automática atende essa validação ou ela pode ser acionada na própria tela. O backend também rejeita envios dentro do intervalo mínimo.

Para a `Entrada 2`, a aplicação atualiza o `ponto_diario` aos 58 minutos após a `Saída 1`, bloqueia a ação manual e tenta o retorno automático aos 59 minutos. O backend compara a posição real com as localizações da `Entrada 1` e da `Saída 1`. Se essas referências não estiverem disponíveis, usa o local configurado em **Ajustes**: trabalho nos dias presenciais selecionados no calendário e residência nos demais dias. Sem uma referência válida, a automação não envia a marcação.

Quando as quatro marcações do dia confirmam no mínimo 8 horas trabalhadas, a jornada é apresentada como concluída, com total trabalhado e saldo do dia. Nesse estado, qualquer registro adicional fica bloqueado por 4 horas no frontend e no backend.

## MVP

- React + TypeScript + Vite PWA.
- Tailwind CSS orientado pelas variáveis remotas de `gamb_variables_geral.css`.
- PrimeReact para componentes e Flaticon UIcons para iconografia.
- PWA instalável com ícones gerados por `npm run generate:pwa-assets`.
- Jornada padrão configurável de 8 horas trabalhadas e intervalo de 1 hora, exibindo permanência prevista de 9 horas.
- Relógio da jornada e intervalo ativo com exibição de segundos; status visual utiliza as cores semânticas do design system.
- Barra animada da meta trabalhada com percentual, tempo restante e marcadores visuais de avanço.
- Alerta de retorno 2 minutos antes do fim do intervalo.
- Alertas 5 minutos antes e no momento de completar a carga diária, com menu no cabeçalho para pausar ou testar notificações.
- Histórico desde `01/05/2026` persistido em SQLite no backend e saldo acumulado calculado a partir das marcações oficiais reconhecidas no relatório para sessões de funcionário.
- Login RHiD, logout, consulta autenticada das marcações do dia e carga histórica desde `01/05/2026` para contas de funcionário.
- Marcação web oficial no fluxo normal, com confirmação, localização obrigatória, verificação pós-envio e intervalo mínimo protegido também no backend.
- Contingência para máquinas sem geolocalização: o endereço de trabalho ou residência informado em **Ajustes** é convertido em coordenadas, persistido por conta e usado na tentativa retomada após uma consulta preventiva ao RHiD.
- Um envio só ativa o bloqueio temporal depois que o horário aparece na consulta diária. Enquanto a confirmação estiver pendente, o sistema consulta sem reenviar e avisa a cada 5 minutos; jornadas abertas há pelo menos 30 minutos além da meta também recebem lembretes a cada 5 minutos.
- Retorno automático do almoço com pré-sincronização aos 58 minutos, envio aos 59 minutos, raio máximo de 100 metros e perfil alternativo de residência, trabalho e calendário presencial.
- Sincronização ao entrar, ao retornar à janela, a cada 5 minutos com o app aberto e pelo ícone de atualização, com registro das verificações no painel RHiD.
- Indicador discreto no painel RHiD mostra o tempo restante até a próxima sincronização automática, sem ser reiniciado por uma consulta manual.
- Atalhos de `Ontem`, `Semana` e `Este mês` para o banco de horas, com pesquisa e ordenação da tabela.
- Importação do indicador `possuiPendencias` no histórico; ao clicar no alerta do dia, a aplicação consulta e exibe os detalhes de aprovação retornados pelo RHiD.
- Destaque semântico para dias com mais de quatro marcações: os horários excedentes são listados com aviso visual baseado nos tokens `--gamb-warning` do CDN.

O portal web público carrega um bundle que autentica em `/v2/login.svc/`, envia o token nos cabeçalhos `Authorization` e `X-Cid-RHiD`, consulta `https://repp.rhid.com.br/ponto_diario`, carrega a apuração com `POST /v2/report.svc/apuracao_ponto_salva_tabela`, consulta detalhes de pendências com `POST /v2/report.svc/list_alteracoes_ponto` e registra a marcação web em `https://repp.rhid.com.br/marcacao_web`. A consulta de pendências implementada é somente leitura. Para marcação sem foto configurada no portal, o payload inclui a geolocalização obtida pelo navegador. A aplicação segue esse fluxo diretamente após autenticação na própria tela; `ALLOW_OFFICIAL_RHID_PUNCH=false` existe apenas para execução de teste sem envio.

O Swagger público de `/v2/api.svc` documenta consultas administrativas/apuração, mas não documenta endpoint de criação de batida nem renovação de token. A marcação e a carga histórica foram implementadas a partir do comportamento publicado pelo próprio portal web. A carga consulta `01/05/2026` até a data atual e importa apenas horários `dateTimeStr`; a resposta deve ser conferida em sessão autorizada pela tela **Banco de horas**.

## Automação

O workflow `CI` valida auditoria, lint, testes e build em cada pull request e push para `main`. O workflow `Deploy Pages` só publica uma revisão da `main` depois que o `CI` correspondente for aprovado e a variável de repositório `ENABLE_PAGES_DEPLOY` estiver definida como `true`.

GitHub Pages recusou ativação neste repositório privado no plano atual. Além disso, Pages publica somente o frontend estático e não hospedaria a API Node necessária para proteger o token RHiD. Para uso fora do computador local, a versão funcional deve hospedar o backend junto ao frontend, ou usar uma hospedagem que forneça backend HTTPS, como Vercel, Cloudflare Workers ou um servidor próprio; publicar não altera as permissões concedidas pelo RHiD.

A proteção obrigatória da branch `main` também foi recusada pelo GitHub no plano atual; até mudança de plano ou visibilidade, deve-se trabalhar por pull request e observar o resultado do `CI` antes de mesclar.

Veja [prd.md](prd.md) para o contexto consolidado do produto e [docs/arquitetura.md](docs/arquitetura.md) para integração RHiD, notificações móveis e automação com agentes.
