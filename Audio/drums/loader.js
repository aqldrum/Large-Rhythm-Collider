// Audio/drums/loader.js — fetch + decode a sample by URL, cached by URL per AudioContext.
//
//   loadSample(ctx, url, { fetch, decode, onError }) -> Promise<AudioBuffer | null>
//
// Any URL works: a site path ('assets/audio/kick1.wav'), an absolute URL, or a blob: URL (Partitions' IndexedDB user
// samples). `fetch(url) -> ArrayBuffer` and `decode(ctx, data) -> AudioBuffer` can be injected (tests, or a caller
// with its own store); the defaults are the browser's fetch (cache: 'no-store', as Partitions has always asked) and
// ctx.decodeAudioData. A load in flight is shared by every stroke asking for it. A failed load resolves null, calls
// onError(url, error) (default: console.warn) and is not cached, so the next stroke tries again.

const caches = new WeakMap();   // ctx -> Map<url, Promise<AudioBuffer | null>>

const cacheOf = (ctx) => {
  let map = caches.get(ctx);
  if (!map) { map = new Map(); caches.set(ctx, map); }
  return map;
};

export const fetchArrayBuffer = (url) => globalThis.fetch(url, { cache: 'no-store' }).then(response => response.arrayBuffer());
export const decodeWith = (ctx, data) => ctx.decodeAudioData(data);
const warn = (url, error) => console.warn('[Audio/drums] Failed to load sample', url, error);

export function loadSample(ctx, url, { fetch = fetchArrayBuffer, decode = decodeWith, onError = warn } = {}) {
  const cache = cacheOf(ctx);
  const hit = cache.get(url);
  if (hit) return hit;
  const pending = (async () => {
    try {
      const data = await fetch(url);
      return await decode(ctx, data);
    } catch (error) {
      if (cache.get(url) === pending) cache.delete(url);
      onError(url, error);
      return null;
    }
  })();
  cache.set(url, pending);
  return pending;
}

/** forget a URL's buffer on this context (a user sample replaced, or a select re-picked) */
export function invalidateSample(ctx, url) {
  caches.get(ctx)?.delete(url);
}

/** is this URL cached (loaded or loading) on this context? */
export function hasSample(ctx, url) {
  return caches.get(ctx)?.has(url) ?? false;
}
