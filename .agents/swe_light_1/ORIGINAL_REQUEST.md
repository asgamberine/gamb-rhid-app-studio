# Original User Request

## 2026-09-04T23:59:52Z

This is a single self-contained fix; keep it small and focused.

Substituir a caixa de diálogo nativa do navegador (`window.confirm`) por um modal customizado, centralizado no viewport (vertical e horizontalmente) com backdrop de baixa opacidade e desfoque, mantendo total integridade das regras de segurança e garantindo zero risco de marcações não autorizadas no RHiD.

Working directory: d:\ProjetosGit\gamb_rhid
Integrity mode: development

## Requirements

### R1. Modal Customizado Centralizado com Backdrop Blur
- Substituir a chamada `window.confirm(...)` em `src/App.tsx` (fluxo de confirmação de marcação manual oficial) por um modal in-app acessível e responsivo.
- O modal deve ser perfeitamente centralizado vertical e horizontalmente na tela.
- O overlay (backdrop) de fundo deve ter opacidade leve (em torno de 0.3) combinada com desfoque (`backdrop-filter: blur(...)`), sem cobrir ou quebrar a usabilidade da página.

### R2. Padronização e Disposição dos Botões de Ação
- Os botões "OK" (Confirmar) e "Cancelar" devem possuir o mesmo tamanho/largura (largura visual uniforme).
- O botão "OK" (ação de confirmação da marcação) deve ficar posicionado à direita.
- O botão "Cancelar" deve adotar estilo arredondado (`round`/pill) e uma severidade visual distinta (estilo secundário/neutro), mantendo harmonia com o design system do projeto (`gamb-design-system-local.css`).

### R3. Segurança Operacional, Rastreabilidade e Zero Regressão
- Preservar integralmente o fluxo assíncrono: se o usuário cancelar, a marcação é abortada imediatamente sem efeitos colaterais; se confirmar, o fluxo segue normalmente para a obtenção de geolocalização e envio.
- A marcação automática de ponto (que não requer confirmação manual) deve continuar funcionando sem interferência do modal.
- Nenhuma requisição real de marcação de ponto pode ser disparada contra o servidor do RHiD durante a suíte de testes e validações locais.
- Registrar as alterações realizadas de forma clara em documentação/log do repositório para total rastreabilidade.

## Acceptance Criteria

### Interface e Apresentação
- [ ] O modal de confirmação aparece centralizado vertical e horizontalmente no centro da tela em vez do popup do navegador no topo.
- [ ] O backdrop apresenta transparência de ~0.3 com efeito de desfoque (`blur`).
- [ ] O botão "OK" está localizado à direita e o botão "Cancelar" está à esquerda (ou disposto ordenadamente com o OK à direita).
- [ ] O botão "Cancelar" possui formato arredondado (`round`/pill) e estilo secundário bem definido.
- [ ] Ambos os botões possuem dimensões (largura) iguais e balanceadas.

### Funcionalidade e Integridade
- [ ] Clicar em "Cancelar" fecha o modal e cancela a operação sem registrar ponto nem disparar chamadas de API.
- [ ] Clicar em "OK" prossegue com a coleta de geolocalização e envio oficial do ponto.
- [ ] A suíte de testes automatizados do projeto executa com sucesso (`npm test` ou script correspondente), com testes cobrindo a nova confirmação sem quebrar os fluxos existentes.
- [ ] Todas as alterações são rastreadas e documentadas sem perda de funcionalidades em produção.
