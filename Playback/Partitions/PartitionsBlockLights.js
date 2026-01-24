// PartitionsBlockLights.js - Visual flash feedback for partition blocks

class PartitionsBlockLights {
    constructor() {
        this.activeTimeouts = new Set();
        this.activeBlocks = new Map();
        this.flashStyle = {
            boxShadow: '0 0 6px rgba(255, 107, 107, 0.9)',
            brightness: '1.35'
        };
    }

    toGlowColor(color) {
        if (typeof color !== 'string') return 'rgba(255, 255, 255, 0.1)';
        if (color.startsWith('#')) {
            const hex = color.replace('#', '');
            const normalized = hex.length === 3
                ? hex.split('').map((c) => c + c).join('')
                : hex;
            const r = parseInt(normalized.slice(0, 2), 16);
            const g = parseInt(normalized.slice(2, 4), 16);
            const b = parseInt(normalized.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, 1.0)`;
        }
        return color;
    }

    setFlashStyle({ boxShadow, brightness } = {}) {
        if (typeof boxShadow === 'string') {
            this.flashStyle.boxShadow = boxShadow;
        }
        if (typeof brightness === 'string') {
            this.flashStyle.brightness = brightness;
        }
    }

    trackTimeout(id) {
        if (id) this.activeTimeouts.add(id);
    }

    untrackTimeout(id) {
        if (id) this.activeTimeouts.delete(id);
    }

    clearAll() {
        this.activeTimeouts.forEach((id) => clearTimeout(id));
        this.activeTimeouts.clear();
        this.activeBlocks.forEach((_, block) => {
            if (!block || !block.isConnected) return;
            block.classList.remove('partition-block-hit');
            block.style.boxShadow = '';
            block.style.filter = '';
            block.style.background = block.dataset.baseBackground || '';
        });
        this.activeBlocks.clear();

        document.querySelectorAll('.partition-block').forEach((block) => {
            block.classList.remove('partition-block-hit');
            block.style.boxShadow = '';
            block.style.filter = '';
            block.style.background = block.dataset.baseBackground || '';
        });
    }

    flash(layerIndex, displayIndex, durationMs = 60) {
        const layer = document.querySelector(`.partition-layer[data-layer-index="${layerIndex}"]`);
        if (!layer) {
            return;
        }
        const preview = layer.querySelector('.partition-preview');
        const track = preview?.querySelector('.partition-blocks-track');
        if (!track) {
            return;
        }
        let resolvedIndex = displayIndex;
        if (preview?.dataset?.p2DisplayMap) {
            try {
                const map = JSON.parse(preview.dataset.p2DisplayMap);
                if (Array.isArray(map)) {
                    resolvedIndex = map.indexOf(displayIndex);
                }
            } catch (_) {
                // ignore
            }
        }
        if (resolvedIndex < 0) {
            return;
        }
        const block = track.children[resolvedIndex];
        if (!block) {
            return;
        }
        if (block.dataset.muted === 'true') {
            return;
        }
        if (!this.activeBlocks.has(block)) {
            this.activeBlocks.set(block, true);
        }
        const blockColor = block.dataset.glowColor
            || window.getComputedStyle(block).backgroundColor
            || 'rgba(255, 255, 255, 0.6)';
        const flashColor = this.toGlowColor(blockColor);
        block.classList.add('partition-block-hit');
        block.style.boxShadow = `0 0 10px ${flashColor}`;
        block.style.background = flashColor;
        block.style.filter = `brightness(${this.flashStyle.brightness})`;
        setTimeout(() => {
            if (block.isConnected) {
                block.classList.remove('partition-block-hit');
                block.style.boxShadow = '';
                block.style.filter = '';
                block.style.background = block.dataset.baseBackground || '';
            }
            this.activeBlocks.delete(block);
        }, Math.max(10, durationMs));
    }
}

window.partitionsBlockLights = new PartitionsBlockLights();
