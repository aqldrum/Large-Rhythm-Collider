// composer-limiter.worklet.js — the master chain's last stage (MIX_MASTER_ORDER.md M4): a lookahead true-peak limiter,
// an AudioWorklet (a small audio processor that runs on the browser's audio thread, sample by sample, instead of a
// built-in node). The file is self-contained (no imports), so it loads the same way in every browser's worklet scope,
// and its math is exported so Node can test it (Composer/tests/assert-mix-master.mjs) and the meter can reuse the
// true-peak detector (Composer/lab/mix-meter.js).
//
//   detector   true peak (dBTP, the peak of the waveform between the samples as well as on them, ITU-R BS.1770's
//              measure): each sample and the three points a 4× oversampling puts between it and the next, from a
//              windowed-sinc polyphase interpolator (TP_TAPS taps a phase). It reports `delay` samples late.
//   gain       the gain each sample needs (ceiling / its true peak, at most 1); the minimum of that over the lookahead
//              window (L samples), then a moving average over the same L: the average of L+1 minimums that each
//              include sample n−L is never above that sample's need, so the gain reaches it, as a ramp, by the time the
//              (delayed) sample plays. Rising back is slower: a one-pole release. The channels share one gain (linked).
//   delay      the audio is delayed by L + the detector's delay, so the gain lands on the sample it was computed for.
//   ceiling    −1 dBTP by default. On the samples it is exact; between them the gain's own movement can leave a hair
//              (the tests hold it within 0.1 dB of the ceiling on test signals far over it).

export const LIMITER_DEFAULTS = Object.freeze({ ceilingDb: -1, lookaheadMs: 6, releaseMs: 120 });
/** taps a phase of the 4× interpolator (48 taps in all, as BS.1770's example filter) */
export const TP_TAPS = 12;
const OVERSAMPLE = 4;

/** the polyphase interpolator's phases 1..3 (phase 0 is the sample itself): Hann-windowed sinc, each phase normalized
 *  to unity gain at DC */
export function truePeakPhases(taps = TP_TAPS, factor = OVERSAMPLE) {
  const half = taps / 2, phases = [];
  for (let p = 1; p < factor; p++) {
    const frac = p / factor, h = new Float64Array(taps);
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const t = k - (half - 1) - frac;   // the tap's distance from the point, in samples (points between k = half−1 and half)
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.5 + 0.5 * Math.cos(Math.PI * t / (half + 0.5));
      h[k] = sinc * w; sum += h[k];
    }
    for (let k = 0; k < taps; k++) h[k] /= sum;
    phases.push(h);
  }
  return phases;
}

/**
 * createTruePeak({ taps }) → { next(x) → the true peak around the sample `delay` samples back, delay, reset() }
 *   the largest |value| among that sample and the interpolated points either side of it
 */
export function createTruePeak({ taps = TP_TAPS } = {}) {
  const phases = truePeakPhases(taps), hist = new Float64Array(taps), half = taps / 2;
  let pos = 0, lastBetween = 0;
  return {
    delay: half,
    next(x) {
      hist[pos] = x; pos = (pos + 1) % taps;
      // hist, oldest first, is hist[pos..]; the points computed lie between the samples at half−1 and half (oldest = 0)
      let between = 0;
      for (const h of phases) {
        let acc = 0;
        for (let k = 0; k < taps; k++) acc += h[k] * hist[(pos + k) % taps];
        const a = Math.abs(acc);
        if (a > between) between = a;
      }
      const centre = Math.abs(hist[(pos + half - 1) % taps]);   // the sample right before those points (`half` back)
      const peak = Math.max(centre, between, lastBetween);      // it, and the points on either side of it
      lastBetween = between;
      return peak;
    },
    reset() { hist.fill(0); pos = 0; lastBetween = 0; },
  };
}

/** a whole signal's true peak (linear), channels arrays → number: the meter's measure */
export function truePeakOf(channels) {
  let max = 0;
  for (const ch of channels) {
    const tp = createTruePeak();
    for (let i = 0; i < ch.length; i++) { const v = tp.next(ch[i]); if (v > max) max = v; }
    for (let i = 0; i < tp.delay + 1; i++) { const v = tp.next(0); if (v > max) max = v; }
  }
  return max;
}

/**
 * createLimiterCore({ sampleRate, channels, ceilingDb, lookaheadMs, releaseMs }) → { process(ins, outs, frames),
 *   latency (samples), reduction (the last gain, dB ≤ 0), set({ ceilingDb, releaseMs }) }
 *   ins/outs: arrays of Float32Array (one a channel); a missing input channel is silence.
 */
export function createLimiterCore({ sampleRate = 48000, channels = 2, ceilingDb = LIMITER_DEFAULTS.ceilingDb, lookaheadMs = LIMITER_DEFAULTS.lookaheadMs, releaseMs = LIMITER_DEFAULTS.releaseMs } = {}) {
  const L = Math.max(1, Math.round(lookaheadMs * sampleRate / 1000));
  const detectors = Array.from({ length: channels }, () => createTruePeak());
  const D = detectors[0].delay, delayLen = L + D + 1;
  const lines = Array.from({ length: channels }, () => new Float32Array(delayLen));
  let writeAt = 0;
  // the sliding minimum over the last L+1 needs: a monotonic deque of (index, value) in ring arrays
  const qIdx = new Float64Array(L + 2), qVal = new Float64Array(L + 2);
  let qHead = 0, qLen = 0, n = 0;
  // the moving average of the last L+1 minimums
  const box = new Float64Array(L + 1);
  let boxAt = 0, boxSum = L + 1, sinceExact = 0;
  box.fill(1);
  let ceiling = 1, rel = 0, gain = 1;
  const set = ({ ceilingDb: c = null, releaseMs: r = null } = {}) => {
    if (c != null) ceiling = Math.pow(10, c / 20) * 0.99999;
    if (r != null) rel = 1 - Math.exp(-1 / (Math.max(1, r) * sampleRate / 1000));
  };
  set({ ceilingDb, releaseMs });
  return {
    latency: delayLen - 1,
    get reduction() { return 20 * Math.log10(gain); },
    set,
    process(ins, outs, frames) {
      for (let i = 0; i < frames; i++) {
        let peak = 0;
        for (let c = 0; c < channels; c++) {
          const x = ins[c] ? ins[c][i] : 0;
          lines[c][writeAt] = x;
          const p = detectors[c].next(x);
          if (p > peak) peak = p;
        }
        const need = peak > ceiling ? ceiling / peak : 1;
        // push `need`, keeping the deque increasing; drop what left the window
        while (qLen && qVal[(qHead + qLen - 1) % (L + 2)] >= need) qLen--;
        const tail = (qHead + qLen) % (L + 2);
        qIdx[tail] = n; qVal[tail] = need; qLen++;
        while (qIdx[qHead] <= n - (L + 1)) { qHead = (qHead + 1) % (L + 2); qLen--; }
        const min = qVal[qHead];
        boxSum += min - box[boxAt]; box[boxAt] = min; boxAt = (boxAt + 1) % (L + 1);
        if (++sinceExact >= 4096) { sinceExact = 0; boxSum = 0; for (let k = 0; k <= L; k++) boxSum += box[k]; }
        const target = Math.min(1, boxSum / (L + 1));
        gain = target < gain ? target : gain + (target - gain) * rel;
        const readAt = (writeAt + 1) % delayLen;   // the oldest sample: delayLen − 1 = L + D back
        for (let c = 0; c < channels; c++) if (outs[c]) outs[c][i] = lines[c][readAt] * gain;
        writeAt = readAt; n++;
      }
    },
  };
}

// ── the processor (only where the worklet scope defines AudioWorkletProcessor) ──
if (typeof AudioWorkletProcessor === 'function' && typeof registerProcessor === 'function') {
  class ComposerLimiter extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const o = options?.processorOptions ?? {};
      this.core = createLimiterCore({ sampleRate, channels: 2, ...o });
      this.frame = 0;
      this.port.onmessage = (e) => { if (e.data?.set) this.core.set(e.data.set); };
    }
    process(inputs, outputs) {
      const input = inputs[0] ?? [], output = outputs[0];
      const ins = input.length === 1 ? [input[0], input[0]] : input;   // a mono input feeds both sides
      this.core.process(ins, output, output[0].length);
      // the gain reduction, about 10 times a second, for a meter
      if ((this.frame += output[0].length) >= 4800) { this.frame = 0; this.port.postMessage({ reduction: this.core.reduction }); }
      return true;
    }
  }
  registerProcessor('composer-limiter', ComposerLimiter);
}
