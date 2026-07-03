// MIDIOut.js - Streams scheduled tone-row notes + partition hits out of the browser over
// the Web MIDI API, in exact just-intonation tuning (nearest MIDI note + per-channel pitch
// bend), with live fundamental retunes mirrored as real-time bend. See Playback/MIDIOUT_SPEC.md.
//
// Singleton window.lrcMidiOut, constructed at script load. Off by default; no engine
// behavior changes unless the user enables it from the UI panel.

class MIDIOut {
    constructor() {
        this.supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
        this.midiAccess = null;
        this.output = null;
        this.enabled = false;

        this.mode = 'mpe';                   // 'layers' | 'mpe'
        this.bendRangeSemitones = 48;
        this.velocity = 100;
        this.sendPartitionsAsDrums = false;
        this.midiLocalMute = false;          // session-only, never persisted - see _loadSettings/_saveSettings
        this.preferredDeviceId = null;
        this._wasEnabled = false;

        this.liveNotes = [];                 // { chIdx, note, ratio, layerIndex, onTs, offTs, timer, kind, __off }
        this.partitionChannels = [9, 10, 11, 12]; // ch 10-13, one per Partitions layer (A-D) - keeps drum
                                              // hits off any channel tone-row notes might land on
        this.MAX_REGISTRY = 128;
        this.mpeNextMember = 0;              // round-robin cursor, index into the member pool
        this.retuneRamps = new Map();         // chIdx -> setInterval id
        this._lastSentBend = new Map();       // chIdx -> last bend value (0-16383), ramp start point

        this._loadSettings();
        this._bindEngineEvents();
    }

    // ====================================
    // PERSISTENCE
    // ====================================

    _loadSettings() {
        try {
            const raw = localStorage.getItem('lrcMidiOut.v1');
            if (!raw) return;
            const saved = JSON.parse(raw);
            if (saved.mode === 'layers' || saved.mode === 'mpe') this.mode = saved.mode;
            if (Number.isFinite(saved.bendRangeSemitones)) this.bendRangeSemitones = saved.bendRangeSemitones;
            if (Number.isFinite(saved.velocity)) this.velocity = saved.velocity;
            if (typeof saved.sendPartitionsAsDrums === 'boolean') this.sendPartitionsAsDrums = saved.sendPartitionsAsDrums;
            // midiLocalMute is deliberately NOT restored here: combined with auto-reconnect, a
            // restored mute would silently re-silence the browser's own synth on every reload
            // whenever a device happens to reconnect. It only takes effect within the session
            // it was checked in - see _saveSettings, which likewise never writes it back out.
            if (typeof saved.preferredDeviceId === 'string') this.preferredDeviceId = saved.preferredDeviceId;
            this._wasEnabled = !!saved.enabled;
        } catch (err) {
            console.warn('[MIDIOut] Failed to load settings', err);
        }
    }

    // `enabled` is only ever authoritative from enable()/disable() (pass { enabled }) - every other
    // settings change leaves it alone. Without this, toggling an unrelated checkbox while an async
    // auto-reconnect is still in flight could persist a stale `false` and overwrite a good `true`,
    // silently breaking auto-reconnect until the user manually re-enables.
    _saveSettings(overrides = {}) {
        try {
            let persistedEnabled = false;
            try {
                const raw = localStorage.getItem('lrcMidiOut.v1');
                if (raw) persistedEnabled = !!JSON.parse(raw).enabled;
            } catch (_) {
                // missing/corrupt entry - fall back to false
            }

            localStorage.setItem('lrcMidiOut.v1', JSON.stringify({
                enabled: 'enabled' in overrides ? overrides.enabled : persistedEnabled,
                mode: this.mode,
                bendRangeSemitones: this.bendRangeSemitones,
                velocity: this.velocity,
                sendPartitionsAsDrums: this.sendPartitionsAsDrums,
                // midiLocalMute intentionally omitted - session-only, see _loadSettings.
                preferredDeviceId: this.preferredDeviceId
            }));
        } catch (err) {
            console.warn('[MIDIOut] Failed to save settings', err);
        }
    }

    // ====================================
    // ENGINE EVENTS (no engine edit needed for stop)
    // ====================================

    _bindEngineEvents() {
        window.addEventListener('playbackStopped', () => this.allNotesOff());
    }

    // ====================================
    // DEVICE / ACCESS MANAGEMENT
    // ====================================

    async enable() {
        if (!this.supported) return false;
        try {
            this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        } catch (err) {
            console.warn('[MIDIOut] MIDI access request failed', err);
            return false;
        }
        this.midiAccess.onstatechange = () => this._onStateChange();
        this._selectOutput(this.preferredDeviceId);
        this.enabled = true;
        this._applyRpnForMode();
        this._applyLocalMute();
        this._saveSettings({ enabled: true });
        this._updateStatusLine();
        console.log('🎹 MIDI Out enabled');
        return true;
    }

    disable() {
        this.allNotesOff();
        this.enabled = false;
        this.output = null;
        this._applyLocalMute();
        this._saveSettings({ enabled: false });
        this._updateStatusLine();
        console.log('🎹 MIDI Out disabled');
    }

    _selectOutput(preferredId) {
        if (!this.midiAccess) return;
        const outputs = Array.from(this.midiAccess.outputs.values());
        let target = preferredId ? outputs.find(o => o.id === preferredId) : null;
        if (!target) target = outputs[0] || null;
        this.output = target || null;
        this.preferredDeviceId = target ? target.id : null;
    }

    _onStateChange() {
        this._populateDeviceSelect();
        if (this.output && this.midiAccess && !this.midiAccess.outputs.has(this.output.id)) {
            this.allNotesOff();
            this._selectOutput(null);
            this._applyRpnForMode();
            this._applyLocalMute();
        }
        this._updateStatusLine();
    }

    _onDeviceChange(deviceId) {
        this.allNotesOff();
        this._selectOutput(deviceId);
        this._applyRpnForMode();
        this._applyLocalMute();
        this._saveSettings();
        this._updateStatusLine();
    }

    _onModeChange(newMode) {
        this.allNotesOff();
        this.mode = newMode;
        this.mpeNextMember = 0;
        this._applyRpnForMode();
        this._saveSettings();
    }

    _onBendRangeChange(newRange) {
        const clamped = Math.max(1, Math.min(96, Math.round(newRange)));
        this.bendRangeSemitones = Number.isFinite(clamped) ? clamped : this.bendRangeSemitones;
        this._applyRpnForMode();
        this._saveSettings();
    }

    async _maybeAutoReconnect() {
        if (!this._wasEnabled || !this.supported) {
            console.log(`🎹 [MIDIOut] auto-reconnect skipped (wasEnabled=${this._wasEnabled}, supported=${this.supported})`);
            return;
        }
        try {
            if (!navigator.permissions?.query) {
                console.log('🎹 [MIDIOut] auto-reconnect skipped (Permissions API unavailable for "midi")');
                return;
            }
            const status = await navigator.permissions.query({ name: 'midi' });
            if (status.state !== 'granted') {
                console.log(`🎹 [MIDIOut] auto-reconnect skipped (permission state="${status.state}", not "granted")`);
                return;
            }
            const ok = await this.enable();
            console.log(`🎹 [MIDIOut] auto-reconnect ${ok ? 'succeeded' : 'FAILED (requestMIDIAccess rejected)'}`);
            if (ok) {
                this._populateDeviceSelect();
                const btn = document.getElementById('midi-enable-toggle');
                if (btn) {
                    btn.textContent = 'Disable MIDI Out';
                    btn.classList.add('active');
                }
            }
        } catch (err) {
            console.log('🎹 [MIDIOut] auto-reconnect skipped (permissions query threw, e.g. Firefox lacks "midi")', err);
        }
    }

    // ====================================
    // TIMING (audio clock -> Web MIDI clock)
    // ====================================

    audioTimeToMidiTs(audioTime) {
        const ctx = window.toneRowPlayback?.audioContext;
        if (!ctx || !Number.isFinite(audioTime)) return performance.now();
        let perfRef = performance.now(), ctxRef = ctx.currentTime;
        const ots = ctx.getOutputTimestamp?.();
        if (ots && Number.isFinite(ots.contextTime) && Number.isFinite(ots.performanceTime)) {
            perfRef = ots.performanceTime; ctxRef = ots.contextTime;
        }
        return perfRef + (audioTime - ctxRef) * 1000;
    }

    // ====================================
    // TUNING MATH
    // ====================================

    freqToMidiFloat(freq) { return 69 + 12 * Math.log2(freq / 440); }

    noteAndBend(freq) {
        const m = this.freqToMidiFloat(freq);
        const note = Math.min(127, Math.max(0, Math.round(m)));
        return { note, bend: this.bendFromSemitones(m - note) };
    }

    bendFromSemitones(semitones) {
        const range = Math.max(1, this.bendRangeSemitones);
        return Math.min(16383, Math.max(0, Math.round(8192 + (semitones / range) * 8192)));
    }

    // ====================================
    // RAW SEND
    // ====================================

    _send(bytes, ts) {
        if (!this.output) return;
        try { this.output.send(bytes, ts); } catch (err) { console.warn('[MIDIOut] send failed', err); }
    }

    _sendBend(chIdx, bend, ts) {
        this._send([0xE0 | chIdx, bend & 0x7F, (bend >> 7) & 0x7F], ts);
        this._lastSentBend.set(chIdx, bend);
    }

    _sendNoteOn(chIdx, note, ts, velocity = this.velocity) {
        this._send([0x90 | chIdx, note, velocity], ts);
    }

    _sendNoteOff(chIdx, note, ts) {
        this._send([0x80 | chIdx, note, 0], ts);
    }

    _sendBendRangeRPN(chIdx, range = this.bendRangeSemitones) {
        const ts = performance.now();
        const value = Math.max(0, Math.min(127, Math.round(range)));
        this._send([0xB0 | chIdx, 101, 0], ts);
        this._send([0xB0 | chIdx, 100, 0], ts);
        this._send([0xB0 | chIdx, 6, value], ts);
        this._send([0xB0 | chIdx, 38, 0], ts);
        this._send([0xB0 | chIdx, 101, 127], ts);
        this._send([0xB0 | chIdx, 100, 127], ts);
    }

    _sendMpeMcm(memberCount = 15) {
        const ts = performance.now();
        this._send([0xB0, 101, 0], ts);
        this._send([0xB0, 100, 6], ts);
        this._send([0xB0, 6, memberCount], ts);
    }

    _applyRpnForMode() {
        if (!this.enabled || !this.output) return;
        if (this.mode === 'layers') {
            for (let chIdx = 0; chIdx <= 3; chIdx += 1) this._sendBendRangeRPN(chIdx);
        } else {
            this._sendMpeMcm(15);
            this._mpeMemberPool().forEach(chIdx => this._sendBendRangeRPN(chIdx));
        }
    }

    // ====================================
    // LIVE-NOTE REGISTRY
    // ====================================

    _registerLiveNote(entry) {
        this.liveNotes.push(entry);
        if (this.liveNotes.length > this.MAX_REGISTRY) {
            const evicted = this.liveNotes.shift();
            if (evicted?.timer) clearTimeout(evicted.timer);
            if (evicted && !evicted.__off) this._sendNoteOff(evicted.chIdx, evicted.note, performance.now());
        }
    }

    _pruneEntry(entry) {
        const idx = this.liveNotes.indexOf(entry);
        if (idx > -1) this.liveNotes.splice(idx, 1);
    }

    _latestLiveEntry(chIdx) {
        let latest = null;
        for (const entry of this.liveNotes) {
            if (entry.chIdx === chIdx && !entry.__off) {
                if (!latest || entry.onTs > latest.onTs) latest = entry;
            }
        }
        return latest;
    }

    _latestLiveEntryForLayer(layerIndex, excludeChIdx) {
        let latest = null;
        for (const entry of this.liveNotes) {
            if (entry.layerIndex === layerIndex && entry.chIdx !== excludeChIdx && entry.kind === 'tone' && !entry.__off) {
                if (!latest || entry.onTs > latest.onTs) latest = entry;
            }
        }
        return latest;
    }

    // Same channel + same note number pending off -> flush it now so it can never land on/after
    // the note-on we're about to send (would otherwise cut the new note short or leave it hanging).
    _flushGuard(chIdx, note, ts) {
        const now = performance.now();
        this.liveNotes.forEach(entry => {
            if (entry.chIdx === chIdx && entry.note === note && !entry.__off && entry.offTs != null && entry.offTs > now) {
                if (entry.timer) clearTimeout(entry.timer);
                this._sendNoteOff(chIdx, note, ts);
                entry.__off = true;
                this._pruneEntry(entry);
            }
        });
    }

    // Actual delivery is deferred to a cancellable JS timer (not a pre-queued future output.send)
    // so the flush guard / panic can genuinely cancel it - Web MIDI has no per-message cancel.
    _scheduleNoteOff(entry, offTsMs) {
        entry.offTs = offTsMs;
        const delay = Math.max(0, offTsMs - performance.now());
        entry.timer = setTimeout(() => {
            this._sendNoteOff(entry.chIdx, entry.note, performance.now());
            entry.__off = true;
            entry.timer = setTimeout(() => this._pruneEntry(entry), 60);
        }, delay);
    }

    // ====================================
    // RETUNE RAMPS
    // ====================================

    _cancelRetuneRamp(chIdx) {
        const timer = this.retuneRamps.get(chIdx);
        if (timer) {
            clearInterval(timer);
            this.retuneRamps.delete(chIdx);
        }
    }

    _rampBend(chIdx, targetBend, glideSec) {
        const stepMs = 30;
        const steps = Math.max(1, Math.round((glideSec * 1000) / stepMs));
        const startBend = this._lastSentBend.get(chIdx) ?? 8192;
        let step = 0;
        const timer = setInterval(() => {
            step += 1;
            const t = Math.min(1, step / steps);
            const bend = Math.round(startBend + (targetBend - startBend) * t);
            this._sendBend(chIdx, bend, performance.now());
            if (t >= 1) {
                clearInterval(timer);
                this.retuneRamps.delete(chIdx);
            }
        }, stepMs);
        this.retuneRamps.set(chIdx, timer);
    }

    // ====================================
    // MPE CHANNEL ALLOCATION
    // ====================================

    _mpeMemberPool() {
        const pool = [];
        for (let chIdx = 1; chIdx <= 15; chIdx += 1) {
            if (this.sendPartitionsAsDrums && this.partitionChannels.includes(chIdx)) continue;
            pool.push(chIdx);
        }
        return pool;
    }

    _allocateMpeChannel() {
        const pool = this._mpeMemberPool();
        const busy = new Set(this.liveNotes.filter(e => e.kind === 'tone' && !e.__off).map(e => e.chIdx));

        for (let i = 0; i < pool.length; i += 1) {
            const idx = (this.mpeNextMember + i) % pool.length;
            if (!busy.has(pool[idx])) {
                this.mpeNextMember = (idx + 1) % pool.length;
                return pool[idx];
            }
        }

        // All members busy: steal round-robin. Terminate the stolen note first so it never hangs.
        const stealIdx = this.mpeNextMember % pool.length;
        const chIdx = pool[stealIdx];
        this.mpeNextMember = (stealIdx + 1) % pool.length;
        const stolen = this._latestLiveEntry(chIdx);
        if (stolen) {
            if (stolen.timer) clearTimeout(stolen.timer);
            this._sendNoteOff(chIdx, stolen.note, performance.now());
            stolen.__off = true;
            this._pruneEntry(stolen);
        }
        return chIdx;
    }

    // ====================================
    // NOTE SCHEDULING (hook: ToneRowPlayback.playNoteAtTime)
    // ====================================

    scheduleNote(noteData, duration, layerIndex, startTime, legatoEnabled) {
        if (!this.enabled || !this.output) return;
        const freq = noteData?.frequency;
        if (!Number.isFinite(freq) || freq <= 0) return;

        const ts = Math.max(performance.now(), this.audioTimeToMidiTs(startTime));

        if (this.mode === 'layers') {
            this._scheduleLayersNote(noteData, duration, layerIndex, ts, legatoEnabled);
        } else {
            this._scheduleMpeNote(noteData, duration, layerIndex, ts, legatoEnabled);
        }
    }

    // Layer volume (dB, -40..0 from the main page slider) scales down from the configured
    // Velocity ceiling so turning a layer down on the LRC side hits softer in the DAW too.
    // Floor is 1, never 0 - a note-on with velocity 0 is conventionally read as a note-off.
    _layerVelocity(layerIndex) {
        const layerKey = ['a', 'b', 'c', 'd'][layerIndex];
        const dbValue = window.toneRowPlayback?.layerStates?.[layerKey]?.volume;
        if (!Number.isFinite(dbValue)) return this.velocity;
        const t = Math.max(0, Math.min(1, (dbValue + 40) / 40));
        return Math.max(1, Math.min(127, Math.round(1 + t * (this.velocity - 1))));
    }

    _scheduleLayersNote(noteData, duration, layerIndex, ts, legatoEnabled) {
        const chIdx = layerIndex;
        const { note, bend } = this.noteAndBend(noteData.frequency);
        const velocity = this._layerVelocity(layerIndex);

        if (legatoEnabled) {
            const held = this._latestLiveEntry(chIdx);
            if (held && held.offTs === null) {
                const m = this.freqToMidiFloat(noteData.frequency);
                const withinHeadroom = Math.abs(m - held.note) <= Math.max(0, this.bendRangeSemitones - 1);
                if (withinHeadroom) {
                    this._cancelRetuneRamp(chIdx);
                    this._sendBend(chIdx, this.bendFromSemitones(m - held.note), ts);
                    held.ratio = noteData.ratio;
                    held.frequency = noteData.frequency;
                    return;
                }
            }

            this._cancelRetuneRamp(chIdx);
            this._flushGuard(chIdx, note, ts);
            this._sendBend(chIdx, bend, ts);
            this._sendNoteOn(chIdx, note, ts, velocity);
            if (held) this._scheduleNoteOff(held, ts + 15);
            this._registerLiveNote({ chIdx, note, ratio: noteData.ratio, layerIndex, onTs: ts, offTs: null, timer: null, kind: 'tone' });
            return;
        }

        this._cancelRetuneRamp(chIdx);
        this._flushGuard(chIdx, note, ts);
        this._sendBend(chIdx, bend, ts);
        this._sendNoteOn(chIdx, note, ts, velocity);
        const offDelayMs = Math.max(10, duration * 1000 - 10);
        const entry = { chIdx, note, ratio: noteData.ratio, layerIndex, onTs: ts, offTs: null, timer: null, kind: 'tone' };
        this._registerLiveNote(entry);
        this._scheduleNoteOff(entry, ts + offDelayMs);
    }

    _scheduleMpeNote(noteData, duration, layerIndex, ts, legatoEnabled) {
        const chIdx = this._allocateMpeChannel();
        this._cancelRetuneRamp(chIdx);
        const { note, bend } = this.noteAndBend(noteData.frequency);

        this._flushGuard(chIdx, note, ts);
        this._sendBend(chIdx, bend, ts);
        this._sendNoteOn(chIdx, note, ts, this._layerVelocity(layerIndex));

        if (legatoEnabled) {
            const prev = this._latestLiveEntryForLayer(layerIndex, chIdx);
            const entry = { chIdx, note, ratio: noteData.ratio, layerIndex, onTs: ts, offTs: null, timer: null, kind: 'tone' };
            this._registerLiveNote(entry);
            if (prev) this._scheduleNoteOff(prev, ts + 15);
            return;
        }

        const offDelayMs = Math.max(10, duration * 1000 - 10);
        const entry = { chIdx, note, ratio: noteData.ratio, layerIndex, onTs: ts, offTs: null, timer: null, kind: 'tone' };
        this._registerLiveNote(entry);
        this._scheduleNoteOff(entry, ts + offDelayMs);
    }

    // ====================================
    // LIVE RETUNE (hook: ToneRowPlayback.handleFundamentalChange)
    // ====================================

    handleFundamentalRetune(glideSec = 0) {
        if (!this.enabled || !this.output) return;
        const fundamentalFreq = window.toneRowPlayback?.fundamentalFreq;
        if (!Number.isFinite(fundamentalFreq)) return;

        const now = performance.now();
        const latestPerChannel = new Map();
        this.liveNotes.forEach(entry => {
            if (entry.__off || !Number.isFinite(entry.ratio)) return;
            const existing = latestPerChannel.get(entry.chIdx);
            if (!existing || entry.onTs > existing.onTs) latestPerChannel.set(entry.chIdx, entry);
        });

        latestPerChannel.forEach((entry, chIdx) => {
            this._cancelRetuneRamp(chIdx);
            const newFreq = fundamentalFreq * entry.ratio;
            const m = this.freqToMidiFloat(newFreq);
            const targetBend = this.bendFromSemitones(m - entry.note);

            if (glideSec > 0.08) {
                this._rampBend(chIdx, targetBend, glideSec);
            } else {
                this._sendBend(chIdx, targetBend, now);
            }
        });
    }

    // ====================================
    // PARTITIONS (hook: PartitionsPlayback.triggerSample)
    // ====================================

    schedulePartitionHit(layerIndex, time, volumeDb, transposeSemitones, durationSec) {
        if (!this.enabled || !this.output || !this.sendPartitionsAsDrums) return;

        // A stale `time` (e.g. a reschedule rescanning already-elapsed hits) must be
        // dropped, not clamped to now - clamping fires every stale hit as an instant
        // burst instead of silently skipping it.
        const targetTs = this.audioTimeToMidiTs(time);
        if (targetTs < performance.now() - 5) return;

        const ts = Math.max(performance.now(), targetTs);
        // One channel per layer (ch 10-13) - a single shared drum channel let unrelated
        // layers steal each other's still-ringing voices on synths with per-channel
        // polyphony limits (e.g. a monophonic or low-voice patch on ch 10).
        const chIdx = this.partitionChannels[layerIndex] ?? 9;
        const baseNotes = [36, 38, 42, 46];
        const transpose = Number.isFinite(transposeSemitones) ? Math.round(transposeSemitones) : 0;
        const note = Math.min(127, Math.max(0, (baseNotes[layerIndex] ?? 36) + transpose));
        const velocity = this._partitionVelocity(volumeDb);

        this._flushGuard(chIdx, note, ts);
        this._sendNoteOn(chIdx, note, ts, velocity);

        const entry = { chIdx, note, ratio: null, layerIndex, onTs: ts, offTs: null, timer: null, kind: 'drum' };
        this._registerLiveNote(entry);
        // Let it ring until the next hit in this layer (matches the tone row's own
        // offDelayMs pattern) instead of a flat 100ms - a fixed cutoff truncates any
        // sample/patch that actually listens for note-off (long cymbal decays, held
        // synth drum voices) regardless of what's happening in other layers.
        const offDelayMs = Number.isFinite(durationSec) ? Math.max(10, durationSec * 1000 - 10) : 100;
        this._scheduleNoteOff(entry, ts + offDelayMs);
    }

    _partitionVelocity(volumeDb) {
        const db = Number.isFinite(volumeDb) ? volumeDb : -18;
        const clamped = Math.max(-40, Math.min(0, db));
        const t = (clamped + 40) / 40;
        return Math.round(20 + t * (127 - 20));
    }

    // ====================================
    // PANIC
    // ====================================

    allNotesOff() {
        if (!this.output) {
            this.liveNotes.forEach(entry => { if (entry.timer) clearTimeout(entry.timer); });
            this.retuneRamps.forEach(timer => clearInterval(timer));
            this.retuneRamps.clear();
            this.liveNotes = [];
            return;
        }

        try { this.output.clear(); } catch (err) { /* not all backends support clear() */ }

        const now = performance.now();
        const stragglers = this.liveNotes.map(e => ({ chIdx: e.chIdx, note: e.note }));
        this.liveNotes.forEach(entry => {
            if (entry.timer) clearTimeout(entry.timer);
            this._sendNoteOff(entry.chIdx, entry.note, now);
        });

        this.retuneRamps.forEach(timer => clearInterval(timer));
        this.retuneRamps.clear();

        for (let chIdx = 0; chIdx <= 15; chIdx += 1) {
            this._send([0xB0 | chIdx, 123, 0], now);
            this._send([0xB0 | chIdx, 120, 0], now);
        }

        this.liveNotes = [];
        this._scheduleStragglerSweep(stragglers);
    }

    // A bend/note-on can already be irrevocably queued via a future-timestamped output.send()
    // when panic fires - clear() isn't honored by every Web MIDI backend, so a note scheduled
    // moments before stop/mute can still arrive after we've wiped the registry and hang forever.
    // Re-send the exact note-offs once the scheduler's 150ms lookahead has fully elapsed.
    _scheduleStragglerSweep(entries) {
        if (!entries.length) return;
        setTimeout(() => {
            if (!this.output) return;
            const ts = performance.now();
            entries.forEach(({ chIdx, note }) => this._sendNoteOff(chIdx, note, ts));
        }, 200);
    }

    // Release whatever's currently sounding for one layer (hook: ToneRowPlayback.updateSoloMuteStates)
    // without touching other layers' notes - solo/mute only silences gain in the browser, it has no
    // idea a MIDI note is out there, so we have to close it out explicitly on this side.
    releaseLayerNotes(layerIndex) {
        if (!this.enabled || !this.output) return;
        const now = performance.now();
        const matches = this.liveNotes.filter(e => e.layerIndex === layerIndex && e.kind === 'tone' && !e.__off);
        if (!matches.length) return;

        matches.forEach(entry => {
            if (entry.timer) clearTimeout(entry.timer);
            this._cancelRetuneRamp(entry.chIdx);
            this._sendNoteOff(entry.chIdx, entry.note, now);
            entry.__off = true;
            this._pruneEntry(entry);
        });

        this._scheduleStragglerSweep(matches.map(e => ({ chIdx: e.chIdx, note: e.note })));
    }

    // Same as releaseLayerNotes but for the drum channel (hook: PartitionsPlayback.rebuildAndReschedule)
    // - disabling/removing a Partitions layer mid-cycle stops its WebAudio locally but has no idea a
    // MIDI note-on for that layer is already out there, so we have to close it out explicitly here too.
    releasePartitionLayerNotes(layerIndex) {
        if (!this.enabled || !this.output) return;
        const now = performance.now();
        const matches = this.liveNotes.filter(e => e.layerIndex === layerIndex && e.kind === 'drum' && !e.__off);
        if (!matches.length) return;

        matches.forEach(entry => {
            if (entry.timer) clearTimeout(entry.timer);
            this._sendNoteOff(entry.chIdx, entry.note, now);
            entry.__off = true;
            this._pruneEntry(entry);
        });

        this._scheduleStragglerSweep(matches.map(e => ({ chIdx: e.chIdx, note: e.note })));
    }

    // ====================================
    // UI
    // ====================================

    getSectionHTML() {
        return `
            <div class="playback-section collapsible-section">
                <button class="collapse-btn midi-out-header" data-target="midi-out-content">
                    MIDI Out — DAW Control
                </button>
                <div id="midi-out-content" class="collapse-content">
                    <div class="control-group">
                        <button id="midi-enable-toggle" class="control-btn">Enable MIDI Out</button>
                    </div>
                    <div class="midi-status" id="midi-status-line">MIDI Out disabled</div>

                    <div class="control-group">
                        <label>Device:</label>
                        <select id="midi-device-select"></select>
                    </div>

                    <div class="control-group">
                        <label>Mode:</label>
                        <select id="midi-mode-select">
                            <option value="layers">Layer channels (A–D → ch 1–4)</option>
                            <option value="mpe">MPE (rotating ch 2–16)</option>
                        </select>
                    </div>

                    <div class="control-group">
                        <label>Bend range (semitones):</label>
                        <input type="number" id="midi-bend-range" min="1" max="96" value="${this.bendRangeSemitones}">
                    </div>

                    <div class="control-group">
                        <label>Velocity:</label>
                        <input type="number" id="midi-velocity" min="1" max="127" value="${this.velocity}">
                    </div>

                    <label class="midi-check"><input type="checkbox" id="midi-partitions-drums"> Send Partitions as drums (ch 10-13, one per layer)</label>
                    <label class="midi-check"><input type="checkbox" id="midi-local-mute"> Mute browser synth (MIDI only)</label>

                    <p class="midi-hint">Match this bend range to your synth's per-patch bend setting. Route through a
                        virtual MIDI port (macOS: IAC Driver; Windows: loopMIDI) into your DAW. Live fundamental
                        changes — including Progression Solver retunes — bend sounding notes in real time.</p>
                </div>
            </div>`;
    }

    bindUI() {
        const enableBtn = document.getElementById('midi-enable-toggle');
        if (enableBtn) {
            if (!this.supported) {
                enableBtn.disabled = true;
                enableBtn.title = 'Web MIDI not supported in this browser';
            }
            enableBtn.addEventListener('click', async () => {
                if (this.enabled) {
                    this.disable();
                    enableBtn.textContent = 'Enable MIDI Out';
                    enableBtn.classList.remove('active');
                } else {
                    const ok = await this.enable();
                    if (ok) {
                        this._populateDeviceSelect();
                        enableBtn.textContent = 'Disable MIDI Out';
                        enableBtn.classList.add('active');
                    } else {
                        this._updateStatusLine();
                    }
                }
            });
        }

        const deviceSelect = document.getElementById('midi-device-select');
        if (deviceSelect) {
            deviceSelect.addEventListener('change', (e) => this._onDeviceChange(e.target.value));
        }

        const modeSelect = document.getElementById('midi-mode-select');
        if (modeSelect) {
            modeSelect.value = this.mode;
            modeSelect.addEventListener('change', (e) => this._onModeChange(e.target.value));
        }

        const bendRangeInput = document.getElementById('midi-bend-range');
        if (bendRangeInput) {
            bendRangeInput.addEventListener('change', (e) => this._onBendRangeChange(parseFloat(e.target.value)));
        }

        const velocityInput = document.getElementById('midi-velocity');
        if (velocityInput) {
            velocityInput.addEventListener('change', (e) => {
                const value = Math.round(parseFloat(e.target.value));
                this.velocity = Number.isFinite(value) ? Math.max(1, Math.min(127, value)) : this.velocity;
                this._saveSettings();
            });
        }

        const drumsCheck = document.getElementById('midi-partitions-drums');
        if (drumsCheck) {
            drumsCheck.checked = this.sendPartitionsAsDrums;
            drumsCheck.addEventListener('change', (e) => {
                this.sendPartitionsAsDrums = e.target.checked;
                this._saveSettings();
            });
        }

        const localMuteCheck = document.getElementById('midi-local-mute');
        if (localMuteCheck) {
            localMuteCheck.checked = this.midiLocalMute;
            localMuteCheck.addEventListener('change', (e) => {
                this.midiLocalMute = e.target.checked;
                this._applyLocalMute();
                this._saveSettings();
            });
        }
        this._applyLocalMute();

        const content = document.getElementById('midi-out-content');
        const header = document.querySelector('.midi-out-header');
        if (content && header) {
            content.style.display = 'none';
            header.classList.add('collapsed');
        }

        this._updateStatusLine();
        this._maybeAutoReconnect();
    }

    // The mute-browser-synth preference persists across sessions, but it must never actually
    // silence the page unless MIDI is truly driving a connected device right now - otherwise a
    // stale "muted" setting from a past DAW session leaves a fresh/disconnected page dead silent.
    _applyLocalMute() {
        const pb = window.toneRowPlayback;
        if (!pb) return;
        const midiActive = this.enabled && !!this.output;
        pb.midiLocalMute = this.midiLocalMute && midiActive;
        pb.updateMasterVolume(pb.masterVolumeDb);
    }

    _populateDeviceSelect() {
        const select = document.getElementById('midi-device-select');
        if (!select || !this.midiAccess) return;
        const outputs = Array.from(this.midiAccess.outputs.values());
        select.innerHTML = outputs.length
            ? outputs.map(o => `<option value="${o.id}">${o.name}</option>`).join('')
            : '<option value="">No outputs</option>';
        if (this.output) select.value = this.output.id;
    }

    _updateStatusLine() {
        const el = document.getElementById('midi-status-line');
        if (!el) return;
        if (!this.supported) {
            el.textContent = 'Web MIDI not supported in this browser (try Chrome, Edge, or Firefox 108+).';
        } else if (!this.enabled) {
            el.textContent = 'MIDI Out disabled.';
        } else if (!this.output) {
            el.textContent = 'No outputs — create a virtual port (macOS: IAC Driver; Windows: loopMIDI).';
        } else {
            el.textContent = `→ ${this.output.name}`;
        }
    }
}

window.lrcMidiOut = new MIDIOut();
