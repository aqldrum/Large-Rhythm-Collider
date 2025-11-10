// Reflections.js - Symmetrical Visualization Engine
// Progressive geometric transformations using Linear Plot as seed

class LRCReflections {
    constructor(lrcVisuals) {
        this.parent = lrcVisuals;
        this.popupWindow = null;
        this.canvas = null;
        this.ctx = null;
        this.isActive = false;
        
        // Animation system
        this.animationId = null;
        this.startTime = Date.now();
        this.isAnimating = false;
        this.showBackground = true; // Control for showing/hiding static background
        this.animationSnapshot = null; // Pure snapshot for animation duplication
        this.animationSnapshotLayers = null; // Layer structure for proper blending
        this.snapshotNeedsUpdate = true; // Flag to regenerate snapshot when needed
        
        // Stage 1: Reflections
        this.reflectionLevel = 1; // 1-4
        this.reflectionType = 1; // 1 or 2 (direct overlay vs reflecting pool)
        this.blendMode = 'difference'; // 'difference' or 'screen'
        this.dotSize = 4; // Default dot size in pixels
        
        // Stage 2: Tessellation
        this.tessellationLevel = 1; // 1-4 (1x1 to 4x4 grid)
        this.tessellationControls = []; // Individual grid section controls
        
        // Stage 3: Animation
        this.masterTime = 10.0; // seconds per cycle
        this.rotationEnabled = false;
        this.translationEnabled = false;
        this.translationDirection = 'up'; // 'up', 'down', 'left', 'right'
        
        // Data from Linear Plot
        this.originalDots = [];
        this.normalizedDots = [];
        this.canvasSize = 800; // Square canvas size
        
        console.log('🔮 LRC Reflections initialized');
        
        // Setup cleanup handlers for main page events
        this.setupMainPageCleanup();
    }

    setupMainPageCleanup() {
        // Close popup when main page is refreshed or closed
        window.addEventListener('beforeunload', () => {
            this.closePopup();
        });
        
        // Close popup when main page loses focus (helps with crashes)
        window.addEventListener('blur', () => {
            if (this.popupWindow && !this.popupWindow.closed) {
                // Small delay to avoid closing during normal interactions
                setTimeout(() => {
                    if (this.popupWindow && !this.popupWindow.closed && this.popupWindow.document.hidden) {
                        this.closePopup();
                    }
                }, 1000);
            }
        });
        
    }

    startPopupMonitoring() {
        // Monitor popup window status
        if (this.popupMonitorInterval) {
            clearInterval(this.popupMonitorInterval);
        }
        
        this.popupMonitorInterval = setInterval(() => {
            if (!this.popupWindow || this.popupWindow.closed) {
                this.deactivate();
                clearInterval(this.popupMonitorInterval);
                this.popupMonitorInterval = null;
            }
        }, 1000);
    }

    // ====================================
    // ACTIVATION & POPUP MANAGEMENT
    // ====================================

    activate() {
        console.log('🔮 Activating Reflections - opening popup window');
        this.openReflectionsPopup();
    }

    deactivate() {
        this.stopAnimation(true); // Skip redraw during deactivation
        this.closePopup();
        
        // Auto-switch back to the most recent canvas visualization
        const fallbackType = (window.lrcVisuals && window.lrcVisuals.getLastNonPopupPlotType)
            ? window.lrcVisuals.getLastNonPopupPlotType()
            : 'linear';
        if (window.lrcHUD && window.lrcHUD.setVisualizationType) {
            window.lrcHUD.setVisualizationType(fallbackType);
        } else if (window.lrcVisuals) {
            window.lrcVisuals.setPlotType(fallbackType);
        }
        console.log(`📊 Restored ${fallbackType} after Reflections close`);
        
        console.log('🔮 Reflections deactivated');
    }

    openReflectionsPopup() {
        if (this.popupWindow && !this.popupWindow.closed) {
            this.popupWindow.focus();
            return;
        }

        this.popupWindow = window.open('', 'ReflectionsVisualization', 
            'width=1200,height=800,resizable=yes,scrollbars=no,menubar=no,toolbar=no,location=no,status=no');

        if (!this.popupWindow) {
            alert('Popup blocked! Please allow popups for the Reflections interface.');
            return;
        }

        this.setupPopupContent();
        this.isActive = true;
        
        // Setup popup monitoring
        this.startPopupMonitoring();
    }

    setupPopupContent() {
        const doc = this.popupWindow.document;
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Large Rhythm Collider - Reflections</title>
                <style>
                    body { 
                        margin: 0; 
                        background: #000; 
                        color: #fff; 
                        font-family: monospace; 
                        overflow: hidden;
                        display: flex;
                    }
                    #reflections-container { 
                        display: flex;
                        width: 100vw; 
                        height: 100vh; 
                    }
                    #canvas-area {
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        background: #000;
                        padding: 20px;
                    }
                    #rhythm-title {
                        color: #00ff88;
                        font-size: 18px;
                        font-weight: bold;
                        margin-bottom: 15px;
                        text-align: center;
                        text-transform: uppercase;
                        letter-spacing: 2px;
                    }
                    #reflections-canvas { 
                        background: #000; 
                        border: 1px solid #333;
                    }
                    #controls-sidebar {
                        width: 300px;
                        background: rgba(20, 20, 20, 0.95);
                        border-left: 1px solid #444;
                        overflow-y: auto;
                        padding: 20px;
                        box-sizing: border-box;
                    }
                    .section {
                        margin-bottom: 25px;
                        border: 1px solid #444;
                        border-radius: 6px;
                        background: rgba(30, 30, 30, 0.8);
                    }
                    .section-header {
                        background: rgba(40, 40, 40, 0.9);
                        padding: 12px 15px;
                        cursor: pointer;
                        user-select: none;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 1px solid #444;
                    }
                    .section-header:hover {
                        background: rgba(50, 50, 50, 0.9);
                    }
                    .section-header h3 {
                        margin: 0;
                        font-size: 14px;
                        color: #00ff88;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                    }
                    .section-content {
                        padding: 15px;
                        display: block;
                    }
                    .section.collapsed .section-content {
                        display: none;
                    }
                    .control-group {
                        margin-bottom: 15px;
                    }
                    .control-group:last-child {
                        margin-bottom: 0;
                    }
                    .control-label {
                        display: block;
                        font-size: 11px;
                        color: #ccc;
                        margin-bottom: 5px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    .control-slider {
                        width: 100%;
                        height: 4px;
                        border-radius: 2px;
                        background: #333;
                        outline: none;
                        cursor: pointer;
                        -webkit-appearance: none;
                        appearance: none;
                    }
                    .control-slider::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        appearance: none;
                        width: 16px;
                        height: 16px;
                        border-radius: 50%;
                        background: #00ff88;
                        cursor: pointer;
                        box-shadow: 0 0 4px rgba(0, 255, 136, 0.3);
                    }
                    .control-value {
                        text-align: center;
                        color: #00ff88;
                        font-size: 12px;
                        font-weight: bold;
                        margin-top: 5px;
                    }
                    .control-select {
                        width: 100%;
                        background: #333;
                        color: #fff;
                        border: 1px solid #555;
                        border-radius: 4px;
                        padding: 8px;
                        font-family: monospace;
                        font-size: 12px;
                    }
                    .control-button {
                        width: 100%;
                        background: #444;
                        color: #fff;
                        border: 1px solid #666;
                        border-radius: 4px;
                        padding: 10px;
                        font-family: monospace;
                        font-size: 12px;
                        cursor: pointer;
                        transition: all 0.2s;
                    }
                    .control-button:hover {
                        background: #555;
                        border-color: #00ff88;
                    }
                    .control-button.active {
                        background: #00ff88;
                        color: #000;
                        border-color: #00ff88;
                    }
                    .chevron {
                        transition: transform 0.2s;
                    }
                    .section.collapsed .chevron {
                        transform: rotate(-90deg);
                    }
                    
                    /* Export Modal Styles */
                    .export-modal {
                        display: none;
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(0, 0, 0, 0.8);
                        z-index: 1000;
                        align-items: center;
                        justify-content: center;
                    }
                    .export-modal.show {
                        display: flex;
                    }
                    .export-content {
                        background: #1a1a1a;
                        border: 1px solid #444;
                        border-radius: 8px;
                        padding: 25px;
                        width: 400px;
                        color: #fff;
                        font-family: monospace;
                    }
                    .export-header {
                        font-size: 18px;
                        color: #00ff88;
                        margin-bottom: 20px;
                        text-align: center;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                    }
                    .export-section {
                        margin-bottom: 20px;
                    }
                    .export-section:last-child {
                        margin-bottom: 0;
                    }
                    .export-label {
                        display: block;
                        font-size: 12px;
                        color: #ccc;
                        margin-bottom: 8px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    .export-input {
                        width: 100%;
                        background: #333;
                        color: #fff;
                        border: 1px solid #555;
                        border-radius: 4px;
                        padding: 10px;
                        font-family: monospace;
                        font-size: 14px;
                        box-sizing: border-box;
                    }
                    .export-buttons {
                        display: flex;
                        gap: 10px;
                        margin-top: 25px;
                    }
                    .export-btn {
                        flex: 1;
                        background: #444;
                        color: #fff;
                        border: 1px solid #666;
                        border-radius: 4px;
                        padding: 12px;
                        font-family: monospace;
                        font-size: 12px;
                        cursor: pointer;
                        transition: all 0.2s;
                        text-transform: uppercase;
                    }
                    .export-btn:hover {
                        background: #555;
                        border-color: #00ff88;
                    }
                    .export-btn.primary {
                        background: #00ff88;
                        color: #000;
                        border-color: #00ff88;
                    }
                    .export-btn.primary:hover {
                        background: #00cc6a;
                        border-color: #00cc6a;
                    }
                    .format-options {
                        display: flex;
                        gap: 10px;
                        margin-bottom: 15px;
                    }
                    .format-option {
                        flex: 1;
                        background: #333;
                        color: #fff;
                        border: 1px solid #555;
                        border-radius: 4px;
                        padding: 10px;
                        text-align: center;
                        cursor: pointer;
                        transition: all 0.2s;
                        font-family: monospace;
                        font-size: 12px;
                        text-transform: uppercase;
                    }
                    .format-option:hover {
                        background: #444;
                        border-color: #777;
                    }
                    .format-option.selected {
                        background: #00ff88;
                        color: #000;
                        border-color: #00ff88;
                    }
                    .conditional-settings {
                        display: none;
                    }
                    .conditional-settings.show {
                        display: block;
                    }

                    /* Color Picker Styles */
                    .color-button {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 8px 12px;
                        background: #2c2c2c;
                        border: 1px solid #444;
                        border-radius: 4px;
                        color: white;
                        cursor: pointer;
                        font-size: 14px;
                        transition: all 0.2s ease;
                    }

                    .color-button:hover {
                        background: #3c3c3c;
                        border-color: #555;
                    }

                    .color-swatch {
                        width: 20px;
                        height: 20px;
                        border-radius: 3px;
                        border: 1px solid #666;
                        flex-shrink: 0;
                    }

                    .color-label {
                        font-size: 13px;
                    }

                    .color-picker-popup {
                        background: #2c2c2c;
                        border: 1px solid #444;
                        border-radius: 8px;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                        color: white;
                        font-family: Arial, sans-serif;
                        width: 300px;
                        user-select: none;
                    }

                    .color-picker-header {
                        padding: 12px 16px;
                        border-bottom: 1px solid #444;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }

                    .color-picker-header h4 {
                        margin: 0;
                        font-size: 14px;
                        font-weight: 500;
                    }

                    .color-picker-close {
                        background: none;
                        border: none;
                        color: #999;
                        font-size: 16px;
                        cursor: pointer;
                        padding: 4px;
                        border-radius: 3px;
                        transition: all 0.2s ease;
                    }

                    .color-picker-close:hover {
                        background: #444;
                        color: white;
                    }

                    .color-picker-content {
                        padding: 16px;
                    }

                    .color-sliders {
                        margin: 16px 0;
                    }

                    .slider-group {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        margin-bottom: 12px;
                    }

                    .slider-group label {
                        font-size: 12px;
                        width: 70px;
                        text-align: left;
                    }

                    .color-slider {
                        flex: 1;
                        height: 6px;
                        background: #444;
                        border-radius: 3px;
                        outline: none;
                        -webkit-appearance: none;
                    }

                    .color-slider::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        width: 16px;
                        height: 16px;
                        background: #0ea5e9;
                        border-radius: 50%;
                        cursor: pointer;
                    }

                    .color-slider::-moz-range-thumb {
                        width: 16px;
                        height: 16px;
                        background: #0ea5e9;
                        border-radius: 50%;
                        border: none;
                        cursor: pointer;
                    }

                    .slider-group span {
                        font-size: 11px;
                        color: #ccc;
                        width: 35px;
                        text-align: right;
                    }

                    .color-picker-controls {
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                    }

                    .color-preview {
                        display: flex;
                        height: 40px;
                        border-radius: 4px;
                        overflow: hidden;
                        border: 1px solid #444;
                    }

                    .color-preview-current,
                    .color-preview-new {
                        flex: 1;
                        position: relative;
                    }

                    .color-preview-current::after {
                        content: 'Current';
                        position: absolute;
                        bottom: 2px;
                        left: 4px;
                        font-size: 10px;
                        color: white;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                    }

                    .color-preview-new::after {
                        content: 'New';
                        position: absolute;
                        bottom: 2px;
                        right: 4px;
                        font-size: 10px;
                        color: white;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
                    }

                    .color-inputs {
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    }

                    .color-input-group {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }

                    .color-input-row {
                        display: flex;
                        gap: 12px;
                    }

                    .color-input-row .color-input-group {
                        flex: 1;
                    }

                    .color-input-group label {
                        font-size: 12px;
                        min-width: 20px;
                        text-align: left;
                    }
                    
                    .color-input-row .color-input-group label {
                        width: 12px;
                        text-align: left;
                    }

                    .color-input-group input {
                        flex: 1;
                        padding: 4px 6px;
                        background: #1a1a1a;
                        border: 1px solid #444;
                        border-radius: 3px;
                        color: white;
                        font-size: 12px;
                    }

                    .color-input-group input:focus {
                        outline: none;
                        border-color: #0ea5e9;
                    }

                    .color-picker-buttons {
                        display: flex;
                        gap: 8px;
                        justify-content: flex-end;
                        margin-top: 4px;
                    }

                    .color-picker-cancel,
                    .color-picker-ok {
                        padding: 6px 12px;
                        border: 1px solid #444;
                        border-radius: 4px;
                        font-size: 12px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                    }

                    .color-picker-cancel {
                        background: #2c2c2c;
                        color: #ccc;
                    }

                    .color-picker-cancel:hover {
                        background: #3c3c3c;
                        color: white;
                    }

                    .color-picker-ok {
                        background: #0ea5e9;
                        color: white;
                        border-color: #0284c7;
                    }

                    .color-picker-ok:hover {
                        background: #0284c7;
                    }
                </style>
            </head>
            <body>
                <div id="reflections-container">
                    <div id="canvas-area">
                        <div id="rhythm-title">Rhythm: Loading...</div>
                        <canvas id="reflections-canvas"></canvas>
                    </div>
                    <div id="controls-sidebar">
                        <!-- Controls will be generated by JavaScript -->
                    </div>
                </div>
                
                <!-- Export Modal -->
                <div id="export-modal" class="export-modal">
                    <div class="export-content">
                        <div class="export-header">Export Visualization</div>
                        
                        <div class="export-section">
                            <label class="export-label">Format</label>
                            <div class="format-options">
                                <div class="format-option selected" data-format="png">PNG</div>
                                <div class="format-option" data-format="mp4">VIDEO</div>
                            </div>
                        </div>
                        
                        <div class="export-section">
                            <label class="export-label">Title</label>
                            <input type="text" class="export-input" id="export-title" 
                                   placeholder="Enter export filename" value="reflections">
                        </div>
                        
                        <div class="export-section">
                            <label class="export-label">Dimensions (Square)</label>
                            <input type="number" class="export-input" id="export-dimensions" 
                                   value="1024" min="256" max="4096" step="64">
                        </div>
                        
                        <div class="export-section conditional-settings" id="mp4-settings">
                            <div style="color: #00ff88; font-weight: bold; margin-bottom: 15px; text-align: center; text-transform: uppercase; letter-spacing: 1px;">
                                Video Animation Settings
                            </div>
                            
                            <div style="margin-bottom: 15px;">
                                <label class="export-label">Frame Rate (FPS)</label>
                                <input type="number" class="export-input" id="export-fps" 
                                       value="30" min="10" max="60" step="1">
                            </div>
                            
                            <div style="margin-bottom: 15px;">
                                <label class="export-label">Cycle Time (seconds)</label>
                                <input type="number" class="export-input" id="export-cycle-time" 
                                       value="10" min="1" max="60" step="0.5">
                            </div>
                            
                            <div style="margin-bottom: 15px;">
                                <label class="export-label">Rotation</label>
                                <button class="control-button" id="export-rotation-toggle">Enable Rotation</button>
                            </div>
                            
                            <div style="margin-bottom: 15px;">
                                <label class="export-label">Translation</label>
                                <button class="control-button" id="export-translation-toggle">Enable Translation</button>
                                <select class="export-input" id="export-translation-direction" style="margin-top: 8px;">
                                    <option value="up">Up</option>
                                    <option value="down">Down</option>
                                    <option value="left">Left</option>
                                    <option value="right">Right</option>
                                </select>
                            </div>
                        </div>
                        
                        <!-- Progress Bar (hidden by default) -->
                        <div class="export-section" id="export-progress" style="display: none;">
                            <div style="color: #00ff88; font-weight: bold; margin-bottom: 10px; text-align: center;">
                                Exporting...
                            </div>
                            <div style="background: #333; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
                                <div id="export-progress-bar" style="height: 8px; background: #00ff88; width: 0%; transition: width 0.3s;"></div>
                            </div>
                            <div id="export-progress-text" style="text-align: center; font-size: 12px; color: #ccc;">
                                Preparing export...
                            </div>
                        </div>
                        
                        <div class="export-buttons">
                            <button class="export-btn" id="export-cancel">Cancel</button>
                            <button class="export-btn primary" id="export-confirm">Export</button>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `);
        doc.close();

        // Initialize canvas and controls
        setTimeout(() => {
            this.setupCanvas();
            this.generateControls();
            
            // Force data update to ensure we have current rhythm data
            this.updateData();
            
            this.updateRhythmTitle();
            this.updateVisualization();
        }, 100);
    }

    setupCanvas() {
        this.canvas = this.popupWindow.document.getElementById('reflections-canvas');
        if (!this.canvas) return;

        // Set square canvas size
        this.canvas.width = this.canvasSize;
        this.canvas.height = this.canvasSize;
        this.canvas.style.width = this.canvasSize + 'px';
        this.canvas.style.height = this.canvasSize + 'px';
        
        this.ctx = this.canvas.getContext('2d');

        console.log('🔮 Reflections canvas initialized');
    }

    closePopup() {
        if (this.popupWindow && !this.popupWindow.closed) {
            this.popupWindow.close();
        }
        
        // Full internal reset to defaults
        this.resetToDefaults();
        
        // Clear popup monitoring
        if (this.popupMonitorInterval) {
            clearInterval(this.popupMonitorInterval);
            this.popupMonitorInterval = null;
        }
        
        this.popupWindow = null;
        this.canvas = null;
        this.ctx = null;
        this.isActive = false;
    }

    resetToDefaults() {
        // Reset all control values to defaults
        this.reflectionLevel = 1;
        this.reflectionType = 1;
        this.blendMode = 'difference';
        this.dotSize = 4;
        this.tessellationLevel = 1;
        this.tessellationControls = [];
        this.masterTime = 10.0;
        this.rotationEnabled = false;
        this.translationEnabled = false;
        this.translationDirection = 'up';
        
        // Stop any animations - skip redraw during reset
        this.stopAnimation(true);
        
        // Clear all caches and data arrays
        this.clearAllCaches();
        this.currentRhythms = [1, 1, 1, 1];
        
        console.log('🔮 Reflections reset to defaults');
    }

    fullSystemReset() {
        // Complete system reset for new rhythm generation (architectural requirement)
        // This ensures Reflections starts with completely clean state
        
        console.log('🔮 Performing full Reflections system reset for new rhythm');
        
        // Stop any ongoing animations immediately
        this.stopAnimation(true);
        
        // Reset all control values to defaults
        this.reflectionLevel = 1;
        this.reflectionType = 1;
        this.blendMode = 'difference';
        this.dotSize = 4;
        this.tessellationLevel = 1;
        this.tessellationControls = [];
        this.masterTime = 10.0;
        this.rotationEnabled = false;
        this.translationEnabled = false;
        this.translationDirection = 'up';
        this.showBackground = true;
        
        // Clear all caches and data arrays completely
        this.clearAllCaches();
        this.currentRhythms = [1, 1, 1, 1];
        this.originalDots = [];
        this.normalizedDots = [];
        
        // Reset popup UI controls to default values if popup is open
        if (this.popupWindow && !this.popupWindow.closed) {
            this.resetPopupControlsToDefaults();
        }
        
        console.log('🔮 Full system reset complete - Reflections ready for new rhythm');
    }

    resetPopupControlsToDefaults() {
        // Reset all UI controls in the popup to their default values
        const doc = this.popupWindow.document;
        
        // Reset reflection controls
        const reflectionType = doc.getElementById('reflection-type');
        if (reflectionType) reflectionType.value = '1';
        
        const blendMode = doc.getElementById('blend-mode');
        if (blendMode) blendMode.value = 'difference';
        
        const reflectionLevel = doc.getElementById('reflection-level');
        const reflectionLevelValue = doc.getElementById('reflection-level-value');
        if (reflectionLevel && reflectionLevelValue) {
            reflectionLevel.value = '1';
            reflectionLevelValue.textContent = '1';
        }
        
        const dotSize = doc.getElementById('dot-size');
        const dotSizeValue = doc.getElementById('dot-size-value');
        if (dotSize && dotSizeValue) {
            dotSize.value = '4';
            dotSizeValue.textContent = '4px';
        }
        
        // Reset tessellation controls
        const tessellationLevel = doc.getElementById('tessellation-level');
        const tessellationLevelValue = doc.getElementById('tessellation-level-value');
        if (tessellationLevel && tessellationLevelValue) {
            tessellationLevel.value = '1';
            tessellationLevelValue.textContent = '1x1';
        }
        
        // Reset animation controls
        const masterTime = doc.getElementById('master-time');
        const masterTimeValue = doc.getElementById('master-time-value');
        if (masterTime && masterTimeValue) {
            masterTime.value = '10';
            masterTimeValue.textContent = '10.0s';
        }
        
        const rotationToggle = doc.getElementById('rotation-toggle');
        if (rotationToggle) {
            rotationToggle.textContent = 'Enable Rotation';
            rotationToggle.classList.remove('active');
        }
        
        const translationToggle = doc.getElementById('translation-toggle');
        if (translationToggle) {
            translationToggle.textContent = 'Enable Translation';
            translationToggle.classList.remove('active');
        }
        
        const translationDirection = doc.getElementById('translation-direction');
        if (translationDirection) translationDirection.value = 'up';
        
        const backgroundToggle = doc.getElementById('background-toggle');
        if (backgroundToggle) {
            backgroundToggle.textContent = 'Show Background';
            backgroundToggle.classList.add('active');
        }
        
        console.log('🔮 Popup controls reset to defaults');
    }

    // ====================================
    // CONTROLS GENERATION
    // ====================================

    generateControls() {
        const sidebar = this.popupWindow.document.getElementById('controls-sidebar');
        if (!sidebar) return;

        sidebar.innerHTML = `
            <!-- Stage 1: Reflections -->
            <div class="section" id="reflections-section">
                <div class="section-header" onclick="toggleSection('reflections-section')">
                    <h3>Reflections</h3>
                    <span class="chevron">▼</span>
                </div>
                <div class="section-content">
                    <div class="control-group">
                        <label class="control-label">Type</label>
                        <select class="control-select" id="reflection-type">
                            <option value="1">Type 1 (Direct Overlay)</option>
                            <option value="2">Type 2 (Reflecting Pool)</option>
                        </select>
                    </div>
                    <div class="control-group">
                        <label class="control-label">Blend Mode</label>
                        <select class="control-select" id="blend-mode">
                            <option value="difference">Difference</option>
                            <option value="screen">Screen</option>
                        </select>
                    </div>
                    <div class="control-group">
                        <label class="control-label">Reflection Level</label>
                        <input type="range" class="control-slider" id="reflection-level" 
                               min="1" max="4" step="1" value="1">
                        <div class="control-value" id="reflection-level-value">1</div>
                    </div>
                    <div class="control-group">
                        <label class="control-label">Dot Size</label>
                        <input type="range" class="control-slider" id="dot-size" 
                               min="1" max="12" step="0.5" value="4">
                        <div class="control-value" id="dot-size-value">4px</div>
                    </div>
                </div>
            </div>

            <!-- Stage 2: Tessellation -->
            <div class="section" id="tessellation-section">
                <div class="section-header" onclick="toggleSection('tessellation-section')">
                    <h3>Tessellation</h3>
                    <span class="chevron">▼</span>
                </div>
                <div class="section-content">
                    <div class="control-group">
                        <label class="control-label">Grid Size</label>
                        <input type="range" class="control-slider" id="tessellation-level" 
                               min="1" max="4" step="1" value="1">
                        <div class="control-value" id="tessellation-level-value">1x1</div>
                    </div>
                </div>
            </div>

            <!-- Stage 3: Animation -->
            <div class="section" id="animation-section">
                <div class="section-header" onclick="toggleSection('animation-section')">
                    <h3>Animation</h3>
                    <span class="chevron">▼</span>
                </div>
                <div class="section-content">
                    <div class="control-group">
                        <label class="control-label">Master Time (seconds)</label>
                        <input type="range" class="control-slider" id="master-time" 
                               min="1" max="60" step="0.5" value="10">
                        <div class="control-value" id="master-time-value">10.0s</div>
                    </div>
                    <div class="control-group">
                        <label class="control-label">Rotation</label>
                        <button class="control-button" id="rotation-toggle">Enable Rotation</button>
                    </div>
                    <div class="control-group">
                        <label class="control-label">Translation</label>
                        <button class="control-button" id="translation-toggle">Enable Translation</button>
                        <select class="control-select" id="translation-direction" style="margin-top: 8px;">
                            <option value="up">Up</option>
                            <option value="down">Down</option>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                        </select>
                    </div>
                    <div class="control-group">
                        <label class="control-label">Background</label>
                        <button class="control-button active" id="background-toggle">Show Background</button>
                    </div>
                </div>
            </div>

            <!-- Color System -->
            <div class="section" id="color-section">
                <div class="section-header" onclick="toggleSection('color-section')">
                    <h3>Colors</h3>
                    <span class="chevron">▼</span>
                </div>
                <div class="section-content">
                    <div class="control-group">
                        <label>Main Plot Color:</label>
                        <button class="color-button" id="mainPlot-color-button" onclick="openColorPicker('mainPlot')">
                            <div class="color-swatch" style="background-color: #FFFFFF;"></div>
                        </button>
                    </div>
                    
                    <div class="control-group">
                        <label>Background Plot Color:</label>
                        <button class="color-button" id="backgroundPlot-color-button" onclick="openColorPicker('backgroundPlot')">
                            <div class="color-swatch" style="background-color: #FFFFFF;"></div>
                        </button>
                    </div>
                    
                    <div class="control-group">
                        <label>Canvas Background Color:</label>
                        <button class="color-button" id="canvasBackground-color-button" onclick="openColorPicker('canvasBackground')">
                            <div class="color-swatch" style="background-color: #000000;"></div>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Export -->
            <div class="control-group" style="margin-top: 20px;">
                <button class="control-button" id="export-button" style="background: #ff4757; border-color: #ff3742;">
                    Export Visualization
                </button>
            </div>
        `;

        // Add global functions to popup window
        this.popupWindow.toggleSection = (sectionId) => {
            const section = this.popupWindow.document.getElementById(sectionId);
            if (section) {
                section.classList.toggle('collapsed');
            }
        };

        this.setupControlsEventListeners();
    }

    setupControlsEventListeners() {
        const doc = this.popupWindow.document;

        // Reflection Type
        const reflectionType = doc.getElementById('reflection-type');
        if (reflectionType) {
            reflectionType.addEventListener('change', (e) => {
                this.reflectionType = parseInt(e.target.value);
                this.snapshotNeedsUpdate = true;
                this.updateVisualization();
            });
        }

        // Blend Mode
        const blendMode = doc.getElementById('blend-mode');
        if (blendMode) {
            blendMode.addEventListener('change', (e) => {
                this.blendMode = e.target.value;
                // No snapshot update needed for blend mode changes
                this.updateVisualization();
            });
        }

        // Reflection Level
        const reflectionLevel = doc.getElementById('reflection-level');
        const reflectionLevelValue = doc.getElementById('reflection-level-value');
        if (reflectionLevel && reflectionLevelValue) {
            reflectionLevel.addEventListener('input', (e) => {
                this.reflectionLevel = parseInt(e.target.value);
                reflectionLevelValue.textContent = this.reflectionLevel;
                this.snapshotNeedsUpdate = true;
                this.updateVisualization();
            });
        }

        // Dot Size
        const dotSize = doc.getElementById('dot-size');
        const dotSizeValue = doc.getElementById('dot-size-value');
        if (dotSize && dotSizeValue) {
            dotSize.addEventListener('input', (e) => {
                this.dotSize = parseFloat(e.target.value);
                dotSizeValue.textContent = `${this.dotSize}px`;
                // No snapshot update needed for dot size changes
                this.updateVisualization();
            });
        }

        // Tessellation Level
        const tessellationLevel = doc.getElementById('tessellation-level');
        const tessellationLevelValue = doc.getElementById('tessellation-level-value');
        if (tessellationLevel && tessellationLevelValue) {
            tessellationLevel.addEventListener('input', (e) => {
                this.tessellationLevel = parseInt(e.target.value);
                tessellationLevelValue.textContent = `${this.tessellationLevel}x${this.tessellationLevel}`;
                this.snapshotNeedsUpdate = true;
                this.updateVisualization();
            });
        }

        // Animation controls
        this.setupAnimationControls();
        
        // Initialize and setup export controls
        this.exporter = new ReflectionsExporter(this);
        this.exporter.setupExportControls();
        
        // Initialize color management system
        this.colorManager = new ReflectionsColorManager(this);
        this.colorManager.initialize();
        
        // Make color picker function available in popup window
        this.popupWindow.openColorPicker = (colorType) => {
            const currentColor = this.colorManager.getColor(colorType);
            this.colorManager.createColorPicker(colorType, currentColor);
        };
    }

    setupAnimationControls() {
        const doc = this.popupWindow.document;

        // Master Time
        const masterTime = doc.getElementById('master-time');
        const masterTimeValue = doc.getElementById('master-time-value');
        if (masterTime && masterTimeValue) {
            masterTime.addEventListener('input', (e) => {
                this.masterTime = parseFloat(e.target.value);
                masterTimeValue.textContent = `${this.masterTime}s`;
            });
        }

        // Rotation Toggle
        const rotationToggle = doc.getElementById('rotation-toggle');
        if (rotationToggle) {
            rotationToggle.addEventListener('click', () => {
                this.rotationEnabled = !this.rotationEnabled;
                rotationToggle.textContent = this.rotationEnabled ? 'Disable Rotation' : 'Enable Rotation';
                rotationToggle.classList.toggle('active', this.rotationEnabled);
                this.toggleAnimation();
            });
        }

        // Translation Toggle
        const translationToggle = doc.getElementById('translation-toggle');
        if (translationToggle) {
            translationToggle.addEventListener('click', () => {
                this.translationEnabled = !this.translationEnabled;
                translationToggle.textContent = this.translationEnabled ? 'Disable Translation' : 'Enable Translation';
                translationToggle.classList.toggle('active', this.translationEnabled);
                this.toggleAnimation();
            });
        }

        // Translation Direction
        const translationDirection = doc.getElementById('translation-direction');
        if (translationDirection) {
            translationDirection.addEventListener('change', (e) => {
                this.translationDirection = e.target.value;
            });
        }

        // Background Toggle
        const backgroundToggle = doc.getElementById('background-toggle');
        if (backgroundToggle) {
            backgroundToggle.addEventListener('click', () => {
                this.showBackground = !this.showBackground;
                backgroundToggle.textContent = this.showBackground ? 'Show Background' : 'Hide Background';
                backgroundToggle.classList.toggle('active', this.showBackground);
            });
        }
    }


    // ====================================
    // DATA PROCESSING
    // ====================================

    updateData() {
        // Get current spaces plot data from parent
        const spacesPlot = this.parent?.currentSpacesPlot || this.parent?.spacesPlot;
        if (!this.parent || !spacesPlot || spacesPlot.length === 0) {
            console.warn('🔮 No spaces plot data available from parent:', this.parent);
            return;
        }

        // Get current rhythm values from parent - try multiple sources
        this.currentRhythms = this.parent.currentRhythms || 
                             this.parent.rhythms || 
                             [this.parent.layerA, this.parent.layerB, this.parent.layerC, this.parent.layerD] ||
                             [1, 1, 1, 1];

        console.log('🔮 Reflections updating with data:', {
            spacesPlot: spacesPlot.slice(0, 5), // Show first 5 values
            rhythms: this.currentRhythms
        });

        // CRITICAL: Clear all cached states when new rhythm data comes in
        this.clearAllCaches();

        // Extract dots from Linear Plot (similar to how LRCVisuals.drawLinearPlot works)
        this.originalDots = this.extractLinearPlotDots();
        this.normalizedDots = this.normalizeToSquare(this.originalDots);
        
        // Update rhythm title
        this.updateRhythmTitle();
        
        if (this.isActive) {
            this.updateVisualization();
        }
    }

    clearAllCaches() {
        // Clear animation snapshot and force regeneration
        this.animationSnapshot = null;
        this.animationSnapshotLayers = null;
        this.snapshotNeedsUpdate = true;
        
        // Stop any ongoing animation to prevent using old cached data
        if (this.isAnimating) {
            this.stopAnimation();
        }
        
        // Clear any existing visualization data
        this.originalDots = [];
        this.normalizedDots = [];
        
        console.log('🔮 All Reflections caches cleared for new rhythm data');
    }

    extractLinearPlotDots() {
        // Extract dot positions from current linear plot
        // This mimics the logic from LRCVisuals.drawLinearPlot
        const dots = [];
        const spacesPlot = this.parent.currentSpacesPlot || this.parent.spacesPlot;
        
        if (!spacesPlot || spacesPlot.length === 0) {
            console.warn('🔮 No spaces plot data found');
            return dots;
        }
        
        const maxValue = Math.max(...spacesPlot);
        
        spacesPlot.forEach((space, index) => {
            // Calculate position (using same logic as linear plot)
            const x = spacesPlot.length > 1 ? (index / (spacesPlot.length - 1)) : 0.5; // Normalized 0-1
            const y = 1 - (space / maxValue); // Normalized 0-1, inverted for proper display
            
            dots.push({
                x: x,
                y: y,
                originalSpace: space,
                index: index
            });
        });

        console.log(`🔮 Extracted ${dots.length} dots from spaces plot:`, spacesPlot);
        return dots;
    }

    normalizeToSquare(dots) {
        // Normalize dots to fit in a perfect square (0-1 range for both x and y)
        return dots.map(dot => ({
            ...dot,
            x: dot.x, // Already normalized 0-1
            y: dot.y  // Already normalized 0-1
        }));
    }

    updateRhythmTitle() {
        if (!this.popupWindow) return;
        
        const titleElement = this.popupWindow.document.getElementById('rhythm-title');
        if (titleElement && this.currentRhythms) {
            const [a, b, c, d] = this.currentRhythms;
            titleElement.textContent = `Rhythm: ${a}:${b}:${c}:${d}`;
        }
    }

    // ====================================
    // VISUALIZATION CORE
    // ====================================

    updateVisualization() {
        console.log('🔮 updateVisualization called:', {
            hasCtx: !!this.ctx,
            dotCount: this.normalizedDots?.length || 0,
            canvasSize: this.canvasSize
        });
        
        if (!this.ctx) {
            console.warn('🔮 No canvas context available');
            return;
        }
        
        if (!this.normalizedDots || this.normalizedDots.length === 0) {
            console.warn('🔮 No normalized dots available');
            // Clear canvas and show empty state
            const colors = this.getColors();
            this.ctx.fillStyle = colors.canvasBackground;
            this.ctx.fillRect(0, 0, this.canvasSize, this.canvasSize);
            return;
        }

        // Clear canvas
        const colors = this.getColors();
        this.ctx.fillStyle = colors.canvasBackground;
        this.ctx.fillRect(0, 0, this.canvasSize, this.canvasSize);

        // Generate reflection layers (single composite layer)
        const reflectionLayers = this.generateReflectionLayers();
        
        // Apply tessellation if needed
        const tessellatedLayers = this.applyTessellation(reflectionLayers);
        
        // Draw layers with proper blend modes
        this.drawLayersWithBlending(tessellatedLayers);
        
        console.log('🔮 Visualization complete');
    }

    generateReflectionLayers() {
        // Create separate layers for proper blend mode application while maintaining iterative reflections
        const layers = [];
        
        // Start with original dots as the base
        let accumulatedDots = [...this.normalizedDots];
        
        // For Level 1, just show the base layer
        if (this.reflectionLevel === 1) {
            layers.push({
                dots: [...this.normalizedDots],
                level: 1,
                transform: 'base',
                isBase: true
            });
            return layers;
        }
        
        // For Level 2+, handle Type 1 vs Type 2 differently
        if (this.reflectionLevel >= 2) {
            if (this.reflectionType === 2) {
                // Type 2 (Reflecting Pool): Level 2 completely replaces Level 1
                const level2Result = this.applyReflectionTransformation(accumulatedDots, 2);
                
                // For reflecting pool, the entire result is the base layer
                layers.push({
                    dots: level2Result,
                    level: 2,
                    transform: 'reflecting-pool-base',
                    isBase: true
                });
                
                accumulatedDots = level2Result;
                
                // Continue with levels 3+ as normal reflections
                for (let level = 3; level <= this.reflectionLevel; level++) {
                    const transformedDots = this.applyReflectionTransformation(accumulatedDots, level);
                    const newDots = transformedDots.filter((dot, index) => index >= accumulatedDots.length);
                    
                    layers.push({
                        dots: newDots,
                        level: level,
                        transform: `level-${level}`,
                        isBase: false
                    });
                    
                    accumulatedDots = transformedDots;
                }
            } else {
                // Type 1 (Direct Overlay): Normal layered approach
                // Base layer (original dots only)
                layers.push({
                    dots: [...this.normalizedDots],
                    level: 1,
                    transform: 'base',
                    isBase: true
                });
                
                // Apply reflections iteratively - each level transforms ALL dots from previous level
                for (let level = 2; level <= this.reflectionLevel; level++) {
                    const transformedDots = this.applyReflectionTransformation(accumulatedDots, level);
                    const newDots = transformedDots.filter((dot, index) => index >= accumulatedDots.length);
                    
                    layers.push({
                        dots: newDots,
                        level: level,
                        transform: `level-${level}`,
                        isBase: false
                    });
                    
                    accumulatedDots = transformedDots;
                }
            }
        }
        
        return layers;
    }

    applyReflectionTransformation(dots, level) {
        // Apply reflection transformation to ALL existing dots (iterative approach)
        // This returns the cumulative result: original dots + new reflected dots
        switch (level) {
            case 2:
                // Level 2: First reflection stage - Type 1 vs Type 2 behavior differs here
                if (this.reflectionType === 1) {
                    // Type 1: Direct overlay with 180-degree rotation
                    const rotated = dots.map(dot => ({
                        ...dot,
                        x: 1 - dot.x,
                        y: 1 - dot.y
                    }));
                    return [...dots, ...rotated];
                } else {
                    // Type 2: Reflecting pool effect
                    // For reflecting pool, we create a completely new layout based on original dots
                    // Step 1: Position original in lower half (0.5 to 1.0)
                    const lowerHalf = this.normalizedDots.map(dot => ({
                        ...dot,
                        x: dot.x,
                        y: 0.5 + (dot.y * 0.5) // Scale to fit lower half
                    }));
                    
                    // Step 2: Create flipped reflection in upper half (0 to 0.5)
                    // Flip the original, then scale and position in upper half
                    const upperHalf = this.normalizedDots.map(dot => ({
                        ...dot,
                        x: dot.x,
                        y: 0.5 - (dot.y * 0.5) // Flip and scale to upper half
                    }));
                    
                    return [...upperHalf, ...lowerHalf];
                }
                
            case 3:
                // Level 3: Both types work the same way (90-degree rotation)
                const rotated90 = dots.map(dot => ({
                    ...dot,
                    x: 1 - dot.y,
                    y: dot.x
                }));
                return [...dots, ...rotated90];
                
            case 4:
                // Level 4: Both types work the same way (45-degree rotation)
                const rotated45 = dots.map(dot => {
                    const centerX = 0.5;
                    const centerY = 0.5;
                    const x = dot.x - centerX;
                    const y = dot.y - centerY;
                    const angle = Math.PI / 4; // 45 degrees
                    
                    return {
                        ...dot,
                        x: centerX + (x * Math.cos(angle) - y * Math.sin(angle)),
                        y: centerY + (x * Math.sin(angle) + y * Math.cos(angle))
                    };
                });
                return [...dots, ...rotated45];
                
            default:
                return dots;
        }
    }

    applyReflection(dots, level) {
        // Apply different reflection transformations based on level
        let newDots = [...dots];
        
        switch (level) {
            case 2:
                // Level 2: First reflection stage - Type 1 vs Type 2 behavior differs here
                if (this.reflectionType === 1) {
                    // Type 1: Direct overlay with 180-degree rotation
                    const rotated = dots.map(dot => ({
                        ...dot,
                        x: 1 - dot.x,
                        y: 1 - dot.y
                    }));
                    newDots = [...dots, ...rotated];
                } else {
                    // Type 2: Reflecting pool effect
                    // Step 1: Position original in lower half (0.5 to 1.0)
                    const lowerHalf = dots.map(dot => ({
                        ...dot,
                        x: dot.x,
                        y: 0.5 + (dot.y * 0.5) // Scale to fit lower half
                    }));
                    
                    // Step 2: Create flipped reflection in upper half (0 to 0.5)
                    // Flip the original, then scale and position in upper half
                    const upperHalf = dots.map(dot => ({
                        ...dot,
                        x: dot.x,
                        y: 0.5 - (dot.y * 0.5) // Flip and scale to upper half
                    }));
                    
                    newDots = [...upperHalf, ...lowerHalf];
                }
                break;
                
            case 3:
                // Level 3+: Both types work the same way (90-degree rotation)
                const rotated90 = dots.map(dot => ({
                    ...dot,
                    x: 1 - dot.y,
                    y: dot.x
                }));
                newDots = [...dots, ...rotated90];
                break;
                
            case 4:
                // Level 4+: Both types work the same way (45-degree rotation)
                const rotated45 = dots.map(dot => {
                    const centerX = 0.5;
                    const centerY = 0.5;
                    const x = dot.x - centerX;
                    const y = dot.y - centerY;
                    const angle = Math.PI / 4; // 45 degrees
                    
                    return {
                        ...dot,
                        x: centerX + (x * Math.cos(angle) - y * Math.sin(angle)),
                        y: centerY + (x * Math.sin(angle) + y * Math.cos(angle))
                    };
                });
                newDots = [...dots, ...rotated45];
                break;
        }
        
        return newDots;
    }

    applyTessellation(layers) {
        if (this.tessellationLevel === 1) return layers;
        
        const tessellatedLayers = [];
        const gridSize = this.tessellationLevel;
        const sectionSize = 1 / gridSize;
        
        layers.forEach(layer => {
            const tessellatedDots = [];
            
            for (let row = 0; row < gridSize; row++) {
                for (let col = 0; col < gridSize; col++) {
                    const offsetX = col * sectionSize;
                    const offsetY = row * sectionSize;
                    
                    layer.dots.forEach(dot => {
                        // Scale dot to section size and offset to grid position
                        tessellatedDots.push({
                            ...dot,
                            x: offsetX + (dot.x * sectionSize),
                            y: offsetY + (dot.y * sectionSize),
                            gridRow: row,
                            gridCol: col
                        });
                    });
                }
            }
            
            tessellatedLayers.push({
                ...layer,
                dots: tessellatedDots
            });
        });
        
        return tessellatedLayers;
    }

    drawLayers(layers) {
        // Draw all layers (should typically be just one composite layer now)
        layers.forEach(layer => {
            this.drawDots(layer.dots);
        });
    }

    drawLayersWithBlending(layers, plotType = 'main') {
        // Draw layers with proper blend mode application
        layers.forEach((layer, index) => {
            if (layer.isBase || index === 0) {
                // Draw base layer with normal compositing
                this.ctx.globalCompositeOperation = 'source-over';
            } else {
                // Draw reflection layers with selected blend mode
                this.ctx.globalCompositeOperation = this.blendMode;
            }
            
            this.drawDots(layer.dots, plotType);
        });
        
        // Reset blend mode
        this.ctx.globalCompositeOperation = 'source-over';
    }

    drawDots(dots, plotType = 'main') {
        // Use color system for plot coloring
        const colors = this.getColors();
        this.ctx.fillStyle = plotType === 'background' ? colors.backgroundPlot : colors.mainPlot;
        
        dots.forEach(dot => {
            // Filter out dots that are outside canvas bounds
            if (dot.x >= 0 && dot.x <= 1 && dot.y >= 0 && dot.y <= 1) {
                const canvasX = dot.x * this.canvasSize;
                const canvasY = dot.y * this.canvasSize;
                
                this.ctx.beginPath();
                this.ctx.arc(canvasX, canvasY, this.dotSize, 0, Math.PI * 2);
                this.ctx.fill();
            }
        });
    }

    // ====================================
    // ANIMATION SYSTEM
    // ====================================

    toggleAnimation() {
        if (this.rotationEnabled || this.translationEnabled) {
            if (!this.isAnimating) {
                this.startAnimation();
            }
        } else {
            this.stopAnimation();
        }
    }

    startAnimation() {
        this.isAnimating = true;
        this.startTime = Date.now();
        this.animate();
    }

    stopAnimation(skipRedraw = false) {
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        // Only redraw static version if not being called during deactivation
        if (!skipRedraw && this.isActive) {
            this.updateVisualization();
        }
    }

    animate() {
        if (!this.isAnimating) return;
        
        const elapsed = (Date.now() - this.startTime) / 1000; // Convert to seconds
        const progress = (elapsed % this.masterTime) / this.masterTime; // 0-1 progress through cycle
        
        this.drawAnimatedFrame(progress);
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    drawAnimatedFrame(progress) {
        if (!this.ctx || !this.normalizedDots.length) return;

        // Clear canvas  
        const colors = this.getColors();
        this.ctx.fillStyle = colors.canvasBackground;
        this.ctx.fillRect(0, 0, this.canvasSize, this.canvasSize);

        // Create or update snapshot if needed
        this.updateAnimationSnapshot();
        
        // Draw static background if enabled
        if (this.showBackground && this.animationSnapshotLayers) {
            this.drawLayersWithBlending(this.animationSnapshotLayers, 'background');
        }
        
        // Create animated version by transforming the snapshot layers
        if (this.animationSnapshotLayers) {
            const animatedLayers = this.applyAnimationToSnapshotLayers(this.animationSnapshotLayers, progress);
            
            // Draw animated layers with blend mode for overlay effect
            this.ctx.globalCompositeOperation = this.blendMode;
            animatedLayers.forEach(layer => {
                this.drawDots(layer.dots);
            });
            
            // Reset blend mode
            this.ctx.globalCompositeOperation = 'source-over';
        }
    }

    applyAnimationToSnapshotLayers(snapshotLayers, progress) {
        // Transform each layer while preserving layer structure
        return snapshotLayers.map(layer => {
            let transformedDots = [...layer.dots];
            
            // Create 3x3 grid for seamless animation (eliminates deadspace)
            transformedDots = this.create3x3Grid(transformedDots);
            
            // Apply rotation if enabled (rotates entire 3x3 grid as one unit)
            if (this.rotationEnabled) {
                const angle = progress * 2 * Math.PI;
                transformedDots = this.rotateDots3x3Grid(transformedDots, angle);
            }
            
            // Apply translation if enabled (translates entire 3x3 grid as one unit)
            if (this.translationEnabled) {
                transformedDots = this.translateDots3x3Grid(transformedDots, progress);
            }
            
            // Apply viewport culling to only render visible dots (performance optimization)
            transformedDots = this.cullToViewport(transformedDots);
            
            return {
                ...layer,
                dots: transformedDots
            };
        });
    }

    updateAnimationSnapshot() {
        // Create a pure snapshot of the complete composite visualization
        // This eliminates any pre-blended dots issues by taking exact final state
        if (!this.animationSnapshot || this.snapshotNeedsUpdate) {
            console.log('🔮 Creating animation snapshot');
            
            const baseLayers = this.generateReflectionLayers();
            const tessellatedLayers = this.applyTessellation(baseLayers);
            
            // Store layer structure for proper blend mode application during animation
            this.animationSnapshotLayers = tessellatedLayers;
            this.animationSnapshot = this.flattenLayers(tessellatedLayers);
            this.snapshotNeedsUpdate = false;
            
            console.log(`🔮 Snapshot created with ${this.animationSnapshot.length} dots in ${tessellatedLayers.length} layers`);
        }
    }

    applyAnimationToSnapshot(snapshotDots, progress) {
        let transformedDots = [...snapshotDots];
        
        // Create 3x3 grid for seamless animation (eliminates deadspace)
        transformedDots = this.create3x3Grid(transformedDots);
        
        // Apply rotation if enabled (rotates entire 3x3 grid as one unit)
        if (this.rotationEnabled) {
            const angle = progress * 2 * Math.PI;
            transformedDots = this.rotateDots3x3Grid(transformedDots, angle);
        }
        
        // Apply translation if enabled (translates entire 3x3 grid as one unit)
        if (this.translationEnabled) {
            transformedDots = this.translateDots3x3Grid(transformedDots, progress);
        }
        
        // Apply viewport culling to only render visible dots (performance optimization)
        transformedDots = this.cullToViewport(transformedDots);
        
        return transformedDots;
    }

    flattenLayers(layers) {
        // Combine all dots from all layers into single flattened array
        const flattenedDots = [];
        layers.forEach(layer => {
            flattenedDots.push(...layer.dots);
        });
        return flattenedDots;
    }

    applyAnimationToFlattenedDots(dots, progress) {
        let transformedDots = [...dots];
        
        // Apply rotation if enabled
        if (this.rotationEnabled) {
            const angle = progress * 2 * Math.PI;
            transformedDots = this.rotateDots(transformedDots, angle);
        }
        
        // Apply translation if enabled
        if (this.translationEnabled) {
            transformedDots = this.translateDotsEndless(transformedDots, progress);
        }
        
        return transformedDots;
    }

    applyAnimationTransforms(layers, progress) {
        const animatedLayers = [];
        
        layers.forEach(layer => {
            let transformedDots = [...layer.dots];
            
            // Apply rotation if enabled
            if (this.rotationEnabled) {
                const angle = progress * 2 * Math.PI; // Full rotation over cycle
                transformedDots = this.rotateDots(transformedDots, angle);
            }
            
            // Apply translation if enabled
            if (this.translationEnabled) {
                transformedDots = this.translateDots(transformedDots, progress);
            }
            
            animatedLayers.push({
                ...layer,
                dots: transformedDots
            });
        });
        
        return animatedLayers;
    }

    rotateDots(dots, angle) {
        const centerX = 0.5;
        const centerY = 0.5;
        
        return dots.map(dot => {
            const x = dot.x - centerX;
            const y = dot.y - centerY;
            
            return {
                ...dot,
                x: centerX + (x * Math.cos(angle) - y * Math.sin(angle)),
                y: centerY + (x * Math.sin(angle) + y * Math.cos(angle))
            };
        });
    }

    translateDotsEndless(dots, progress) {
        // Create endless spool effect - linear translation with wrapping
        let offsetX = 0;
        let offsetY = 0;
        
        // Linear movement based on progress (0-1 over master time)
        switch (this.translationDirection) {
            case 'up':
                offsetY = -progress; // Move up continuously
                break;
            case 'down':
                offsetY = progress; // Move down continuously
                break;
            case 'left':
                offsetX = -progress; // Move left continuously
                break;
            case 'right':
                offsetX = progress; // Move right continuously
                break;
        }
        
        // Create multiple copies to simulate endless spool
        const spoolDots = [];
        const copies = 3; // Number of copies in each direction
        
        for (let i = -copies; i <= copies; i++) {
            let copyOffsetX = offsetX;
            let copyOffsetY = offsetY;
            
            // Add spacing between copies based on direction
            if (this.translationDirection === 'left' || this.translationDirection === 'right') {
                copyOffsetX += i * 1.0; // Horizontal spacing
            } else {
                copyOffsetY += i * 1.0; // Vertical spacing
            }
            
            dots.forEach(dot => {
                const translatedDot = {
                    ...dot,
                    x: dot.x + copyOffsetX,
                    y: dot.y + copyOffsetY
                };
                
                // Only include dots that are visible or nearly visible
                if (translatedDot.x >= -0.5 && translatedDot.x <= 1.5 && 
                    translatedDot.y >= -0.5 && translatedDot.y <= 1.5) {
                    spoolDots.push(translatedDot);
                }
            });
        }
        
        return spoolDots;
    }

    // Keep the old method for backward compatibility (though it shouldn't be used now)
    translateDots(dots, progress) {
        return this.translateDotsEndless(dots, progress);
    }

    // ====================================
    // 3X3 GRID SYSTEM FOR DEADSPACE ELIMINATION
    // ====================================

    create3x3Grid(dots) {
        // Create a 3x3 grid of the pattern to eliminate deadspace during rotation/translation
        // Center square (1,1) represents the visible canvas (0-1, 0-1)
        // Grid coordinates: (-1,-1) to (2,2) in normalized space
        const gridDots = [];
        
        for (let gridY = -1; gridY <= 1; gridY++) {
            for (let gridX = -1; gridX <= 1; gridX++) {
                dots.forEach(dot => {
                    gridDots.push({
                        ...dot,
                        x: dot.x + gridX,
                        y: dot.y + gridY,
                        gridX: gridX,
                        gridY: gridY
                    });
                });
            }
        }
        
        return gridDots;
    }

    rotateDots3x3Grid(dots, angle) {
        // Rotate entire 3x3 grid around the center of the visible canvas (0.5, 0.5)
        const centerX = 0.5; // Center of visible canvas
        const centerY = 0.5;
        
        return dots.map(dot => {
            const x = dot.x - centerX;
            const y = dot.y - centerY;
            
            return {
                ...dot,
                x: centerX + (x * Math.cos(angle) - y * Math.sin(angle)),
                y: centerY + (x * Math.sin(angle) + y * Math.cos(angle))
            };
        });
    }

    translateDots3x3Grid(dots, progress) {
        // Translate entire 3x3 grid as one unit
        let offsetX = 0;
        let offsetY = 0;
        
        // Calculate translation offset based on direction
        switch (this.translationDirection) {
            case 'up':
                offsetY = -progress;
                break;
            case 'down':
                offsetY = progress;
                break;
            case 'left':
                offsetX = -progress;
                break;
            case 'right':
                offsetX = progress;
                break;
        }
        
        return dots.map(dot => ({
            ...dot,
            x: dot.x + offsetX,
            y: dot.y + offsetY
        }));
    }

    cullToViewport(dots) {
        // Only render dots within visible viewport plus small buffer for smoother edges
        // Visible canvas is 0-1, buffer extends slightly beyond for smooth transitions
        const buffer = 0.1; // 10% buffer beyond visible edges
        const minX = -buffer;
        const maxX = 1 + buffer;
        const minY = -buffer;
        const maxY = 1 + buffer;
        
        return dots.filter(dot => 
            dot.x >= minX && dot.x <= maxX && 
            dot.y >= minY && dot.y <= maxY
        );
    }

    // ====================================
    // COLOR SYSTEM INTEGRATION
    // ====================================

    getColors() {
        // Return current colors for rendering
        if (this.colorManager) {
            return this.colorManager.applyColors(this.ctx);
        }
        
        // Fallback colors if color manager not available
        return {
            mainPlot: '#FFFFFF',
            backgroundPlot: '#FFFFFF',
            canvasBackground: '#000000'
        };
    }
}

// ====================================
// INTEGRATION
// ====================================

// Global color picker function for popup window access
window.openColorPicker = function(colorType) {
    // Find the active reflections instance
    if (window.reflectionsViz && window.reflectionsViz.colorManager) {
        const currentColor = window.reflectionsViz.colorManager.getColor(colorType);
        window.reflectionsViz.colorManager.createColorPicker(colorType, currentColor);
    }
};

// Auto-integration with LRCVisuals
if (typeof window !== 'undefined') {
    window.LRCReflections = LRCReflections;
    
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (window.lrcVisuals) {
                // Create reflections instance
                const reflections = new LRCReflections(window.lrcVisuals);
                
                // Add to plot types
                if (!window.lrcVisuals.plotTypes) {
                    window.lrcVisuals.plotTypes = {};
                }
                window.lrcVisuals.plotTypes['reflections'] = reflections;
                
                // Add to dropdown (insert after Linear Plot)
                const plotSelect = document.getElementById('viz-type-selector');
                if (plotSelect) {
                    const option = document.createElement('option');
                    option.value = 'reflections';
                    option.textContent = 'Reflections';
                    
                    // Insert after Linear Plot (index 1)
                    plotSelect.insertBefore(option, plotSelect.children[1]);
                    console.log('🔮 Reflections option added to plot selector');
                    
                    // Listen for plot type changes to activate/deactivate properly (reuse the same plotSelect)
                    plotSelect.addEventListener('change', (e) => {
                        const reflectionsViz = window.lrcVisuals.plotTypes['reflections'];
                        if (e.target.value === 'reflections') {
                            if (reflectionsViz) {
                                reflectionsViz.updateData();
                                reflectionsViz.activate();
                            }
                        } else {
                            // Deactivate reflections if switching away
                            if (reflectionsViz && reflectionsViz.isActive) {
                                reflectionsViz.deactivate();
                            }
                        }
                    });
                }
                
                // Integrate with visualization system via event listener (no method hijacking)
                window.addEventListener('rhythmGenerated', () => {
                    const reflectionsViz = window.lrcVisuals.plotTypes['reflections'];
                    if (reflectionsViz) {
                        // ALWAYS reset Reflections on new rhythm generation (architectural principle)
                        // This ensures clean state regardless of whether Reflections is currently active
                        reflectionsViz.fullSystemReset();
                        
                        // Only update data if Reflections is currently the active visualization
                        if (window.lrcVisuals.currentPlotType === 'reflections') {
                            reflectionsViz.updateData();
                        }
                    }
                });
                
                console.log('🔮 Reflections visualization integrated');
            }
        }, 100);
    });
}
