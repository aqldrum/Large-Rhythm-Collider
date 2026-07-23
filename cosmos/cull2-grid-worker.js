import { buildGridCull2Readout } from './cull2-grid-core.js?v=6';

self.onmessage = event => {
  const { id, grid, options } = event.data || {};
  try {
    const result = buildGridCull2Readout(grid, options);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
