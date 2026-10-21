// Audio/drums/sample.js — one stroke of a decoded sample.
//
//   playSample({ ctx, out, buffer, at, rate = 1, envelope = null, peak = 1, until = null })
//     -> { source, gain, end, stop(at?), onEnded(cb) }
//
// envelope: an { attack, decay, sustain, release } ADSR, FITTED TO THE BUFFER'S LENGTH the way Partitions has always
//   played its drums (fitEnvelope below): attack, decay, a sustain hold that fills the rest of the file, then the
//   release ending where the file ends. The source stops just after. With no envelope the sample plays whole at `peak`
//   (chunk-tunes' kit sample).
// rate: the source's playbackRate (2^(semitones/12) for a transpose). The fitted envelope is laid out in context
//   seconds against buffer.duration, not the rate-scaled length, as Partitions does.
// until: optional cut-short at the same channel's next stroke (chunk-tunes): a 12 ms fade ending at `until` when that
//   falls before the stroke's own end. With an envelope the fade is a separate gain after it; without, it rides the
//   stroke's own gain as chunk-tunes does.
//
// Graph:   source ─▶ gain (envelope or flat peak) ─▶ [cut gain, envelope + until only] ─▶ out

import { strokeHandle, cutInput } from './made.js';

const CUT_SECONDS = 0.012;

/** Partitions' layer ADSR fitted to a buffer of `duration` seconds. Zero/missing knobs fall back as Partitions' did. */
export function fitEnvelope(adsr = {}, duration = 0) {
  const attack = Math.max(0.001, adsr.attack || 0.001);
  const decay = Math.max(0.001, adsr.decay || 0.2);
  const sustain = Math.min(1, Math.max(0, adsr.sustain ?? 0.7));
  const release = Math.max(0.001, adsr.release || 0.3);
  const sustainTime = Math.max(0, (duration || 0) - attack - decay - release);
  return { attack, decay, sustain, release, sustainTime, length: attack + decay + sustainTime + release };
}

export function playSample({ ctx, out, buffer, at, rate = 1, envelope = null, peak = 1, until = null }) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  const cutting = until !== null && until !== undefined;
  let into = out, stopAt = null, end;

  if (envelope) {
    // Event for event what PartitionsPlayback.triggerSample scheduled before the library (including its leading
    // duplicate set-to-0), so the default graph is identical — Audio/tests/assert-drums.mjs holds it to that.
    gain.gain.setValueAtTime(0, at);
    const { attack, decay, sustain, sustainTime, release, length } = fitEnvelope(envelope, buffer.duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + attack);
    gain.gain.linearRampToValueAtTime(sustain * peak, at + attack + decay);
    gain.gain.setValueAtTime(sustain * peak, at + attack + decay + sustainTime);
    gain.gain.linearRampToValueAtTime(0, at + attack + decay + sustainTime + release);
    stopAt = at + Math.max(0.01, length + 0.01);
    end = stopAt;
    if (cutting) {
      const cut = cutInput(ctx, out, at, end, until);
      into = cut.input; stopAt = cut.stopAt(stopAt);
    }
  } else {
    gain.gain.setValueAtTime(peak, at);
    end = at + (buffer.duration || 0) / (rate || 1);
    if (cutting && until < end) {
      gain.gain.setValueAtTime(peak, Math.max(at, until - CUT_SECONDS));
      gain.gain.linearRampToValueAtTime(0, until);
      stopAt = until + 0.01;
    }
  }

  source.playbackRate.setValueAtTime(rate, at);
  source.connect(gain);
  gain.connect(into);
  source.start(at);
  if (stopAt !== null) source.stop(stopAt);

  const handle = strokeHandle([source], stopAt ?? end);
  handle.source = source;
  handle.gain = gain;
  return handle;
}
