import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { SpatialGridRowPlayer } from '../audio/spatial-grid-row-player.js';
import { buildRowScheduleTables } from '../audio/cosmos-grid-audio-core.js';
import { solveRoots, scoreRootAt } from '../audio/sky-root.js';
import { solveRootProposal } from '../workers/sky-root-worker.js';
import { AudioTelemetry } from '../audio/audio-telemetry.js';

function run(program, { fast, now, horizon, rate, cursorTick, fundamental }) {
  const player = Object.create(SpatialGridRowPlayer.prototype);
  player.rowFundamental = fundamental;
  const attacks = [];
  let dropped = 0, skipped = 0;
  player.telemetry = {
    lateEvent: (_, emitted) => { if (!emitted) dropped++; },
    lateEventsSkipped: count => { dropped += count; skipped += count; },
  };
  player._startVoice = (_, action, when, gap) => attacks.push([action.layer, action.rawFraction, when, gap]);
  if (!fast) player._skipLateEvents = () => {};
  const deck = { program, lastToneByLayer: new Map(), startTime: cursorTick / rate };
  player._syncCursor(deck, cursorTick);
  player._seedDeck(deck, cursorTick);
  const start = performance.now();
  player._scheduleDeck(deck, now, horizon, 0, rate);
  return { result: { attacks, memory: [...deck.lastToneByLayer].sort(), cycle: deck.cursorCycle,
    event: deck.cursorEvent, dropped }, skipped, ms: performance.now() - start };
}

// Uneven layers, wrap gaps, repeated tones, a muted fundamental, and a layer absent at cycle start.
const events = [0, 2, 4, 5, 8, 11, 15, 19].map((tick, i) => ({ tick, layerActions: [
  { layer: 'A', rawFraction: ['1/1', '3/2', '3/2', '1/1'][i % 4], rawRatio: 1.5 },
  ...(i % 3 === 1 ? [{ layer: 'D', rawFraction: i % 2 ? '5/4' : '1/1', rawRatio: 1.25 }] : []),
] }));
let checks = 0;
for (const repeatCull of [true, false]) {
  const program = { grid: 23, repeatCull, events, ...buildRowScheduleTables(events, 23, repeatCull) };
  for (const fundamental of [true, false]) for (const rate of [1, 13, 1000]) {
    for (const cursorTick of [0, 3, 22, 25]) for (const elapsed of [0.01, 0.26, 1, 9.333, 60]) {
      const now = cursorTick / rate + elapsed;
      const opts = { now, horizon: now + 0.25, rate, cursorTick, fundamental };
      const slow = run(program, { ...opts, fast: false });
      const fast = run(program, { ...opts, fast: true });
      assert.deepEqual(fast.result, slow.result, JSON.stringify({ repeatCull, ...opts }));
      checks++;
    }
  }
}
const program = { grid: 23, repeatCull: true, events, ...buildRowScheduleTables(events, 23, true) };
const opts = { now: 3600, horizon: 3600.25, rate: 1000, cursorTick: 0, fundamental: true };
const slow = run(program, { ...opts, fast: false }), fast = run(program, { ...opts, fast: true });
assert.deepEqual(fast.result, slow.result);
assert.ok(fast.skipped > 1_000_000);
console.log(`Recovery parity: ${checks + 1} cases; ${fast.skipped} overdue events skipped; linear ${slow.ms.toFixed(1)}ms, seek ${fast.ms.toFixed(2)}ms.`);

const field = [{ weight: 1, tones: [{ f: '1/1', c: 0 }, { f: '5/4', c: 386.314 }, { f: '3/2', c: 701.955 }] }];
for (const options of [{}, { targetsCents: [0, 386.314, 701.955], toleranceCents: 15 }]) {
  const currentRoot = { fraction: '1/1', cents: 0 };
  const { score, perDegree } = scoreRootAt(0, field, options);
  assert.deepEqual(solveRootProposal({ field, options, currentRoot }), {
    ladder: solveRoots(field, options), incumbent: { ...currentRoot, score, perDegree },
  });
}
assert.deepEqual(solveRootProposal({ field: [], options: {}, currentRoot: { fraction: '1/1', cents: 0 } }).ladder, []);
const meter = new AudioTelemetry();
meter.lateEventsSkipped(1234, 500);
assert.equal(meter.bucket().counts.dropped, 1234);
console.log('Root worker proposal parity and aggregate dropped-event telemetry pass.');

// Exercise the actual browser-worker handler through a node transport shim, including error replies.
const workerURL = new URL('../workers/sky-root-worker.js', import.meta.url).href;
const worker = new Worker(`
  const { parentPort } = require('node:worker_threads');
  globalThis.self = { postMessage: data => parentPort.postMessage(data) };
  import(${JSON.stringify(workerURL)}).then(() => {
    parentPort.on('message', data => self.onmessage({ data }));
  });
`, { eval: true });
const request = payload => new Promise((resolve, reject) => {
  worker.once('message', resolve);
  worker.once('error', reject);
  worker.postMessage(payload);
});
try {
  const payload = { id: 71, field, options: {}, currentRoot: { fraction: '1/1', cents: 0 } };
  const response = await request(payload);
  assert.equal(response.id, 71);
  assert.deepEqual(response.result, solveRootProposal(payload));
  assert.ok(response.compileMs >= 0);
  const failure = await request({ id: 72 });
  assert.equal(failure.id, 72);
  assert.equal(typeof failure.error, 'string');
  console.log('Actual root worker message, result, and error round trips pass.');
} finally { await worker.terminate(); }
