// CreatePlayer.js - Player Creation Stage for Collider Battle
// Handles 4-player rhythm generation with miniaturized Linear Plot visualization

class CreatePlayer {
    constructor(containerElement, colliderUI) {
        this.container = containerElement;
        this.colliderUI = colliderUI;
        this.battleController = colliderUI.battleController;
        this.lockedPlayers = new Set();
        
        this.setupCreationInterface();
        console.log('🎮 CreatePlayer stage initialized');
    }

    setupCreationInterface() {
        this.container.innerHTML = `
            <div id="creation-background" style="
                width: 100vw;
                height: 100vh;
                background: #1a1a1a;
                position: relative;
                display: grid;
                grid-template-columns: 1fr 1fr;
                grid-template-rows: 1fr 1fr;
                gap: 15px;
                padding: 15px;
                box-sizing: border-box;
                overflow: hidden;
            ">
                ${this.generatePlayerCreationDivs()}
            </div>
            <div id="start-battle-container" style="
                position: absolute;
                bottom: 15px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 10;
            ">
                <button id="start-battle-btn" disabled style="
                    background: #444;
                    border: 2px solid #666;
                    color: #888;
                    padding: 12px 24px;
                    font-size: 16px;
                    font-weight: bold;
                    border-radius: 8px;
                    cursor: not-allowed;
                    font-family: monospace;
                ">🚀 Start Battle (Need 2+ Players)</button>
            </div>
        `;

        this.setupEventListeners();
    }

    generatePlayerCreationDivs() {
        let html = '';
        
        for (let i = 0; i < 4; i++) {
            const player = this.battleController.players[i];
            html += `
                <div id="create-player-${i + 1}" class="player-creation-div" style="
                    background: rgba(0, 0, 0, 0.8);
                    border: 3px solid ${player.color};
                    border-radius: 12px;
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    min-height: 0;
                    max-height: 100%;
                    overflow: hidden;
                    box-sizing: border-box;
                ">
                    <div class="player-header" style="
                        color: ${player.color};
                        font-size: 16px;
                        font-weight: bold;
                        text-align: center;
                        margin-bottom: 10px;
                        font-family: monospace;
                    ">PLAYER ${i + 1}</div>
                    
                    <div class="rhythm-inputs" style="
                        display: grid;
                        grid-template-columns: 1fr 1fr 1fr 1fr auto;
                        gap: 8px;
                        margin-bottom: 10px;
                        align-items: center;
                    ">
                        <div style="text-align: center;">
                            <label style="color: #ff6b6b; font-size: 12px;">A</label>
                            <input type="number" id="p${i + 1}-layer-a" min="1" value="8" style="
                                width: 100%;
                                padding: 4px;
                                background: #333;
                                border: 1px solid #666;
                                color: #fff;
                                text-align: center;
                                border-radius: 3px;
                            ">
                        </div>
                        <div style="text-align: center;">
                            <label style="color: #4ecdc4; font-size: 12px;">B</label>
                            <input type="number" id="p${i + 1}-layer-b" min="1" value="7" style="
                                width: 100%;
                                padding: 4px;
                                background: #333;
                                border: 1px solid #666;
                                color: #fff;
                                text-align: center;
                                border-radius: 3px;
                            ">
                        </div>
                        <div style="text-align: center;">
                            <label style="color: #00a638ff; font-size: 12px;">C</label>
                            <input type="number" id="p${i + 1}-layer-c" min="1" value="6" style="
                                width: 100%;
                                padding: 4px;
                                background: #333;
                                border: 1px solid #666;
                                color: #fff;
                                text-align: center;
                                border-radius: 3px;
                            ">
                        </div>
                        <div style="text-align: center;">
                            <label style="color: #f9ca24; font-size: 12px;">D</label>
                            <input type="number" id="p${i + 1}-layer-d" min="1" value="5" style="
                                width: 100%;
                                padding: 4px;
                                background: #333;
                                border: 1px solid #666;
                                color: #fff;
                                text-align: center;
                                border-radius: 3px;
                            ">
                        </div>
                        <button id="generate-p${i + 1}" style="
                            background: ${player.color};
                            border: none;
                            color: #000;
                            padding: 8px 12px;
                            font-weight: bold;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 12px;
                        ">Generate</button>
                    </div>

                    <div id="p${i + 1}-visualization" class="mini-visualization" style="
                        flex: 1;
                        background: #0a0a0a;
                        border: 1px solid #444;
                        border-radius: 6px;
                        margin-bottom: 8px;
                        min-height: 80px;
                        max-height: 150px;
                        position: relative;
                        display: none;
                    ">
                        <canvas id="p${i + 1}-canvas" style="
                            width: 100%;
                            height: 100%;
                            border-radius: 6px;
                        "></canvas>
                    </div>

                    <div id="p${i + 1}-bottom-row" style="
                        display: none;
                        justify-content: space-between;
                        align-items: center;
                        margin-top: 8px;
                    ">
                        <div id="p${i + 1}-info" class="player-info" style="
                            color: #888;
                            font-size: 10px;
                            font-family: monospace;
                            flex: 1;
                        ">
                            <!-- Stats will be populated here -->
                        </div>
                        
                        <button id="lock-p${i + 1}" disabled style="
                            background: #444;
                            border: 2px solid #666;
                            color: #888;
                            padding: 6px 10px;
                            font-weight: bold;
                            border-radius: 4px;
                            cursor: not-allowed;
                            font-family: monospace;
                            font-size: 14px;
                        ">🔒</button>
                    </div>

                    <div id="p${i + 1}-status" style="
                        color: #666;
                        font-size: 9px;
                        text-align: center;
                        margin-top: 5px;
                        font-family: monospace;
                        line-height: 1.2;
                    ">Ready to generate...</div>
                </div>
            `;
        }
        
        return html;
    }

    setupEventListeners() {
        // Generate buttons
        for (let i = 1; i <= 4; i++) {
            const generateBtn = this.colliderUI.popupWindow.document.getElementById(`generate-p${i}`);
            if (generateBtn) {
                generateBtn.addEventListener('click', () => this.generateRhythm(i));
            }

            // Lock buttons
            const lockBtn = this.colliderUI.popupWindow.document.getElementById(`lock-p${i}`);
            if (lockBtn) {
                lockBtn.addEventListener('click', () => this.lockPlayer(i));
            }
        }

        // Start battle button
        const startBattleBtn = this.colliderUI.popupWindow.document.getElementById('start-battle-btn');
        if (startBattleBtn) {
            startBattleBtn.addEventListener('click', () => this.startBattle());
        }
    }

    generateRhythm(playerId) {
        const doc = this.colliderUI.popupWindow.document;
        
        // Get layer values
        const layerA = parseInt(doc.getElementById(`p${playerId}-layer-a`).value) || 1;
        const layerB = parseInt(doc.getElementById(`p${playerId}-layer-b`).value) || 1;
        const layerC = parseInt(doc.getElementById(`p${playerId}-layer-c`).value) || 1;
        const layerD = parseInt(doc.getElementById(`p${playerId}-layer-d`).value) || 1;

        // Get player from battle controller
        const player = this.battleController.getPlayer(playerId);
        if (!player) return;

        // Generate rhythm data using LRCModule if available
        let rhythmData;
        if (window.lrcModule) {
            // Temporarily set the main form values to our layer values
            const oldA = document.getElementById('layer-a')?.value;
            const oldB = document.getElementById('layer-b')?.value;
            const oldC = document.getElementById('layer-c')?.value;
            const oldD = document.getElementById('layer-d')?.value;
            
            if (document.getElementById('layer-a')) document.getElementById('layer-a').value = layerA;
            if (document.getElementById('layer-b')) document.getElementById('layer-b').value = layerB;
            if (document.getElementById('layer-c')) document.getElementById('layer-c').value = layerC;
            if (document.getElementById('layer-d')) document.getElementById('layer-d').value = layerD;
            
            // Suppress auto-close during rhythm generation
            if (window.lrcVisuals) {
                window.lrcVisuals.setSuppressAutoClose(true);
            }
            
            // Generate the rhythm using the main method
            window.lrcModule.generateRhythm();
            
            // Re-enable auto-close after generation
            if (window.lrcVisuals) {
                window.lrcVisuals.setSuppressAutoClose(false);
            }
            
            // Extract the current rhythm data
            rhythmData = {
                grid: window.lrcModule.currentGrid,
                spacesPlot: [...window.lrcModule.currentSpacesPlot],
                ratios: [...window.lrcModule.currentRatios],
                compositeRhythm: [...window.lrcModule.currentCompositeRhythm]
            };
            
            // Restore the original values
            if (document.getElementById('layer-a') && oldA !== undefined) document.getElementById('layer-a').value = oldA;
            if (document.getElementById('layer-b') && oldB !== undefined) document.getElementById('layer-b').value = oldB;
            if (document.getElementById('layer-c') && oldC !== undefined) document.getElementById('layer-c').value = oldC;
            if (document.getElementById('layer-d') && oldD !== undefined) document.getElementById('layer-d').value = oldD;
            
            console.log(`🎮 Generated rhythm data for Player ${playerId}:`, {
                grid: rhythmData.grid,
                spacesLength: rhythmData.spacesPlot?.length,
                ratiosCount: rhythmData.ratios?.length
            });
        }

        // Update player with rhythm data - pass the full rhythm data to keep consistency
        if (rhythmData) {
            player.setRhythmData(rhythmData, layerA, layerB, layerC, layerD);
        } else {
            player.updateRhythmData(layerA, layerB, layerC, layerD);
        }
        
        // Use player's updated spacesPlot if available, otherwise use rhythmData
        const spacesPlot = player.spacesPlot || rhythmData?.spacesPlot || [];
        
        // Set up the bottom row first so the visualization can size correctly
        const bottomRow = doc.getElementById(`p${playerId}-bottom-row`);
        if (bottomRow) {
            bottomRow.style.display = 'flex';
        }
        
        // Show stats immediately
        this.showPlayerInfo(playerId, player, rhythmData);
        
        // Small delay to ensure DOM layout is complete before showing visualization and enabling button
        setTimeout(() => {
            // Show visualization after stats are in place
            this.showPlayerVisualization(playerId, { spacesPlot, rhythmData, player });
            
            // Enable lock button
            const lockBtn = doc.getElementById(`lock-p${playerId}`);
            if (lockBtn) {
                lockBtn.disabled = false;
                lockBtn.style.background = '#00ff88';
                lockBtn.style.borderColor = '#00ff88';
                lockBtn.style.color = '#000';
                lockBtn.style.cursor = 'pointer';
            }
        }, 10); // Very small delay just for DOM layout

        // Update status
        const statusDiv = doc.getElementById(`p${playerId}-status`);
        if (statusDiv) {
            statusDiv.textContent = 'Rhythm generated - click Lock to confirm';
            statusDiv.style.color = '#00ff88';
        }

        console.log(`🎮 Player ${playerId} rhythm generated:`, {
            spacesPlot: spacesPlot.length,
            hp: player.hp,
            grid: player.grid,
            rhythmData: rhythmData ? 'available' : 'missing'
        });
    }

    calculateLCM(numbers) {
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const lcm = (a, b) => Math.abs(a * b) / gcd(a, b);
        return numbers.reduce(lcm);
    }

    showPlayerVisualization(playerId, data) {
        const doc = this.colliderUI.popupWindow.document;
        const vizContainer = doc.getElementById(`p${playerId}-visualization`);
        const canvas = doc.getElementById(`p${playerId}-canvas`);
        
        if (!vizContainer || !canvas) return;

        vizContainer.style.display = 'block';
        
        // Set canvas size - use computed styles instead of getBoundingClientRect
        const computedStyle = this.colliderUI.popupWindow.getComputedStyle(vizContainer);
        const containerWidth = parseInt(computedStyle.width) || 200;
        const containerHeight = parseInt(computedStyle.height) || 120;
        
        canvas.width = containerWidth - 2; // Account for border
        canvas.height = containerHeight - 2;
        canvas.style.width = (containerWidth - 2) + 'px';
        canvas.style.height = (containerHeight - 2) + 'px';
        
        const ctx = canvas.getContext('2d');
        
        // Draw miniaturized linear plot using the spaces plot
        this.drawMiniLinearPlot(ctx, canvas.width, canvas.height, data.spacesPlot);
    }

    drawMiniLinearPlot(ctx, width, height, spacesPlot) {
        // Clear canvas
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);
        
        if (!spacesPlot || spacesPlot.length === 0) {
            // Draw "no data" message
            ctx.fillStyle = '#666';
            ctx.font = '12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('No rhythm data', width / 2, height / 2);
            return;
        }
        
        const padding = 10;
        const plotWidth = Math.max(width - (padding * 2), 10);
        const plotHeight = Math.max(height - (padding * 2), 10);
        const maxValue = Math.max(...spacesPlot, 1); // Ensure maxValue is at least 1
        
        // Calculate spacing, handle case where spacesPlot.length is 1
        const spacing = spacesPlot.length > 1 ? plotWidth / (spacesPlot.length - 1) : 0;
        
        // Draw dots
        spacesPlot.forEach((space, index) => {
            let x, y;
            
            if (spacesPlot.length === 1) {
                x = width / 2; // Center single dot
            } else {
                x = padding + (index * spacing);
            }
            
            // Ensure y is within bounds
            y = Math.max(padding, height - padding - ((space / maxValue) * plotHeight));
            y = Math.min(y, height - padding);
            
            // Color based on space value with better scaling
            let color = '#888';
            if (space > 0) {
                const intensity = Math.min(space / Math.max(maxValue, 4), 1);
                color = `rgba(0, 255, 136, ${0.3 + intensity * 0.7})`;
            }
            
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // Draw grid lines
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        
        // Vertical lines
        for (let i = 0; i <= 4; i++) {
            const x = padding + (i / 4) * plotWidth;
            ctx.moveTo(x, padding);
            ctx.lineTo(x, height - padding);
        }
        
        // Horizontal lines  
        for (let i = 0; i <= 3; i++) {
            const y = padding + (i / 3) * plotHeight;
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
        }
        
        ctx.stroke();
    }

    showPlayerInfo(playerId, player, rhythmData) {
        const doc = this.colliderUI.popupWindow.document;
        const infoDiv = doc.getElementById(`p${playerId}-info`);
        
        if (infoDiv) {
            // Calculate essential rhythm information
            const hp = rhythmData?.grid || player.hp || player.grid || '--';
            const nodes = player.spacesPlot ? player.spacesPlot.length : '--';
            const ratios = rhythmData?.ratios?.length || '--';
            
            console.log(`🎮 Player ${playerId} info:`, { hp, nodes, ratios, hasRhythmData: !!rhythmData });
            
            infoDiv.innerHTML = `
                <span style="margin-right: 8px;">HP: <strong style="color: #00ff88;">${hp}</strong></span>
                <span style="margin-right: 8px;">Nodes: <strong style="color: #4ecdc4;">${nodes}</strong></span>
                <span>Ratios: <strong style="color: #00a638ff;">${ratios}</strong></span>
            `;
        }
    }

    lockPlayer(playerId) {
        if (this.lockedPlayers.has(playerId)) return;
        
        this.lockedPlayers.add(playerId);
        
        const doc = this.colliderUI.popupWindow.document;
        const lockBtn = doc.getElementById(`lock-p${playerId}`);
        const statusDiv = doc.getElementById(`p${playerId}-status`);
        const playerDiv = doc.getElementById(`create-player-${playerId}`);
        
        // Update lock button
        if (lockBtn) {
            lockBtn.textContent = '✅';
            lockBtn.style.background = '#666';
            lockBtn.style.borderColor = '#666';
            lockBtn.style.cursor = 'not-allowed';
            lockBtn.disabled = true;
        }
        
        // Update status
        if (statusDiv) {
            statusDiv.textContent = 'Rhythm locked and ready for battle!';
            statusDiv.style.color = '#00ff88';
        }
        
        // Add locked visual effect
        if (playerDiv) {
            playerDiv.style.boxShadow = `0 0 15px ${this.battleController.players[playerId - 1].color}`;
        }
        
        // Disable inputs
        ['a', 'b', 'c', 'd'].forEach(layer => {
            const input = doc.getElementById(`p${playerId}-layer-${layer}`);
            if (input) input.disabled = true;
        });
        
        const generateBtn = doc.getElementById(`generate-p${playerId}`);
        if (generateBtn) generateBtn.disabled = true;
        
        this.updateStartBattleButton();
        
        console.log(`🎮 Player ${playerId} locked in`);
    }

    updateStartBattleButton() {
        const doc = this.colliderUI.popupWindow.document;
        const startBtn = doc.getElementById('start-battle-btn');
        if (!startBtn) return;
        
        const lockedCount = this.lockedPlayers.size;
        
        if (lockedCount >= 2) {
            startBtn.disabled = false;
            startBtn.style.background = '#ff4444';
            startBtn.style.color = '#fff';
            startBtn.style.cursor = 'pointer';
            startBtn.style.borderColor = '#ff6666';
            startBtn.textContent = `🚀 Start Battle (${lockedCount}/4 Ready)`;
        } else {
            startBtn.textContent = `🚀 Start Battle (Need ${2 - lockedCount} More)`;
        }
    }

    startBattle() {
        if (this.lockedPlayers.size < 2) {
            alert('Need at least 2 players locked in to start battle!');
            return;
        }
        
        console.log('🚀 Starting battle with', this.lockedPlayers.size, 'players');
        
        // Ensure all locked players have proper data
        for (const playerId of this.lockedPlayers) {
            const player = this.battleController.getPlayer(playerId);
            if (player && player.spacesPlot.length === 0) {
                console.warn(`⚠️ Player ${playerId} locked but has no spaces plot`);
            }
        }
        
        // Switch to battle stage
        this.colliderUI.switchToBattleStage();
        
        console.log('🚀 Battle started!');
    }

    reset() {
        // Clear locked players
        this.lockedPlayers.clear();

        // Reset all player creation divs to initial state
        for (let i = 1; i <= 4; i++) {
            const doc = this.colliderUI.popupWindow.document;
            
            // Reset layer inputs to defaults
            const layerA = doc.getElementById(`p${i}-layer-a`);
            const layerB = doc.getElementById(`p${i}-layer-b`);
            const layerC = doc.getElementById(`p${i}-layer-c`);
            const layerD = doc.getElementById(`p${i}-layer-d`);
            
            if (layerA) { layerA.value = '8'; layerA.disabled = false; }
            if (layerB) { layerB.value = '7'; layerB.disabled = false; }
            if (layerC) { layerC.value = '6'; layerC.disabled = false; }
            if (layerD) { layerD.value = '5'; layerD.disabled = false; }

            // Hide visualization and info
            const vizContainer = doc.getElementById(`p${i}-visualization`);
            const bottomRow = doc.getElementById(`p${i}-bottom-row`);
            
            if (vizContainer) vizContainer.style.display = 'none';
            if (bottomRow) bottomRow.style.display = 'none';

            // Reset generate button
            const generateBtn = doc.getElementById(`generate-p${i}`);
            if (generateBtn) generateBtn.disabled = false;

            // Reset lock button
            const lockBtn = doc.getElementById(`lock-p${i}`);
            if (lockBtn) {
                lockBtn.disabled = true;
                lockBtn.style.background = '#444';
                lockBtn.style.borderColor = '#666';
                lockBtn.style.color = '#888';
                lockBtn.style.cursor = 'not-allowed';
                lockBtn.textContent = '🔒';
            }

            // Reset status
            const statusDiv = doc.getElementById(`p${i}-status`);
            if (statusDiv) {
                statusDiv.textContent = 'Ready to generate...';
                statusDiv.style.color = '#666';
            }

            // Remove glow effect
            const playerDiv = doc.getElementById(`create-player-${i}`);
            if (playerDiv) {
                playerDiv.style.boxShadow = '';
            }
        }

        // Reset start battle button to initial grey disabled state
        const startBtn = this.colliderUI.popupWindow.document.getElementById('start-battle-btn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.style.background = '#444';
            startBtn.style.borderColor = '#666';
            startBtn.style.color = '#888';
            startBtn.style.cursor = 'not-allowed';
            startBtn.textContent = '🚀 Start Battle (Need 2+ Players)';
        }

        console.log('🔄 CreatePlayer reset to initial state');
    }
}

// Make globally available
window.CreatePlayer = CreatePlayer;