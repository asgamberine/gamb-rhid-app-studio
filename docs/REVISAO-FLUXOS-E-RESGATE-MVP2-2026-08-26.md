# Revisão de fluxos e resgate do MVP-2 — 26/08/2026

## Objetivo desta revisão

Separar quatro frentes que não devem ser implementadas como uma única mudança:

1. corrigir e fechar o fluxo de Nova Solicitação no sistema atual;
2. comprovar o isolamento ao trocar de usuário;
3. entregar alertas reais no celular, inclusive com o aplicativo fechado;
4. retomar o MVP-2 como projeto paralelo e independente do RHiD legado.

Estado auditado: branch `codex/homolog-uiux-v0.2.0`, commit-base `38a682c`, versão `0.2.0-homolog.4`. A árvore estava limpa no início da revisão.

## 1. Nova Solicitação

### Fluxo existente

1. `HistoryView.submitRequest()` valida tipo, período e, para inclusão de marcação, uma data e um horário.
2. O frontend chama `POST /api/rhid/requests`.
3. O backend recupera a sessão RHiD e resolve o funcionário.
4. Inclusão de marcação é enviada para `report.svc/apuracao_ponto_salva_tabela`; os demais tipos usam `customerdb/justification.svc/a`.
5. Depois do POST, o backend consulta `report.svc/list_alteracoes_ponto` até oito vezes, com intervalo de um segundo.
6. Somente uma correspondência encontrada nessa listagem é persistida em `rhid_requests` como `source=rhid` e `status=pending`.
7. O frontend mostra sucesso e, somente quando o usuário fecha o resultado, cria um alerta local de acompanhamento.
8. O Outlook é aberto apenas depois de outro clique nesse alerta.

### Evidências encontradas

- A base local possui uma única solicitação antiga, `source=local` e `status=queued`; não há solicitação persistida como confirmada pelo RHiD.
- Não havia navegador com sessão autenticada disponível durante esta revisão. Portanto, ainda não foi possível executar `GET /api/rhid/requests/diagnostics` no contexto da conta afetada.
- Não foi executado POST real: faltam caso de teste autorizado, data, horário, justificativa e confirmação explícita para criar uma solicitação oficial.

### Lacunas confirmadas

1. **O e-mail não abre em seguida.** O fluxo exige fechar o sucesso, abrir a central de alertas e clicar em “Criar e-mail no Outlook”.
2. **Destinatários não são preenchidos.** `buildOutlookComposeUrl()` recebe apenas assunto e corpo; não existe configuração de `to`, `cc` ou catálogo de contatos.
3. **Uma aceitação não confirmada é apresentada como falha.** Se o POST remoto for aceito, mas a listagem não refletir a solicitação em aproximadamente sete segundos, a API devolve 502 e não persiste um estado intermediário. Repetir manualmente pode criar duplicidade no RHiD.
4. **Não existe identificador operacional visível.** A UI não mostra um ID de tentativa/correlação para distinguir falha antes do envio, aceitação pendente e falha de confirmação.
5. **A abertura automática do Outlook exige tratamento de bloqueio de pop-up.** Como a confirmação do RHiD é assíncrona, uma nova janela aberta somente depois do `await` pode ser bloqueada pelo navegador.
6. **A chave primária local de solicitações é apenas `request_id`.** O isolamento de consulta usa `account_key`, mas a identidade persistida deveria ser composta por conta + identificador remoto para eliminar risco de colisão entre contas.

### Fluxo-alvo acordado

```text
Enviar
  -> validar campos
  -> criar tentativa idempotente vinculada à conta
  -> enviar ao RHiD
  -> registrar "aceita, aguardando confirmação"
  -> reconciliar na listagem autenticada
  -> registrar "confirmada"
  -> preparar Outlook com destinatários, assunto e corpo
  -> abrir a composição e manter uma ação de reabertura na interface
```

Estados mínimos: `validating`, `sending`, `accepted_pending_confirmation`, `confirmed`, `rejected`, `confirmation_timeout` e `email_prepared`.

Para cumprir “abrir o serviço de e-mail em seguida” sem ser bloqueado pelo navegador, a implementação recomendada é abrir uma janela controlada no clique original em **Enviar**, mantê-la em espera e navegar essa mesma janela para o Outlook somente após a confirmação. Se houver erro, a janela deve mostrar/fechar com mensagem segura. O botão manual de reabertura deve permanecer como contingência.

### Bloqueadores antes da correção funcional

- lista exata de destinatários e cópias (`to`/`cc`), além da regra por empresa ou tipo de solicitação;
- uma sessão autenticada para executar o diagnóstico de leitura;
- um caso real autorizado, com tipo, data, horário e justificativa, caso seja necessário testar a mutação depois da correção.

## 2. Acesso com outro usuário

### Proteções existentes

- Cookie de sessão único, criptografado e substituído a cada login.
- Arquivos oficiais, localizações, submissões e solicitações são consultados pelo `account_key` formado por e-mail + domínio.
- Login e logout limpam snapshots, alertas manuais, recibos, tentativas automáticas e perfil carregado da sessão anterior.
- Seleção de empresa é repetida quando o RHiD devolve mais de um vínculo.

### Riscos e lacunas

- Não há teste integrado “usuário A sai → usuário B entra → nenhum dado de A aparece”.
- Algumas preferências do navegador são globais ao dispositivo, não por conta, como jornada configurada, alertas habilitados e opção padrão do retorno automático.
- O navegador guarda somente uma conta lembrada por vez.
- A chave primária de `rhid_requests` não inclui `account_key`.
- Perfis próprios de superadmin, administrador, RH e gestor não existem no produto atual; o acesso continua dependendo dos tipos e permissões devolvidos pelo RHiD.

### Matriz de aceite necessária

1. funcionário A e funcionário B na mesma empresa;
2. mesmo e-mail com empresas/domínios diferentes, quando permitido pelo RHiD;
3. funcionário versus conta administrativa;
4. logout, expiração e troca direta de conta;
5. isolamento de histórico, solicitações, localização, alertas e automação;
6. testes negativos no backend usando conta diferente para cada registro persistido.

## 3. Alertas no celular

### Estado atual

- A aplicação usa `Notification.requestPermission()` e `ServiceWorkerRegistration.showNotification()`.
- Os alertas são calculados dentro de `App.tsx`; portanto dependem do frontend em execução.
- O service worker atual apenas faz cache e não possui evento `push` ou `notificationclick`.
- Não existem `PushSubscription`, chaves VAPID, endpoint de inscrição, tabela de dispositivos, fila/agendador ou envio Web Push no backend.

Conclusão: o sistema atual pode exibir notificações locais enquanto o PWA/navegador está ativo, mas não atende a meta de entrega confiável com o aplicativo fechado.

### Arquitetura mínima para atingir a meta

1. O dispositivo instala/abre o PWA e concede permissão por gesto do usuário.
2. O frontend usa `serviceWorker.ready` e `pushManager.subscribe()`.
3. A assinatura é enviada ao backend e vinculada a conta, dispositivo, preferências e data de validade.
4. Um worker/backend calcula os eventos a partir de dados oficiais atualizados, sem depender de `App.tsx` aberto.
5. O backend envia Web Push com VAPID, registra tentativa/resultado e remove assinaturas expiradas.
6. O service worker trata `push` e `notificationclick`, mostra a notificação e abre a rota correta.
7. Uma marcação confirmada cancela os lembretes ainda pendentes.
8. A operação mede `requested`, `sent`, `failed`, `expired` e, quando tecnicamente disponível, interação do usuário.

Requisitos de produto preservados: dois lembretes para a última marcação, preferências por usuário/dispositivo, fuso `America/Sao_Paulo`, de duplicação e nenhuma notificação de outro usuário no mesmo aparelho.

No iPhone/iPad, o Web Push padrão é suportado para web apps adicionados à Tela de Início; a solicitação de permissão deve ocorrer por interação direta do usuário. Referências: [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) e [WebKit — Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

## 4. Resgate do MVP-2

O plano já existe e permanece a referência canônica:

- `DOCUMENTACAO-TECNICA-E-PLANO-MVP2.md`
- criado em 29/07/2026 no commit `4c14efb`;
- descreve produto próprio, sem RHiD como fonte de verdade;
- cobre multi-organização, superadmin, administração da organização, RH, gestor e funcionário;
- propõe frontend, API, worker, PostgreSQL, Redis/fila, storage, auditoria, Web Push e e-mail;
- contém modelo de dados, API/eventos, segurança, ambientes e etapas 0 a 10.

### Atualizações necessárias no documento canônico

- A confirmação de solicitações atual usa oito tentativas de um segundo, não quatro de 750 ms.
- O SQLite local agora possui 1.381 snapshots em `official_history_backups` e aproximadamente 111 MB; a fotografia de julho está desatualizada.
- A revisão atual confirmou que e-mail com contatos e Web Push ainda não estão completos no legado.
- O fluxo da primeira marcação diária mudou na homologação e deve ser tratado como regra candidata, não copiado automaticamente para o novo núcleo.

### Fronteira do projeto paralelo

- Criar repositório/monorepo próprio para o MVP-2.
- Não adicionar condicionais “modo MV2” ao `gamb_rhid` atual.
- Reutilizar identidade visual, componentes e regras somente quando houver contrato e testes.
- Manter adaptador de importação/RHiD na borda; o domínio novo não deve usar payloads ou nomes internos do RHiD.
- Começar pela Etapa 0: PRD, jornadas, catálogo de regras, RBAC, modelo entidade-relacionamento e ADRs.

### Próxima unidade recomendada do MVP-2

Produzir, em conjunto, três artefatos antes de escrever infraestrutura:

1. mapa de jornadas de superadmin, admin, RH, gestor e funcionário;
2. matriz RBAC por organização e unidade/equipe;
3. decisões de tenancy, uso legal, localização, modo offline e retenção LGPD.

## Ordem recomendada de execução

1. Diagnóstico autenticado de Nova Solicitação, sem mutação.
2. Definição dos contatos e correção do fluxo de confirmação + Outlook.
3. Teste integrado com duas contas.
4. Vertical mínima de Web Push em homologação, começando por um alerta manual de teste.
5. Etapa 0 do MVP-2 em repositório separado.

