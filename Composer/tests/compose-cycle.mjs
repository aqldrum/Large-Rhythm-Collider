// compose-cycle.mjs — compose.js with the meter of before (METER_TEMPO_ORDER.md P7): every compose here asks
// `meterFrom: 'cycle'` (the bars that put the cycle's tempo in 90–130 BPM, 8 slots lowered while sparse, 4 beats a bar,
// the cycle's tempo) unless it asks a meterFrom itself, and the override is taken back out of the spec's input, so a
// spec is byte for byte what Compose made before the meter came from the layers. The suites whose baselines, hashes and
// expectations were written on that meter import Compose from here, as earlier default changes kept theirs with
// `compStyle: 'notes'` and `voicing: 'close'`. The meter from the layers has its own suite (assert-meter.mjs).
// `chooseMeter` and `chartMeter` default to `from: 'cycle'` here the same way.
import * as live from '../core/compose.js';

export * from '../core/compose.js';

const asks = (o) => o?.overrides && Object.prototype.hasOwnProperty.call(o.overrides, 'meterFrom');

export function compose(layers, cycleSeconds, options = {}) {
  if (asks(options)) return live.compose(layers, cycleSeconds, options);
  const spec = live.compose(layers, cycleSeconds, { ...options, overrides: { ...(options?.overrides ?? {}), meterFrom: 'cycle' } });
  if (spec?.input?.overrides) delete spec.input.overrides.meterFrom;
  return spec;
}
export const chooseMeter = (n, T, opts = {}) => live.chooseMeter(n, T, { from: 'cycle', ...opts });
export const chartMeter = (n, T, changes, opts = {}) => live.chartMeter(n, T, changes, { from: 'cycle', ...opts });
