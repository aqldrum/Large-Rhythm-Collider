import { compileGridAudioProgram } from '../audio/cosmos-grid-audio-core.js?v=1';

self.onmessage = event => {
  const { id, ...payload } = event.data || {};
  try {
    const started = performance.now();
    const result = compileGridAudioProgram(payload);
    self.postMessage({ id, result, compileMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
