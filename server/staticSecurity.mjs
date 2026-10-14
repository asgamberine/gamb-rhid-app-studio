export function staticCacheControl(filePath) {
  const normalized = String(filePath ?? '').replaceAll('\\', '/').toLowerCase();
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (fileName === 'index.html') return 'no-store';
  if (fileName === 'sw.js' || fileName === 'manifest.webmanifest') {
    return 'no-cache, no-store, must-revalidate';
  }
  return 'public, max-age=31536000, immutable';
}
