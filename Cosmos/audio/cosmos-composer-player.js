// cosmos-composer-player.js — the Composer's player inside Cosmos, and the clock takeover around it (Compose mode, E1,
// 2026-10-22 night). No DOM.
//
//   perform(spec)  suspends the flight (cosmos-audio.js suspendFlight: flightGain → 0, the bed and lead released, MIDI
//                  out all-notes-off, the transport held) and plays the spec on a loop through the Composer player,
//                  whose tick is now the transport's own pulse: the worker-driven schedulerTick calls it instead of the
//                  flight phases, with Cosmos's 250 ms horizon. Its output is Cosmos's composition bus (behind MUTE,
//                  VOLUME and the limiter, past the flight gate). It never goes to MIDI out (v1).
//   stop()         fades the composition out (the player's 30 ms) and hands the transport back (resumeFlight: re-anchor,
//                  chord baseline reset, lead resync, flightGain back in over 1.5 s).
//   setLevel(x)    the range fade as the player flies away (0..1).
//   onNote(e)      a hook per note and drum stroke AS IT IS BOOKED, ~250 ms ahead of `when` (audio-context seconds):
//                  { kind: 'note' | 'drum', part, node, tick, when, cycle, time, … } — E2's dust and choreography wait
//                  for currentTime ≥ when. `node` is the spec's row index (the rhythm's onset, or the superrow's node).
//
// THE ONE IMPORT of the Composer player is the line below: the shared player (Composer/perform/), whose limiter feeds
// the `destination` it's given (here Cosmos's composition bus).

import { createPlayer } from '../../Composer/perform/composer-player.js';
import { suspendFlight, resumeFlight, compositionOutput, setCompositionLevel } from './cosmos-audio.js';
import { SCHEDULE_AHEAD_SECONDS } from './transport-clock.js';

/** every note and drum stroke of a spec, by time: what the hook reports as the player books it */
export function bookingEvents(spec) {
  const out = [];
  for (const part of spec.parts || []) {
    if (!part.enabled) continue;
    for (const n of part.notes) out.push({ kind: 'note', part: part.id, node: n.node, tick: n.tick, time: n.time, hz: n.hz, velocity: n.velocity, duration: n.duration, bar: n.bar, slot: n.slot, ...(n.voice != null ? { voice: n.voice } : {}) });
  }
  if (spec.drums?.enabled) for (const h of spec.drums.hits) out.push({ kind: 'drum', part: 'drums', voice: h.voice, tick: h.tick, time: h.time, velocity: h.velocity, bar: h.bar, slot: h.slot });
  return out.sort((a, b) => a.time - b.time);
}

const defaultAudio = { suspendFlight, resumeFlight, compositionOutput, setCompositionLevel };

export function createCosmosComposerPlayer({ audio = defaultAudio, makePlayer = createPlayer, schedule } = {}) {
  let player = null, spec = null, events = [], cursor = 0, cycle = 0, onNote = null;
  const aheadSeconds = schedule?.aheadSeconds ?? SCHEDULE_AHEAD_SECONDS;

  // the hook: everything the player has booked, from where it last reached, cycle by cycle (the player's own clock map
  // at factor 1: clock = loopStart + spec seconds)
  function report() {
    if (!onNote || !events.length) return;
    const T = spec.knobs.cycleSeconds, until = player.booked - player.loopStart;
    while (cycle * T + (cursor < events.length ? events[cursor].time : T) < until) {
      if (cursor >= events.length) { cursor = 0; cycle++; continue; }
      const e = events[cursor++];
      try { onNote({ ...e, cycle, when: player.loopStart + cycle * T + e.time }); } catch (err) { console.warn('[cosmos compose] onNote hook threw', err); }
    }
  }
  function tick() { if (!player) return; player.tick(); report(); }

  return {
    get playing() { return !!player; },
    get spec() { return spec; },
    /** the clock time the loop started (audio-context seconds), or null */
    get startedAt() { return player ? player.loopStart : null; },
    /** 0..1 of the cycle, or null */
    playhead() { return player ? player.playhead() : null; },
    perform(theSpec, { onNote: hook = null } = {}) {
      if (player || !theSpec || theSpec.refused) return false;
      const out = audio.compositionOutput();
      if (!out) return false;
      if (!audio.suspendFlight({ onTick: tick })) return false;
      spec = theSpec; events = bookingEvents(spec); cursor = 0; cycle = 0; onNote = hook;
      player = makePlayer({ ctx: out.ctx, destination: out.destination, timers: {}, options: { aheadSeconds } });
      audio.setCompositionLevel(1, 0.01);
      player.play(spec);
      report();
      return true;
    },
    tick,
    setLevel(level) { if (player) audio.setCompositionLevel(level); },
    stop({ fadeSeconds } = {}) {
      if (!player) return false;
      const p = player;
      player = null; onNote = null; events = []; spec = null;
      p.stop();
      setTimeout(() => { try { p.limiter.disconnect(); } catch {} }, 200);   // after the 30 ms fade: free the graph
      audio.resumeFlight(fadeSeconds != null ? { fadeSeconds } : undefined);
      audio.setCompositionLevel(1, 0.05);
      return true;
    },
  };
}
