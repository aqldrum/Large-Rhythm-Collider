import assert from 'node:assert/strict';
import test from 'node:test';

const pendingTimers = new Map();
let nextTimerId = 1;

globalThis.setTimeout = (callback, delay = 0) => {
    const id = nextTimerId++;
    pendingTimers.set(id, { callback, delay });
    return id;
};
globalThis.clearTimeout = (id) => pendingTimers.delete(id);
globalThis.window = {
    addEventListener() {},
    toneRowPlayback: {
        audioContext: null,
        layerStates: {
            a: { volume: 0 },
            b: { volume: 0 },
            c: { volume: 0 },
            d: { volume: 0 }
        }
    }
};
globalThis.localStorage = {
    getItem() { return null; },
    setItem() {}
};
Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { requestMIDIAccess() {} }
});

await import('./MIDIOut.js');
const MIDIOut = window.lrcMidiOut.constructor;

function makeMidi() {
    const messages = [];
    const midi = new MIDIOut();
    midi.enabled = true;
    midi.output = {
        name: 'Fake MIDI Port',
        send(bytes, timestamp) {
            messages.push({ bytes: [...bytes], timestamp });
        },
        clear() {}
    };
    return { midi, messages };
}

function messageType(message) {
    return message.bytes[0] & 0xF0;
}

test('queues note-off immediately on the Web MIDI timeline', () => {
    const { midi, messages } = makeMidi();
    const startTs = performance.now() + 100;

    midi._scheduleMpeNote({ frequency: 440, ratio: 1 }, 0.1, 0, startTs, false);

    const noteOn = messages.find(message => messageType(message) === 0x90);
    const noteOff = messages.find(message => messageType(message) === 0x80);
    assert.ok(noteOn);
    assert.ok(noteOff, 'off must be sent to Web MIDI before any cleanup timer runs');
    assert.equal(noteOn.timestamp, startTs);
    assert.equal(noteOff.timestamp, startTs + 90);
});

test('reuses channels by timestamp interval when cleanup timers are delayed', () => {
    const { midi, messages } = makeMidi();
    const startTs = performance.now() + 100;

    for (let i = 0; i < 40; i += 1) {
        midi._scheduleMpeNote({ frequency: 440, ratio: 1 }, 0.02, i % 4, startTs + (i * 20), false);
    }

    const noteOns = messages.filter(message => messageType(message) === 0x90);
    const noteOffs = messages.filter(message => messageType(message) === 0x80);
    assert.equal(noteOns.length, 40);
    assert.equal(noteOffs.length, 40);
    assert.ok(new Set(noteOns.map(message => message.bytes[0] & 0x0F)).size <= 15);
    assert.equal(midi.liveNotes.length, 40, 'the test intentionally leaves every cleanup timer pending');
});

test('accepts out-of-order non-overlapping reservations on the same channel and note', () => {
    const { midi, messages } = makeMidi();
    midi._mpeMemberPool = () => [1];
    const startTs = performance.now() + 100;

    midi._scheduleMpeNote({ frequency: 440, ratio: 1 }, 0.02, 0, startTs + 40, false);
    midi._scheduleMpeNote({ frequency: 440, ratio: 1 }, 0.02, 1, startTs, false);

    assert.equal(messages.filter(message => messageType(message) === 0x90).length, 2);
    assert.equal(messages.filter(message => messageType(message) === 0x80).length, 2);
});

test('voice stealing closes a future held note at the replacement boundary', () => {
    const { midi, messages } = makeMidi();
    const startTs = performance.now() + 100;

    for (let i = 0; i < 16; i += 1) {
        midi._scheduleMpeNote({ frequency: 440 + i, ratio: 1 }, 1, i, startTs, true);
    }

    const noteOns = messages.filter(message => messageType(message) === 0x90);
    const noteOffs = messages.filter(message => messageType(message) === 0x80);
    assert.equal(noteOns.length, 16);
    assert.equal(noteOffs.length, 1);
    assert.equal(noteOffs[0].timestamp, startTs, 'the stolen off must not precede its queued on');
    assert.ok(messages.indexOf(noteOffs[0]) > messages.indexOf(noteOns[0]));
    assert.ok(messages.indexOf(noteOffs[0]) < messages.indexOf(noteOns[15]));
});

test('drops excess overlapping finite notes rather than orphaning a queued note-on', () => {
    const { midi, messages } = makeMidi();
    const startTs = performance.now() + 100;
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        for (let i = 0; i < 16; i += 1) {
            midi._scheduleMpeNote({ frequency: 440 + i, ratio: 1 }, 1, i, startTs, false);
        }
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(messages.filter(message => messageType(message) === 0x90).length, 15);
    assert.equal(messages.filter(message => messageType(message) === 0x80).length, 15);
    assert.ok(messages.filter(message => messageType(message) === 0x80)
        .every(message => message.timestamp > startTs));
});
