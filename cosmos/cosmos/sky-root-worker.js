import { solveRoots, scoreRootAt } from '../sky-root.js';

export function solveRootProposal({ field, options, currentRoot }) {
  const ladder = solveRoots(field, options);
  const { score, perDegree } = scoreRootAt(currentRoot.cents, field, options);
  return { ladder, incumbent: { ...currentRoot, score, perDegree } };
}

if (typeof self !== 'undefined') self.onmessage = event => {
  const { id, ...payload } = event.data || {};
  try {
    const started = performance.now();
    const result = solveRootProposal(payload);
    self.postMessage({ id, result, compileMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
