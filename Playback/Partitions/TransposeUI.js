// TransposeUI.js - Knob control for per-layer transpose

class TransposeUI {
    constructor(container, initialValue = 0, config = {}) {
        this.container = container;
        this.value = initialValue;
        this.config = {
            min: -24,
            max: 24,
            step: 0.1,
            precision: 1,
            label: 'Transpose',
            unit: 'st',
            ...config
        };

        this.isDragging = false;
        this.startY = 0;
        this.startValue = 0;

        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);

        this.createElement();
        this.setupEventListeners();
        this.updateDisplay();
    }

    createElement() {
        this.element = document.createElement('div');
        this.element.className = 'knob-container';
        this.element.innerHTML = `
            <div class="knob-label">${this.config.label}</div>
            <div class="knob">
                <div class="knob-indicator"></div>
            </div>
            <div class="knob-value"></div>
        `;

        this.knob = this.element.querySelector('.knob');
        this.indicator = this.element.querySelector('.knob-indicator');
        this.valueDisplay = this.element.querySelector('.knob-value');

        if (this.container) {
            this.container.appendChild(this.element);
        }
    }

    setupEventListeners() {
        this.knob.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.isDragging = true;
            this.startY = e.clientY;
            this.startValue = this.value;
            this.knob.classList.add('active');

            document.addEventListener('mousemove', this.handleMouseMove);
            document.addEventListener('mouseup', this.handleMouseUp);
        });

        this.knob.addEventListener('dblclick', () => {
            this.showDirectInput();
        });
    }

    handleMouseMove(e) {
        if (!this.isDragging) return;
        const deltaY = this.startY - e.clientY;
        const sensitivity = 0.005;
        const change = deltaY * sensitivity * (this.config.max - this.config.min);
        this.setValue(this.startValue + change);
    }

    handleMouseUp() {
        this.isDragging = false;
        this.knob.classList.remove('active');
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
    }

    showDirectInput() {
        const input = document.createElement('input');
        input.className = 'knob-input';
        input.type = 'number';
        input.min = this.config.min;
        input.max = this.config.max;
        input.step = this.config.step;
        input.value = this.value.toFixed(this.config.precision);

        this.element.appendChild(input);
        input.focus();
        input.select();

        const handleInput = () => {
            if (handleInput.handled) return;
            handleInput.handled = true;
            if (!input.isConnected) return;
            const nextValue = parseFloat(input.value);
            this.setValue(Number.isFinite(nextValue) ? nextValue : this.value);
            if (input.parentElement) {
                input.remove();
            }
        };

        input.addEventListener('blur', handleInput, { once: true });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleInput();
            } else if (e.key === 'Escape') {
                if (!handleInput.handled && input.parentElement) {
                    handleInput.handled = true;
                    input.remove();
                }
            }
        });
    }

    setValue(newValue) {
        const clamped = Math.max(this.config.min, Math.min(this.config.max, newValue));
        this.value = clamped;
        this.updateDisplay();
        if (this.onChange) {
            this.onChange(this.value);
        }
    }

    updateDisplay() {
        const normalized = (this.value - this.config.min) / (this.config.max - this.config.min);
        const rotation = (normalized * 270) - 135;
        this.indicator.style.transform = `translateX(-50%) rotate(${rotation}deg)`;

        const sign = this.value > 0 ? '+' : '';
        this.valueDisplay.textContent = `${sign}${this.value.toFixed(this.config.precision)}${this.config.unit}`;
    }
}

window.TransposeUI = TransposeUI;
