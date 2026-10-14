import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();

if (!/^\d+\.\d+\.\d+-homolog\.\d+$/.test(packageJson.version)) {
  throw new Error(`Versao de homologacao invalida: ${packageJson.version}`);
}

if (!branch.startsWith('codex/homolog-')) {
  throw new Error(`Branch de homologacao invalida: ${branch || '(detached HEAD)'}`);
}

console.log(`Homologacao confirmada: ${packageJson.version} em ${branch}`);
