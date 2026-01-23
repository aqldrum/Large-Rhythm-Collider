// Collider.js - Large Rhythm Collider Battle Royale Hinges System
// Physics-based rhythm combat with up to 4 competing hinge structures

// ====================================
// MAIN COLLIDER CLASS
// ====================================

class LRCCollider {
    constructor(lrcVisuals) {
        this.parent = lrcVisuals;
        this.canvas = null;
        this.ctx = null;
        
        this.battleController = new BattleController();
        this.colliderUI = new ColliderUI(this.battleController);

        // Animation state
        this.isAnimating = false;
        this.animationId = null;
        this.animationFrameWindow = null;

        // Visual controls
        this.lineThickness = 3; // Default line thickness
        
        // Camera system (adapted from Hinges)
        this.camera = {
            x: 0, y: 0, scale: 1,
            targetX: 0, targetY: 0, targetScale: 1,
            smoothing: 0.08
        };
        
    }

    // ====================================
    // SETUP AND ACTIVATION
    // ====================================

    activate() {
        // Open popup window instead of using main canvas
        this.colliderUI.openColliderPopup();
    }

    deactivate() {
        this.stopAnimation();
        this.colliderUI.removePlayerDivs();
    }

    setupCanvas() {
        // Use popup canvas if available, otherwise fall back to main canvas
        if (this.colliderUI.popupCanvas && this.colliderUI.popupCtx) {
            this.canvas = this.colliderUI.popupCanvas;
            this.ctx = this.colliderUI.popupCtx;
        } else {
            this.canvas = this.parent?.canvas;
            this.ctx = this.parent?.ctx;
        }
        
        if (!this.canvas || !this.ctx) {
            console.error('⚔️ Collider: Canvas not available', {
                popupCanvas: !!this.colliderUI.popupCanvas,
                popupCtx: !!this.colliderUI.popupCtx,
                parentCanvas: !!this.parent?.canvas,
                parentCtx: !!this.parent?.ctx
            });
            return false;
        }
        
        // Initialize camera state only if canvas is valid and camera hasn't been initialized
        if (this.canvas.width > 0 && this.canvas.height > 0 && this.camera.scale === 1) {
            this.updateCamera();
        }
        return true;
    }

    // ====================================
    // FUNDAMENTAL AND RANGE CALCULATIONS
    // ====================================

    calculateFundamental() {
        // Fundamental = Grid / Layer A (fastest layer)
        const activeLayers = this.currentRhythms.filter(layer => layer > 0);
        if (activeLayers.length === 0) return 0;
        
        const layerA = Math.max(...activeLayers); // Fastest layer
        return this.currentGrid / layerA;
    }

    calculateRange() {
        // Range = quotient between fastest and slowest layer
        const activeLayers = this.currentRhythms.filter(layer => layer > 0);
        if (activeLayers.length === 0) return 0;
        
        const fastest = Math.max(...activeLayers);
        const slowest = Math.min(...activeLayers);
        return fastest / slowest;
    }

    getRhythmInfoData() {
        const activeLayers = this.currentRhythms.filter(layer => layer > 0);
        const fundamental = this.calculateFundamental();
        const range = this.calculateRange();
        
        // Calculate average deviation only for 12-tone scales
        const uniqueTones = new Set(this.currentRatios.map(r => r.fraction));
        uniqueTones.delete("2/1"); // Exclude octave
        const avgDeviation = uniqueTones.size === 12 ? this.calculateAverageDeviation(this.currentSpacesPlot) : null;
        
        // Calculate additional metrics
        const density = this.currentCompositeRhythm.length > 0 ? 
            (this.currentCompositeRhythm.length / this.currentGrid * 100) : 0;
        const layerSum = activeLayers.reduce((sum, layer) => sum + layer, 0);
        
        return {
            layers: activeLayers,
            grid: this.currentGrid,
            fundamental: fundamental,
            range: range,
            avgDeviation: avgDeviation,
            density: density,
            compositeLength: this.currentCompositeRhythm.length,
            layerSum: layerSum,
            pitchCount: uniqueTones.size
        };
    }
    
    // ====================================
    // ANIMATION CONTROL
    // ====================================

    startAnimation() {
        if (this.isAnimating) return;
        
        // Ensure canvas is set up before starting battle
        if (!this.canvas || !this.ctx) {
            this.setupCanvas();
        }

        if (this.canvas) {
            this.battleController.updateBattleCenterFromCanvas(this.canvas);
        }

        // Start the battle
        this.battleController.startBattle();
        
        this.isAnimating = true;
        this.scheduleNextFrame();
        
        // Switch UI to battle mode
        setTimeout(() => {
            this.colliderUI.updateBattleUI();
        }, 100);
    }

    stopAnimation() {
        this.isAnimating = false;
        if (this.animationId && this.animationFrameWindow) {
            this.animationFrameWindow.cancelAnimationFrame(this.animationId);
        }
        this.animationId = null;
        this.animationFrameWindow = null;
    }

    getActiveAnimationWindow() {
        const popupWin = this.colliderUI?.popupWindow;
        if (popupWin && !popupWin.closed) {
            return popupWin;
        }
        return window;
    }

    scheduleNextFrame() {
        if (!this.isAnimating) return;
        const frameWindow = this.getActiveAnimationWindow();
        this.animationFrameWindow = frameWindow;
        this.animationId = frameWindow.requestAnimationFrame(() => this.animate());
    }

    animate() {
        if (!this.isAnimating) return;
        
        this.battleController.updateBattle();
        this.updateCamera();
        this.draw();
        
        // Update UI periodically
        if (Math.floor(Date.now() / 100) % 5 === 0) {
            this.colliderUI.updateBattleUI();
        }
        
        // Check for victory
        if (this.battleController.gameState === 'victory') {
            // Victory screen is automatically handled by BattleController.showVictoryScreen()
            this.stopAnimation();
            return;
        }

        this.scheduleNextFrame();
    }

    // ====================================
    // CAMERA SYSTEM
    // ====================================

    calculateBoundingBox() {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let hasNodes = false;
        let nodeCount = 0;
        
        for (const player of this.battleController.players) {
            if (!player.isAlive || player.nodes.length === 0) continue;
            
            hasNodes = true;
            nodeCount += player.nodes.length;
            for (const node of player.nodes) {
                minX = Math.min(minX, node.x);
                maxX = Math.max(maxX, node.x);
                minY = Math.min(minY, node.y);
                maxY = Math.max(maxY, node.y);
            }
        }
        
        // Bounding box calculations (logging removed for performance)
        
        // If no nodes exist, use player starting positions for setup view
        if (!hasNodes) {
            for (const config of this.battleController.playerConfigs) {
                minX = Math.min(minX === Infinity ? config.startX : minX, config.startX);
                maxX = Math.max(maxX === -Infinity ? config.startX : maxX, config.startX);
                minY = Math.min(minY === Infinity ? config.startY : minY, config.startY);
                maxY = Math.max(maxY === -Infinity ? config.startY : maxY, config.startY);
            }
        }
        
        // Fallback if still no valid bounds
        if (minX === Infinity) {
            return { minX: 0, maxX: 800, minY: 0, maxY: 600, width: 800, height: 600, centerX: 400, centerY: 300 };
        }
        
        const padding = hasNodes ? 100 : 150; // More padding during setup
        minX -= padding; maxX += padding;
        minY -= padding; maxY += padding;
        
        return {
            minX, maxX, minY, maxY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }

    updateCamera() {
        if (!this.canvas) {
            console.warn('⚔️ updateCamera called but canvas is null');
            return;
        }
        
        const width = this.canvas.width || 800;
        const height = this.canvas.height || 600;
        
        const bounds = this.calculateBoundingBox();
        
        // Camera calculations (logging removed for performance)
        
        const scaleX = width / bounds.width;
        const scaleY = height / bounds.height;
        this.camera.targetScale = Math.min(scaleX, scaleY, 1.5);
        
        this.camera.targetX = width / 2 - bounds.centerX * this.camera.targetScale;
        this.camera.targetY = height / 2 - bounds.centerY * this.camera.targetScale;
        
        this.camera.x += (this.camera.targetX - this.camera.x) * this.camera.smoothing;
        this.camera.y += (this.camera.targetY - this.camera.y) * this.camera.smoothing;
        this.camera.scale += (this.camera.targetScale - this.camera.scale) * this.camera.smoothing;
    }

    // ====================================
    // RENDERING
    // ====================================

    draw() {
        if (!this.setupCanvas()) return;
        
        if (!this.canvas || !this.ctx) {
            console.warn('⚔️ draw called but canvas/ctx is null');
            return;
        }
        
        const width = this.canvas.width || 800;
        const height = this.canvas.height || 600;
        
        // Clear canvas with distinct Collider background
        this.ctx.fillStyle = '#0a0a0a';
        this.ctx.fillRect(0, 0, width, height);
        
        // Apply camera transform
        this.ctx.save();
        this.ctx.translate(this.camera.x, this.camera.y);
        this.ctx.scale(this.camera.scale, this.camera.scale);
        
        // Draw all players (only if they have rhythm data)
        for (const player of this.battleController.players) {
            if (player.isAlive && player.nodes.length > 0) {
                this.drawPlayer(player);
            }
        }
        
        // If no players have rhythms yet, draw setup indicators
        const playersWithRhythms = this.battleController.players.filter(p => p.spacesPlot.length > 0);
        if (playersWithRhythms.length === 0) {
            this.drawSetupIndicators();
        }
        
        this.ctx.restore();
        
        // Draw UI elements in screen space
        this.drawBattleUI(width, height);
    }
    
    drawSetupIndicators() {
        // Draw corner markers showing where each player will start
        const configs = this.battleController.playerConfigs;
        
        for (const config of configs) {
            this.ctx.strokeStyle = config.color;
            this.ctx.fillStyle = config.color;
            this.ctx.lineWidth = 3;
            this.ctx.globalAlpha = 0.6;
            
            // Draw a crosshair at starting position
            const size = 20;
            this.ctx.beginPath();
            this.ctx.moveTo(config.startX - size, config.startY);
            this.ctx.lineTo(config.startX + size, config.startY);
            this.ctx.moveTo(config.startX, config.startY - size);
            this.ctx.lineTo(config.startX, config.startY + size);
            this.ctx.stroke();
            
            // Draw player number
            this.ctx.font = 'bold 16px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(`P${config.id}`, config.startX, config.startY + 35);
        }
        
        this.ctx.globalAlpha = 1;
        this.ctx.textAlign = 'left';
    }

    drawPlayer(player) {
        const baseLineWidth = this.lineThickness;
        
        // Apply invulnerability glow effect (scales with line thickness)
        if (player.invulnerabilityGlow > 0) {
            this.ctx.shadowColor = 'white';
            this.ctx.shadowBlur = (15 * player.invulnerabilityGlow) * (baseLineWidth / 3); // Scale shadow blur with thickness
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${player.invulnerabilityGlow * 0.7})`;
            this.ctx.lineWidth = baseLineWidth * (1 + player.invulnerabilityGlow * 0.5);
        } else {
            this.ctx.shadowBlur = 0;
            this.ctx.strokeStyle = player.color;
            this.ctx.lineWidth = baseLineWidth;
        }
        
        this.ctx.lineCap = 'round';
        
        // Draw segments
        for (let i = 0; i < player.segments.length; i++) {
            const segment = player.segments[i];
            const nodeA = player.nodes[segment.nodeA];
            const nodeB = player.nodes[segment.nodeB];
            
            if (!nodeA || !nodeB) continue;
            
            // Distinguish healing segments visually
            if (segment.spaceIndex === -1 && player.invulnerabilityGlow === 0) {
                // Healing segment when not glowing - slightly dimmer
                this.ctx.strokeStyle = `${player.color}80`; // Add alpha
            } else if (player.invulnerabilityGlow === 0) {
                this.ctx.strokeStyle = player.color;
            }
            
            this.ctx.beginPath();
            this.ctx.moveTo(nodeA.x, nodeA.y);
            this.ctx.lineTo(nodeB.x, nodeB.y);
            this.ctx.stroke();
        }
        
        // Draw nodes (scale base radius with line thickness)
        for (let i = 0; i < player.nodes.length; i++) {
            const node = player.nodes[i];
            const baseRadius = Math.max(2, baseLineWidth * 0.8); // Scale base radius with line thickness
            let radius = baseRadius;
            
            // Apply glow to nodes too (scales with line thickness)
            if (player.invulnerabilityGlow > 0) {
                this.ctx.fillStyle = `rgba(255, 255, 255, ${player.invulnerabilityGlow * 0.8})`;
                radius = baseRadius + (player.invulnerabilityGlow * baseLineWidth * 0.6); // Scale glow with thickness
            } else if (i === 0) {
                // Anchor node (slightly larger)
                this.ctx.fillStyle = node.pinned ? '#ffffff' : player.color;
                radius = baseRadius * 1.3;
            } else {
                this.ctx.fillStyle = player.color;
                radius = baseRadius;
            }
            
            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Add extra glow ring for invulnerable nodes (scales with line thickness)
            if (player.invulnerabilityGlow > 0) {
                this.ctx.strokeStyle = `rgba(255, 255, 255, ${player.invulnerabilityGlow * 0.4})`;
                this.ctx.lineWidth = Math.max(1, baseLineWidth * 0.3); // Scale ring thickness
                this.ctx.beginPath();
                this.ctx.arc(node.x, node.y, radius + (baseLineWidth * 0.5), 0, Math.PI * 2); // Scale ring offset
                this.ctx.stroke();
            }
        }
        
        // Reset shadow effects for next draw
        this.ctx.shadowBlur = 0;
    }

    drawBattleUI(width, height) {
        this.ctx.fillStyle = '#00ff88';
        this.ctx.font = '14px monospace';
        this.ctx.textAlign = 'center';
        
        let statusText = '';
        let instructionText = '';
        
        switch (this.battleController.gameState) {
            case 'setup':
                const playersWithRhythms = this.battleController.players.filter(p => p.spacesPlot.length > 0);
                statusText = `⚔️ COLLIDER BATTLE ROYALE - Setup Phase (${playersWithRhythms.length}/4 Ready)`;
                instructionText = 'Generate rhythms for each player in corner divs, then Start Battle!';
                break;
            case 'battle':
                const alivePlayers = this.battleController.players.filter(p => p.isAlive);
                statusText = `⚔️ BATTLE IN PROGRESS - ${alivePlayers.length} Players Remaining`;
                instructionText = 'Node hits destroy segments • Last player standing wins!';
                break;
            case 'victory':
                if (this.battleController.winner) {
                    statusText = `🏆 VICTORY: Player ${this.battleController.winner.playerId}!`;
                } else {
                    statusText = '🏆 DRAW - No Survivors!';
                }
                instructionText = 'Switch visualization modes or reset to play again';
                break;
        }
        
        this.ctx.fillText(statusText, width / 2, 30);
        
        // Instructions
        this.ctx.fillStyle = '#888';
        this.ctx.font = '11px monospace';
        this.ctx.fillText(instructionText, width / 2, height - 20);
        
        // Camera info
        this.ctx.fillStyle = '#666';
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`Camera: ${(this.camera.scale * 100).toFixed(0)}% zoom`, 10, height - 10);
    }
}

// ====================================
// INTEGRATION WITH LRC SYSTEM
// ====================================

function integrateColliderVisualization() {
    if (!window.lrcVisuals) {
        console.error('⚔️ LRCVisuals not found for Collider integration');
        return;
    }

    // Create collider instance
    const collider = new LRCCollider(window.lrcVisuals);
    
    // Add to LRCVisuals plot types
    if (!window.lrcVisuals.plotTypes) {
        window.lrcVisuals.plotTypes = {};
    }
    window.lrcVisuals.plotTypes['collider'] = collider;
    
    // Add to dropdown
    const plotSelect = document.getElementById('viz-type-selector');
    if (plotSelect) {
        const option = document.createElement('option');
        option.value = 'collider';
        option.textContent = 'Collider Battle';
        plotSelect.appendChild(option);
        console.log('⚔️ Collider option added to plot selector');
    }
    
    // No longer need battle button in main interface - handled by popup
    
    // Extend main visualization methods
    const originalDrawPlot = window.lrcVisuals.drawPlot.bind(window.lrcVisuals);
    let colliderWasActive = false;
    window.lrcVisuals.drawPlot = function() {
        if (this.currentPlotType === 'collider') {
            const colliderViz = this.plotTypes['collider'];
            if (colliderViz) {
                colliderViz.activate();
                colliderWasActive = true;
            }
        } else {
            // Only deactivate collider if it was previously active
            if (this.plotTypes['collider'] && colliderWasActive) {
                this.plotTypes['collider'].deactivate();
                colliderWasActive = false;
            }
            originalDrawPlot();
        }
    };
    
    console.log('⚔️ Collider Battle visualization integrated');
}

// Auto-integration
if (typeof window !== 'undefined') {
    window.LRCCollider = LRCCollider;
    
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (window.lrcVisuals) {
                integrateColliderVisualization();
            } else {
                const checkInterval = setInterval(() => {
                    if (window.lrcVisuals) {
                        clearInterval(checkInterval);
                        integrateColliderVisualization();
                    }
                }, 100);
                
                setTimeout(() => clearInterval(checkInterval), 5000);
            }
        }, 100);
    });
}

// Initialize the speed control when setting up the UI
if (window.colliderUI) {
    window.colliderUI.initializeSpeedControl();
}

// Set the initial master clock
if (window.battleController) {
    window.battleController.resetMasterClock();
}
