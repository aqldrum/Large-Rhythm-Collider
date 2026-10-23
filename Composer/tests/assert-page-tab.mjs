// assert-page-tab.mjs — the main page's Composer tab controller (Composer/page/tab-controller.js), in Node, with an
// injected host standing in for the page (its rhythm, main playback) and a recording mock AudioContext:
//   • Compose reads the page's rhythm; none yet → the button does nothing; a new rhythm or cycle → back to Compose,
//     playback stopped (new layers clear the progression, a new cycle keeps it); a change during Compose drops it
//   • one thing sounds at a time: Perform stops main playback first; main playback starting stops the Composer;
//     closing the tab stops it
//   • the progression and the drums carried through it exactly as the lab carries them; the page's sample paths
//   • the selection and the inspector's section; the lit nodes memoized, and null for another rhythm
//   node Composer/tests/assert-page-tab.mjs
import { createTabController, SECTIONS, SECTION_OF, kitChoices, PAGE_SAMPLES_BASE } from '../page/tab-controller.js';
import { compose } from '../core/compose.js';
import { siteRhythm } from './site-scripts.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };

function makeCtx() {
  const param = (value) => { const p = { value }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p; return p; };
  const node = (extra = {}) => ({ outs: [], connect(d) { this.outs.push(d); return d; }, disconnect() {}, ...extra });
  return {
    currentTime: 0, sampleRate: 48000, state: 'running', resume() {}, destination: node(),
    createGain: () => node({ gain: param(1) }), createBiquadFilter: () => node({ frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
    createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }),
    createOscillator: () => node({ frequency: param(440), detune: param(0), setPeriodicWave() {}, start() {}, stop() {} }),
    createBufferSource: () => node({ start() {}, stop() {} }), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }), createPeriodicWave: () => ({}),
  };
}
/** the page, as a test drives it */
function makeHost() {
  const host = { rhythm: null, mainPlaying: false, stops: 0, startedFns: [],
    readRhythm: () => host.rhythm, stopMain() { if (host.mainPlaying) { host.mainPlaying = false; host.stops++; } },
    onMainStarted(fn) { host.startedFns.push(fn); return () => {}; },
    startMain() { host.mainPlaying = true; for (const f of host.startedFns) f(); } };
  return host;
}
const timers = { setInterval: () => 1, clearInterval: () => {} };

console.log('Composer tab — the controller');
const host = makeHost(), ctx = makeCtx();
const tab = createTabController({ host, createContext: () => ctx, timers });

console.log('\n— the page\'s rhythm');
check('no rhythm on the page yet: Compose, and pressing it does nothing', tab.button() === 'Compose' && !tab.canPress() && !tab.view.hasRhythm && (await tab.press()) === null && tab.state.spec === null);
host.rhythm = { layers: [8, 7, 6, 5], cycleSeconds: 4 };
check('a rhythm appears: the tab takes it over (layers and cycle)', tab.syncRhythm() && tab.state.input.layers.join() === '8,7,6,5' && tab.state.input.cycleSeconds === 4 && tab.canPress());
check('nothing changed: a sync is a no-op (it runs every frame)', tab.syncRhythm() === false);
await tab.press();
check(`Compose composes the page's rhythm (${tab.state.spec.chords.map((c) => c.name).join(' ')}); the button says Perform`, tab.button() === 'Perform' && JSON.stringify(tab.state.spec) === JSON.stringify(compose([8, 7, 6, 5], 4, { seed: 1, worker: true })));

console.log('\n— one thing sounds at a time');
host.mainPlaying = true;
await tab.press();
check('Perform stops main playback first, then plays; the button says Stop', host.stops === 1 && !host.mainPlaying && tab.state.status === 'playing' && tab.button() === 'Stop' && tab.core.player.playing);
const ph = tab.playheadAt();
check('the playhead while performing: p in [0, 1) and t = p × the cycle', ph && ph.p >= 0 && ph.p < 1 && Math.abs(ph.t - ph.p * 4) < 1e-12);
host.startMain();
check('main playback starts: the Composer stops (Perform again)', tab.state.status === 'ready' && tab.button() === 'Perform' && !tab.core.player.playing && tab.playheadAt() === null);
host.startMain();
check('main starting again while the Composer is stopped changes nothing', tab.state.status === 'ready' && tab.button() === 'Perform');
await tab.press();
check('Perform again while main plays: main stops again', host.stops === 2 && !host.mainPlaying && tab.state.status === 'playing');
tab.core.stop(); await tab.press();
check('Perform with main already stopped: nothing to stop', host.stops === 2 && tab.state.status === 'playing');
tab.close();
check('closing the tab stops the Composer', tab.state.status === 'ready' && !tab.core.player.playing && tab.view.open === false);
tab.open();
check('opening it again keeps the composition (Perform)', tab.view.open && tab.button() === 'Perform');

console.log('\n— a rhythm change on the page');
const r0 = tab.state.spec.chords[0].rootTone;
tab.core.setProgressionRoot(0, r0);
await tab.press();   // the progression is an input: Compose again
await tab.press();   // Perform
check('(playing, with a progression asked)', tab.state.status === 'playing' && tab.core.progressionInput()?.[0] === r0 && tab.state.spec.input.progression?.[0] === r0);
host.rhythm = { layers: [8, 7, 6, 5], cycleSeconds: 6 };
tab.syncRhythm();
// (sprint 2) a new rhythm or cycle is another entry of the composition store: a fresh one (idle), the old one cached
const at4 = tab.store.entry('8:7:6:5@4');
check('a new cycle: playback stops, the button goes back to Compose; the progression is kept (same row)', tab.state.status === 'idle' && tab.button() === 'Compose' && tab.state.input.cycleSeconds === 6 && tab.core.progressionInput()?.[0] === r0);
check('(sprint 2) … the cycle before is cached in the store, its composition intact', at4 && at4.state !== tab.state && at4.state.spec && at4.state.status === 'ready' && tab.store.key === '8:7:6:5@6');
await tab.press(); await tab.press();
host.rhythm = { layers: [41, 42, 43, 0], cycleSeconds: 6 };
tab.syncRhythm();
check('new layers: playback stops, Compose, and the progression is cleared (its ratios were the old row\'s)', tab.state.status === 'idle' && tab.button() === 'Compose' && tab.core.progressionInput() === null && tab.state.input.layers.join() === '41,42,43,0');
host.rhythm = null;
tab.syncRhythm();
check('the rhythm gone: nothing to compose', !tab.canPress() && tab.button() === 'Compose');
host.rhythm = { layers: [41, 42, 43, 0], cycleSeconds: 6 };
tab.syncRhythm();

console.log('\n— a change while Compose runs');
{
  const h2 = makeHost(); h2.rhythm = { layers: [8, 7, 6, 5], cycleSeconds: 4 };
  let release = null;
  const slow = (l, T, o) => new Promise((resolve) => { release = () => resolve(compose(l, T, o)); });
  const t2 = createTabController({ host: h2, runCompose: slow, createContext: () => makeCtx(), timers });
  const pending = t2.press();
  check('Composing…', t2.button() === 'Composing…' && !t2.canPress());
  h2.rhythm = { layers: [19, 17, 16, 15], cycleSeconds: 6 };
  t2.syncRhythm();
  check('the page\'s rhythm changes mid-compose: the button is Compose again at once', t2.button() === 'Compose' && t2.state.status !== 'composing');
  release(); await pending;
  check('the old compose\'s answer is dropped when it comes (no spec of the old rhythm)', t2.state.spec === null && t2.button() === 'Compose');
  check('(sprint 2) … it lands in the old rhythm\'s own entry instead: cached, not lost', t2.store.entry('8:7:6:5@4').state.spec?.input.layers.join() === '8,7,6,5' && t2.store.recallable('8:7:6:5@4'));
  const p2 = t2.press(); release(); await p2;
  check('Compose again: the new rhythm', t2.state.spec.input.layers.join() === '19,17,16,15' && t2.button() === 'Perform');
}

console.log('\n— the drums, the kit, the progression editor');
await tab.press();
tab.core.setDrums({ mode: 'son', fills: false });
check('the drums re-arrange from the spec, nothing re-composed', tab.state.drums.mode === 'son' && tab.button() === 'Perform');
await tab.core.compose();
check('a new Compose keeps the drum options', tab.state.drums.mode === 'son' && tab.state.drumOptions.fills === false);
check(`the kit offers the site's samples from index.html (${PAGE_SAMPLES_BASE})`, kitChoices('snare').some((c) => c.value === 'assets/audio/snare1.wav') && kitChoices('kick')[0].value === '' && tab.kitChoices === kitChoices);
check('take from last compose, then clear', tab.core.takeProgression() && tab.core.progressionInput().length === tab.state.spec.chords.length && (tab.core.clearProgression(), tab.core.progressionInput() === null));
check('root choices come from the page\'s row', tab.core.rootChoices().candidates.length > 3);

console.log('\n— the selection and the inspector');
check('lead is selected, on Lines', tab.view.selected === 'lead' && tab.view.section === 'lines');
tab.select('drums');
check('select the drums: the Drums section', tab.view.selected === 'drums' && tab.view.section === 'drums');
tab.select('chords');
check('select the chords: Harmony', tab.view.section === 'harmony' && SECTION_OF.chords === 'harmony');
tab.setSection('tuning');
check('a section by hand', tab.view.section === 'tuning' && SECTIONS.length === 4);
let threw = 0;
try { tab.select('kazoo'); } catch { threw++; }
try { tab.setSection('mixing'); } catch { threw++; }
check('no such part or section: an error', threw === 2);

console.log('\n— the lit nodes, from the tab');
{
  await tab.press();   // compose 41:42:43 if needed
  if (tab.button() === 'Compose') await tab.press();
  const site = siteRhythm([41, 42, 43, 1]);
  const h1 = tab.highlights(site), h2 = tab.highlights(site);
  check('the lit nodes of the spec as it plays now, memoized', h1 && h1 === h2 && h1.parts.drums.notes.length === tab.state.drums.hits.length);
  tab.core.setPart('bass', { enabled: false });
  const h3 = tab.highlights(site);
  check('a part switched off: new highlights, that part marked off', h3 !== h1 && h3.parts.bass.enabled === false);
  tab.core.setDrums({ mode: 'backbeat' });
  check('a drum change: new highlights', tab.highlights(site) !== h3);
  check('the plot showing another rhythm: null', tab.highlights(siteRhythm([8, 7, 6, 5])) === null && tab.highlights(null) === null);
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
