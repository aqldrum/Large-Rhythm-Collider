// ReflectionsColor.js - Color management system for Reflections visualization
// Provides photoshop-style color pickers for Main Plot, Background Plot, and Canvas Background

class ReflectionsColorManager {
    constructor(reflectionsInstance) {
        this.reflections = reflectionsInstance;
        this.isInitialized = false;
        
        // Default colors
        this.colors = {
            mainPlot: '#FFFFFF',        // White for main plot
            backgroundPlot: '#FFFFFF',  // White for background plot  
            canvasBackground: '#000000' // Black for canvas background
        };
        
        // Color picker state
        this.activeColorPicker = null;
        this.colorPickerCallbacks = {};
        
        // HSB values for current color being edited
        this.currentHSB = { h: 0, s: 0, b: 100 }; // Default to white (0 saturation, 100% brightness)
        
        console.log('🎨 ReflectionsColorManager initialized');
    }

    // ====================================
    // COLOR PICKER SYSTEM
    // ====================================

    createColorPicker(colorType, currentColor) {
        const doc = this.reflections.popupWindow.document;
        
        // Remove any existing color picker
        this.removeColorPicker();
        
        // Create color picker container
        const colorPicker = doc.createElement('div');
        colorPicker.className = 'color-picker-popup';
        colorPicker.id = 'reflections-color-picker';
        
        // Position relative to the color button
        const colorButton = doc.getElementById(`${colorType}-color-button`);
        const buttonRect = colorButton.getBoundingClientRect();
        
        colorPicker.innerHTML = `
            <div class="color-picker-header">
                <h4>Select ${this.getColorDisplayName(colorType)}</h4>
                <button class="color-picker-close" onclick="window.reflectionsColorManager.removeColorPicker()">✕</button>
            </div>
            <div class="color-picker-content">
                <div class="color-preview">
                    <div class="color-preview-current" id="current-color-preview" style="background-color: ${currentColor}"></div>
                    <div class="color-preview-new" id="new-color-preview" style="background-color: ${currentColor}"></div>
                </div>
                
                <div class="color-sliders">
                    <div class="slider-group">
                        <label>Hue:</label>
                        <input type="range" id="hue-slider" min="0" max="360" value="0" class="color-slider">
                        <span id="hue-value">0°</span>
                    </div>
                    <div class="slider-group">
                        <label>Saturation:</label>
                        <input type="range" id="saturation-slider" min="0" max="100" value="0" class="color-slider">
                        <span id="saturation-value">0%</span>
                    </div>
                    <div class="slider-group">
                        <label>Brightness:</label>
                        <input type="range" id="brightness-slider" min="0" max="100" value="100" class="color-slider">
                        <span id="brightness-value">100%</span>
                    </div>
                </div>
                
                <div class="color-inputs">
                    <div class="color-input-group">
                        <label>Hex:</label>
                        <input type="text" id="hex-input" value="${currentColor}" maxlength="7">
                    </div>
                    <div class="color-input-row">
                        <div class="color-input-group">
                            <label>R:</label>
                            <input type="number" id="r-input" min="0" max="255" value="255">
                        </div>
                        <div class="color-input-group">
                            <label>G:</label>
                            <input type="number" id="g-input" min="0" max="255" value="255">
                        </div>
                        <div class="color-input-group">
                            <label>B:</label>
                            <input type="number" id="b-input" min="0" max="255" value="255">
                        </div>
                    </div>
                </div>
                
                <div class="color-picker-buttons">
                    <button class="color-picker-cancel" onclick="window.reflectionsColorManager.removeColorPicker()">Cancel</button>
                    <button class="color-picker-ok" onclick="window.reflectionsColorManager.applySelectedColor('${colorType}')">OK</button>
                </div>
            </div>
        `;
        
        // Position the color picker with bounds checking
        const colorPickerWidth = 300; // Width defined in CSS (updated)
        const colorPickerHeight = 450; // Increased to account for all elements
        const windowWidth = this.reflections.popupWindow.innerWidth;
        const windowHeight = this.reflections.popupWindow.innerHeight;
        
        let left = buttonRect.right + 10;
        let top = buttonRect.top;
        
        // Check right boundary - if picker would overflow, position to the left of button
        if (left + colorPickerWidth > windowWidth) {
            left = buttonRect.left - colorPickerWidth - 10;
        }
        
        // Check left boundary - ensure picker doesn't go off left edge
        if (left < 10) {
            left = 10;
        }
        
        // Check bottom boundary - if picker would overflow, move it up
        if (top + colorPickerHeight > windowHeight) {
            top = windowHeight - colorPickerHeight - 10;
        }
        
        // Check top boundary - ensure picker doesn't go off top edge
        if (top < 10) {
            top = 10;
        }
        
        colorPicker.style.position = 'absolute';
        colorPicker.style.left = `${left}px`;
        colorPicker.style.top = `${top}px`;
        colorPicker.style.zIndex = '10000';
        
        doc.body.appendChild(colorPicker);
        
        // Get actual dimensions after adding to DOM
        const actualWidth = colorPicker.offsetWidth;
        const actualHeight = colorPicker.offsetHeight;
        
        // Recalculate position with actual dimensions if they differ significantly
        if (Math.abs(actualWidth - colorPickerWidth) > 20 || Math.abs(actualHeight - colorPickerHeight) > 20) {
            let newLeft = buttonRect.right + 10;
            let newTop = buttonRect.top;
            
            // Recheck boundaries with actual dimensions
            if (newLeft + actualWidth > windowWidth) {
                newLeft = buttonRect.left - actualWidth - 10;
            }
            if (newLeft < 10) {
                newLeft = 10;
            }
            if (newTop + actualHeight > windowHeight) {
                newTop = windowHeight - actualHeight - 10;
            }
            if (newTop < 10) {
                newTop = 10;
            }
            
            colorPicker.style.left = `${newLeft}px`;
            colorPicker.style.top = `${newTop}px`;
        }
        
        // Initialize color picker functionality
        this.initializeColorPicker(currentColor);
        this.setupColorPickerEvents(colorType);
        
        this.activeColorPicker = colorType;
    }

    initializeColorPicker(currentColor) {
        // Convert current color to HSB and update sliders
        const rgb = this.hexToRgb(currentColor);
        if (rgb) {
            const hsb = this.rgbToHsb(rgb.r, rgb.g, rgb.b);
            this.currentHSB = hsb;
            this.updateSliderValues(hsb);
            this.updateAllInputs(currentColor, rgb, hsb);
        }
    }


    drawHueGradient(ctx, width, height) {
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        
        // Create RGB spectrum following the exact cycle described
        const rgbStops = [
            '#FF0000', // Red (255,0,0)
            '#FF00FF', // Purple (255,0,255)
            '#0000FF', // Blue (0,0,255)
            '#00FFFF', // Cyan (0,255,255)
            '#00FF00', // Green (0,255,0)
            '#FFFF00', // Yellow (255,255,0)
            '#FF0000'  // Red again (255,0,0)
        ];
        
        rgbStops.forEach((color, i) => {
            gradient.addColorStop(i / (rgbStops.length - 1), color);
        });
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
    }

    setupColorPickerEvents(colorType) {
        const doc = this.reflections.popupWindow.document;
        
        // Slider events
        const hueSlider = doc.getElementById('hue-slider');
        const saturationSlider = doc.getElementById('saturation-slider');
        const brightnessSlider = doc.getElementById('brightness-slider');
        
        if (hueSlider) {
            hueSlider.addEventListener('input', () => this.handleSliderChange());
        }
        if (saturationSlider) {
            saturationSlider.addEventListener('input', () => this.handleSliderChange());
        }
        if (brightnessSlider) {
            brightnessSlider.addEventListener('input', () => this.handleSliderChange());
        }
        
        // Input field events
        const hexInput = doc.getElementById('hex-input');
        const rInput = doc.getElementById('r-input');
        const gInput = doc.getElementById('g-input');
        const bInput = doc.getElementById('b-input');
        
        if (hexInput) {
            hexInput.addEventListener('input', () => this.handleHexInput());
        }
        
        [rInput, gInput, bInput].forEach(input => {
            if (input) {
                input.addEventListener('input', () => this.handleRGBInput());
            }
        });
    }

    handleSliderChange() {
        const doc = this.reflections.popupWindow.document;
        
        // Get values from sliders
        const h = parseInt(doc.getElementById('hue-slider').value);
        const s = parseInt(doc.getElementById('saturation-slider').value);
        const b = parseInt(doc.getElementById('brightness-slider').value);
        
        // Update current HSB
        this.currentHSB = { h, s, b };
        
        // Update slider value displays
        doc.getElementById('hue-value').textContent = `${h}°`;
        doc.getElementById('saturation-value').textContent = `${s}%`;
        doc.getElementById('brightness-value').textContent = `${b}%`;
        
        // Convert to RGB and update color
        const rgb = this.hsbToRgb(h, s, b);
        const hex = this.rgbToHex(rgb.r, rgb.g, rgb.b);
        
        this.updateColorPreview(hex);
        this.updateColorInputs(hex, rgb);
    }

    updateSliderValues(hsb) {
        const doc = this.reflections.popupWindow.document;
        
        doc.getElementById('hue-slider').value = hsb.h;
        doc.getElementById('saturation-slider').value = hsb.s;
        doc.getElementById('brightness-slider').value = hsb.b;
        
        doc.getElementById('hue-value').textContent = `${hsb.h}°`;
        doc.getElementById('saturation-value').textContent = `${hsb.s}%`;
        doc.getElementById('brightness-value').textContent = `${hsb.b}%`;
    }

    updateAllInputs(hex, rgb, hsb) {
        this.updateColorPreview(hex);
        this.updateColorInputs(hex, rgb);
        this.updateSliderValues(hsb);
    }

    handleHexInput() {
        const doc = this.reflections.popupWindow.document;
        const hexInput = doc.getElementById('hex-input');
        let hex = hexInput.value;
        
        // Ensure hex format
        if (!hex.startsWith('#')) hex = '#' + hex;
        if (hex.length === 4) {
            // Convert #RGB to #RRGGBB
            hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        
        if (this.isValidHex(hex)) {
            const rgb = this.hexToRgb(hex);
            if (rgb) {
                const hsb = this.rgbToHsb(rgb.r, rgb.g, rgb.b);
                this.currentHSB = hsb;
                this.updateSliderValues(hsb);
                this.updateColorPreview(hex);
                this.updateColorInputs(hex, rgb);
            }
        }
    }

    handleRGBInput() {
        const doc = this.reflections.popupWindow.document;
        const r = Math.max(0, Math.min(255, parseInt(doc.getElementById('r-input').value) || 0));
        const g = Math.max(0, Math.min(255, parseInt(doc.getElementById('g-input').value) || 0));
        const b = Math.max(0, Math.min(255, parseInt(doc.getElementById('b-input').value) || 0));
        
        const hex = this.rgbToHex(r, g, b);
        const hsb = this.rgbToHsb(r, g, b);
        
        this.currentHSB = hsb;
        this.updateSliderValues(hsb);
        this.updateColorPreview(hex);
        
        // Update hex input
        doc.getElementById('hex-input').value = hex;
    }


    updateColorPreview(hex) {
        const doc = this.reflections.popupWindow.document;
        const newPreview = doc.getElementById('new-color-preview');
        if (newPreview) {
            newPreview.style.backgroundColor = hex;
        }
    }

    updateColorInputs(hex, rgb) {
        const doc = this.reflections.popupWindow.document;
        
        doc.getElementById('hex-input').value = hex;
        doc.getElementById('r-input').value = rgb.r;
        doc.getElementById('g-input').value = rgb.g;
        doc.getElementById('b-input').value = rgb.b;
    }

    applySelectedColor(colorType) {
        const doc = this.reflections.popupWindow.document;
        const newColor = doc.getElementById('hex-input').value;
        
        // Update the color
        this.setColor(colorType, newColor);
        
        // Close the color picker
        this.removeColorPicker();
        
        // Trigger re-render of the visualization
        this.reflections.updateVisualization();
    }

    removeColorPicker() {
        const doc = this.reflections.popupWindow.document;
        const colorPicker = doc.getElementById('reflections-color-picker');
        if (colorPicker) {
            colorPicker.remove();
        }
        this.activeColorPicker = null;
    }

    // ====================================
    // COLOR MANAGEMENT
    // ====================================

    setColor(colorType, color) {
        if (this.colors.hasOwnProperty(colorType)) {
            this.colors[colorType] = color;
            this.updateColorButton(colorType, color);
            console.log(`🎨 Updated ${colorType} color to ${color}`);
        }
    }

    getColor(colorType) {
        return this.colors[colorType] || '#FFFFFF';
    }

    updateColorButton(colorType, color) {
        const doc = this.reflections.popupWindow.document;
        const button = doc.getElementById(`${colorType}-color-button`);
        if (button) {
            const colorSwatch = button.querySelector('.color-swatch');
            if (colorSwatch) {
                colorSwatch.style.backgroundColor = color;
            }
        }
    }

    getColorDisplayName(colorType) {
        const displayNames = {
            mainPlot: 'Main Plot Color',
            backgroundPlot: 'Background Plot Color', 
            canvasBackground: 'Canvas Background Color'
        };
        return displayNames[colorType] || colorType;
    }

    // ====================================
    // COLOR UTILITY FUNCTIONS
    // ====================================

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    // HSB to RGB conversion
    hsbToRgb(h, s, b) {
        h = h / 360;
        s = s / 100;
        b = b / 100;
        
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = b * (1 - s);
        const q = b * (1 - f * s);
        const t = b * (1 - (1 - f) * s);
        
        let r, g, blue;
        
        switch (i % 6) {
            case 0: r = b; g = t; blue = p; break;
            case 1: r = q; g = b; blue = p; break;
            case 2: r = p; g = b; blue = t; break;
            case 3: r = p; g = q; blue = b; break;
            case 4: r = t; g = p; blue = b; break;
            case 5: r = b; g = p; blue = q; break;
        }
        
        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(blue * 255)
        };
    }

    // RGB to HSB conversion
    rgbToHsb(r, g, b) {
        r = r / 255;
        g = g / 255;
        b = b / 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const diff = max - min;
        
        let h = 0;
        const s = max === 0 ? 0 : diff / max;
        const brightness = max;
        
        if (diff !== 0) {
            switch (max) {
                case r: h = ((g - b) / diff + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / diff + 2) / 6; break;
                case b: h = ((r - g) / diff + 4) / 6; break;
            }
        }
        
        return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            b: Math.round(brightness * 100)
        };
    }

    hslToRgb(h, s, l) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h * 6) % 2 - 1));
        const m = l - c / 2;
        
        let r, g, b;
        
        if (h < 1/6) {
            r = c; g = x; b = 0;
        } else if (h < 2/6) {
            r = x; g = c; b = 0;
        } else if (h < 3/6) {
            r = 0; g = c; b = x;
        } else if (h < 4/6) {
            r = 0; g = x; b = c;
        } else if (h < 5/6) {
            r = x; g = 0; b = c;
        } else {
            r = c; g = 0; b = x;
        }
        
        return {
            r: Math.round((r + m) * 255),
            g: Math.round((g + m) * 255),
            b: Math.round((b + m) * 255)
        };
    }

    rgbToHsl(r, g, b) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const diff = max - min;
        const sum = max + min;
        const l = sum / 2;
        
        let h, s;
        
        if (diff === 0) {
            h = s = 0;
        } else {
            s = l > 0.5 ? diff / (2 - sum) : diff / sum;
            
            switch (max) {
                case r: h = ((g - b) / diff + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / diff + 2) / 6; break;
                case b: h = ((r - g) / diff + 4) / 6; break;
            }
        }
        
        return { h, s, l };
    }

    isValidHex(hex) {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
    }

    // ====================================
    // INITIALIZATION
    // ====================================

    initialize() {
        if (this.isInitialized) return;
        
        // Make color manager globally accessible for popup window
        this.reflections.popupWindow.reflectionsColorManager = this;
        
        this.isInitialized = true;
        console.log('🎨 ReflectionsColorManager initialized and ready');
    }

    // ====================================
    // RENDERING INTEGRATION
    // ====================================

    applyColors(ctx) {
        // This method will be called by the rendering system to apply colors
        // The actual color application will depend on how the rendering is structured
        
        // Set canvas background
        const canvasElement = ctx.canvas;
        canvasElement.style.backgroundColor = this.colors.canvasBackground;
        
        // Return colors for use in rendering
        return {
            mainPlot: this.colors.mainPlot,
            backgroundPlot: this.colors.backgroundPlot,
            canvasBackground: this.colors.canvasBackground
        };
    }
}

// Export the class for use by Reflections.js
if (typeof window !== 'undefined') {
    window.ReflectionsColorManager = ReflectionsColorManager;
}