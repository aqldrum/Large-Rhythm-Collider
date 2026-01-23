// ====================================
// UI CONTROLLER
// ====================================

class ColliderUI {
    constructor(battleController) {
        this.battleController = battleController;
        this.setupComplete = false;
        this.popupWindow = null;
        this.currentStage = 'creation'; // 'creation' or 'battle'
        this.isClosing = false; // Flag to prevent recursive closePopup calls
        this.popupMonitorInterval = null; // Polling interval to detect popup close
    }

    openColliderPopup() {
        if (this.popupWindow && !this.popupWindow.closed) {
            this.popupWindow.focus();
            return;
        }

        // Only reset if this is a re-opening (popup was previously used)
        if (this.setupComplete) {
            console.log('🔄 Re-opening Collider - resetting previous state');
            this.resetAllUIState();
            if (this.battleController) {
                this.battleController.resetBattle();
            }
        }

        this.popupWindow = window.open('', 'ColliderBattle', 
            'width=1200,height=800,resizable=yes,scrollbars=no,menubar=no,toolbar=no,location=no,status=no');
        
        // Start monitoring for popup close (polling approach like Reflections)
        if (this.popupMonitorInterval) {
            clearInterval(this.popupMonitorInterval);
        }
        
        this.popupMonitorInterval = setInterval(() => {
            if (!this.popupWindow || this.popupWindow.closed) {
                this.closePopup();
                clearInterval(this.popupMonitorInterval);
                this.popupMonitorInterval = null;
            }
        }, 1000);

        if (!this.popupWindow) {
            alert('Popup blocked! Please allow popups for the Collider Battle interface.');
            return;
        }

        this.setupPopupContent();
        this.currentStage = 'creation';
        console.log('🎮 Collider popup window opened - all state reset');
    }

    setupPopupContent() {
        const doc = this.popupWindow.document;
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Large Rhythm Collider - Battle Interface</title>
                <style>
                    body { 
                        margin: 0; 
                        background: #1a1a1a; 
                        color: #fff; 
                        font-family: monospace; 
                        overflow: hidden;
                    }
                    #collider-container { 
                        width: 100vw; 
                        height: 100vh; 
                        position: relative; 
                    }
                    #battle-canvas { 
                        position: absolute; 
                        top: 0; 
                        left: 0; 
                        background: #0a0a0a; 
                        border: 1px solid #444; 
                    }
                    .stage-container { 
                        position: absolute; 
                        top: 0; 
                        left: 0; 
                        width: 100vw; 
                        height: 100vh; 
                        box-sizing: border-box;
                        overflow: hidden;
                    }
                </style>
            </head>
            <body>
                <div id="collider-container">
                    <canvas id="battle-canvas"></canvas>
                    <div id="creation-stage" class="stage-container"></div>
                    <div id="battle-stage" class="stage-container" style="display: none;"></div>
                </div>
                <script>
                    // Copy CreatePlayer class from parent window
                    window.CreatePlayer = window.opener.CreatePlayer;
                    window.lrcModule = window.opener.lrcModule;
                </script>
            </body>
            </html>
        `);
        doc.close();

        // Initialize canvas
        this.setupPopupCanvas();
        
        // Load CreatePlayer interface with a small delay to ensure popup is ready
        setTimeout(() => {
            this.loadCreatePlayerStage();
        }, 100);
    }

    setupPopupCanvas() {
        const canvas = this.popupWindow.document.getElementById('battle-canvas');
        if (!canvas) return;

        // Ensure canvas fits within popup window bounds
        const availableWidth = this.popupWindow.innerWidth;
        const availableHeight = this.popupWindow.innerHeight;
        
        canvas.width = availableWidth;
        canvas.height = availableHeight;
        canvas.style.width = availableWidth + 'px';
        canvas.style.height = availableHeight + 'px';
        
        this.popupCanvas = canvas;
        this.popupCtx = canvas.getContext('2d');

        // Handle window resize
        this.popupWindow.addEventListener('resize', () => {
            const newWidth = this.popupWindow.innerWidth;
            const newHeight = this.popupWindow.innerHeight;
            canvas.width = newWidth;
            canvas.height = newHeight;
            canvas.style.width = newWidth + 'px';
            canvas.style.height = newHeight + 'px';
        });
    }

    loadCreatePlayerStage() {
        if (!this.popupWindow) return;
        
        const creationStage = this.popupWindow.document.getElementById('creation-stage');
        if (!creationStage) return;

        // This will be implemented by CreatePlayer.js
        if (window.CreatePlayer) {
            this.createPlayerInstance = new window.CreatePlayer(creationStage, this);
        } else {
            console.error('CreatePlayer.js not loaded');
        }
    }

    switchToBattleStage() {
        if (!this.popupWindow) return;

        const creationStage = this.popupWindow.document.getElementById('creation-stage');
        const battleStage = this.popupWindow.document.getElementById('battle-stage');
        
        if (creationStage) creationStage.style.display = 'none';
        if (battleStage) battleStage.style.display = 'block';

        this.currentStage = 'battle';
        this.setupBattleStageUI();
        
        // Start the battle animation
        this.startBattleAnimation();
        
        console.log('🎮 Switched to battle stage');
    }

    startBattleAnimation() {
        // Ensure canvas is ready and start the battle animation
        if (window.lrcVisuals && window.lrcVisuals.plotTypes && window.lrcVisuals.plotTypes['collider']) {
            const collider = window.lrcVisuals.plotTypes['collider'];
            
            // Make sure the collider knows about our popup canvas
            if (this.popupCanvas && this.popupCtx) {
                console.log('⚔️ Setting up collider with popup canvas');
                collider.canvas = this.popupCanvas;
                collider.ctx = this.popupCtx;
            }
            
            collider.startAnimation();
        } else {
            console.error('⚔️ Collider visualization not found');
        }
    }

    setupBattleStageUI() {
        const battleStage = this.popupWindow.document.getElementById('battle-stage');
        if (!battleStage) return;

        // Create draggable/minimizable Controls panel
        this.createBattleControlsPanel();

        // Create player corner divs for battle
        this.createBattlePlayerDivs();
    }

    createBattleControlsPanel() {
        const battleStage = this.popupWindow.document.getElementById('battle-stage');
        if (!battleStage) return;

        // Add CSS styles to popup document
        const style = this.popupWindow.document.createElement('style');
        style.textContent = `
            :root {
                --hud-bg: rgba(20, 20, 20, 0.9);
                --hud-border: rgba(100, 100, 100, 0.3);
                --hud-accent: #00ff88;
                --hud-text: #ffffff;
                --hud-text-muted: #cccccc;
                --hud-header: rgba(40, 40, 40, 0.95);
                --border-radius: 6px;
                --transition-speed: 0.3s;
            }
            
            .battle-controls-panel {
                position: fixed;
                top: 50%;
                right: 20px;
                transform: translateY(-50%);
                background: var(--hud-bg);
                border: 1px solid var(--hud-border);
                border-radius: var(--border-radius);
                backdrop-filter: blur(10px);
                z-index: 1000;
                transition: all var(--transition-speed);
                cursor: move;
                user-select: none;
                min-width: 200px;
                max-width: 300px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            }
            
            .battle-controls-panel:hover {
                border-color: var(--hud-accent);
                box-shadow: 0 0 15px rgba(0, 255, 136, 0.2);
            }
            
            .battle-controls-panel.minimized .control-content {
                display: none !important;
            }
            
            .control-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px;
                background: var(--hud-header);
                border-bottom: 1px solid var(--hud-border);
                cursor: move;
            }
            
            .control-header h3 {
                margin: 0;
                font-size: 13px;
                font-weight: 500;
                color: var(--hud-accent);
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            
            .control-content {
                padding: 12px;
            }
            
            .control-group {
                margin-bottom: 15px;
            }
            
            .control-group:last-child {
                margin-bottom: 0;
            }
            
            .control-label {
                display: block;
                color: var(--hud-text);
                font-size: 11px;
                font-weight: 500;
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
                background: var(--hud-accent);
                cursor: pointer;
                box-shadow: 0 0 4px rgba(0, 255, 136, 0.3);
            }
            
            .control-slider::-moz-range-thumb {
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: var(--hud-accent);
                cursor: pointer;
                border: none;
                box-shadow: 0 0 4px rgba(0, 255, 136, 0.3);
            }
            
            .control-value {
                text-align: center;
                color: var(--hud-accent);
                font-size: 12px;
                font-weight: bold;
                margin-top: 5px;
            }
            
            .minimize-btn {
                background: none;
                border: none;
                color: var(--hud-text-muted);
                font-size: 16px;
                cursor: pointer;
                padding: 0;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: color var(--transition-speed);
            }
            
            .minimize-btn:hover {
                color: var(--hud-accent);
            }
        `;
        this.popupWindow.document.head.appendChild(style);

        // Create the controls panel
        const controlsPanel = this.popupWindow.document.createElement('div');
        controlsPanel.className = 'battle-controls-panel';
        controlsPanel.innerHTML = `
            <div class="control-header">
                <h3>Battle Controls</h3>
                <button class="minimize-btn" id="controls-minimize">−</button>
            </div>
            <div class="control-content">
                <div class="control-group">
                    <label class="control-label">Cycle Speed</label>
                    <input type="range" class="control-slider" id="battle-speed-slider" 
                           min="0.1" max="20" step="0.1" value="1">
                    <div class="control-value" id="battle-speed-value">1.0x</div>
                </div>
                <div class="control-group">
                    <label class="control-label">Force Amplitude</label>
                    <input type="range" class="control-slider" id="force-amplitude-slider" 
                           min="0.1" max="10" step="0.1" value="1">
                    <div class="control-value" id="force-amplitude-value">1.0x</div>
                </div>
                <div class="control-group">
                    <label class="control-label">Line Thickness</label>
                    <input type="range" class="control-slider" id="thickness-slider" 
                           min="0" max="1" step="0.001" value="0">
                    <div class="control-value" id="thickness-value">3.0px</div>
                </div>
                <div class="control-group">
                    <label class="control-label">Audio Volume</label>
                    <input type="range" class="control-slider" id="audio-volume-slider" 
                           min="-60" max="0" step="1" value="-24">
                    <div class="control-value" id="audio-volume-value">-24 dB</div>
                </div>
            </div>
        `;
        
        battleStage.appendChild(controlsPanel);

        // Position panel vertically centered on the right edge
        this.popupWindow.requestAnimationFrame(() => {
            const panelHeight = controlsPanel.offsetHeight || 0;
            const availableHeight = this.popupWindow.innerHeight || 0;
            const computedTop = Math.max(20, (availableHeight - panelHeight) / 2);
            controlsPanel.style.top = computedTop + 'px';
            controlsPanel.style.transform = 'none';
        });

        // Make it draggable
        this.makeDraggable(controlsPanel);
        
        // Wire up controls
        this.setupControlsEventListeners();
    }

    makeDraggable(element) {
        let isDragging = false;
        let startX, startY, startLeft, startTop;
        
        const header = element.querySelector('.control-header');
        
        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('minimize-btn')) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(this.popupWindow.getComputedStyle(element).left);
            startTop = parseInt(this.popupWindow.getComputedStyle(element).top);
            
            element.style.zIndex = '1001';
            
            e.preventDefault();
        });
        
        this.popupWindow.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const newLeft = startLeft + e.clientX - startX;
            const newTop = startTop + e.clientY - startY;
            
            element.style.left = newLeft + 'px';
            element.style.top = newTop + 'px';
        });
        
        this.popupWindow.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                element.style.zIndex = '1000';
            }
        });
    }

    setupControlsEventListeners() {
        const doc = this.popupWindow.document;
        
        // Minimize button
        const minimizeBtn = doc.getElementById('controls-minimize');
        const controlsPanel = doc.querySelector('.battle-controls-panel');
        
        if (minimizeBtn && controlsPanel) {
            minimizeBtn.addEventListener('click', () => {
                controlsPanel.classList.toggle('minimized');
                minimizeBtn.textContent = controlsPanel.classList.contains('minimized') ? '+' : '−';
            });
        }
        
        // Battle Speed slider
        const speedSlider = doc.getElementById('battle-speed-slider');
        const speedValue = doc.getElementById('battle-speed-value');
        
        if (speedSlider && speedValue) {
            speedSlider.addEventListener('input', (e) => {
                const speed = parseFloat(e.target.value);
                speedValue.textContent = `${speed}x`;
                
                if (this.battleController) {
                    this.battleController.setMasterSpeed(speed);
                }
            });
        }
        
        // Force Amplitude slider
        const amplitudeSlider = doc.getElementById('force-amplitude-slider');
        const amplitudeValue = doc.getElementById('force-amplitude-value');
        
        if (amplitudeSlider && amplitudeValue) {
            amplitudeSlider.addEventListener('input', (e) => {
                const amplitude = parseFloat(e.target.value);
                amplitudeValue.textContent = `${amplitude}x`;
                
                // Apply force amplitude to all active players
                for (const player of this.battleController.players) {
                    if (player.isAlive && player.setForceAmplitude) {
                        player.setForceAmplitude(amplitude);
                    }
                }
            });
        }
        
        // Thickness slider
        const thicknessSlider = doc.getElementById('thickness-slider');
        const thicknessValue = doc.getElementById('thickness-value');
        const thicknessMin = 0.5;
        const thicknessMax = 500;

        const sliderToThickness = (val) => {
            const sliderVal = Math.min(1, Math.max(0, parseFloat(val)));
            const ratio = thicknessMax / thicknessMin;
            return thicknessMin * Math.pow(ratio, sliderVal);
        };

        const thicknessToSlider = (thickness) => {
            const clamped = Math.min(thicknessMax, Math.max(thicknessMin, thickness));
            const ratio = thicknessMax / thicknessMin;
            return Math.log(clamped / thicknessMin) / Math.log(ratio);
        };

        const applyThickness = (thickness) => {
            const formatted = thickness >= 10 ? thickness.toFixed(1) : thickness.toFixed(2);
            thicknessValue.textContent = `${formatted}px`;

            if (window.lrcVisuals?.plotTypes?.collider) {
                window.lrcVisuals.plotTypes['collider'].lineThickness = thickness;
            }
        };

        if (thicknessSlider && thicknessValue) {
            // Sync slider to current collider value or default 3px
            const initialThickness = window.lrcVisuals?.plotTypes?.collider?.lineThickness || 3;
            thicknessSlider.value = thicknessToSlider(initialThickness).toFixed(3);
            applyThickness(initialThickness);

            thicknessSlider.addEventListener('input', (e) => {
                const thickness = sliderToThickness(e.target.value);
                applyThickness(thickness);
            });
        }
        
        // Audio Volume slider
        const audioVolumeSlider = doc.getElementById('audio-volume-slider');
        const audioVolumeValue = doc.getElementById('audio-volume-value');
        
        if (audioVolumeSlider && audioVolumeValue) {
            audioVolumeSlider.addEventListener('input', (e) => {
                const volumeDb = parseInt(e.target.value);
                audioVolumeValue.textContent = `${volumeDb} dB`;
                
                // Update ColliderAudio if it exists
                if (this.battleController && this.battleController.colliderAudio) {
                    this.battleController.colliderAudio.setMasterVolumeDb(volumeDb);
                }
            });
        }
        
    }

    createBattlePlayerDivs() {
        const battleStage = this.popupWindow.document.getElementById('battle-stage');
        if (!battleStage) return;

        const positions = [
            { top: '60px', left: '10px' },
            { top: '60px', right: '10px' },
            { bottom: '60px', left: '10px' },
            { bottom: '60px', right: '10px' }
        ];

        for (let i = 0; i < 4; i++) {
            const player = this.battleController.players[i];
            const position = positions[i];

            const playerDiv = this.popupWindow.document.createElement('div');
            playerDiv.id = `battle-player-${player.playerId}`;
            playerDiv.style.cssText = `
                position: absolute;
                background: rgba(0, 0, 0, 0.9);
                border: 2px solid ${player.color};
                border-radius: 8px;
                padding: 12px;
                color: #fff;
                font-family: monospace;
                font-size: 12px;
                min-width: 120px;
                max-width: 160px;
                backdrop-filter: blur(5px);
                ${position.top ? `top: ${position.top};` : ''}
                ${position.bottom ? `bottom: ${position.bottom};` : ''}
                ${position.left ? `left: ${position.left};` : ''}
                ${position.right ? `right: ${position.right};` : ''}
            `;

            playerDiv.innerHTML = this.generateBattlePlayerHTML(player);
            battleStage.appendChild(playerDiv);
        }
    }

    generateBattlePlayerHTML(player) {
        const hpPercent = player.maxHp > 0 ? (player.hp / player.maxHp) * 100 : 0;
        const healthBarColor = hpPercent > 20 ? '#00ff88' : '#ff4444';

        return `
            <div style="color: ${player.color}; font-weight: bold; margin-bottom: 8px;">
                PLAYER ${player.playerId} ${player.isAlive ? '' : '💀'}
            </div>
            <div style="margin-bottom: 4px;">HP: <span style="color: ${player.color}; font-weight: bold;">${player.hp}</span>/${player.maxHp || player.hp}</div>
            <div style="margin-bottom: 8px;">Nodes: ${player.nodeCount || 0}</div>
            <div style="background: #222; height: 8px; border-radius: 4px; overflow: hidden; border: 1px solid #555;">
                <div style="width: ${hpPercent}%; height: 100%; background: ${healthBarColor}; transition: all 0.3s; border-radius: 3px;"></div>
            </div>
        `;
    }

    updateBattlePlayerDivs() {
        if (this.currentStage !== 'battle' || !this.popupWindow) return;

        for (let i = 0; i < 4; i++) {
            const player = this.battleController.players[i];
            const playerDiv = this.popupWindow.document.getElementById(`battle-player-${player.playerId}`);
            
            if (playerDiv) {
                playerDiv.innerHTML = this.generateBattlePlayerHTML(player);
            }
        }
    }

    resetToPlayerCreation() {
        if (!this.popupWindow) return;

        // Remove victory overlay if it exists
        const victoryOverlay = this.popupWindow.document.getElementById('victory-overlay');
        if (victoryOverlay) {
            victoryOverlay.remove();
        }

        // Clear battle stage completely
        const battleStage = this.popupWindow.document.getElementById('battle-stage');
        if (battleStage) {
            battleStage.innerHTML = ''; // Clear all battle UI elements
        }

        // Switch back to creation stage
        const creationStage = this.popupWindow.document.getElementById('creation-stage');
        
        if (creationStage) creationStage.style.display = 'block';
        if (battleStage) battleStage.style.display = 'none';

        this.currentStage = 'creation';

        // Reset ALL UI state completely
        this.resetAllUIState();

        // Reset CreatePlayer instance if it exists
        if (this.createPlayerInstance) {
            this.createPlayerInstance.reset();
        } else {
            // Reload the CreatePlayer stage
            this.loadCreatePlayerStage();
        }

        console.log('🔄 Reset to player creation stage');
    }
    
    resetAllUIState() {
        console.log('🧹 COMPREHENSIVE UI STATE RESET initiated...');
        
        // Reset any cached UI state or timers
        this.setupComplete = false;
        
        // Clear any references to battle controls
        this.battleControlsPanel = null;
        
        // Reset Collider visualization if it exists
        if (window.lrcVisuals && window.lrcVisuals.plotTypes && window.lrcVisuals.plotTypes['collider']) {
            const collider = window.lrcVisuals.plotTypes['collider'];
            collider.lineThickness = 3; // Reset to default
            
            // Stop animation if running
            collider.stopAnimation();
            
            // Reset camera to defaults
            if (collider.camera) {
                collider.camera = {
                    x: 0, y: 0, scale: 1,
                    targetX: 0, targetY: 0, targetScale: 1,
                    smoothing: 0.08
                };
            }
            
            // Clear any cached camera data
            if (collider.lastCameraDebug) collider.lastCameraDebug = 0;
            if (collider.lastBoundsDebug) collider.lastBoundsDebug = 0;
        }
        
        // CRITICAL: Reset all UI control values to defaults if popup window exists
        if (this.popupWindow && !this.popupWindow.closed) {
            this.resetUIControlValues();
        }
        
        console.log('🧹 All UI state reset - controls restored to defaults');
    }
    
    resetUIControlValues() {
        if (!this.popupWindow || this.popupWindow.closed) return;
        
        const doc = this.popupWindow.document;
        
        // Reset Battle Speed to 1.0x
        const speedSlider = doc.getElementById('battle-speed-slider');
        const speedValue = doc.getElementById('battle-speed-value');
        if (speedSlider && speedValue) {
            speedSlider.value = '1';
            speedValue.textContent = '1.0x';
            // Apply to battle controller
            if (this.battleController) {
                this.battleController.setMasterSpeed(1.0);
            }
        }
        
        // Reset Force Amplitude to 1.0x
        const amplitudeSlider = doc.getElementById('force-amplitude-slider');
        const amplitudeValue = doc.getElementById('force-amplitude-value');
        if (amplitudeSlider && amplitudeValue) {
            amplitudeSlider.value = '1';
            amplitudeValue.textContent = '1.0x';
            // Apply to all players
            for (const player of this.battleController.players) {
                player.forceAmplitude = 1.0;
            }
        }
        
        // Reset Line Thickness to 3px
        const thicknessSlider = doc.getElementById('thickness-slider');
        const thicknessValue = doc.getElementById('thickness-value');
        if (thicknessSlider && thicknessValue) {
            const defaultThickness = 3;
            const thicknessMin = 0.5;
            const thicknessMax = 500;
            const ratio = thicknessMax / thicknessMin;
            const sliderValue = Math.log(defaultThickness / thicknessMin) / Math.log(ratio);
            thicknessSlider.value = sliderValue.toFixed(3);
            thicknessValue.textContent = '3.0px';
            if (window.lrcVisuals?.plotTypes?.collider) {
                window.lrcVisuals.plotTypes['collider'].lineThickness = defaultThickness;
            }
        }
        
        // Reset Audio Volume to -24dB
        const audioVolumeSlider = doc.getElementById('audio-volume-slider');
        const audioVolumeValue = doc.getElementById('audio-volume-value');
        if (audioVolumeSlider && audioVolumeValue) {
            audioVolumeSlider.value = '-24';
            audioVolumeValue.textContent = '-24 dB';
            // Apply to ColliderAudio
            if (this.battleController && this.battleController.colliderAudio) {
                this.battleController.colliderAudio.setMasterVolumeDb(-24);
            }
        }
        
        console.log('🎛️ UI control values reset to defaults');
    }

    closePopup() {
        // Prevent recursive calls - exit immediately if already closing
        if (this.isClosing) {
            console.log('🎮 closePopup() already in progress - skipping recursive call');
            return;
        }
        
        // Set flag to prevent recursive calls
        this.isClosing = true;
        console.log('🎮 MANUAL POPUP CLOSE - initiating comprehensive reset (ONCE)...');
        
        try {
            // CRITICAL: Perform complete reset before closing (runs ONLY once)
            if (this.battleController) {
                this.battleController.resetBattle();
            }
            
            // Reset Collider visualization state
            this.resetAllUIState();
            
            // Close the actual popup window
            if (this.popupWindow && !this.popupWindow.closed) {
                this.popupWindow.close();
            }
            
            // Completely reset all internal state when popup closes
            this.popupWindow = null;
            this.setupComplete = false;
            this.currentStage = 'creation';
            this.popupCanvas = null;
            this.popupCtx = null;
            this.createPlayerInstance = null;
            this.battleControlsPanel = null;
            
            // Clear popup monitoring
            if (this.popupMonitorInterval) {
                clearInterval(this.popupMonitorInterval);
                this.popupMonitorInterval = null;
            }
            
            console.log('🎮 Collider popup closed - comprehensive reset completed (cache clear finished)');
            
            // DEFER Linear Plot switch and rhythm regeneration until after all cleanup is complete
            setTimeout(() => {
                // Auto-switch back to the most recent canvas visualization
                const fallbackType = (window.lrcVisuals && window.lrcVisuals.getLastNonPopupPlotType)
                    ? window.lrcVisuals.getLastNonPopupPlotType()
                    : 'linear';
                if (window.lrcHUD && window.lrcHUD.setVisualizationType) {
                    window.lrcHUD.setVisualizationType(fallbackType);
                } else {
                    const vizSelector = document.querySelector('#visualizations-div #viz-type-selector') ||
                        document.getElementById('viz-type-selector');
                    if (vizSelector) {
                        vizSelector.value = fallbackType;
                        vizSelector.dispatchEvent(new Event('change', { bubbles: true }));
                    } else if (window.lrcVisuals) {
                        window.lrcVisuals.setPlotType(fallbackType);
                    }
                }
                console.log(`📊 Restored ${fallbackType} after Collider Battle close`);
                
                // Re-trigger main rhythm generation with current input values
                if (window.lrcHudController && window.lrcHudController.handleRhythmSubmission) {
                    console.log('🔄 Re-triggering rhythm generation with current input values');
                    window.lrcHudController.handleRhythmSubmission();
                }
                
                // Reset the closing flag after everything is complete
                this.isClosing = false;
                console.log('✅ Collider close sequence completed successfully');
            }, 100); // Small delay to ensure all cleanup is finished
            
        } catch (error) {
            console.error('❌ Error during Collider closePopup:', error);
            this.isClosing = false; // Reset flag even on error
        }
    }

    initializeSpeedControl() {
        // Create speed control container
        const speedContainer = document.createElement('div');
        speedContainer.className = 'speed-control-container';
        speedContainer.innerHTML = `
            <div class="control-section">
                <label for="collider-speed">Cycle Speed</label>
                <input type="range" id="collider-speed" min="0.1" max="20" step="0.1" value="1">
                <div class="control-value">
                    <span id="speed-display">1.0x</span>
                    <small>(1 unit = 1ms)</small>
                </div>
            </div>
        `;
        
        // Add to the main UI container (adjust selector as needed)
        const uiContainer = document.querySelector('#collider-controls') || document.body;
        uiContainer.appendChild(speedContainer);
        
        // Wire up the speed control
        const speedSlider = document.getElementById('collider-speed');
        const speedDisplay = document.getElementById('speed-display');
        
        speedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            speedDisplay.textContent = `${speed}x`;
            
            // Update the battle controller's master clock
            if (window.battleController) {
                window.battleController.setMasterSpeed(speed);
            }
            
            console.log(`⚡ Battle speed set to ${speed}x (${speed} units/ms)`);
        });
        
        console.log('🎛️ Speed control initialized');
    }

    // Legacy method - now handled by popup system
    createPlayerDivs() {
        console.log('🎮 Player divs now handled by popup system');
    }
    
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? 
            `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` :
            '255, 255, 255';
    }

    generatePlayerHTML(player) {
        if (this.battleController.gameState === 'setup') {
            return `
                <div class="player-header" style="color: ${player.color}; font-weight: bold; margin-bottom: 8px;">
                    PLAYER ${player.playerId}
                </div>
                <div class="rhythm-inputs">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px;">
                        <div>A: <input type="number" id="p${player.playerId}-a" min="1" value="8" style="width: 40px;"></div>
                        <div>B: <input type="number" id="p${player.playerId}-b" min="1" value="7" style="width: 40px;"></div>
                        <div>C: <input type="number" id="p${player.playerId}-c" min="1" value="6" style="width: 40px;"></div>
                        <div>D: <input type="number" id="p${player.playerId}-d" min="1" value="5" style="width: 40px;"></div>
                    </div>
                    <button onclick="window.colliderUI.updatePlayerRhythm(${player.playerId})" 
                            style="width: 100%; padding: 4px; background: ${player.color}; border: none; color: #000; font-weight: bold;">
                        Generate Rhythm
                    </button>
                </div>
                <div id="p${player.playerId}-status" style="margin-top: 6px; font-size: 9px; color: #888;">
                    Ready to generate...
                </div>
            `;
        } else {
            // Battle mode - show HP and status
            return `
                <div class="player-header" style="color: ${player.color}; font-weight: bold; margin-bottom: 8px;">
                    PLAYER ${player.playerId} ${player.isAlive ? '' : '💀'}
                </div>
                <div class="battle-stats">
                    <div style="margin-bottom: 4px;">HP: <span style="color: ${player.color}; font-weight: bold;">${player.hp}</span></div>
                    <div style="margin-bottom: 4px;">Nodes: ${player.nodeCount}</div>
                    <div style="margin-bottom: 4px;">Phase: ${player.animationPhase}</div>
                    <div style="font-size: 9px; color: ${player.isInvulnerable ? '#fff' : '#888'};">
                        ${player.isInvulnerable ? '🛡️ INVULNERABLE' : 
                          player.isReconnecting ? '🔧 Reconnecting...' : '⚔️ In Battle'}
                    </div>
                </div>
            `;
        }
    }

    setupEventListeners() {
        // Global window functions for onclick handlers
        window.colliderUI = this;
    }

    updatePlayerRhythm(playerId) {
        const player = this.battleController.getPlayer(playerId);
        if (!player) return;
        
        const layerA = parseInt(document.getElementById(`p${playerId}-a`).value) || 1;
        const layerB = parseInt(document.getElementById(`p${playerId}-b`).value) || 1;
        const layerC = parseInt(document.getElementById(`p${playerId}-c`).value) || 1;
        const layerD = parseInt(document.getElementById(`p${playerId}-d`).value) || 1;
        
        player.updateRhythmData(layerA, layerB, layerC, layerD);
        
        // Update status
        const statusDiv = document.getElementById(`p${playerId}-status`);
        if (statusDiv) {
            statusDiv.innerHTML = `Grid: ${player.grid} | Spaces: ${player.spacesPlot.length}`;
            statusDiv.style.color = '#00ff88'; // Green when ready
        }
        
        // Update battle button state
        this.updateBattleButtonState();
        
        // Trigger a redraw to update visual indicators
        if (window.lrcVisuals && window.lrcVisuals.plotTypes['collider']) {
            window.lrcVisuals.plotTypes['collider'].draw();
        }
        
        console.log(`🎮 Player ${playerId} rhythm updated`);
    }
    
    updateBattleButtonState() {
        const battleBtn = document.getElementById('collider-battle-btn');
        if (!battleBtn) return;
        
        const readyPlayers = this.battleController.players.filter(p => p.spacesPlot.length > 0);
        
        if (readyPlayers.length >= 2) {
            battleBtn.disabled = false;
            battleBtn.style.opacity = '1';
            battleBtn.textContent = '🚀 Start Battle';
        } else {
            battleBtn.disabled = true;
            battleBtn.style.opacity = '0.5';
            battleBtn.textContent = `🚀 Need ${2 - readyPlayers.length} More Players`;
        }
    }

    updateBattleUI() {
        if (this.currentStage === 'battle') {
            this.updateBattlePlayerDivs();
        }
    }

    // Legacy method - victory is now handled by BattleController.showVictoryScreen()
    showVictoryMessage() {
        console.log('🎮 Victory message handled by popup - no main page alert needed');
    }

    // Legacy method - now handled by popup system
    removePlayerDivs() {
        this.closePopup();
    }
}
