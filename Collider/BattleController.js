// ====================================
// BATTLE CONTROLLER
// ====================================

class BattleController {
    constructor() {
        this.players = [];
        this.collisionDetector = new CollisionDetector();
        this.colliderAudio = new ColliderAudio(); // Initialize ColliderAudio system
        this.gameState = 'setup'; // 'setup', 'battle', 'victory'
        this.winner = null;

        // Master clock system
        this.masterSpeed = 1.0; // Default 1x speed (1 unit = 1ms)
        this.masterClockStart = Date.now();
        this.isPaused = false;

        console.log('⏰ Master clock initialized at 1x speed');
        
        // Player colors and base positions (will be dynamically adjusted)
        this.playerConfigs = [
            { id: 1, color: '#ff6b6b', baseX: 200, baseY: 150 },   // Top-left, red
            { id: 2, color: '#4ecdc4', baseX: 600, baseY: 150 },   // Top-right, cyan
            { id: 3, color: '#00a638ff', baseX: 200, baseY: 450 },   // Bottom-left, green
            { id: 4, color: '#f9ca24', baseX: 600, baseY: 450 }    // Bottom-right, yellow
        ];

        this.battleCenter = { x: 400, y: 300 }; // Default battle center point (will be updated based on canvas)
        
        // Initialize players with base positions (will be updated when rhythms are set)
        for (const config of this.playerConfigs) {
            const player = new ColliderPlayer(config.id, config.baseX, config.baseY, config.color);
            player.parent = { battleController: this };
            this.players.push(player);
            console.log(`🎮 Player ${config.id} parent reference set:`, !!player.parent?.battleController);
        }
        
        console.log('⚔️ Battle Controller initialized with 4 players');
    }

    // ====================================
    // DYNAMIC POSITIONING
    // ====================================

    calculateDynamicStartingPositions() {
        const center = this.battleCenter || { x: 400, y: 300 };
        const configById = new Map(this.playerConfigs.map(config => [config.id, config]));

        const baseGapX = Math.abs((configById.get(2)?.baseX ?? 600) - (configById.get(1)?.baseX ?? 200)) || 400;
        const baseGapY = Math.abs((configById.get(3)?.baseY ?? 450) - (configById.get(1)?.baseY ?? 150)) || 300;

        const sizeScale = 0.5; // Scale grid length into a starting "radius"
        const minSize = 80; // Prevent tiny rhythms from collapsing spacing

        const sizes = {};
        for (const config of this.playerConfigs) {
            const player = this.players.find(p => p.playerId === config.id);
            const grid = player?.grid || 0;
            sizes[config.id] = Math.max(minSize, grid * sizeScale);
        }

        const maxSize = Math.max(...Object.values(sizes));
        const margin = Math.max(40, maxSize * 0.15);
        const verticalBufferScale = 0.2;
        const verticalBufferLeft = (sizes[1] + sizes[3]) * verticalBufferScale;
        const verticalBufferRight = (sizes[2] + sizes[4]) * verticalBufferScale;

        // Ensure horizontal and vertical gaps respect the combined player sizes
        const horizontalGap = Math.max(
            baseGapX,
            (sizes[1] + sizes[2] + margin),
            (sizes[3] + sizes[4] + margin)
        );
        const verticalGap = Math.max(
            baseGapY,
            (sizes[1] + sizes[3] + margin + verticalBufferLeft),
            (sizes[2] + sizes[4] + margin + verticalBufferRight)
        );

        const xLeft = center.x - horizontalGap / 2;
        const xRight = center.x + horizontalGap / 2;
        const yTop = center.y - verticalGap / 2;
        const yBottom = center.y + verticalGap / 2;

        const layoutById = {
            1: { x: xLeft, y: yTop },
            2: { x: xRight, y: yTop },
            3: { x: xLeft, y: yBottom },
            4: { x: xRight, y: yBottom }
        };

        // Update starting positions for all players
        for (const config of this.playerConfigs) {
            const player = this.players.find(p => p.playerId === config.id);
            if (!player) continue;

            const newStartX = layoutById[config.id]?.x ?? config.baseX;
            const newStartY = layoutById[config.id]?.y ?? config.baseY;

            // Update player's starting position
            player.startX = newStartX;
            player.startY = newStartY;

            // Also update the config for reference
            config.startX = newStartX;
            config.startY = newStartY;

            console.log(`🎯 Player ${config.id} positioned at (${newStartX.toFixed(1)}, ${newStartY.toFixed(1)})`);
        }

        console.log(
            `📐 Dynamic positioning: sizes=${JSON.stringify(sizes)}, gaps=(${horizontalGap.toFixed(1)}, ${verticalGap.toFixed(1)}), margin=${margin.toFixed(1)}, vBuffer=(${verticalBufferLeft.toFixed(1)}, ${verticalBufferRight.toFixed(1)})`
        );
    }

// ====================================
// MASTER CLOCK
// ====================================

    setMasterSpeed(speed) {
        this.masterSpeed = speed;
        
        // Notify all players of speed change (including inactive players)
        for (const player of this.players) {
            player.updateMasterSpeed(speed);
        }
        
        console.log(`⚡ Master speed set to ${speed}x - updated ${this.players.length} players`);
    }

    getMasterTime() {
        if (this.isPaused) return this.pausedTime || 0;
        
        const realElapsed = Date.now() - this.masterClockStart;
        return realElapsed * this.masterSpeed; // Convert to master clock units
    }

    resetMasterClock() {
        this.masterClockStart = Date.now();
        console.log('⏰ Master clock reset');
    }

    pauseMasterClock() {
        this.isPaused = true;
        this.pausedTime = this.getMasterTime();
    }

    resumeMasterClock() {
        this.isPaused = false;
        this.masterClockStart = Date.now() - (this.pausedTime / this.masterSpeed);
    }

// ====================================
// BATTLE INITIALIZATION
// ====================================

    // Method to set the battle center (call this once during initialization)
    setBattleCenter(x, y) {
        this.battleCenter = { x, y };
        console.log(`🎯 Battle center fixed at (${x}, ${y})`);
    }
    
    // Update battle center based on canvas size
    updateBattleCenterFromCanvas(canvas) {
        if (canvas && canvas.width && canvas.height) {
            this.battleCenter = { 
                x: canvas.width / 2, 
                y: canvas.height / 2 
            };
            
            // Update ColliderAudio battle center for spatial audio
            this.colliderAudio.setBattleCenter(this.battleCenter.x, this.battleCenter.y);
            
            console.log(`🎯 Battle center updated to canvas center: (${this.battleCenter.x}, ${this.battleCenter.y})`);
        }
    }

    startBattle() {
        console.log('🚀 BATTLE BEGINS - initializing with synchronized timing...');
        this.gameState = 'battle';
        this.battleStartTime = Date.now();
        
        // CRITICAL: Reset master clock to ensure all players start with synchronized timing
        this.resetMasterClock();
        
        // FIRST: Calculate dynamic starting positions based on Grid values
        this.calculateDynamicStartingPositions();
        
        // Only activate players that have rhythm data (were locked in)
        const activePlayers = [];
        
        // CRITICAL: Initialize players in order with slight delay to ensure proper setup
        for (let i = 0; i < this.players.length; i++) {
            const player = this.players[i];
            if (player.spacesPlot && player.spacesPlot.length > 0) {
                player.isAlive = true;
                
                // Ensure player has fresh master speed
                player.updateMasterSpeed(this.masterSpeed);
                
                player.startAnimation();
                activePlayers.push(player);
                console.log(`✅ Player ${player.playerId} activated for battle - master speed: ${player.masterSpeed}`);
            } else {
                player.isAlive = false; // Mark inactive players as eliminated
                console.log(`❌ Player ${player.playerId} not participating (no rhythm data)`);
            }
        }
        
        console.log(`🎮 Battle starting with ${activePlayers.length} active players - master clock synchronized`);
    }

    getBattleElapsedTime() {
        if (!this.battleStartTime || this.gameState !== 'battle') return 0;
        return Date.now() - this.battleStartTime;
    }
    
    updateCollisionDetectorThickness() {
        // Get the current visual thickness from the collider instance
        const colliderUI = this.getColliderUI();
        if (colliderUI && colliderUI.collider) {
            const currentThickness = colliderUI.collider.lineThickness || 3;
            this.collisionDetector.updateVisualThickness(currentThickness);
        }
    }
    
    updateBattle() {
        if (this.gameState !== 'battle') return;
        
        // Update all players
        for (const player of this.players) {
            if (player.isAlive) {
                player.updateAnimation();
            }
        }
        
        // Check for collisions every other frame to improve performance
        if (!this.lastCollisionCheck) this.lastCollisionCheck = 0;
        if (Date.now() - this.lastCollisionCheck > 16) { // ~60fps collision checking
            // Update collision detector with current line thickness
            this.updateCollisionDetectorThickness();
            
            const collisions = this.collisionDetector.checkAllCollisions(this.players);
            if (collisions.length > 0) {
                this.processCollisions(collisions);
            }
            this.lastCollisionCheck = Date.now();
        }
        
        // Check for victory condition
        this.checkVictoryCondition();
    }


// ====================================
// BATTLE MECHANICS
// ====================================

    processCollisions(collisions) {
        // FAIR COLLISION PROCESSING: Randomize collision order to prevent Player 1 bias
        if (collisions.length > 0) {
            // Shuffle collisions to ensure fair processing when multiple occur simultaneously
            const shuffledCollisions = [...collisions];
            for (let i = shuffledCollisions.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledCollisions[i], shuffledCollisions[j]] = [shuffledCollisions[j], shuffledCollisions[i]];
            }
            
            const collision = shuffledCollisions[0];
            
            // Double-check that the defender is not already invulnerable
            const defender = this.getPlayer(collision.defender);
            if (defender && !defender.isInvulnerable) {
                if (collision.type === 'node-segment') {
                    this.processAttack(collision);
                } else if (collision.type === 'node-node') {
                    this.processNodeNodeCollision(collision);
                }
            } else {
                console.log(`🛡️ Collision ignored - Player ${collision.defender} already invulnerable`);
            }
            
            // Log if multiple collisions were ignored
            if (collisions.length > 1) {
                console.log(`⚔️ Processed 1 of ${collisions.length} simultaneous collisions (randomly selected to ensure fairness)`);
            }
        }
    }

    processNodeNodeCollision(collision) {
        const playerA = this.getPlayer(collision.playerA);
        const playerB = this.getPlayer(collision.playerB);
        
        if (!playerA || !playerB || !playerA.isAlive || !playerB.isAlive) return;
        
        // Apply rebound forces (no damage, just physics)
        playerA.applyReboundForce(-collision.forceA.x, -collision.forceA.y);
        playerB.applyReboundForce(collision.forceB.x, collision.forceB.y);
        
        console.log(`🤝 Node collision: Player ${collision.playerA} <-> Player ${collision.playerB}`);
    }

    getPlayer(playerId) {
        return this.players.find(p => p.playerId === playerId);
    }

    processAttack(collision) {
        const attacker = this.getPlayer(collision.attacker);
        const defender = this.getPlayer(collision.defender);
        
        // Debug logging
        console.log(`🔍 ProcessAttack debug:`, {
            attacker: attacker ? attacker.playerId : 'null',
            defender: defender ? defender.playerId : 'null',
            defenderType: typeof defender,
            defenderMethods: defender ? Object.getOwnPropertyNames(Object.getPrototypeOf(defender)) : 'none'
        });
        
        if (!attacker || !defender || !defender.isAlive || defender.isInvulnerable) return;
        
        // Check if the method exists
        if (typeof defender.sufferAttackWithDelayedReconnection !== 'function') {
            console.error(`❌ Method sufferAttackWithDelayedReconnection not found on defender ${defender.playerId}`);
            console.log(`Available methods:`, Object.getOwnPropertyNames(Object.getPrototypeOf(defender)));
            return;
        }
        
        // INSTANT INVULNERABILITY - This happens FIRST, before anything else
        defender.setInvulnerable(true, 'attack received');
        defender.invulnerabilityGlow = 1.0;
        
        console.log(`🛡️ Player ${defender.playerId} INSTANTLY invulnerable`);
        
        const segmentIndex = collision.defendingSegment.segmentIndex;
        const segment = defender.segments[segmentIndex];
        
        if (!segment) return;
        
        // Calculate midpoint between the severed nodes
        const nodeA = defender.nodes[segment.nodeA];
        const nodeB = defender.nodes[segment.nodeB];
        const midpoint = {
            x: (nodeA.x + nodeB.x) / 2,
            y: (nodeA.y + nodeB.y) / 2
        };
        
        // Use the actual spaces plot value as reconnection duration
        const reconnectionDuration = segment.originalSpaceValue;
        
        // Apply damage immediately, then queue delayed reconnection start
        defender.sufferAttackWithDelayedReconnection(segmentIndex, collision.attackingForce, midpoint, reconnectionDuration);
        
        // Apply rebound forces
        attacker.applyReboundForce(-collision.attackingForce.x, -collision.attackingForce.y);
        defender.applyReboundForce(collision.attackingForce.x, collision.attackingForce.y);
        
        console.log(`💥 Attack processed: Player ${collision.attacker} -> Player ${collision.defender}, invulnerability applied instantly`);
    }

    // Add this method to BattleController class
    recreatePlayersWithUpdatedMethods() {
        console.log('🔄 Recreating players with updated methods...');
        
        // Store current player data
        const playerData = this.players.map(player => ({
            id: player.playerId,
            startX: player.startX,
            startY: player.startY,
            color: player.color,
            spacesPlot: player.spacesPlot,
            rhythms: player.rhythms,
            grid: player.grid,
            hp: player.hp,
            isAlive: player.isAlive
        }));
        
        // Clear existing players
        this.players = [];
        
        // Recreate players with fresh instances
        for (const config of this.playerConfigs) {
            const player = new ColliderPlayer(config.id, config.startX, config.startY, config.color);
            player.parent = { battleController: this }; // CRITICAL: Restore parent reference
            
            // Restore data if it existed
            const savedData = playerData.find(p => p.id === config.id);
            if (savedData && savedData.spacesPlot.length > 0) {
                player.spacesPlot = savedData.spacesPlot;
                player.rhythms = savedData.rhythms;
                player.grid = savedData.grid;
                player.hp = savedData.hp;
                player.isAlive = savedData.isAlive;
            }
            
            this.players.push(player);
        }
        
        console.log('✅ Players recreated with updated methods');
        
        // Verify the method exists
        this.players.forEach(player => {
            const hasMethod = typeof player.sufferAttackWithDelayedReconnection === 'function';
            console.log(`🔍 Player ${player.playerId} has sufferAttackWithDelayedReconnection: ${hasMethod}`);
        });
    }

    checkVictoryCondition() {
        const alivePlayers = this.players.filter(p => p.isAlive);
        
        if (alivePlayers.length === 1) {
            this.winner = alivePlayers[0];
            this.gameState = 'victory';
            console.log(`🏆 VICTORY: Player ${this.winner.playerId} wins!`);
        } else if (alivePlayers.length === 0) {
            this.gameState = 'victory';
            this.winner = null;
            console.log('🏆 DRAW: No survivors!');
        }
    }

    onPlayerEliminated(eliminatedPlayer) {
        console.log(`💀 Player ${eliminatedPlayer.playerId} eliminated!`);
        
        // Check for victory condition
        const alivePlayers = this.players.filter(p => p.isAlive);
        
        if (alivePlayers.length === 1) {
            // Single winner
            this.winner = alivePlayers[0];
            this.gameState = 'victory';
            console.log(`🏆 Player ${this.winner.playerId} wins!`);
            this.showVictoryScreen();
        } else if (alivePlayers.length === 0) {
            // Draw
            this.winner = null;
            this.gameState = 'victory';
            console.log('🏆 DRAW: No survivors!');
            this.showVictoryScreen();
        }
    }

    showVictoryScreen() {
        // Get the popup window from ColliderUI
        const colliderUI = this.getColliderUI();
        if (!colliderUI || !colliderUI.popupWindow) {
            console.error('Cannot show victory screen - popup window not available');
            return;
        }

        const popupDoc = colliderUI.popupWindow.document;
        
        // Create victory overlay
        const victoryOverlay = popupDoc.createElement('div');
        victoryOverlay.id = 'victory-overlay';
        victoryOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            color: #fff;
            font-family: monospace;
        `;

        const winnerText = this.winner ? 
            `🏆 Winner Player ${this.winner.playerId}!` : 
            '🏆 Draw - No Survivors!';

        victoryOverlay.innerHTML = `
            <div style="text-align: center;">
                <h1 style="font-size: 48px; color: ${this.winner?.color || '#fff'}; margin-bottom: 30px;">
                    ${winnerText}
                </h1>
                <button id="return-to-creation" style="
                    background: #00ff88;
                    border: none;
                    color: #000;
                    padding: 15px 30px;
                    font-size: 18px;
                    font-weight: bold;
                    border-radius: 8px;
                    cursor: pointer;
                    font-family: monospace;
                ">Player Creation</button>
            </div>
        `;

        popupDoc.body.appendChild(victoryOverlay);

        // Wire up the button
        const returnBtn = popupDoc.getElementById('return-to-creation');
        if (returnBtn) {
            returnBtn.addEventListener('click', () => {
                this.returnToPlayerCreation();
            });
        }
    }

    returnToPlayerCreation() {
        console.log('🔄 Returning to player creation...');
        
        // Reset the entire battle system
        this.resetBattle();
        
        // Get ColliderUI and reset it
        const colliderUI = this.getColliderUI();
        if (colliderUI) {
            colliderUI.resetToPlayerCreation();
        }
    }

    getColliderUI() {
        // Find the ColliderUI instance
        if (window.lrcVisuals && window.lrcVisuals.plotTypes && window.lrcVisuals.plotTypes['collider']) {
            return window.lrcVisuals.plotTypes['collider'].colliderUI;
        }
        return null;
    }

    resetBattle() {
        console.log('🔄 COMPREHENSIVE BATTLE RESET initiated...');
        
        // Reset core battle state
        this.gameState = 'setup';
        this.winner = null;
        this.battleStartTime = 0;
        this.lastCollisionCheck = 0;
        
        // Reset master clock system completely
        this.masterSpeed = 1.0; // Reset to default 1x speed
        this.resetMasterClock();
        this.isPaused = false;
        this.pausedTime = 0;
        
        // Stop all audio
        this.colliderAudio.stopAllNotes();
        
        // Reset all players completely and clear all cached data
        for (const player of this.players) {
            player.reset();
            player.clearAllCaches();
            // Ensure force amplitude is reset to default
            player.forceAmplitude = 1.0;
        }
        
        // Reset any collision detector state
        if (this.collisionDetector) {
            this.collisionDetector.setDebugMode(false);
        }
        
        console.log('🔄 Battle completely reset to setup phase - all parameters restored to defaults');
    }
}
