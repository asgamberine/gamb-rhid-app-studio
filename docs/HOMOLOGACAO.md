# Registro de homologacao

## Base aprovada

- Versao: `0.1.2`
- Commit: `a5627d3575c063e216b5df77846293974c0f549f`
- Tag local: `v0.1.2`
- Validacao em 22/08/2026: lint, typecheck, 106 testes e build aprovados.

## Linha de desenvolvimento

- Branch: `codex/homolog-uiux-v0.2.0`
- Versao inicial: `0.2.0-homolog.1`
- Producao nao faz parte desta linha sem autorizacao explicita.

Antes de aceitar uma alteracao, execute `npm run verify:homolog`. O comando interrompe se a branch ou a versao nao forem de homologacao e, quando o contexto esta correto, executa lint, typecheck, testes e build.

## Funcionalidades protegidas

- Autenticacao, expiracao e recuperacao de sessao.
- Registro de ponto manual e automatico, geolocalizacao e bloqueios de seguranca.
- Monitoramento e retorno automatico do intervalo.
- Sincronizacao com o RHiD, historico oficial e marcacoes excluidas.
- Calculo e exibicao de jornada, intervalo, horas trabalhadas e saldos.
- Filtros e atalhos de historico, solicitacoes e atualizacao de dados.
- Persistencia SQLite, segredos, PWA, cache e funcionamento responsivo.

As validacoes automatizadas reduzem o risco, mas nao substituem comparacao visual nem testes autenticados dos fluxos afetados. Cada incremento deve registrar o que foi verificado e o que ainda depende de homologacao manual.

## Matriz da refatoracao da Home

| Funcao aprovada | Evidencia na base 0.1.2 | Mudanca de homologacao | Verificacao obrigatoria |
| --- | --- | --- | --- |
| Navegacao, alertas, perfil e logout | Header da aplicacao | Header compacto e responsivo | Teclado, mobile, desktop e todas as acoes |
| Jornada, progresso e previsao | Card principal da Home | Hierarquia visual mais limpa | Estados sem jornada, trabalhando, intervalo e concluido |
| Metricas e saldos oficiais | Resumo calculado da jornada | Quatro metricas permanentes e dados auxiliares compactos | Valores antes/depois e numeros tabulares |
| Marcacoes do dia | Lista de registros | Timeline responsiva com badges preservados | Vazio, quatro registros, excedentes, local, RHiD e automatico |
| Registro oficial e bloqueios | Botao ou painel de seguranca | Acao primaria movida para zona do polegar no mobile | Liberado, teste, validacao, cooldown e jornada concluida |
| Retorno automatico | Switch persistente | Botao circular com estado acessivel | Ativo, inativo, bloqueado por Ajustes e oculto por jornada |
| Sincronizacao e sessao | Painel de integracao | Painel compacto; Atualizar continua sincronizando dados | Conectado, atualizando, aviso, erro e expiracao de sessao |
| Historico e solicitacoes | Cards laterais | Superficies compactas preservadas | Semana, mes, ontem e nova solicitacao |

O texto anexado e uma referencia visual. Ele nao autoriza contornar bloqueios, substituir a sincronizacao segura por `window.location.reload()` nem publicar em producao.

## Incremento `0.2.0-homolog.2`

- Refatoracao visual responsiva da Home, sem alteracao das regras de negocio.
- Quatro metricas permanentes, com informacoes anteriores preservadas em faixa auxiliar.
- Timeline ampliada para exibir a jornada padrao completa e manter excedentes rolaveis.
- Controle Retorno circular, com `role="switch"`, estado acessivel e mesma persistencia existente.
- Acao oficial fixa na zona do polegar abaixo de 1250 px, somente quando o registro esta liberado.
- Previa local isolada com dados ficticios para os estados vazio e concluido; nao integra o build produtivo.
- Validacao: desktop 1440 x 1000, mobile 390 x 844, console sem erros, lint, typecheck, 108 testes e build.
