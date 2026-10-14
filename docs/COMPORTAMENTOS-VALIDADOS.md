# Comportamentos validados

## Retorno automático do almoço

**Estado:** aprovado e protegido em 13/07/2026.

Contrato que deve permanecer inalterado:

- inicia o monitoramento quando existem exatamente duas marcações oficiais no dia;
- atualiza o relógio sem depender de recarregar a página;
- aos 58 minutos, sincroniza e confere se a Entrada 2 já existe no RHiD;
- aos 59 minutos, envia o retorno automático para não ultrapassar uma hora;
- antes de enviar, revalida as marcações diretamente no RHiD;
- somente considera sucesso depois da confirmação oficial;
- se a Entrada 2 já existir, cancela a tentativa automática;
- falhas não podem ser gravadas como sucesso e devem permanecer elegíveis para retry.

Caso real protegido por teste: **Saída 1 às 13:02 → Entrada 2 automática às 14:01**.

### Dupla autorização obrigatória

Qualquer mudança nos arquivos abaixo que altere esse comportamento exige duas manifestações separadas do proprietário:

1. **Autorização de escopo:** aprovação explícita antes da implementação.
2. **Autorização de resultado:** aprovação explícita do diff final antes do merge ou deploy.

Arquivos protegidos:

- `src/domain/journey.ts`;
- `src/App.tsx`, nos efeitos e controles de retorno automático;
- `server/punchPolicy.mjs`;
- `server/index.mjs`, no endpoint de marcação oficial;
- testes do fluxo automático.

Correções emergenciais podem interromper uma publicação, mas não podem mudar o contrato sem as duas autorizações.

### Verificação obrigatória

Antes de aceitar qualquer alteração:

```bash
npm test
npm run build
```

Os testes que cobrem 58 minutos, 59 minutos, precisão por minuto, cancelamento após Entrada 2 e janela de segurança não podem ser removidos ou enfraquecidos.
