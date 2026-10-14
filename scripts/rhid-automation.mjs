#!/usr/bin/env node
/**
 * Gamb RH ID - Script CLI para acionamento de avaliacao de automacoes.
 * Pode ser executado em cron jobs da Hostinger ou manualmente para verificacao.
 */

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const apiBase = process.env.RHID_API_BASE ?? `http://${host}:${port}`;
const secret = process.env.AUTOMATION_SECRET ?? '';

console.log(`[rhid-automation] Disparando avaliacao de automacao em ${apiBase}...`);

try {
  const url = new URL('/api/rhid/automation/evaluate', apiBase);
  if (secret) {
    url.searchParams.set('secret', secret);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'x-automation-secret': secret } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[rhid-automation] Falha na avaliacao (${response.status}): ${errorText}`);
    process.exit(1);
  }

  const data = await response.json();
  console.log('[rhid-automation] Avaliacao concluida com sucesso:', JSON.stringify(data, null, 2));
} catch (error) {
  console.error('[rhid-automation] Erro durante a execucao:', error instanceof Error ? error.message : error);
  process.exit(1);
}
