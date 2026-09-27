// Behavioural guards for the VIEW section's state (view-options.js) and the on-screen chord name
// (chord-label.js). Both are pure; these assert on what they return, never on source text.
import { VIEW_OPTIONS, createViewOptions, constellationPatch, gravityHeld, gravityControlLabel } from '../view-options.js';
import { chordLabel, dominantFraction } from '../chord-label.js';
import { CHORDS } from '../sky-walk.js';
import { HARMONY_SOURCES } from '../harmony-policy.js';

let PASS = true;
const check = (label, ok, detail = '') => {
  if (!ok) PASS = false;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
console.log('═══ COSMOS VIEW OPTIONS + CHORD LABEL — assertions ═══');

const memoryStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

// ── view options ──
{
  const storage = memoryStorage();
  const view = createViewOptions({ storage });
  check('defaults: persist constellations, hold-G gravity, first person, full screen',
    view.get('constellations') === 'persist' && view.get('gravity') === 'hold' && view.get('camera') === 'first' && view.get('screen') === 'full');
  const seen = [];
  view.subscribe((name, value) => seen.push(`${name}=${value}`));
  view.set('gravity', 'always'); view.set('constellations', 'fade'); view.set('camera', 'chase'); view.set('screen', 'clean');
  view.set('gravity', 'always');        // same value → silent
  view.set('gravity', 'sometimes');     // illegal → ignored
  view.set('nonsense', 'off');          // unknown → ignored
  check('only real changes notify', seen.join(',') === 'gravity=always,constellations=fade,camera=chase,screen=clean', seen.join(','));
  const again = createViewOptions({ storage });
  check('taste persists across visits (constellations, gravity)', again.get('gravity') === 'always' && again.get('constellations') === 'fade');
  check('per-flight state does not (camera, screen)', again.get('camera') === 'first' && again.get('screen') === 'full');
  view.resetForEntry();
  check('entry reset returns camera + screen to defaults, keeps taste',
    view.get('camera') === 'first' && view.get('screen') === 'full' && view.get('gravity') === 'always');
  storage.setItem('lrc.cosmos.view.v1', JSON.stringify({ gravity: 'warp', constellations: 'off', camera: 'chase' }));
  const stale = createViewOptions({ storage });
  check('a stale/illegal stored value falls back; a transient never loads',
    stale.get('gravity') === 'hold' && stale.get('constellations') === 'off' && stale.get('camera') === 'first');
  storage.setItem('lrc.cosmos.view.v1', '{not json');
  check('corrupt storage → defaults, no throw', createViewOptions({ storage }).get('constellations') === 'persist');
  check('null storage works (no persistence)', createViewOptions({ storage: null }).set('gravity', 'off') === 'off');
  check('every option has a legal default', Object.entries(VIEW_OPTIONS).every(([, s]) => s.choices.some(([v]) => v === s.default)));
}
{
  const off = constellationPatch('off'), fade = constellationPatch('fade'), keep = constellationPatch('persist');
  check('constellations: OFF disables, FADE = lifespan, PERSIST = chord hold',
    !off.enabled && fade.enabled && fade.lifecycle === 'lifespan' && keep.enabled && keep.lifecycle === 'chord');
  check('gravity: OFF ignores G, HOLD needs G, ALWAYS needs nothing',
    !gravityHeld('off', true) && gravityHeld('hold', true) && !gravityHeld('hold', false) && gravityHeld('always', false));
  check('G row label follows the pill',
    gravityControlLabel('hold') === 'hold local gravity' && gravityControlLabel('always') === 'gravity always on' && gravityControlLabel('off') === 'gravity off');
}

// ── chord label ──
const chordOf = (rootSemitone, quality) => {
  const c = CHORDS.find(x => x.rootSemitone === rootSemitone && x.quality === quality);
  return { id: c.id, source: HARMONY_SOURCES.CHORD_WALK, symbol: c.symbol };
};
const slot = (fraction, dev = 0) => ({ fraction, cents: 0, dev });
{
  const on = (chord, fundamentalCents = 0) => chordLabel({ chord, modulationOn: true, fundamentalCents }).text;
  check('modulating: maj7 on degree 0 at fundamental 0 → A MAJ7', on(chordOf(0, 'major_7th')) === 'A MAJ7', on(chordOf(0, 'major_7th')));
  check('modulating: bare major triad is just its root', on(chordOf(3, 'major_triad')) === 'C');
  check('modulating: minor 7 on degree 9 → F♯ MIN7 (caps spell minor out)', on(chordOf(9, 'minor_7th')) === 'F♯ MIN7', on(chordOf(9, 'minor_7th')));
  check('modulating: accidentals typeset and survive the caps (7#5 → 7♯5, m7b5 → MIN7♭5, 7b9 → 7♭9)',
    on(chordOf(0, 'aug7')) === 'A 7♯5' && on(chordOf(2, 'half_dim7')) === 'B MIN7♭5' && on(chordOf(0, 'dom7_flat9')) === 'A 7♭9', `${on(chordOf(0, 'aug7'))} ${on(chordOf(2, 'half_dim7'))}`);
  check('modulating: the FUNDAMENTAL transpose moves the name (+300¢ → C)', on(chordOf(0, 'major_triad'), 300) === 'C');
  check('modulating: an off-grid fundamental names the nearest note and shows the cents',
    on(chordOf(0, 'major_7th'), 37) === 'A MAJ7 +37¢' && on(chordOf(0, 'major_7th'), -60) === 'A♭ MAJ7 +40¢', `${on(chordOf(0, 'major_7th'), 37)} / ${on(chordOf(0, 'major_7th'), -60)}`);
  check('modulating: a near-grid fundamental stays clean', on(chordOf(0, 'major_7th'), 2) === 'A MAJ7');
  check('compound qualities get a space and no camelCase (augMaj7, mMaj7, quartal, add9, 7sus4)',
    on(chordOf(0, 'aug_maj7')) === 'A AUG MAJ7' && on(chordOf(0, 'minor_major_7th')) === 'A MIN MAJ7' &&
    on(chordOf(0, 'quartal_triad')) === 'A QUARTAL' && on(chordOf(0, 'add9')) === 'A ADD9' && on(chordOf(0, 'dom7_sus4')) === 'A 7SUS4' &&
    on(chordOf(0, 'dim7')) === 'A DIM7' && on(chordOf(0, 'minor_triad')) === 'A MIN',
    ['aug_maj7', 'minor_major_7th', 'quartal_triad', 'add9', 'dom7_sus4', 'dim7', 'minor_triad'].map(q => on(chordOf(0, q))).join(' / '));
  check('every quality in the vocabulary renders caps-only (no stray lowercase)',
    CHORDS.every(c => !/[a-z]/.test(on({ id: c.id, source: HARMONY_SOURCES.CHORD_WALK }).split(' ').slice(1).join(' '))));
  const scale = chordLabel({ chord: { id: 'diatonic-major', source: HARMONY_SOURCES.SCALE, symbol: 'DIATONIC MAJOR' }, modulationOn: true });
  check('scale source: root + scale name', scale.text === 'A DIATONIC MAJOR', scale.text);
}
{
  const pools = [
    Object.assign(new Array(12).fill(null), { 5: slot('32/27', 4) }),
    Object.assign(new Array(12).fill(null), { 5: slot('32/27', -2) }),
    Object.assign(new Array(12).fill(null), { 5: slot('6/5', 12) }),
    Object.assign(new Array(12).fill(null), { 5: slot('13/11', 48) }),   // beyond the playable ceiling
  ];
  check('dominantFraction: most common playable ratio wins', dominantFraction(pools, 5) === '32/27');
  check('dominantFraction: ties go to the better-tuned ratio',
    dominantFraction([[slot('a', 10)], [slot('b', 3)]], 0) === 'b');
  check('dominantFraction: an unplayable-only degree → null', dominantFraction([pools[3]], 5) === null);
  const off = chordLabel({ chord: chordOf(5, 'aug7'), modulationOn: false, rootCents: 294, rootFraction: '32/27', pools });
  check('xenharmonic: ratio at the chord root + quality → "32/27 7♯5"', off.text === '32/27 7♯5', off.text);
  const triad = chordLabel({ chord: chordOf(0, 'major_triad'), modulationOn: false, rootFraction: '7/4', pools: [] });
  check('xenharmonic: degree-0 falls back to the solved root, and keeps MAJ so it reads as a chord',
    triad.text === '7/4 MAJ', triad.text);
  const bare = chordLabel({ chord: chordOf(4, 'minor_triad'), modulationOn: false, rootCents: 1000, pools: [] });
  check('xenharmonic: an uncovered root degree reports cents above 1/1 instead of inventing a ratio',
    bare.text === '200¢ MIN', bare.text);
  check('unknown chord → empty label, no throw', chordLabel({ chord: { id: 99999 }, modulationOn: true }).text === '');
}

console.log(PASS ? '\n✓ COSMOS VIEW OPTIONS OK' : '\n✗ COSMOS VIEW OPTIONS FAILED');
process.exitCode = PASS ? 0 : 1;
