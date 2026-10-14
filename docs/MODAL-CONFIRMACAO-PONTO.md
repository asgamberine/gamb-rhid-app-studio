# Modal Customizado de Confirmação de Marcação no RHiD

**Data:** 04/09/2026  
**Status:** Implementado  
**Objetivo:** Substituir a caixa de diálogo nativa do navegador (`window.confirm`) por um modal customizado, in-app, perfeitamente centralizado no viewport com backdrop blur e botões padronizados, garantindo integridade das regras de segurança e zero risco de marcações não autorizadas no RHiD.

---

## 1. Contexto e Motivação
Anteriormente, no fluxo de registro manual oficial de ponto (`registerOfficialPunch` em `src/App.tsx`), a confirmação para marcações posteriores à primeira diária utilizava a função síncrona `window.confirm(...)` do navegador. Isso gerava um popup no topo do navegador que não seguia o design system (`gamb-design-system-local.css`), além de não oferecer controles estilizados de acessibilidade e layout.

---

## 2. Alterações Implementadas

### R1. Modal Customizado Centralizado com Backdrop Blur
- Criado o componente `ConfirmPunchDialog` (`src/components/ConfirmPunchDialog.tsx`) baseado em `primereact/dialog` e `primereact/button`, integrado com as classes do projeto.
- O modal é perfeitamente centralizado vertical e horizontalmente no viewport através de flexbox (`display: flex; align-items: center; justify-content: center`).
- O overlay de fundo (`.punch-confirm-dialog-mask`) possui opacidade leve (~0.3: `rgba(15, 23, 42, 0.3)`) combinada com desfoque de fundo (`backdrop-filter: blur(8px)` e `-webkit-backdrop-filter: blur(8px)`).
- Não há bloqueio invasivo da interface e o fechamento por clique no backdrop ou tecla `Escape` aborta com segurança a marcação.

### R2. Padronização e Disposição dos Botões de Ação
- Botão "Cancelar":
  - Posicionado à esquerda.
  - Estilo arredondado (`round`/pill: `borderRadius: 9999px`, classe `p-button-rounded`).
  - Severidade secundária/neutra (`severity="secondary"`, `outlined`), com cores neutras do design system.
- Botão "OK":
  - Posicionado à direita.
  - Severidade primária (`severity="primary"`), com a cor de destaque oficial do design system (`var(--gamb-primary, #ed3224)`).
- Ambos os botões possuem largura visual uniforme e balanceada (`flex: 1 1 0%`, `width: 50%`).

### R3. Segurança Operacional e Zero Regressão
- Fluxo assíncrono mantido via Promise (`requestPunchConfirmation`):
  - Clicar em "Cancelar" ou fechar o modal: resolve como `false`, abortando a execução imediatamente. Não há requisição de geolocalização e nenhuma chamada à API de ponto é disparada.
  - Clicar em "OK": resolve como `true`, prosseguindo para a obtenção de localização e envio oficial do ponto.
- A marcação automática de ponto (fluxo de retorno de almoço) continua intacta e não é interceptada (`manualOfficialPunchRequiresConfirmation({ automatic: true }) === false`).
- A primeira marcação do dia segue direta sem confirmação (`manualOfficialPunchRequiresConfirmation({ dailyPunchCount: 0 }) === false`).
- Nenhuma requisição real de marcação de ponto é executada em suítes de teste.

---

## 3. Arquivos Modificados / Criados

1. **`src/components/ConfirmPunchDialog.tsx`** (Novo)
   - Componente do modal de confirmação acessível e responsivo com PrimeReact Dialog, Button e classes customizadas.
2. **`src/components/ConfirmPunchDialog.test.tsx`** (Novo)
   - Testes unitários cobrindo visibilidade, backdrop blur, opacidade ~0.3, ordem e estilos dos botões (pill e primário) e resolução de ações.
3. **`src/index.css`** (Modificado)
   - Regras CSS para `.punch-confirm-dialog-mask`, `.punch-confirm-dialog`, `.punch-confirm-actions`, `.punch-confirm-btn`, `.punch-confirm-btn-cancel` e `.punch-confirm-btn-confirm`.
   - Utilização do token de design system `var(--gamb-radius-pill, 9999px)` para o botão Cancelar.
4. **`src/App.tsx`** (Modificado)
   - Integração do `ConfirmPunchDialog`, substituição de `window.confirm` por `await requestPunchConfirmation(...)`, e gerenciamento de ciclo de vida seguro com `useRef` e `useCallback`.
   - Preservação da mensagem durante a animação de saída/fechamento (`setPunchConfirmState((current) => current ? { ...current, visible: false } : null)`).
5. **`docs/MODAL-CONFIRMACAO-PONTO.md`** (Novo)
   - Documentação para rastreabilidade no repositório.

---

## 4. Revisão Adversarial e Correções Aplicadas (Round 1)
1. **Acessibilidade de Teclado (Tecla Escape):**
   - No PrimeReact `Dialog`, configurar `closable={false}` desativa internamente o listener de `closeOnEscape`.
   - Correção: configurado `closable` (true) em conjunto com `showCloseIcon={false}`, garantindo que nenhum botão "X" apareça no cabeçalho enquanto a tecla `Escape` encerra e aborta a confirmação com total segurança (WCAG 2.1).
2. **Estabilidade Visual durante Transição de Saída:**
   - Evitado salto de conteúdo / esvaziamento abrupto do texto durante os ~150-200ms da animação de saída com cache em `useRef` no componente e preservação no estado do `App.tsx`.
3. **Harmonia com Tokens de Design System:**
   - Padronizado o `border-radius` do botão Cancelar para `var(--gamb-radius-pill, 9999px)`.
4. **Resiliência e Cobertura de Testes Automatizados:**
   - Inclusão de testes unitários para a tecla `Escape`, clique no backdrop mask e preservação de mensagem durante a transição.
   - Assertividade compatível com jsdom via atributo `data-backdrop-filter="blur(8px)"` e classes CSS com `!important`.

---

## 5. Revisão Adversarial e Refinamentos (Round 2)
1. **Correção do Token CSS de Tipografia Secundária (`.punch-confirm-message`):**
   - Em `src/index.css`, a classe `.punch-confirm-message` utilizava `color: var(--gamb-text, #575f6d) !important;`. Como `--gamb-text` está sempre definido no `:root` como `#191b1c` (cor de alto contraste do título), o fallback `#575f6d` nunca era atingido, tornando o corpo da mensagem idêntico ao título em peso visual.
   - Correção: alterado para `color: var(--gamb-text-muted, #575f6d) !important;`, harmonizando com o token semântico do design system para textos de corpo e apoio.
2. **Simetria dos Tokens de `border-radius` nos Botões de Ação:**
   - O botão "Cancelar" possuía `borderRadius: 'var(--gamb-radius-pill, 9999px)'` no inline style, enquanto o botão "OK" dependia apenas da classe CSS externa `.punch-confirm-btn-confirm.p-button`.
   - Correção: adicionado explicitamente `borderRadius: 'var(--gamb-radius-default, 0.75rem)'` no inline style do botão "OK", garantindo paridade e blindagem contra reset de estilos em ambos os botões.
3. **Preservação de Título durante Transição de Fechamento:**
   - Adicionado `lastTitleRef` em `ConfirmPunchDialog.tsx` para garantir estabilidade do título caso a prop `title` sofra re-render ou limpeza durante o ciclo de transição de saída.
4. **Expansão da Suíte de Testes Acessíveis (WAI-ARIA):**
   - Validação de `aria-modal="true"`, `aria-labelledby` e `aria-describedby` no elemento `dialog`.
   - Validação do token de raio do botão OK e teste de persistência para título e mensagem simultaneamente em re-renders vazios.

---

## 6. Revisão Adversarial e Refinamentos de Produção (Round 3)
1. **Desacoplamento de Altura Fixa no Cabeçalho (`.punch-confirm-dialog .p-dialog-header`):**
   - A regra global `.p-dialog-header` em `src/index.css` define `height: var(--gamb-height-xxl, 56px);`. Em viewports móveis estreitos (<480px, ex: 320px/360px) ou sob ampliação de fonte de acessibilidade, o título de 26 caracteres "Confirmar marcação no RHiD" quebra em 2 linhas, causando truncamento e sobreposição com o corpo.
   - Correção: adicionado `height: auto !important; min-height: var(--gamb-height-xxl, 56px) !important;` na classe específica do modal, garantindo acomodação elástica perfeita.
2. **Blindagem de Layout Responsivo em Telas Pequenas (<480px) e WCAG Touch Target:**
   - Adicionado media query `@media (max-width: 480px)` ajustando padding horizontal interno (de 1.5rem para 1.125rem) para evitar compressão excessiva em smartphones estreitos.
   - Garantida altura mínima de 44px (2.75rem) nos botões de ação em telas móveis, em total conformidade com WCAG 2.5.8 (Target Size).
   - Adicionado `white-space: nowrap !important;` nos botões e `overflow-wrap: break-word !important;` no texto da mensagem, prevenindo quebras indesejadas de rótulos.
3. **Acessibilidade e Indicador de Foco por Teclado (`:focus-visible`):**
   - Definido anel de foco explícito `.punch-confirm-btn:focus-visible` com `outline: 2px solid var(--gamb-info, #5ca8ff) !important; outline-offset: 2px !important; box-shadow: 0 0 0 3px rgba(92, 168, 255, 0.25) !important;`, assegurando visibilidade cristalina para usuários que navegam via Tab.
4. **Progressive Enhancement: Fallback de Fundo sem Suporte a `backdrop-filter`:**
   - Adicionada regra `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` elevando a opacidade de fundo para `rgba(15, 23, 42, 0.5)` em ambientes ou navegadores sem aceleração gráfica, preservando o contraste e a legibilidade.
5. **Ciclo de Vida Robusto em Redefinição de Sessão / Logout (`App.tsx`):**
   - Em `resetSessionState`, foi adicionado o cancelamento atômico de `punchConfirmResolverRef.current(false)` e `setPunchConfirmState(null)`. Se a sessão for expirada ou o usuário sair enquanto o modal aguarda resposta, a Promise é cancelada com segurança sem deixar promises pendentes nem diálogos órfãos.
6. **Expansão de Cobertura de Testes Automatizados:**
   - Adicionados testes para acionamento por teclado (Enter nos botões focados) e garantia de que todos os botões possuem `type="button"`, prevenindo submissões espúrias.
