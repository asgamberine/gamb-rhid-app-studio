import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist');
const basePath = normalizeBasePath(process.env.PUBLIC_BASE ?? process.env.VITE_PUBLIC_BASE ?? '/gamb_rhid/');
const files = await listFiles(distDir);
const precacheFiles = files
  .filter((file) => file !== 'sw.js' && !file.endsWith('.map') && !path.basename(file).startsWith('.'))
  .sort();
const assets = precacheFiles.map((file) => `${basePath}${file.replaceAll(path.sep, '/')}`);
const versionHash = createHash('sha256');
for (const file of precacheFiles) {
  versionHash.update(file);
  versionHash.update('\0');
  versionHash.update(await readFile(path.join(distDir, file)));
  versionHash.update('\0');
}
const version = versionHash.digest('hex').slice(0, 12);
const source = buildServiceWorker({ assets, basePath, version });

await writeFile(path.join(distDir, 'sw.js'), source, 'utf8');

function normalizeBasePath(value) {
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(path.join(directory, prefix));
  const result = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry);
    const details = await stat(path.join(directory, relative));
    if (details.isDirectory()) result.push(...(await listFiles(directory, relative)));
    else result.push(relative);
  }
  return result;
}

function buildServiceWorker({ assets, basePath, version }) {
  return `const CACHE_PREFIX = 'gamb-rhid-';
const PRECACHE = CACHE_PREFIX + '${version}';
const TOKEN_CACHE = CACHE_PREFIX + 'design-tokens';
const BASE_PATH = ${JSON.stringify(basePath)};
const ASSETS = ${JSON.stringify(assets, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PRECACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== PRECACHE && key !== TOKEN_CACHE)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;

  const isDesignToken =
    request.url === 'https://gamberine.com.br/arquivos_publicos/gamb_variables_geral.css' ||
    /^https:\\/\\/cdn\\.jsdelivr\\.net\\/gh\\/gamberine\\/\\.?gamb_variaveis@[^/]+\\/dist\\/gamb-design-system\\.min\\.css$/i.test(request.url);
  if (isDesignToken) {
    event.respondWith(staleWhileRevalidate(request, TOKEN_CACHE));
    return;
  }

  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE_PATH)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(BASE_PATH + 'index.html')));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refreshed = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  return cached || refreshed;
}
`;
}
