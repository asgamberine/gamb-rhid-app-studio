import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
const versionFile = path.resolve('public', 'version.json');
const buildTime = new Date().toISOString();
const payload = {
  name: packageJson.name,
  version: packageJson.version,
  cacheBust: `v${packageJson.version}`,
  buildTime,
};

await writeFile(versionFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
