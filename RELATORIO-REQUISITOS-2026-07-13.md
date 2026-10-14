# Relatório de requisitos e segurança — 13/07/2026

## Escopo e método

Foram confrontados os requisitos de `.anotacoes-projeto.md` com o código atual, o diff pendente, a suíte automatizada, as portas locais ativas, respostas HTTP e o banco `.data/rhid.sqlite`.

Validações executadas:

- duas execuções consecutivas da suíte: 73/73 testes aprovados em ambas;
- typecheck e build de produção aprovados;
- lint aprovado sem avisos;
- `npm audit --omit=dev --audit-level=moderate` sem vulnerabilidades reportadas;
- integridade SQLite: `ok`;
- rotas `/gamb_rhid/`, `/gamb_rhid/login` e `/gamb_rhid/registros`: HTTP 200;
- API sem cookie de sessão: HTTP 401, conforme esperado;
- cabeçalhos da API: CSP, `frame-ancestors 'none'`, COOP/CORP, `nosniff`, `DENY`, política de permissões e `Cache-Control: no-store` presentes.

Não foi possível controlar uma aba autenticada nem consultar diretamente o RHiD oficial. Logo, igualdade absoluta com o RHiD não está comprovada nesta execução.

## Resultado item a item

### Etapa 0 — branch e mapeamento

**Status: não aplicado intencionalmente.** A branch `Gemin-VERSAO` não foi criada porque existem processos ativos nas portas 5173 e 8787 e alterações locais ainda não commitadas. Trocar a branch compartilhada poderia afetar a execução atual e contrariar a instrução de evitar conflitos.

Arquivos centrais mapeados: `package.json`, `src/App.tsx`, `src/index.css`, `src/domain/journey.ts`, `src/domain/workday.ts`, `src/services/notifications.ts`, `src/services/rhidParser.ts`, `src/services/rhidApi.ts`, `src/components/HistoryView.tsx`, `src/components/SettingsView.tsx`, `server/index.mjs`, `server/punchPolicy.mjs` e testes associados.

### 1.1 — pipeline seguro

**Status: parcial.** Foi criado `npm run verify:release`, que executa testes duas vezes e depois o build. Commit, push e deploy automáticos não foram adicionados: são mutações externas e não devem ocorrer implicitamente a partir de um script de verificação local.

### 2.1 — marcação de 09/07 às 17:00

**Status: crítico / ainda não garantido no processo ativo.** O parser do worktree foi restringido às coleções oficiais `afdt`, `listAfdt` e listas oficiais de excluídos. Existe teste que impede `afdtPrevisto` de ser importado como marcação autenticada.

Entretanto, o servidor ativo foi iniciado antes dessa correção e recolocou no SQLite `09/07/2026 17:00`. O cache atual apresenta quatro registros nesse dia: 09:18, 12:59, 13:58 e 17:00. É obrigatório reiniciar controladamente o backend com o código corrigido e realizar nova sincronização autenticada antes de considerar o problema encerrado.

Não existe fila persistente de retentativa específica para falha de reconciliação histórica. Os retries atuais cobrem sincronização e marcação automática durante a sessão da aplicação.

### 2.2 — monitoramento do almoço

**Status: parcial.** Após exatamente duas marcações, a aplicação ativa relógio de cinco segundos, atualização por foco/visibilidade, sincronização de um minuto, pré-validação no RHiD, retry e trava manual. Não depende mais de atualização manual enquanto a aplicação está viva.

Não existe Web Worker nem serviço persistente independente. Aba congelada, navegador encerrado, logout, queda do backend ou suspensão do computador impedem garantia absoluta de execução em até uma hora.

### 2.3 — revalidação pós-registro

**Status: implementado.** Após envio oficial, o frontend tenta confirmar a marcação no RHiD até dez vezes, em intervalos de 1,5 segundo, atualiza snapshot/arquivo oficial e faz sincronização histórica posterior.

### 2.4 — marcações excedentes

**Status: parcial.** Mais de quatro marcações gera inconsistência visual, alerta persistente e permite revalidação após três dias. A reconsulta é disparada pelo frontend quando autenticado.

Não existe scheduler persistente no backend. Se a aplicação não abrir após três dias, a verificação não ocorre automaticamente.

### 3.1 — bordas por status

**Status: implementado no worktree.** Todos os painéis recebem a mesma variável de cor do status (`connected`, `syncing`, `warning`, `error`) e opacidades diferentes conforme a posição do bloco.

Validação visual autenticada não foi possível porque nenhuma aba controlável estava disponível.

### 3.2 — bloco e modal “Ontem”

**Status: não atendido integralmente.** Existe botão “Ontem”, mas ele abre o histórico filtrado. Não existe na Home um espelho do último dia útil com registros nem o modal compacto solicitado.

### 4.1 — ícone e badge

**Status: implementado.** O botão muda para `danger` quando há alertas ativos e exibe badge quando a contagem é maior que um.

### 4.2 — central flutuante e persistência

**Status: parcial.** Existe central com lista, detalhe e dismiss manual persistente. A implementação usa `Dialog`, não popover/box ancorado. A lista mostra título e corpo, enquanto o requisito pede somente o nome curto por linha. Toasts temporários não são sticky; inconsistências permanecem na central até dismiss.

### 4.3 — solicitação e Outlook

**Status: implementado.** Alertas de falta de marcação abrem “Nova Solicitação” com data, tipo, horário estimado e notas. Após envio, é criado alerta “Enviar e-mail supervisor”; o link do Outlook inclui “adicionar o que falta”.

### 5.1 — jornada, calendário, comarca e afastamentos

**Status: majoritariamente não atendido.** Existe auditoria para quantidade diferente de quatro em dias úteis, além de filtros de fins de semana e feriados nacionais/móveis.

Faltam:

- alerta específico para dia consolidado abaixo de seis horas;
- regra completa de saldo negativo histórico;
- calendário TJMG da Comarca de Belo Horizonte;
- detecção de comarca pela localização;
- cidade/comarca derivada do endereço de trabalho;
- cadastro persistente de férias, atestado e afastamento com supressão dos alertas.

O perfil já suporta endereços de casa/trabalho e datas presenciais, servindo como base parcial para a modelagem geográfica.

## Auditoria de segurança e integridade

### Controles encontrados

- cookie de sessão `HttpOnly`, `SameSite=Strict` e `Secure` quando aplicável;
- sessão criptografada e chave fora do frontend;
- validação de origem confiável e rate limit de login/acesso externo;
- marcação oficial bloqueada quando a feature não está habilitada;
- validação de quantidade/estado de marcações antes do envio;
- validação de geolocalização e referência autorizada para automação;
- API com cabeçalhos defensivos e respostas sem cache;
- arquivo oficial SQLite contém somente registros com `origin: rhid` e não possui timestamps duplicados.

### Riscos e vulnerabilidades funcionais

1. **Crítico — equivalência oficial não demonstrável:** cache local não é prova da fonte oficial. Sem consulta autenticada ao RHiD e comparação por dia/timestamp/ID, não existe garantia de igualdade.
2. **Crítico — processo ativo desatualizado:** o backend atual continua usando o parser anterior e reintroduziu a marcação contestada de 09/07 às 17:00.
3. **Alto — automação dependente do runtime:** não há executor persistente fora da aplicação/navegador.
4. **Médio — polling de três dias dependente de abertura da aplicação:** inconsistências podem permanecer sem revalidação.
5. **Médio — frontend Vite de desenvolvimento sem cabeçalhos de segurança:** os cabeçalhos estão presentes na API/servidor de produção, mas não na resposta direta da porta 5173.
6. **Médio — cobertura incompleta de exceções trabalhistas:** férias/afastamentos ausentes podem gerar alertas falsos e saldo incorreto.

## Condições obrigatórias para declarar “sem diferença do RHiD”

1. Fazer reinício controlado do backend para carregar o parser corrigido.
2. Autenticar novamente e sincronizar o período de 09/07 diretamente do RHiD.
3. Comparar, para cada dia, conjunto exato de timestamps e identificadores ativos e excluídos.
4. Substituir o período no arquivo local, nunca apenas mesclar, removendo registros que desapareceram da fonte.
5. Registrar hash/data da última reconciliação e bloquear a exibição como “oficial” quando a reconciliação estiver vencida ou tiver falhado.
6. Manter teste de regressão impedindo coleções previstas/auxiliares de virar marcações oficiais.

Até essas condições serem executadas com uma sessão oficial, o sistema deve apresentar os dados como “última sincronização local”, e não como equivalência garantida em tempo real.
