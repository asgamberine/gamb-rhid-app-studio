const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV ||= 'production';
process.env.HOST ||= '0.0.0.0';
process.env.PORT ||= '3000';
process.env.SERVE_STATIC ||= 'false';
process.env.TRUST_PROXY ||= 'true';
process.env.COOKIE_SECURE ||= 'true';
process.env.TRUSTED_ORIGINS ||= 'https://gamberine.com.br';
process.env.DATA_DIR ||= path.join(
  os.homedir(),
  'domains',
  'gambrhid-api.gamberine.com.br',
  'nodejs-data',
);

import('./server/index.mjs').catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
