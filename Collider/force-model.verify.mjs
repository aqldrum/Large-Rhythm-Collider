// force-model.verify.mjs — equivalence gate for the compact vector-force progression.
//
// Proves the REAL ColliderPlayer force sampler (forceAt) and schedule are bit-identical
// to the original materialized formulas, that pulses are labelled by real layer
// membership, and that the wiring around them agrees: materialized vs
// derive-on-demand reads, and seeking (net drift aimed at the nearest enemy).
//
// Run:  node "Collider/force-model.verify.mjs"
//
// ColliderPlayer.js and CollisionDetector.js are browser scripts (no exports), so
// they are loaded into a vm context and their classes are exercised directly. legacyForces() below is the one
// independent oracle: copied verbatim from the pre-refactor calculateLayerForces loop.

import fs from 'fs';
import vm from 'vm';

// ---------- Load the real ColliderPlayer + CollisionDetector ----------
const source = ['ColliderPlayer.js', 'CollisionDetector.js']
    .map(file => fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).join('\n');
const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Date, Math });
vm.runInContext(`${source}\n;globalThis.ColliderPlayer = ColliderPlayer; globalThis.CollisionDetector = CollisionDetector;`, context);
const { ColliderPlayer, CollisionDetector } = context;

function makePlayer(spacesPlot, amplitude = 1, pulseLayers = null) {
    const player = new ColliderPlayer(1, 0, 0, '#fff');
    player.spacesPlot = spacesPlot;
    player.pulseLayers = pulseLayers;
    player.forceAmplitude = amplitude;
    return player;
}

function randLabels(n) {
    return Array.from({ length: n }, () => Math.floor(Math.random() * 4));
}

// ---------- ORACLE: verbatim from original calculateLayerForces() ----------
function legacyForces(spacesPlot, angleToCenter, forceAmplitude, labels = null) {
    const layerDirections = {
        A: angleToCenter,                    // toward center
        B: angleToCenter + Math.PI / 2,
        C: angleToCenter + Math.PI,
        D: angleToCenter + 3 * Math.PI / 2,
    };
    const out = [];
    for (let i = 0; i < spacesPlot.length; i++) {
        const spaceValue = spacesPlot[i];
        const primaryLayer = ['A', 'B', 'C', 'D'][labels ? labels[i] : i % 4];
        const direction = layerDirections[primaryLayer];
        let baseMagnitude = spaceValue * 0.15;
        if (primaryLayer === 'A') baseMagnitude *= 2.0;
        const forceX = Math.cos(direction) * baseMagnitude * forceAmplitude;
        const forceY = Math.sin(direction) * baseMagnitude * forceAmplitude;
        out.push({
            x: forceX, y: forceY,
            magnitude: Math.sqrt(forceX * forceX + forceY * forceY),
            layer: primaryLayer, direction,
        });
    }
    return out;
}

// Object.is comparison => distinguishes +0 from -0 and catches NaN. Strictest possible.
function sameForce(a, b) {
    return !!a && !!b &&
           Object.is(a.x, b.x) && Object.is(a.y, b.y) &&
           Object.is(a.magnitude, b.magnitude) && Object.is(a.direction, b.direction) &&
           a.layer === b.layer;
}

function randSpaces(n) {
    const s = new Array(n);
    for (let i = 0; i < n; i++) {
        const r = Math.random();
        // mix of small ints (real rhythms), zeros (edge), and floats
        s[i] = r < 0.15 ? 0 : r < 0.85 ? (1 + Math.floor(Math.random() * 64)) : Math.random() * 100;
    }
    return s;
}

// Reference true-onset index: largest k with onsets[k] <= phase (binary search)
function trueOnsetIndex(onsets, phase) {
    let lo = 0, hi = onsets.length - 1, k = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (onsets[m] <= phase) { k = m; lo = m + 1; } else hi = m - 1; }
    return Math.min(k, onsets.length - 2);
}

function report(title, checks, mismatches, firstFails, passText) {
    console.log(`\n${title}`);
    console.log(`    comparisons : ${checks.toLocaleString()}`);
    console.log(`    mismatches  : ${mismatches}`);
    if (mismatches) console.log(`    FIRST FAILURES:`, firstFails);
    console.log(`    => ${mismatches === 0 ? `PASS ✅  ${passText}` : 'FAIL ❌'}`);
    return mismatches === 0;
}

// ================= PART 1: real forceAt vs legacy formula =================
function partBitIdentity() {
    let checks = 0, mismatches = 0;
    const firstFails = [];
    const check = (sp, ang, amp) => {
        // Unlabelled (original i % 4 encoding), then with real-membership labels
        for (const labels of [null, randLabels(sp.length)]) {
            const player = makePlayer(sp, 1, labels);
            const legacy = legacyForces(sp, ang, amp, labels);
            for (let i = 0; i < sp.length; i++) {
                checks++;
                if (!sameForce(player.forceAt(i, ang, amp), legacy[i])) {
                    mismatches++;
                    if (firstFails.length < 5) firstFails.push({ n: sp.length, i, ang, amp, labelled: !!labels });
                }
            }
        }
    };

    // Hand-picked edge cases: ±0 angle, axis-aligned angles (cos/sin hit ±0),
    // amplitude 0, spaceValue 0, and the layer offsets themselves.
    const edgeAngles = [0, -0, Math.PI / 2, Math.PI, 3 * Math.PI / 2, -Math.PI, 1e-300, -1e-300];
    const edgeAmps = [0, -0, 1, 2.5];
    const edgeSpaces = [[0, 0, 0, 0], [1, 2, 3, 4], [7, 11, 13, 17, 19, 23], [0, 5, 0, 5, 0, 5, 0]];
    for (const sp of edgeSpaces) for (const ang of edgeAngles) for (const amp of edgeAmps) check(sp, ang, amp);

    // Randomized bulk, including LARGE rhythms.
    for (const n of [1, 2, 3, 12, 37, 149, 512, 2120, 4000]) {
        for (let t = 0; t < 400; t++) {
            let ang = (Math.random() * 4 - 2) * Math.PI;
            if (t % 50 === 0) ang = -0;                 // sprinkle in -0
            const amp = t % 37 === 0 ? 0 : Math.random() * 3;
            check(randSpaces(n), ang, amp);
        }
    }

    return report('[1] Real ColliderPlayer.forceAt vs legacy formula', checks, mismatches, firstFails,
        'sampler is byte-for-byte the legacy array');
}

// ============ PART 2: real schedule (cycleTotal + true-onset cursor) ============
function partSchedule() {
    let checks = 0, mismatches = 0;
    const firstFails = [];
    for (const n of [1, 5, 12, 149, 2120]) {
        for (let t = 0; t < 60; t++) {
            const sp = randSpaces(n);
            if (sp.every(v => v === 0)) sp[0] = 1;      // a cycle needs nonzero length
            const player = makePlayer(sp);
            player.rebuildSchedule();

            // cycleTotal is bit-identical to the reduce() it replaced
            checks++;
            if (!Object.is(player.cycleTotal, sp.reduce((s, v) => s + v, 0))) {
                mismatches++;
                if (firstFails.length < 5) firstFails.push({ n, kind: 'cycleTotal' });
            }

            // Monotonic sweep over three cycles (exercises the wrap reset), then random
            // phases (exercises non-monotonic restarts).
            const total = player.cycleTotal;
            const phases = [];
            for (let s = 0; s < 3 * 200; s++) phases.push(((s / 200) * total) % total);
            for (let s = 0; s < 200; s++) phases.push(Math.random() * total);
            for (const phase of phases) {
                checks++;
                const got = player.indexForPhaseTrueOnset(phase);
                const want = trueOnsetIndex(player.onsets, phase);
                if (got !== want) {
                    mismatches++;
                    if (firstFails.length < 5) firstFails.push({ n, phase, got, want });
                }
            }
        }
    }
    return report('[2] Real schedule — cycleTotal vs reduce(), cursor vs binary search', checks, mismatches, firstFails,
        'cached total and O(1) cursor match the reference');
}

// ============ PART 3: real layer membership labels ============
// Oracle: build each layer's beat grid directly, merge into the composite, and
// label every onset with the first layer (A–D) whose beat lands on it.
function membershipOracle(rhythms) {
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const grid = rhythms.filter(L => L > 0).reduce((a, b) => a * b / gcd(a, b), 1);
    const beats = rhythms.map(L => {
        const set = new Set();
        if (L > 0) for (let k = 0; k < L; k++) set.add(k * grid / L);
        return set;
    });
    const onsets = [...new Set(beats.flatMap(set => [...set]))].sort((a, b) => a - b);
    const spacesPlot = onsets.map((onset, k) => (onsets[k + 1] ?? grid) - onset);
    const labels = onsets.map(onset => beats.findIndex(set => set.has(onset)));
    return { spacesPlot, labels };
}

function partMembership() {
    let checks = 0, mismatches = 0;
    const firstFails = [];
    const check = (rhythms, expected = null) => {
        const oracle = membershipOracle(rhythms);
        const player = makePlayer(oracle.spacesPlot);
        player.rhythms = rhythms;
        const got = player.computePulseLayers();
        const want = expected || oracle.labels;
        checks++;
        if (got.length !== want.length || got.some((label, k) => label !== want[k])) {
            mismatches++;
            if (firstFails.length < 5) firstFails.push({ rhythms, got: got.join(''), want: want.join('') });
        }
    };

    // Worked example, A=4 B=3: onsets 0,3,4,6,8,9 → A,A,B,A,B,A (shared downbeat counts as A)
    check([4, 3, 0, 0], [0, 0, 1, 0, 1, 0]);
    // Layer A off, B=3 C=4: onsets 0,3,4,6,8,9 → B,C,B,C,B,C (the shared downbeat falls to B)
    check([0, 3, 4, 0], [1, 2, 1, 2, 1, 2]);
    for (let t = 0; t < 3000; t++) {
        const rhythms = Array.from({ length: 4 }, () => Math.random() < 0.15 ? 0 : 1 + Math.floor(Math.random() * 13));
        if (rhythms.every(L => L === 0)) rhythms[0] = 1;
        check(rhythms);
    }
    return report('[3] Real layer membership — computePulseLayers vs beat-grid oracle', checks, mismatches, firstFails,
        'every onset carries the first layer whose beat lands on it');
}

// ============ PART 4: wiring — materialized vs derived reads, seeking ============
function makeBattle(boundaryMode, players) {
    const collisionDetector = new CollisionDetector();
    collisionDetector.arena = { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000, boundaryMode };
    const controller = { players, collisionDetector, battleCenter: { x: 500, y: 500 } };
    for (const player of players) player.parent = { battleController: controller };
    return controller;
}

function placeAt(player, x, y, alive = true) {
    player.nodes = [{ x, y }];
    player.isAlive = alive;
    return player;
}

// Angle of the share-weighted sum of one cycle of oracle forces at the player's heading
function oracleDriftAngle(player, sp, amp, labels) {
    const forces = legacyForces(sp, player.computeForceAngle(), amp, labels);
    const total = sp.reduce((s, v) => s + v, 0);
    let x = 0, y = 0;
    forces.forEach((f, i) => {
        const share = player.trueOnsetTiming ? sp[i] / total : 1 / sp.length;
        x += f.x * share;
        y += f.y * share;
    });
    return Math.atan2(y, x);
}

const angleGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function partWiring() {
    let checks = 0, mismatches = 0;
    const firstFails = [];
    const fail = (info) => { mismatches++; if (firstFails.length < 5) firstFails.push(info); };

    for (const n of [3, 12, 149]) {
        for (let t = 0; t < 50; t++) {
            const sp = randSpaces(n).map(v => v || 1);   // a zero-length plot has no drift
            const labels = randLabels(n);
            const amp = 0.1 + Math.random() * 3;

            for (const trueOnsetTiming of [false, true]) {
                // Me, a near enemy, a farther enemy, and a dead one closest of all
                const me = placeAt(makePlayer(sp, amp, labels), 200 + Math.random() * 100, 200 + Math.random() * 100);
                const near = placeAt(makePlayer([1, 1, 1]), 400 + Math.random() * 200, 300 + Math.random() * 200);
                const far = placeAt(makePlayer([1, 1, 1]), 900, 900);
                const dead = placeAt(makePlayer([1, 1, 1]), me.nodes[0].x + 5, me.nodes[0].y + 5, false);
                me.playerId = 1; near.playerId = 2; far.playerId = 3; dead.playerId = 4;
                makeBattle('bounce', [me, near, far, dead]);
                me.trueOnsetTiming = trueOnsetTiming;

                // Seeking: the cycle's net drift points straight at the nearest living enemy
                const toNear = Math.atan2(near.nodes[0].y - me.nodes[0].y, near.nodes[0].x - me.nodes[0].x);
                checks += 2;
                if (angleGap(oracleDriftAngle(me, sp, amp, labels), toNear) > 1e-9) fail({ n, trueOnsetTiming, kind: 'drift misses target' });
                if (me.targetPlayerId !== 2) fail({ n, trueOnsetTiming, kind: `targeted P${me.targetPlayerId}` });

                // Materialized and derived reads agree with the oracle at that heading
                const legacy = legacyForces(sp, me.computeForceAngle(), amp, labels);
                me.deriveForcesOnDemand = false;
                me.calculateLayerForces();
                checks++;
                if (me.getForceCount() !== n || me.nodeForces.length !== n) fail({ n, kind: 'count' });
                for (let i = 0; i < n; i++) {
                    me.deriveForcesOnDemand = false;
                    const materialized = me.getNodeForce(i);
                    me.deriveForcesOnDemand = true;
                    const derived = me.getNodeForce(i);
                    checks += 2;
                    if (!sameForce(materialized, legacy[i])) fail({ n, i, kind: 'materialized' });
                    if (!sameForce(derived, legacy[i])) fail({ n, i, kind: 'derived' });
                }
            }
        }
    }

    // Wrapping arena: an enemy across the left edge is nearer than one mid-arena,
    // and the drift aims through the edge (−x), not across the map (+x)
    for (const [mode, wantTarget, wantAngle] of [['wrap', 3, Math.PI], ['bounce', 2, 0]]) {
        const sp = [3, 1, 2, 2, 1, 3], labels = [0, 0, 1, 0, 1, 0];
        const me = placeAt(makePlayer(sp, 1, labels), 50, 500);
        const mid = placeAt(makePlayer([1, 1, 1]), 500, 500);
        const across = placeAt(makePlayer([1, 1, 1]), 950, 500);
        me.playerId = 1; mid.playerId = 2; across.playerId = 3;
        makeBattle(mode, [me, mid, across]);
        checks += 2;
        if (angleGap(oracleDriftAngle(me, sp, 1, labels), wantAngle) > 1e-9) fail({ mode, kind: 'edge drift' });
        if (me.targetPlayerId !== wantTarget) fail({ mode, kind: `edge targeted P${me.targetPlayerId}` });
    }

    return report('[4] Wiring — seeking aims net drift at nearest enemy; both read paths agree', checks, mismatches, firstFails,
        'drift hits the target (both timings, through wrap edges); reads match the oracle');
}

// ============ PART 5: quantify trueOnsetTiming behavior change ============
function partTimingDelta() {
    console.log(`\n[5] trueOnsetTiming behavior change — uniform mapping vs true-onset timing`);
    console.log(`    (fraction of the cycle where the ACTIVE pulse index differs)`);
    const examples = [
        { label: 'even 4:4',     sp: [1, 1, 1, 1] },
        { label: 'prime 5:7:11', sp: [7, 4, 3, 5, 2, 6, 8, 1, 9, 3, 5] },
        { label: 'lopsided',     sp: [1, 1, 1, 40] },
        { label: 'random-32',    sp: randSpaces(32) },
    ];
    for (const ex of examples) {
        const player = makePlayer(ex.sp);
        player.rebuildSchedule();
        const n = ex.sp.length, total = player.cycleTotal;
        const M = 20000; let diff = 0;
        for (let s = 0; s < M; s++) {
            const phase = (s / M) * total;
            const uniform = Math.floor((phase / total) * n) % n;
            if (uniform !== player.indexForPhaseTrueOnset(phase)) diff++;
        }
        console.log(`    ${ex.label.padEnd(12)} differs ${(100 * diff / M).toFixed(1)}% of the cycle`);
    }
    console.log(`    => informational: 0% means the groove was already uniform; >0% is what true-onset restores`);
}

// ============ PART 6: cost — materialize N vs derive active ============
function partCost() {
    console.log(`\n[6] Per-frame cost — materialize whole array vs derive active pulse only`);
    for (const n of [149, 2120]) {
        const player = makePlayer(randSpaces(n));
        const FRAMES = 20000;
        let sink = 0;

        const t0 = process.hrtime.bigint();
        for (let f = 0; f < FRAMES; f++) {
            const arr = [];                                   // legacy: rebuild all N every frame
            for (let i = 0; i < n; i++) arr.push(player.forceAt(i, f * 1e-4, 1));
            sink += arr[f % n].x;
        }
        const t1 = process.hrtime.bigint();
        for (let f = 0; f < FRAMES; f++) {
            sink += player.forceAt(f % n, f * 1e-4, 1).x;     // derive: only the active pulse
        }
        const t2 = process.hrtime.bigint();

        const matMs = Number(t1 - t0) / 1e6, derMs = Number(t2 - t1) / 1e6;
        console.log(`    N=${String(n).padStart(4)}: materialize ${matMs.toFixed(1)}ms  |  derive-active ${derMs.toFixed(1)}ms  ` +
                    `=> ${(matMs / derMs).toFixed(1)}× cheaper  (sink=${sink.toFixed(3)})`);
    }
}

console.log('==================================================================');
console.log(' Collider vector-force progression — equivalence gate (real ColliderPlayer)');
console.log('==================================================================');
const p1 = partBitIdentity();
const p2 = partSchedule();
const p3 = partMembership();
const p4 = partWiring();
partTimingDelta();
partCost();
const ok = p1 && p2 && p3 && p4;
console.log(`\n${ok ? '✅ ALL EQUIVALENCE CHECKS PASS' : '❌ EQUIVALENCE BROKEN'}\n`);
process.exit(ok ? 0 : 1);
