export class AnimationPlayback {
  constructor(sequence, canvas) {
    this.sequence = sequence;
    this.canvas = canvas;
    this.isPointerDown = false;
    this.lastRowIndex = null;
    this.synth = null;
    this.output = null;
    this.baseFrequency = 220;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  }

  canStrum() {
    return this.sequence && this.sequence.isStrumReady();
  }

  ensureAudio() {
    if (!window.Tone) return false;
    if (!this.synth) {
      const sustain = Math.pow(10, -18 / 20);
      this.output = new window.Tone.Volume(-4).toDestination();
      this.synth = new window.Tone.PolySynth(window.Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: {
          attack: 0.005,
          decay: 0.2,
          sustain,
          release: 0.4
        }
      }).connect(this.output);
    }
    return true;
  }

  async handlePointerDown(event) {
    if (!this.canStrum()) return;
    if (!this.ensureAudio()) return;
    try {
      await window.Tone.start();
    } catch (err) {
      console.warn('Tone start failed', err);
    }

    this.isPointerDown = true;
    this.lastRowIndex = null;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.handlePointerMove(event);
  }

  handlePointerMove(event) {
    if (!this.isPointerDown || !this.canStrum()) return;
    const row = this.getRowFromEvent(event);
    if (!row) return;
    if (row.index === this.lastRowIndex) return;

    this.lastRowIndex = row.index;
    this.triggerRow(row);
  }

  handlePointerUp(event) {
    if (this.isPointerDown) {
      this.canvas.releasePointerCapture?.(event.pointerId);
    }
    this.isPointerDown = false;
    this.lastRowIndex = null;
  }

  getRowFromEvent(event) {
    const rows = this.sequence.getPlaybackRows();
    if (!rows.length) return null;

    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let nearest = null;
    let minDist = Infinity;

    rows.forEach((row) => {
      const rowY = row.startScreen.y;
      const dist = Math.abs(y - rowY);
      if (dist < minDist) {
        minDist = dist;
        nearest = row;
      }
    });

    const threshold = Math.max(12, rect.height * 0.04);
    if (!nearest || minDist > threshold) return null;

    const minX = Math.min(nearest.startScreen.x, nearest.endScreen.x) - 6;
    const maxX = Math.max(nearest.startScreen.x, nearest.endScreen.x) + 6;
    if (x < minX || x > maxX) return null;

    return nearest;
  }

  triggerRow(row) {
    if (!this.synth) return;
    const fundamental = this.sequence.fundamentalValue || 1;
    const value = row.value || 1;
    const ratio = fundamental / value;
    const frequency = this.baseFrequency * ratio;
    const maxFrequency = this.baseFrequency * 32;
    if (frequency > maxFrequency) return;
    this.synth.triggerAttackRelease(frequency, 0.6);
  }
}
