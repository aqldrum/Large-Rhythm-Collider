export class AnimationControls {
  constructor(sequence) {
    this.sequence = sequence;
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleWheel = this.handleWheel.bind(this);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  handleKeyDown(event) {
    if (event.repeat) return;
    const target = event.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    const isEditing =
      tag === 'input' ||
      tag === 'textarea' ||
      (target && target.isContentEditable);
    if (isEditing) return;

    const key = event.key;
    if (key === 'p' || key === 'P') {
      event.preventDefault();
      this.togglePause();
      return;
    }

    if (key === '1' || key === '2' || key === '3' || key === '4' || key === '5' || key === '6' || key === '7' || key === '8') {
      event.preventDefault();
      this.jumpToPhase(parseInt(key, 10));
      return;
    }

    if (key === 'w' || key === 'W') {
      event.preventDefault();
      this.toggleWaves();
    }
  }

  togglePause() {
    if (!this.sequence || !this.sequence.isPlaying) return;
    if (this.sequence.isPaused && this.sequence.isAtPhase8()) {
      this.sequence.toggleFinalSlidePlayback();
      return;
    }
    if (this.sequence.isPaused) {
      this.sequence.resume();
    } else {
      this.sequence.pause();
    }
  }

  jumpToPhase(phaseIndex) {
    if (!this.sequence) return;
    const layers = this.readLayers();
    this.sequence.jumpToPhase(phaseIndex, layers);
  }

  toggleWaves() {
    if (!this.sequence) return;
    this.sequence.toggleWaves();
  }

  handleWheel(event) {
    if (!this.sequence || !this.sequence.finalSlide || !this.sequence.finalSlide.isActive()) return;
    event.preventDefault();
    this.sequence.finalSlide.adjustTempo(event.deltaY, performance.now());
  }

  readLayers() {
    const ids = ['layer-a', 'layer-b', 'layer-c', 'layer-d'];
    return ids.map((id) => {
      const input = document.getElementById(id);
      if (!input) return 0;
      const value = parseInt(input.value, 10);
      return Number.isFinite(value) ? value : 0;
    });
  }
}
