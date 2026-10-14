import { describe, expect, it } from 'vitest';
import { staticCacheControl } from './staticSecurity.mjs';

describe('static asset cache policy', () => {
  it('never makes the app shell or service worker immutable', () => {
    expect(staticCacheControl('/dist/index.html')).toBe('no-store');
    expect(staticCacheControl('/dist/sw.js')).toBe('no-cache, no-store, must-revalidate');
    expect(staticCacheControl('/dist/manifest.webmanifest')).toBe('no-cache, no-store, must-revalidate');
  });

  it('keeps fingerprinted assets immutable', () => {
    expect(staticCacheControl('/dist/assets/index-abc123.js')).toBe('public, max-age=31536000, immutable');
  });
});
