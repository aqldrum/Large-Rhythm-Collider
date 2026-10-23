// assert-store.mjs — the composition store (Composer/store/composition-store.js, sprint 2 step 1), in Node:
//   • keys: a rhythm + cycle, the layers normalized (blank, 0 and missing are absent)
//   • the entry shape is the shared controller's own state (the lab's default state has exactly its fields)
//   • select: made once, recalled after; moved only on a new key; a new cycle of the same row carries its edits
//     (deep copies), new layers start fresh; null = no rhythm
//   • the LRU: 4 rhythms, oldest out first, never the current one or one composing (the store may run over until it
//     lands), a re-selected rhythm moves to the back
//   • subscribe: select · lens · made · change · evict; the lens 'row' | 'composition'
//   • through the tab controller: recall without re-solve (runCompose counted), a compose landing in its own entry
//     after the page moved on, one compose in flight per entry (a second press joins the first), a change to a
//     composing entry dropping its answer, the window's edits kept in the entry the glyph will recall
//   node Composer/tests/assert-store.mjs
import { createCompositionStore, rhythmKey, newCompositionState, normalLayers, STORE_CAPACITY } from '../store/composition-store.js';
import { createComposerController } from '../perform/composer-controller.js';
import { createTabController } from '../page/tab-controller.js';
import { compose } from '../core/compose.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const timers = { setInterval: () => 1, clearInterval: () => {} };

console.log('Composition store');

console.log('\n— keys');
check('a rhythm + cycle: 8:7:6:5 at 4 s → 8:7:6:5@4', rhythmKey({ layers: [8, 7, 6, 5], cycleSeconds: 4 }) === '8:7:6:5@4');
check('absent layers (blank, 0, missing, not whole) are 0', rhythmKey({ layers: [768, 769], cycleSeconds: 8 }) === '768:769:0:0@8' && normalLayers(['41', '', 0, 2.5]).join() === '41,0,0,0');
check('the cycle is part of the key', rhythmKey({ layers: [8, 7, 6, 5], cycleSeconds: 6 }) !== rhythmKey({ layers: [8, 7, 6, 5], cycleSeconds: 4 }));

console.log('\n— the entry is the controller\'s state');
{
  const lab = createComposerController({ createContext: () => ({}), timers });
  const fresh = newCompositionState({ layers: [41, 42, 43, 0], cycleSeconds: 8, seed: 1 });
  check('the lab\'s default state has exactly the store\'s fields, with the same defaults', JSON.stringify(Object.keys(lab.state)) === JSON.stringify(Object.keys(fresh)) && JSON.stringify(lab.state) === JSON.stringify(fresh));
  const other = newCompositionState({ layers: [8, 7, 6, 5], cycleSeconds: 4 });
  check('bind(state): the controller acts on another state from then on', lab.bind(other) && lab.state === other && !lab.bind(other));
  lab.setSeed(9);
  check('… its edits land there, not in the state before', other.input.seed === 9 && fresh.input.seed === 1);
}

console.log('\n— select');
const store = createCompositionStore();
const events = [];
const off = store.subscribe((e) => events.push(`${e.type}:${e.key}`));
check(`the capacity is ${STORE_CAPACITY} (proposed), the lens starts on the row, nothing selected`, store.capacity === 4 && STORE_CAPACITY === 4 && store.lens === 'row' && store.key === null && store.state === null);
const a = store.select({ layers: [8, 7, 6, 5], cycleSeconds: 4 });
check('a rhythm: an entry made, current, moved', a.created && a.moved && a.key === '8:7:6:5@4' && store.state === a.state && a.state.input.layers.join() === '8,7,6,5' && a.state.input.cycleSeconds === 4);
const a2 = store.select({ layers: [8, 7, 6, 5, 0].slice(0, 4), cycleSeconds: 4 });
check('the same rhythm again: the same entry, not moved, no event', !a2.created && !a2.moved && a2.state === a.state && events.length === 1);
a.state.input.seed = 5; a.state.knobs.bars = 4; a.state.progression = ['7/4']; a.state.drumOptions.mode = 'son'; a.state.drumOptions.kit.kick = 'x'; a.state.levels.bass = 0.3; a.state.glideMs = 40;
a.state.spec = { fake: true }; a.state.status = 'ready'; a.state.dirty = false;
const b = store.select({ layers: [8, 7, 6, 5], cycleSeconds: 6 });
check('a new cycle of the same row: a new entry, with that row\'s edits carried (seed, knobs, progression, drums, levels, glide)', b.created && b.state !== a.state && b.state.input.seed === 5 && b.state.knobs.bars === 4
  && b.state.progression.join() === '7/4' && b.state.drumOptions.mode === 'son' && b.state.drumOptions.kit.kick === 'x' && b.state.levels.bass === 0.3 && b.state.glideMs === 40);
check('… but not its spec (it composes at its own cycle)', b.state.spec === null && b.state.status === 'idle' && b.state.dirty === true);
b.state.progression.push('3/2'); b.state.drumOptions.kit.kick = 'y'; b.state.knobs.bars = 8;
check('… as copies: editing the new entry leaves the old one alone', a.state.progression.length === 1 && a.state.drumOptions.kit.kick === 'x' && a.state.knobs.bars === 4);
const c = store.select({ layers: [41, 42, 43, 0], cycleSeconds: 6 });
check('new layers: a fresh entry', c.created && c.state.input.seed === 1 && c.state.progression.length === 0 && c.state.drumOptions.mode === 'backbeat');
const back = store.select({ layers: [8, 7, 6, 5], cycleSeconds: 4 });
check('back to the first rhythm: recalled as it was left (its spec and edits)', !back.created && back.moved && back.state === a.state && back.state.spec.fake && back.state.input.seed === 5);
check('recallable: made and not refused; a fresh entry is not', store.recallable('8:7:6:5@4') && !store.recallable('41:42:43:0@6') && !store.recallable('nope'));
a.state.dirty = true;
check('… nor one edited since (dirty: the glyph composes it again)', !store.recallable('8:7:6:5@4'));
a.state.dirty = false;
a.state.spec = { refused: true }; a.state.status = 'refused';
check('a clean refusal is known as one (refused), not recallable', store.refused('8:7:6:5@4') && !store.recallable('8:7:6:5@4') && !store.refused('41:42:43:0@6'));
a.state.spec = { fake: true }; a.state.status = 'ready';
const none = store.select(null);
check('no rhythm: nothing current (moved), the entries kept', none.moved && store.key === null && store.state === null && store.size === 3);

console.log('\n— the LRU');
store.select({ layers: [8, 7, 6, 5], cycleSeconds: 4 });
check(`the order: least recently used first (${store.keys().join(' ')})`, store.keys().join(' ') === '8:7:6:5@6 41:42:43:0@6 8:7:6:5@4');
store.select({ layers: [19, 17, 16, 15], cycleSeconds: 6 });
check('a fourth rhythm: all four kept', store.size === 4 && events.every((e) => !e.startsWith('evict')));
store.select({ layers: [119, 42, 15, 8], cycleSeconds: 8 });
check('a fifth: the least recently used goes (8:7:6:5@6), with an evict event', store.size === 4 && !store.has('8:7:6:5@6') && events.includes('evict:8:7:6:5@6') && store.has('8:7:6:5@4'));
store.entry('41:42:43:0@6').state.status = 'composing';
store.select({ layers: [768, 769, 0, 0], cycleSeconds: 8 });
check('a sixth while the oldest is composing: it is kept, the next oldest goes', store.has('41:42:43:0@6') && !store.has('8:7:6:5@4') && store.size === 4);
for (const k of store.keys()) if (k !== '41:42:43:0@6') store.entry(k).state.status = 'composing';
store.select({ layers: [5, 4, 3, 0], cycleSeconds: 2 });
check('every other entry composing too: the store runs over its capacity rather than drop a compose in flight', store.size === 5);
for (const k of store.keys()) store.entry(k).state.status = 'idle';
store.select({ layers: [5, 4, 3, 0], cycleSeconds: 3 });
check('once they land, the next select trims it back to 4', store.size === 4 && store.has('5:4:3:0@3'));
check('the current entry is never the one evicted', store.has(store.key));

console.log('\n— lens and events');
events.length = 0;
check('setLens: composition, then row; a no-op is false; anything else throws', store.setLens('composition') && store.lens === 'composition' && !store.setLens('composition') && store.setLens('row') && (() => { try { store.setLens('wheel'); return false; } catch { return true; } })());
store.made(store.key, 'glyph');
store.notify(store.key);
check(`events: ${events.join(', ')}`, events.join() === `lens:${store.key},lens:${store.key},made:${store.key},change:${store.key}` && store.entry().madeBy === 'glyph');
off();
store.notify(store.key);
check('unsubscribed: no more events', events.length === 4);
check('keyOfState finds an entry\'s key from its state', store.keyOfState(store.state) === store.key && store.keyOfState({}) === null);

console.log('\n— through the tab controller (the window\'s editor of the store)');
{
  const host = { rhythm: { layers: [8, 7, 6, 5], cycleSeconds: 4 }, readRhythm: () => host.rhythm, stopMain() {}, onMainStarted() { return () => {}; } };
  let solves = 0, release = null, slow = false;
  const runCompose = (l, T, o) => { solves++; if (!slow) return Promise.resolve(compose(l, T, o)); return new Promise((r) => { release = () => r(compose(l, T, o)); }); };
  const tab = createTabController({ host, runCompose, createContext: () => ({}), timers });
  tab.syncRhythm();
  await tab.press();
  const first = tab.state;
  check('the window composes 8:7:6:5 into the store\'s entry, marked made by the window', tab.store.state === first && first.spec && tab.store.entry().madeBy === 'window' && solves === 1);
  tab.core.setPart('bass', { enabled: false });
  tab.core.setDrums({ mode: 'son' });
  tab.core.setLevel('lead', 0.4);
  host.rhythm = { layers: [41, 42, 43, 0], cycleSeconds: 6 };
  tab.syncRhythm();
  await tab.press();
  check('another rhythm: its own entry, composed', tab.state !== first && tab.state.spec.input.layers.join() === '41,42,43,0' && solves === 2);
  host.rhythm = { layers: [8, 7, 6, 5], cycleSeconds: 4 };
  tab.syncRhythm();
  check('back to 8:7:6:5: recalled, no re-solve — Perform, the same spec', tab.state === first && tab.button() === 'Perform' && solves === 2 && tab.store.recallable());
  check('… with the window\'s edits as they were left (bass off, son, lead at 0.4)', tab.state.parts.bass.enabled === false && tab.state.drums.mode === 'son' && tab.state.levels.lead === 0.4);

  // one compose in flight per entry
  slow = true;
  tab.core.setSeed(2);
  const p1 = tab.core.compose(), p2 = tab.core.compose();
  check('a second Compose of a composing entry joins the first (the same promise, one solve)', p1 === p2 && solves === 3 && tab.core.composing());
  host.rhythm = { layers: [19, 17, 16, 15], cycleSeconds: 6 };
  tab.syncRhythm();
  check('the page moves on mid-compose: the new rhythm\'s entry is current, idle', tab.state.input.layers.join() === '19,17,16,15' && tab.state.status === 'idle' && tab.button() === 'Compose');
  release(); await p1;
  const left = tab.store.entry('8:7:6:5@4').state;
  check('the compose lands in its own entry (seed 2), cached for when the page comes back', left.status === 'ready' && left.spec.input.seed === 2 && !left.dirty && tab.state.spec === null);
  // a change to a composing entry drops its answer (as before)
  const p3 = tab.core.compose();
  tab.core.setSeed(3);
  check('a change to the entry while it composes: back to Compose at once', tab.button() === 'Compose' && !tab.core.composing());
  release(); await p3;
  check('… and that answer is dropped when it comes', tab.state.spec === null && tab.state.status === 'idle');
  slow = false;
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
