// transport-clock-worker.js — the audio transport's heartbeat, and nothing else.
//
// It holds no state the music depends on: it posts an empty tick and cosmos-audio's schedulerTick does all
// the work, reading the AudioContext clock as the single source of truth. So a late or missed tick can
// never desynchronise anything — it only delays the moment the next window of notes gets scheduled.
//
// WHY A WORKER AT ALL: the main thread's setInterval is starved by whatever the renderer is doing (the
// flight loop projects every zone and rebuilds the audio field each frame) and is clamped to 1Hz outright
// while the tab is hidden — measured at 1001ms against a 25ms nominal. A worker's timer runs on its own
// thread, so frame cost cannot delay it, and background clamping is far weaker. This is the standard
// WebAudio "two clocks" arrangement: a lookahead scheduler pulsed by an unstarved timer.
let timer = null;

self.onmessage = event => {
  const { op, intervalMs } = event.data || {};
  if (op === 'start') {
    if (timer !== null) clearInterval(timer);
    timer = setInterval(() => self.postMessage(0), Math.max(1, Number(intervalMs) || 25));
  } else if (op === 'stop') {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
};
