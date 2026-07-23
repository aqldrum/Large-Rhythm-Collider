// cull2-audio-player.js — self-contained audition transport for the Cull2 lab. Mirrors the main
// ToneRowPlayback legato rule (one sustained oscillator per layer; the next sounded event replaces
// it) without importing Playback/* or coupling this experiment to the product audio engine.

const LAYERS = ['A', 'B', 'C', 'D'];

export class Cull2AudioPlayer {
  constructor({ onState = () => {} } = {}) {
    this.onState = onState;
    this.ctx = null;
    this.master = null;
    this.program = null;
    this.programKey = '';
    this.scheduleKey = '';
    this.playing = false;
    this.timer = null;
    this.transportStart = 0;
    this.cursorCycle = 0;
    this.cursorEvent = 0;
    this.ticksPerSecond = 15;
    this.frozenTick = 0;
    this.rootHz = 110;
    this.waveform = 'sine';
    this.level = 0.38;
    this.layerVoices = new Map();
    this.oscillators = new Set();
    this.lookahead = 0.12;
    this.intervalMs = 25;
  }

  async _ensureAudio() {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.level;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  setProgram(program) {
    const nextKey = program ? (program.programKey || `${program.layers.join('.')}:${program.events.length}`) : '';
    const nextScheduleKey = program ? (program.scheduleKey || program.events.map(event => event.phase).join(',')) : '';
    const rhythmChanged = this.programKey && nextKey !== this.programKey;
    const scheduleChanged = this.scheduleKey && nextScheduleKey !== this.scheduleKey;
    this.program = program;
    this.programKey = nextKey;
    this.scheduleKey = nextScheduleKey;
    if (rhythmChanged && this.playing) this._restartTransport();
    else if (scheduleChanged && this.playing && this.ctx) this._syncCursor(this.ctx.currentTime);

    // A harmonic selection change is immediate for voices already being held. Newly enabled ratios
    // still wait for their next real surviving event; no synthetic attack is created here.
    const selected = new Set(program?.ratioCatalog.filter(note => note.selected).map(note => note.fraction) || []);
    if (this.ctx) for (const [layer, voice] of [...this.layerVoices]) {
      if (!selected.has(voice.fraction)) this._releaseVoice(layer, this.ctx.currentTime, 0.08);
    }
  }

  async play() {
    if (this.playing) return;
    await this._ensureAudio();
    this.playing = true;
    this.transportStart = this.ctx.currentTime + 0.06;
    this.frozenTick = 0;
    this.cursorCycle = 0;
    this.cursorEvent = 0;
    if (this.ticksPerSecond > 0) this._schedule();
    this.onState(true);
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.playing = false;
    this.frozenTick = 0;
    if (this.ctx) this._stopAll(this.ctx.currentTime);
    this.onState(false);
  }

  async toggle() {
    if (this.playing) this.stop(); else await this.play();
  }

  setTickRate(ticksPerSecond) {
    const parsed = Number(ticksPerSecond);
    const next = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 15;
    if (next === this.ticksPerSecond) return;
    if (this.playing && this.ctx) {
      const now = this.ctx.currentTime;
      const absoluteTick = this.ticksPerSecond > 0
        ? Math.max(0, (now - this.transportStart) * this.ticksPerSecond)
        : this.frozenTick;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.ticksPerSecond = next;
      this.frozenTick = absoluteTick;
      this._stopAll(now);
      if (next > 0) {
        this.transportStart = now - absoluteTick / next;
        this._syncCursor(now);
        this._schedule();
      }
    } else this.ticksPerSecond = next;
  }

  setRootHz(hz) {
    this.rootHz = Math.max(20, Number(hz) || 110);
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.layerVoices.values()) voice.osc.frequency.setTargetAtTime(this.rootHz * voice.ratio, now, 0.04);
  }

  setWaveform(waveform) { this.waveform = ['sine', 'triangle', 'sawtooth', 'square'].includes(waveform) ? waveform : 'sine'; }
  setLevel(level) {
    this.level = Math.max(0, Math.min(1, Number(level) || 0));
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.03);
  }

  _restartTransport() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this._stopAll(now);
    this.transportStart = now + 0.06;
    this.frozenTick = 0;
    this.cursorCycle = 0;
    this.cursorEvent = 0;
    if (this.playing && this.ticksPerSecond > 0) this._schedule();
  }

  _syncCursor(now) {
    const events = this.program?.events || [];
    if (!events.length) { this.cursorCycle = 0; this.cursorEvent = 0; return; }
    const grid = this.program?.grid || 1;
    const absoluteTick = this.ticksPerSecond > 0
      ? Math.max(0, (now - this.transportStart) * this.ticksPerSecond)
      : this.frozenTick;
    this.cursorCycle = Math.floor(absoluteTick / grid);
    const cycleTick = absoluteTick - this.cursorCycle * grid;
    this.cursorEvent = events.findIndex(event => event.tick >= cycleTick);
    if (this.cursorEvent < 0) { this.cursorEvent = 0; this.cursorCycle++; }
  }

  _schedule() {
    if (!this.playing || !this.ctx || this.ticksPerSecond <= 0) return;
    const events = this.program?.events || [];
    const grid = this.program?.grid || 1;
    const now = this.ctx.currentTime;
    const horizon = now + this.lookahead;
    if (events.length) {
      while (true) {
        const event = events[this.cursorEvent];
        const when = this.transportStart + (this.cursorCycle * grid + event.tick) / this.ticksPerSecond;
        if (when > horizon) break;
        if (when >= now - 0.03 && event.finalKeep && event.selected) {
          // Runtime comparison makes the static cyclic repeat-cull robust at startup and after live
          // selector edits: a silent layer is seeded even when its steady-state annotation is HOLD.
          for (const layerAction of event.layerActions) {
            const { layer } = layerAction;
            if (!LAYERS.includes(layer)) continue;
            if (!['play', 'repeat-hold'].includes(layerAction.action)) continue;
            const voice = this.layerVoices.get(layer);
            const tone = {
              rawRatio: layerAction.rawRatio ?? event.rawRatio,
              foldedRatio: layerAction.foldedRatio ?? event.foldedRatio,
              fraction: layerAction.fraction ?? event.fraction,
              gap: layerAction.gap ?? event.gap,
              rawFraction: layerAction.rawFraction ?? event.rawFraction,
            };
            const sameTone = voice && (tone.rawFraction != null
              ? voice.rawFraction === tone.rawFraction
              : voice.gap === tone.gap);
            if (!this.program.repeatCull || !sameTone) this._startLegato(layer, tone, Math.max(now, when));
          }
        }
        this.cursorEvent++;
        if (this.cursorEvent >= events.length) { this.cursorEvent = 0; this.cursorCycle++; }
      }
    }
    this.timer = setTimeout(() => this._schedule(), this.intervalMs);
  }

  _startLegato(layer, tone, when) {
    this._releaseVoice(layer, when, 0.055);
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = this.waveform;
    osc.frequency.setValueAtTime(this.rootHz * tone.rawRatio, when);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(0.18, when + 0.018);
    env.gain.exponentialRampToValueAtTime(0.09, when + 0.12);
    osc.connect(env); env.connect(this.master);
    osc.start(when);
    const voice = {
      osc,
      env,
      ratio: tone.rawRatio,
      foldedRatio: tone.foldedRatio,
      fraction: tone.fraction,
      gap: tone.gap,
      rawFraction: tone.rawFraction,
    };
    this.layerVoices.set(layer, voice);
    this.oscillators.add(osc);
    osc.onended = () => {
      this.oscillators.delete(osc);
      if (this.layerVoices.get(layer)?.osc === osc) this.layerVoices.delete(layer);
      try { osc.disconnect(); } catch {} try { env.disconnect(); } catch {}
    };
  }

  _releaseVoice(layer, when, release = 0.08) {
    const voice = this.layerVoices.get(layer);
    if (!voice) return;
    this.layerVoices.delete(layer);
    const stop = when + release;
    try {
      voice.env.gain.cancelScheduledValues(when);
      voice.env.gain.setValueAtTime(Math.max(0.0001, voice.env.gain.value || 0.09), when);
      voice.env.gain.exponentialRampToValueAtTime(0.0001, stop);
      voice.osc.stop(stop + 0.02);
    } catch {}
  }

  _stopAll(now) {
    for (const layer of [...this.layerVoices.keys()]) this._releaseVoice(layer, now, 0.04);
    for (const osc of [...this.oscillators]) {
      try { osc.stop(now + 0.06); } catch {}
    }
  }
}
