// gravity-worker.js — production wrapper around the pure gravity core.
// Body geography is supplied by flight-view; this worker owns only simulation state and stepping.

import { GravitySimulation } from '../gravity-core.js';

let simulation = null;
let bodyRevision = 0;

function syncBodies(message) {
  const ids = message.ids || new Int32Array();
  const rest = message.rest || new Float64Array();
  const sizes = message.sizes || new Float32Array();
  const pins = message.pins || new Uint8Array();
  const axes = message.axes || new Float32Array();
  const bodies = new Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    const base = i * 3;
    bodies[i] = {
      id: ids[i],
      rest: [rest[base], rest[base + 1], rest[base + 2]],
      size: sizes[i],
      pinned: pins[i] !== 0,
      spinAxis: [axes[base], axes[base + 1], axes[base + 2]],
      cycleTicks: Math.max(1, ids[i]),
    };
  }
  simulation.setBodies(bodies);
  bodyRevision = message.revision || 0;
}

function stepFrame(message) {
  const output = new Float32Array(message.buffer);
  simulation.advance(message.dt, {
    held: message.held,
    center: message.center,
    tick: message.tick,
    ticksPerSecond: message.ticksPerSecond,
  });
  const length = simulation.count * 3;
  for (let i = 0; i < length; i++) output[i] = simulation.offsets[i];
  output.fill(0, length);
  self.postMessage({
    type: 'frameDone',
    buffer: output.buffer,
    revision: bodyRevision,
    count: simulation.count,
    activation: simulation.stats.activation,
    strength: simulation.stats.strength,
    clampEngagements: simulation.stats.clampEngagements,
  }, [output.buffer]);
}

self.onmessage = event => {
  const message = event.data || {};
  try {
    if (message.type === 'init') {
      simulation = new GravitySimulation({ capacity: message.capacity, options: message.options });
    } else if (message.type === 'sync' && simulation) {
      syncBodies(message);
    } else if (message.type === 'frame' && simulation) {
      stepFrame(message);
    } else if (message.type === 'reset' && simulation) {
      simulation.reset();
    }
  } catch (error) {
    if (message.type === 'frame' && message.buffer) {
      self.postMessage({ type: 'frameDone', buffer: message.buffer, revision: bodyRevision, count: 0,
        activation: 0, strength: 0, clampEngagements: 0, error: error.message || String(error) }, [message.buffer]);
    } else {
      self.postMessage({ type: 'error', error: error.message || String(error) });
    }
  }
};
