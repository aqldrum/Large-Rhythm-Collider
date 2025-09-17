class ColliderPlayer {
    constructor(playerId, startX, startY, color) {
        this.playerId = playerId;
        this.color = color;
        this.startX = startX;
        this.startY = startY;
        
        // Rhythm data
        this.spacesPlot = [];
        this.rhythms = [1, 1, 1, 1];
        this.grid = 1;
        this.originalGrid = 1;
        
        // Physics state
        this.nodes = [];
        this.segments = [];
        this.nodeForces = [];
        this.lastForceUpdate = 0;
        this.layerDirections = {}; 
        
        // Animation state
        this.animationPhase = 'inactive'; // 'inactive', 'hanging', 'connecting', 'settling', 'reconnecting'
        this.phaseStartTime = 0;
        this.currentRhythmPosition = 0;
        this.activeForceNodes = new Set();

        // Master clock integration
        this.masterSpeed = 1.0;
        this.rhythmClockOffset = 0; // When this player's rhythm started on master clock

        // Battle state
        this.isAlive = true;
        this.hp = 0; // Grid value
        this.nodeCount = 0;
        this.isReconnecting = false;
        this.isInvulnerable = false; 
        this.invulnerabilityGlow = 0; 
        
        // Physics parameters
        this.gravity = 0;
        this.damping = 0.995;
        this.tensionStrength = 0.3;
        this.maxSegmentLength = 50;
        
        // Force amplitude control (like Hinges.js)
        this.forceAmplitude = 1.0;
        
        // Rebound velocity system for animated center-of-mass movement
        this.reboundVelocity = { x: 0, y: 0 };
        this.reboundDamping = 0.9; // How quickly rebound velocity decays
    }

    // ====================================
    // DATA MANAGEMENT
    // ====================================

    // Helper functions
    lerp(start, end, progress) {
        return start + (end - start) * progress;
    }

    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
    }

    setRhythmData(rhythmData, layerA, layerB, layerC, layerD) {
        this.rhythms = [layerA, layerB, layerC, layerD];
        
        // Use the provided rhythm data directly to maintain consistency
        this.spacesPlot = rhythmData.spacesPlot || [];
        this.grid = rhythmData.grid;
        this.originalGrid = rhythmData.grid;
        this.hp = rhythmData.grid;
        this.maxHp = rhythmData.grid; // Set maximum HP for health bar calculations
        this.ratios = rhythmData.ratios || [];
        
        this.calculateLayerForces();
        
        console.log(`🎮 Player ${this.playerId} rhythm set: Grid ${this.grid}, Spaces: ${this.spacesPlot.length}, Ratios: ${this.ratios.length}`);
    }

    updateRhythmData(layerA, layerB, layerC, layerD) {
        this.rhythms = [layerA, layerB, layerC, layerD];
        
        // Use LRCModule to generate spaces plot
        if (window.lrcModule) {
            const tempGrid = window.lrcModule.calculateTotalLCM(layerA, layerB, layerC, layerD);
            const { rhythm } = window.lrcModule.generateCompositeRhythm(this.rhythms);
            const { spacesPlot } = window.lrcModule.generateSpacesPlot(rhythm, tempGrid, []);
            
            this.spacesPlot = spacesPlot || [];
            this.grid = tempGrid;
            this.originalGrid = tempGrid;
            this.hp = this.grid;
            this.maxHp = this.grid; // Set maximum HP for health bar calculations
            
            this.calculateLayerForces();
            
            console.log(`🎮 Player ${this.playerId} rhythm updated: Grid ${this.grid}, Spaces: ${this.spacesPlot.length}`);
        }
    }

    getCanvasCenter() {
        const canvasWidth = parseInt(this.parent?.canvas?.style?.width) || 800;
        const canvasHeight = parseInt(this.parent?.canvas?.style?.height) || 600;
        return {
            x: canvasWidth / 2,
            y: canvasHeight / 2
        };
    }

    validateStructure() {
        console.log(`🔍 Player ${this.playerId} structure validation:`);
        console.log(`  Nodes: ${this.nodes.length}`);
        console.log(`  Segments: ${this.segments.length}`);
        
        for (let i = 0; i < this.segments.length; i++) {
            const segment = this.segments[i];
            const nodeAValid = segment.nodeA >= 0 && segment.nodeA < this.nodes.length;
            const nodeBValid = segment.nodeB >= 0 && segment.nodeB < this.nodes.length;
            
            if (!nodeAValid || !nodeBValid) {
                console.error(`❌ Invalid segment ${i}: nodeA=${segment.nodeA} (valid: ${nodeAValid}), nodeB=${segment.nodeB} (valid: ${nodeBValid})`);
            }
        }
    }

    validateAndRepairStructure() {
        console.log(`🔧 STRUCTURE VALIDATION for Player ${this.playerId}...`);
        
        let repairsMade = 0;
        
        // Check 1: Remove segments with invalid node references
        const originalSegmentCount = this.segments.length;
        this.segments = this.segments.filter(segment => {
            const validA = segment.nodeA >= 0 && segment.nodeA < this.nodes.length;
            const validB = segment.nodeB >= 0 && segment.nodeB < this.nodes.length;
            const notSelfRef = segment.nodeA !== segment.nodeB;
            
            return validA && validB && notSelfRef;
        });
        
        if (this.segments.length !== originalSegmentCount) {
            repairsMade += originalSegmentCount - this.segments.length;
            console.log(`🔧 Removed ${repairsMade} invalid segments`);
        }
        
        // Check 2: Ensure nodeForces array matches structure
        const expectedForces = Math.max(0, this.nodes.length - 1); // Skip anchor node
        if (this.nodeForces.length !== expectedForces) {
            console.log(`🔧 Force array mismatch: expected ${expectedForces}, got ${this.nodeForces.length}`);
            // Recalculate all forces from scratch
            this.calculateLayerForces();
            repairsMade++;
        }
        
        // Check 3: Clear invalid activeForceNodes references
        const invalidActiveForces = Array.from(this.activeForceNodes).filter(index => 
            index >= this.nodeForces.length || index < 0
        );
        
        if (invalidActiveForces.length > 0) {
            console.log(`🔧 Clearing ${invalidActiveForces.length} invalid active force references`);
            this.activeForceNodes.clear();
            repairsMade++;
        }
        
        // Check 4: Detect extreme force magnitudes that could cause stretching
        let maxForceMagnitude = 0;
        for (const force of this.nodeForces) {
            if (force.magnitude > maxForceMagnitude) {
                maxForceMagnitude = force.magnitude;
            }
        }
        
        if (maxForceMagnitude > 100000) { // Arbitrary threshold
            console.log(`🔧 EXTREME FORCES detected (${maxForceMagnitude.toFixed(2)}) - recalculating`);
            this.calculateLayerForces();
            repairsMade++;
        }
        
        console.log(`✅ Structure validation complete: ${repairsMade} repairs made`);
        return repairsMade === 0; // Return true if structure was already valid
    }

    // ====================================
    // MASTER CLOCK
    // ====================================

    updateMasterSpeed(speed) {
        this.masterSpeed = speed;
        console.log(`🎮 Player ${this.playerId} updated to ${speed}x speed`);
    }

    setForceAmplitude(amplitude) {
        this.forceAmplitude = amplitude;
        // Recalculate forces immediately with new amplitude
        this.calculateLayerForces();
        console.log(`🎮 Player ${this.playerId} force amplitude set to ${amplitude}x`);
    }

    getMasterTime() {
        return this.parent?.battleController?.getMasterTime() || 0;
    }

    getCurrentRhythmPosition() {
        if (this.spacesPlot.length === 0) return { spaceIndex: 0, exactPosition: 0, cycleProgress: 0 };
        
        // Use the master clock (speed is already applied in getMasterTime)
        const masterTime = this.getMasterTime();
        const rhythmTime = masterTime - this.rhythmClockOffset;
        
        // FIXED: Use simpler approach similar to Hinges for reliable progression
        // Calculate cycle progress as a percentage (0 to 1)
        const cycleDuration = this.spacesPlot.reduce((sum, space) => sum + space, 0);
        const cycleProgress = (rhythmTime % cycleDuration) / cycleDuration;
        
        // Map cycle progress directly to space index (like Hinges does)
        const exactPosition = cycleProgress * this.spacesPlot.length;
        const currentSpaceIndex = Math.floor(exactPosition) % this.spacesPlot.length;
        
        // CRITICAL: Ensure valid index after modulo operation
        const validSpaceIndex = Math.max(0, Math.min(currentSpaceIndex, this.spacesPlot.length - 1));
        
        return {
            spaceIndex: validSpaceIndex,
            exactPosition: rhythmTime % cycleDuration,
            cycleProgress: cycleProgress
        };
    }

    // Layer Forces

    calculateLayerForces() {
        // Skip force calculations for invulnerable players
        if (this.isInvulnerable) {
            return;
        }

        this.nodeForces = [];
        
        if (this.spacesPlot.length === 0) return;
        
        // Use FIXED battle center (not canvas center)
        const battleCenter = this.parent?.battleController?.battleCenter || { x: 400, y: 300 };
        
        // Calculate current center of mass for this rhythm
        const centerOfMass = this.getCenterOfMass();
        
        // Calculate angle from center of mass to FIXED battle center
        const deltaX = battleCenter.x - centerOfMass.x;
        const deltaY = battleCenter.y - centerOfMass.y;
        const angleToCenter = Math.atan2(deltaY, deltaX);
        
        // Define layer directions relative to center-pointing angle
        this.layerDirections = {
            'A': angleToCenter,                    // Points toward center
            'B': angleToCenter + Math.PI / 2,      // 90° counterclockwise from A  
            'C': angleToCenter + Math.PI,          // 180° from A (away from center)
            'D': angleToCenter + 3 * Math.PI / 2   // 270° counterclockwise from A
        };
        
        // Create layer forces with increased magnitude for distant rhythms
        for (let i = 0; i < this.spacesPlot.length; i++) {
            const spaceValue = this.spacesPlot[i];
            const layerNames = ['A', 'B', 'C', 'D'];
            const primaryLayer = layerNames[i % 4];
            
            const direction = this.layerDirections[primaryLayer];
            
            // Increase force magnitude, especially for Layer A (toward center)
            let baseMagnitude = spaceValue * 0.15; // Increased from 0.12
            
            // Extra boost for Layer A to pull toward center
            if (primaryLayer === 'A') {
                baseMagnitude *= 2.0; // Double the force for center-pointing layer
            }
            
            // Apply force amplitude multiplier
            const forceX = Math.cos(direction) * baseMagnitude * this.forceAmplitude;
            const forceY = Math.sin(direction) * baseMagnitude * this.forceAmplitude;
            
            this.nodeForces.push({
                x: forceX,
                y: forceY,
                magnitude: Math.sqrt(forceX * forceX + forceY * forceY),
                layer: primaryLayer,
                direction: direction // Store for debugging
            });
        }
    }

    // ====================================
    // PHYSICS INITIALIZATION
    // ====================================

    initializeChain() {
        if (this.spacesPlot.length === 0) return;
        
        this.nodes = [];
        this.segments = [];
        
        // TRUE PROPORTIONAL SCALING: Total chain length = Grid value
        // This ensures players with same Grid have same total size regardless of layer complexity
        const totalSpaces = this.spacesPlot.reduce((sum, space) => sum + space, 0);
        const targetTotalLength = this.grid; // Total chain length equals Grid/HP value
        const scaleFactor = targetTotalLength / totalSpaces;
        
        // Create first node at assigned starting position
        this.nodes.push({
            x: this.startX,
            y: this.startY,
            oldX: this.startX,
            oldY: this.startY,
            pinned: true,
            velocity: { x: 0, y: 0 }
        });
        
        // Create subsequent nodes in hanging chain
        let currentX = this.startX;
        let currentY = this.startY;
        
        for (let i = 0; i < this.spacesPlot.length; i++) {
            const segmentLength = this.spacesPlot[i] * scaleFactor;
            currentY += segmentLength;
            
            this.nodes.push({
                x: currentX,
                y: currentY,
                oldX: currentX,
                oldY: currentY,
                pinned: false,
                velocity: { x: 0, y: 0 }
            });
            
            this.segments.push({
                nodeA: i,
                nodeB: i + 1,
                restLength: segmentLength,
                originalSpaceValue: this.spacesPlot[i],
                spaceIndex: i // Track which space this represents
            });
        }
        
        this.nodeCount = this.nodes.length;
        console.log(`🎮 Player ${this.playerId} chain initialized: ${this.nodes.length} nodes, ${this.segments.length} segments, total length: ${targetTotalLength}`);
    }

    // ====================================
    // ANIMATION PHASES
    // ====================================

    startAnimation() {
        if (this.spacesPlot.length === 0) {
            console.warn(`⚠️ Player ${this.playerId} startAnimation called but no spacesPlot data`);
            return;
        }
        
        console.log(`🎮 Player ${this.playerId} animation starting - initializing fresh state...`);
        
        // CRITICAL: Ensure clean state before starting animation
        this.animationPhase = 'hanging';
        this.phaseStartTime = Date.now();
        this.isAlive = true;
        
        // Reset any lingering timing issues
        this.rhythmStartTime = 0;
        this.currentRhythmPosition = 0;
        this.activeForceNodes.clear();
        
        // Initialize the chain structure
        this.initializeChain();
        
        console.log(`🎮 Player ${this.playerId} animation started successfully - ${this.nodes.length} nodes, ${this.segments.length} segments`);
    }

    updateAnimation() {
        // Handle bezier reconnection
        if (this.isReconnecting) {
            console.log(`🧲 Bezier reconnection active for Player ${this.playerId}`);
            this.animateBezierReconnection();
            
            // Apply constraints during reconnection
            const iterations = 15;
            for (let i = 0; i < iterations; i++) {
                this.constrainSegments();
            }
            return; // Skip normal animation
        }
        
        // Normal animation logic for non-invulnerable players
        const currentTime = Date.now();
        const elapsed = currentTime - this.phaseStartTime;
        
        switch (this.animationPhase) {
            case 'hanging':
                if (elapsed > 2000) {
                    this.startConnectionPhase();
                }
                break;
                
            case 'connecting':
                const progress = Math.min(elapsed / 3000, 1);
                this.animateConnection(progress);
                if (progress >= 1) {
                    this.completeConnection();
                }
                break;
                
            case 'settling':
                // Check if anchor node should be unpinned
                if (this.anchorUnpinTime && currentTime >= this.anchorUnpinTime && this.nodes[0]) {
                    this.nodes[0].pinned = false;
                    this.anchorUnpinTime = null; // Clear the timer
                    console.log(`🎮 Player ${this.playerId} anchor node unpinned - full physics enabled`);
                }
                
                this.updateRhythmicProgression();
                this.applyPhysics();
                break;
        }
        
        // Apply constraints
        if (this.animationPhase !== 'inactive') {
            const iterations = this.animationPhase === 'connecting' ? 8 : 15;
            for (let i = 0; i < iterations; i++) {
                this.constrainSegments();
            }
        }
    }

    startConnectionPhase() {
        this.animationPhase = 'connecting';
        this.phaseStartTime = Date.now();
        
        const lastNode = this.nodes[this.nodes.length - 1];
        const firstNode = this.nodes[0];
        
        this.connectionStart = { x: lastNode.x, y: lastNode.y };
        this.connectionTarget = { x: firstNode.x, y: firstNode.y };
        
        this.arcMidpoint = {
            x: this.connectionStart.x - 100,
            y: Math.min(this.connectionStart.y - 150, firstNode.y - 50)
        };
        
        console.log(`🎮 Player ${this.playerId} starting connection phase`);
    }

    animateConnection(progress) {
        const eased = 1 - Math.pow(1 - progress, 2);
        const lastNode = this.nodes[this.nodes.length - 1];
        
        const t = eased;
        const invT = 1 - t;
        
        lastNode.x = Math.pow(invT, 2) * this.connectionStart.x + 
                    2 * invT * t * this.arcMidpoint.x + 
                    Math.pow(t, 2) * this.connectionTarget.x;
                    
        lastNode.y = Math.pow(invT, 2) * this.connectionStart.y + 
                    2 * invT * t * this.arcMidpoint.y + 
                    Math.pow(t, 2) * this.connectionTarget.y;
        
        lastNode.oldX = lastNode.x - (lastNode.x - this.connectionStart.x) * 0.1;
        lastNode.oldY = lastNode.y - (lastNode.y - this.connectionStart.y) * 0.1;
        lastNode.pinned = true;
    }

    completeConnection() {
        this.animationPhase = 'settling';
        
        const lastNode = this.nodes[this.nodes.length - 1];
        const anchorNode = this.nodes[0];
        
        // Unpin the last node immediately
        lastNode.pinned = false;
        
        // CRITICAL: Keep anchor node pinned initially to prevent jump
        // It will be unpinned after a brief settling period
        anchorNode.pinned = true;
        this.anchorUnpinTime = Date.now() + 500; // Unpin after 0.5 seconds
        
        // Create closing segment with safety checks
        const endNode = this.nodes[this.nodes.length - 1];
        const anchorNodeRef = this.nodes[0];
        
        if (endNode && anchorNodeRef) {
            this.segments.push({
                nodeA: this.segments.length,
                nodeB: 0,
                restLength: this.calculateDistance(endNode, anchorNodeRef),
                originalSpaceValue: 0,
                spaceIndex: -1 // Special marker for closing segment
            });
        } else {
            console.error(`❌ Cannot create closing segment - missing nodes: anchor=${!!anchorNodeRef}, end=${!!endNode}`);
        }
        
        // CRITICAL: Initialize rhythm timing properly for all players
        this.rhythmStartTime = Date.now();
        
        // Get current master time for proper synchronization
        const currentMasterTime = this.getMasterTime();
        this.rhythmClockOffset = currentMasterTime;
        this.currentRhythmPosition = 0;
        this.activeForceNodes.clear();
        
        // Ensure force calculations are ready
        this.calculateLayerForces();
        
        console.log(`🎮 Player ${this.playerId} connection complete - rhythm clock offset: ${this.rhythmClockOffset}, master time: ${currentMasterTime}, anchor will unpin in 500ms`);
    }

    // ====================================
    // PHYSICS SYSTEM (adapted from Hinges)
    // ====================================

    updateRhythmicProgression() {
        // PAUSE rhythm progression during invulnerability
        if (this.isInvulnerable) {
            this.activeForceNodes.clear();
            return;
        }
        
        if (this.spacesPlot.length === 0) return;
        
        // CRITICAL: Ensure forces are available for the current spaces plot
        if (this.nodeForces.length !== this.spacesPlot.length) {
            console.warn(`⚠️ Force array mismatch: ${this.nodeForces.length} forces vs ${this.spacesPlot.length} spaces - recalculating`);
            this.calculateLayerForces();
        }
        
        const rhythmPos = this.getCurrentRhythmPosition();
        this.currentRhythmPosition = rhythmPos.exactPosition;
        
        // SAFETY: Clear and validate before setting new active forces
        this.activeForceNodes.clear();
        
        // CRITICAL: Bounds checking before activating forces
        if (rhythmPos.spaceIndex >= 0 && 
            rhythmPos.spaceIndex < this.spacesPlot.length && 
            rhythmPos.spaceIndex < this.nodeForces.length) {
            this.activeForceNodes.add(rhythmPos.spaceIndex);
            
            // DEBUG: Log rhythm progression resumption after reconnection
            if (this.lastProgressionLog !== rhythmPos.spaceIndex) {
                console.log(`🔄 Player ${this.playerId} rhythm active on space ${rhythmPos.spaceIndex}/${this.spacesPlot.length-1} (progress: ${rhythmPos.cycleProgress.toFixed(3)}, force: ${this.nodeForces[rhythmPos.spaceIndex]?.layer})`);
                this.lastProgressionLog = rhythmPos.spaceIndex;
            }
        } else {
            console.warn(`⚠️ Player ${this.playerId} invalid rhythm position ${rhythmPos.spaceIndex} (spaces: ${this.spacesPlot.length}, forces: ${this.nodeForces.length})`);
        }
    }

    queueReconnectionForNextBeat(nodeAIndex, nodeBIndex, midpoint, duration) {
        this.pendingReconnection = {
            nodeAIndex,
            nodeBIndex,
            midpoint,
            duration,
            triggerAtSpace: null // Will be set to next space
        };
        
        const currentPos = this.getCurrentRhythmPosition();
        const nextSpace = (currentPos.spaceIndex + 1) % this.spacesPlot.length;
        this.pendingReconnection.triggerAtSpace = nextSpace;
        
        console.log(`⏳ Reconnection queued for space ${nextSpace} (currently at ${currentPos.spaceIndex})`);
    }

    setInvulnerable(value, reason = 'unknown') {
        console.log(`🛡️ Setting invulnerability to ${value} for Player ${this.playerId}. Reason: ${reason}`);
        this.isInvulnerable = value;
        
        // CRITICAL: When invulnerability ends, immediately validate rhythm progression
        if (!value && this.spacesPlot.length > 0) {
            console.log(`🔄 Player ${this.playerId} exiting invulnerability - validating rhythm progression`);
            setTimeout(() => {
                if (!this.isInvulnerable && this.isAlive) {
                    this.validateRhythmProgression();
                }
            }, 100); // Small delay to ensure all reconnection processes are complete
        }
    }

    applyPhysics() {
        // CRITICAL: Skip ALL physics for invulnerable players
        if (this.isInvulnerable) {
            return;
        }

        // CRITICAL: Check for one-node elimination condition (automatic defeat)
        if (this.isAlive && this.nodes.length <= 1) {
            console.log(`💀 Player ${this.playerId} AUTO-ELIMINATED: Only ${this.nodes.length} node(s) remaining`);
            this.eliminate();
            return;
        }

        // Emergency validation every 60 frames (~1 second at 60fps)
        if (!this.lastValidation) this.lastValidation = 0;
        if (Date.now() - this.lastValidation > 1000) {
            this.validateAndRepairStructure();
            this.lastValidation = Date.now();
        }
        
        // Update forces every 33ms (~30fps) to reduce computation
        if (!this.lastForceUpdate) this.lastForceUpdate = Date.now();
        if (Date.now() - this.lastForceUpdate > 33) {
            this.calculateLayerForces();
            this.lastForceUpdate = Date.now();
        }
        
        // Calculate gravity force every 50ms to reduce computation
        if (!this.lastGravityUpdate) this.lastGravityUpdate = Date.now();
        if (!this.cachedGravity || Date.now() - this.lastGravityUpdate > 50) {
            this.cachedGravity = this.calculateGravityForce();
            this.lastGravityUpdate = Date.now();
        }
        const gravity = this.cachedGravity;
        
        // Apply physics to all non-pinned nodes
        for (let i = 1; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            
            const tempX = node.x;
            const tempY = node.y;
            
            let velocityX = (node.x - node.oldX) * this.damping;
            let velocityY = (node.y - node.oldY) * this.damping;
            
            // Apply layer forces
            const forceIndex = i - 1;
            if (this.activeForceNodes.has(forceIndex) && this.nodeForces[forceIndex]) {
                const force = this.nodeForces[forceIndex];
                const forceMultiplier = 1.2;
                
                velocityX += force.x * forceMultiplier;
                velocityY += force.y * forceMultiplier;
            }
            
            // NEW: Apply gravity to all nodes
            if (gravity.magnitude > 0) {
                velocityX += gravity.x;
                velocityY += gravity.y;
                
                // Gravity applied (logging removed for performance)
            }
            
            node.x += velocityX;
            node.y += velocityY;
            
            node.oldX = tempX;
            node.oldY = tempY;
        }
    }

    constrainSegments() {
        for (const segment of this.segments) {
            const nodeA = this.nodes[segment.nodeA];
            const nodeB = this.nodes[segment.nodeB];
            
            if (!nodeA || !nodeB) continue;
            
            const deltaX = nodeB.x - nodeA.x;
            const deltaY = nodeB.y - nodeA.y;
            const currentLength = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            if (currentLength === 0) continue;
            
            const difference = segment.restLength - currentLength;
            const percent = difference / currentLength / 2;
            
            const offsetX = deltaX * percent * this.tensionStrength;
            const offsetY = deltaY * percent * this.tensionStrength;
            
            if (!nodeA.pinned) {
                nodeA.x -= offsetX;
                nodeA.y -= offsetY;
            }
            if (!nodeB.pinned) {
                nodeB.x += offsetX;
                nodeB.y += offsetY;
            }
        }
    }

    calculateDistance(nodeA, nodeB) {
        // CRITICAL SAFETY: Check for undefined nodes to prevent game freeze
        if (!nodeA || !nodeB) {
            console.error(`❌ calculateDistance called with undefined nodes: nodeA=${!!nodeA}, nodeB=${!!nodeB}`);
            return 0; // Return safe default instead of crashing
        }
        
        // CRITICAL SAFETY: Check for undefined coordinates
        if (typeof nodeA.x !== 'number' || typeof nodeA.y !== 'number' || 
            typeof nodeB.x !== 'number' || typeof nodeB.y !== 'number') {
            console.error(`❌ calculateDistance called with invalid coordinates: nodeA(${nodeA.x}, ${nodeA.y}), nodeB(${nodeB.x}, ${nodeB.y})`);
            return 0; // Return safe default instead of crashing
        }
        
        const deltaX = nodeB.x - nodeA.x;
        const deltaY = nodeB.y - nodeA.y;
        return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    }

    // ====================================
    // COLLISION
    // ====================================

    sufferAttackWithDelayedReconnection(segmentIndex, attackerForce, midpoint, reconnectionDuration) {
        if (!this.isAlive || segmentIndex >= this.segments.length || this.isReconnecting) {
            return;
        }
        
        console.log(`💥 Player ${this.playerId} hit! Starting immediate bezier reconnection`);
        
        // Get segment info BEFORE removal
        const destroyedSegment = this.segments[segmentIndex];
        const nodeAIndex = destroyedSegment.nodeA;
        const nodeBIndex = destroyedSegment.nodeB;
        const destroyedSpaceIndex = destroyedSegment.spaceIndex;
        const destroyedSpaceValue = destroyedSegment.originalSpaceValue;
        
        console.log(`🔍 DESTROYING: segment ${segmentIndex}, space index ${destroyedSpaceIndex}, space value ${destroyedSpaceValue}`);
        
        // CRITICAL: Play the segment's note before destruction!
        if (this.parent?.battleController?.colliderAudio) {
            this.parent.battleController.colliderAudio.playSegmentNote(this, destroyedSegment);
        }
        
        // Remove segment immediately
        this.segments.splice(segmentIndex, 1);
        
        // CRITICAL: Remove the destroyed space from spaces plot and update HP and node count
        if (destroyedSpaceIndex >= 0 && destroyedSpaceIndex < this.spacesPlot.length) {
            this.spacesPlot.splice(destroyedSpaceIndex, 1);
            this.grid = this.spacesPlot.reduce((sum, space) => sum + space, 0);
            this.hp = this.grid;
            this.nodeCount = this.nodes.length - 1; // Update node count (will be decremented by 1 in fuseNodes)
            console.log(`🎮 Player ${this.playerId} NEW SPACES PLOT: [${this.spacesPlot.join(', ')}], HP: ${this.hp}, Nodes: ${this.nodeCount}`);
        }
        
        // Check elimination - if no segments left, player is defeated
        if (this.segments.length === 0 || this.spacesPlot.length === 0) {
            console.log(`💀 Player ${this.playerId} eliminated - no segments remaining`);
            this.eliminate();
            return;
        }
        
        // Start bezier reconnection with space plot info
        this.startBezierReconnection(nodeAIndex, nodeBIndex, destroyedSpaceIndex);
    }

    // Add this right after the sufferAttackWithDelayedReconnection method in ColliderPlayer.js
    testTimeout() {
        console.log(`🧪 Testing timeout for Player ${this.playerId}`);
        setTimeout(() => {
            console.log(`🧪 Timeout test successful for Player ${this.playerId}`);
        }, 100);
    }

    getNodePositions() {
        const validNodes = [];
        
        for (let index = 0; index < this.nodes.length; index++) {
            const node = this.nodes[index];
            
            // Safety check: ensure node exists and has valid coordinates
            if (node && typeof node.x === 'number' && typeof node.y === 'number') {
                validNodes.push({
                    x: node.x,
                    y: node.y,
                    index: index,
                    playerId: this.playerId
                });
            } else {
                console.warn(`⚠️ Player ${this.playerId}: Invalid node at index ${index}`);
            }
        }
        
        return validNodes;
    }

    getSegments() {
        const validSegments = [];
        
        for (let segmentIndex = 0; segmentIndex < this.segments.length; segmentIndex++) {
            const segment = this.segments[segmentIndex];
            
            // Safety check: ensure segment has valid node indices
            if (segment.nodeA >= 0 && segment.nodeA < this.nodes.length &&
                segment.nodeB >= 0 && segment.nodeB < this.nodes.length) {
                
                const nodeA = this.nodes[segment.nodeA];
                const nodeB = this.nodes[segment.nodeB];
                
                // Safety check: ensure nodes exist and have coordinates
                if (nodeA && nodeB && 
                    typeof nodeA.x === 'number' && typeof nodeA.y === 'number' &&
                    typeof nodeB.x === 'number' && typeof nodeB.y === 'number') {
                    
                    validSegments.push({
                        nodeA: nodeA,
                        nodeB: nodeB,
                        segmentIndex: segmentIndex,
                        playerId: this.playerId,
                        spaceIndex: segment.spaceIndex
                    });
                } else {
                    console.warn(`⚠️ Player ${this.playerId}: Invalid nodes for segment ${segmentIndex}`);
                }
            } else {
                console.warn(`⚠️ Player ${this.playerId}: Invalid node indices for segment ${segmentIndex}: nodeA=${segment.nodeA}, nodeB=${segment.nodeB}, nodes.length=${this.nodes.length}`);
            }
        }
        
        return validSegments;
    }

    getCenterOfMass() {
        if (this.nodes.length === 0) return { x: this.startX, y: this.startY };
        
        let totalX = 0;
        let totalY = 0;
        
        for (const node of this.nodes) {
            totalX += node.x;
            totalY += node.y;
        }
        
        return {
            x: totalX / this.nodes.length,
            y: totalY / this.nodes.length
        };
    }

    applyReboundForce(forceX, forceY) {
        // ANIMATED REBOUND: Set rebound velocity for gradual center-of-mass movement
        // This will be applied over time during reconnection animation
        
        const centerOfMass = this.getCenterOfMass();
        
        // Set rebound velocity (will be applied gradually during animation)
        // Scale down the force to make it a reasonable velocity
        const velocityScale = 0.07;
        this.reboundVelocity.x = forceX * velocityScale;
        this.reboundVelocity.y = forceY * velocityScale;
        
        console.log(`🚀 Player ${this.playerId} rebound velocity set: (${this.reboundVelocity.x.toFixed(2)}, ${this.reboundVelocity.y.toFixed(2)}) - will animate from center (${centerOfMass.x.toFixed(1)}, ${centerOfMass.y.toFixed(1)})`);
    }

    applyReboundVelocity() {
        // Apply rebound velocity to all nodes as rigid body translation
        if (Math.abs(this.reboundVelocity.x) > 0.01 || Math.abs(this.reboundVelocity.y) > 0.01) {
            for (const node of this.nodes) {
                if (!node.pinned) {
                    node.x += this.reboundVelocity.x;
                    node.y += this.reboundVelocity.y;
                    
                    // Update old position to maintain physics consistency
                    node.oldX += this.reboundVelocity.x;
                    node.oldY += this.reboundVelocity.y;
                }
            }
            
            // Apply damping to gradually reduce rebound velocity
            this.reboundVelocity.x *= this.reboundDamping;
            this.reboundVelocity.y *= this.reboundDamping;
        }
    }

    calculateGravityForce() {
        // No gravity during invulnerability or if no battle controller
        if (this.isInvulnerable || !this.parent?.battleController) {
            return { x: 0, y: 0, magnitude: 0 };
        }
        
        // CRITICAL: Ensure battle controller is in active battle state for gravity timing
        if (this.parent.battleController.gameState !== 'battle') {
            return { x: 0, y: 0, magnitude: 0 };
        }
        
        const battleElapsed = this.parent.battleController.getBattleElapsedTime();
        const battleCenter = this.parent.battleController.battleCenter;
        const centerOfMass = this.getCenterOfMass();
        
        // Gravity calculation (logging removed for performance)
        
        // Gravity timing: 
        // 0-10s: No gravity  
        // 10-20s: Gradually increase from 0 to maximum
        // 20s+: Maximum gravity
        
        // DYNAMIC PLAYER-SCALED GRAVITY TIMING
        const alivePlayers = this.parent.battleController.players.filter(p => p.isAlive);
        const playerCount = alivePlayers.length;
        
        // Scale timing based on player count - more players = earlier gravity activation
        const baseStartTime = 20000; // 20 seconds for 4 players
        const timeReduction = (4 - playerCount) * 5000; // Reduce by 5s per eliminated player
        const GRAVITY_START_TIME = Math.max(5000, baseStartTime - timeReduction); // Min 5s
        
        const baseDuration = 20000; // 20 seconds for 4 players  
        const durationReduction = (4 - playerCount) * 3000; // Reduce by 3s per eliminated player
        const GRAVITY_RAMP_DURATION = Math.max(3000, baseDuration - durationReduction); // Min 3s
        
        // Scale strength based on remaining players - fewer players = stronger gravity
        const baseStrength = 0.8;
        const strengthMultiplier = 4 / Math.max(playerCount, 1); // Inverse scaling
        const MAX_GRAVITY_STRENGTH = baseStrength * strengthMultiplier;
        
        if (battleElapsed < GRAVITY_START_TIME) {
            return { x: 0, y: 0, magnitude: 0 }; // No gravity yet
        }
        
        // Calculate gravity strength (0 to 1)
        const gravityElapsed = battleElapsed - GRAVITY_START_TIME;
        const gravityProgress = Math.min(gravityElapsed / GRAVITY_RAMP_DURATION, 1);
        
        // Smooth easing curve for gravity ramp-up
        const easedProgress = gravityProgress < 0.5 
            ? 2 * gravityProgress * gravityProgress 
            : 1 - Math.pow(-2 * gravityProgress + 2, 2) / 2;
        
        const currentGravityStrength = easedProgress * MAX_GRAVITY_STRENGTH;
        
        // Calculate direction from center of mass to battle center
        const deltaX = battleCenter.x - centerOfMass.x;
        const deltaY = battleCenter.y - centerOfMass.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        if (distance === 0) {
            return { x: 0, y: 0, magnitude: 0 };
        }
        
        // Normalize direction and apply gravity strength
        const normalizedX = deltaX / distance;
        const normalizedY = deltaY / distance;
        
        const gravityX = normalizedX * currentGravityStrength;
        const gravityY = normalizedY * currentGravityStrength;
        
        // Log gravity activation/changes with player scaling info
        if (gravityElapsed < 1000 && gravityElapsed > 0) { // First second of gravity
            console.log(`🌍 GRAVITY ACTIVATED for Player ${this.playerId} at ${(battleElapsed/1000).toFixed(1)}s - strength: ${currentGravityStrength.toFixed(3)} (${playerCount} players, multiplier: ${strengthMultiplier.toFixed(2)}x)`);
        } else if (currentGravityStrength > 0 && Math.floor(battleElapsed / 5000) !== Math.floor((battleElapsed - 100) / 5000)) { // Every 5 seconds
            console.log(`🌍 Gravity update for Player ${this.playerId}: ${currentGravityStrength.toFixed(3)} strength at ${(battleElapsed/1000).toFixed(1)}s (${playerCount} players remaining)`);
        }
        
        return {
            x: gravityX,
            y: gravityY,
            magnitude: currentGravityStrength,
            progress: easedProgress,
            playerCount: playerCount,
            strengthMultiplier: strengthMultiplier,
            startTime: GRAVITY_START_TIME,
            rampDuration: GRAVITY_RAMP_DURATION
        };
    }

    // ====================================
    // RECONNECTION
    // ====================================     

    startBezierReconnection(nodeAIndex, nodeBIndex, destroyedSpaceIndex) {
        // Set reconnection state
        this.isReconnecting = true;
        this.isInvulnerable = true;
        this.invulnerabilityGlow = 1.0;
        this.animationPhase = 'reconnecting';
        this.phaseStartTime = Date.now();
        
        // Determine which node moves (earliest in sequence)
        const movingNodeIndex = Math.min(nodeAIndex, nodeBIndex);
        const targetNodeIndex = Math.max(nodeAIndex, nodeBIndex);
        
        const movingNode = this.nodes[movingNodeIndex];
        const targetNode = this.nodes[targetNodeIndex];
        
        if (!movingNode || !targetNode) {
            console.error(`❌ Invalid nodes for reconnection`);
            this.completeReconnection();
            return;
        }
        
        // Store reconnection data including space index info
        this.reconnectionData = {
            movingNodeIndex,
            targetNodeIndex,
            destroyedSpaceIndex, // Track which space was destroyed
            originalStartPos: { x: movingNode.x, y: movingNode.y }, // Original positions before any rebound
            originalTargetPos: { x: targetNode.x, y: targetNode.y },
            originalControlPoint: {
                x: movingNode.x - 80,
                y: Math.min(movingNode.y - 120, targetNode.y - 60)
            },
            totalReboundOffset: { x: 0, y: 0 } // Track total rebound movement
        };
        
        console.log(`🧲 Starting bezier reconnection: Node ${movingNodeIndex} → Node ${targetNodeIndex}, destroyed space ${destroyedSpaceIndex}`);
    }

    animateBezierReconnection() {
        if (!this.reconnectionData) {
            console.error(`❌ No reconnection data in animateBezierReconnection for Player ${this.playerId}`);
            return;
        }
        
        const elapsed = Date.now() - this.phaseStartTime;
        const duration = 300; // Fixed 2-second duration
        const progress = Math.min(elapsed / duration, 1);
        
        // Smooth easing (same as your animateConnection)
        const eased = 1 - Math.pow(1 - progress, 2);
        
        const { movingNodeIndex, originalStartPos, originalTargetPos, originalControlPoint, totalReboundOffset } = this.reconnectionData;
        const movingNode = this.nodes[movingNodeIndex];
        
        if (!movingNode) {
            this.completeReconnection();
            return;
        }
        
        // Update rebound offset tracking
        totalReboundOffset.x += this.reboundVelocity.x;
        totalReboundOffset.y += this.reboundVelocity.y;
        
        // Calculate bezier curve with rebound-adjusted coordinates
        const adjustedStartPos = {
            x: originalStartPos.x + totalReboundOffset.x,
            y: originalStartPos.y + totalReboundOffset.y
        };
        const adjustedTargetPos = {
            x: originalTargetPos.x + totalReboundOffset.x,
            y: originalTargetPos.y + totalReboundOffset.y
        };
        const adjustedControlPoint = {
            x: originalControlPoint.x + totalReboundOffset.x,
            y: originalControlPoint.y + totalReboundOffset.y
        };
        
        // Bezier curve calculation with moving coordinates
        const t = eased;
        const invT = 1 - t;
        
        movingNode.x = Math.pow(invT, 2) * adjustedStartPos.x + 
                       2 * invT * t * adjustedControlPoint.x + 
                       Math.pow(t, 2) * adjustedTargetPos.x;
                       
        movingNode.y = Math.pow(invT, 2) * adjustedStartPos.y + 
                       2 * invT * t * adjustedControlPoint.y + 
                       Math.pow(t, 2) * adjustedTargetPos.y;
        
        // Override physics during reconnection
        movingNode.oldX = movingNode.x;
        movingNode.oldY = movingNode.y;
        movingNode.pinned = true; // Keep pinned during animation
        
        // APPLY REBOUND VELOCITY: Animate center-of-mass movement during reconnection
        this.applyReboundVelocity();
        
        // Check if reconnection is complete
        if (progress >= 1) {
            console.log(`🎯 Bezier animation complete - CLEARING PINS AND INVULNERABILITY`);
            
            // CRITICAL: Unpin the moving node BEFORE fusion
            movingNode.pinned = false;
            
            // CRITICAL: Clear invulnerability BEFORE calling completeReconnection
            this.isInvulnerable = false;
            this.invulnerabilityGlow = 0;
            this.isReconnecting = false;
            
            // Clear rebound velocity when reconnection completes
            this.reboundVelocity.x = 0;
            this.reboundVelocity.y = 0;
            
            this.completeReconnection();
        }
    }

    completeReconnection() {
        if (!this.reconnectionData) {
            console.error(`❌ No reconnection data found for Player ${this.playerId}`);
            return;
        }
        
        const { movingNodeIndex, targetNodeIndex, destroyedSpaceIndex } = this.reconnectionData;
        
        console.log(`✨ FUSION COMPLETE: Rebuilding structure after destroying space ${destroyedSpaceIndex}`);
        
        // Ensure both nodes are unpinned before fusion
        if (this.nodes[movingNodeIndex]) this.nodes[movingNodeIndex].pinned = false;
        if (this.nodes[targetNodeIndex]) this.nodes[targetNodeIndex].pinned = false;
        
        // STEP 1: Fuse the nodes physically
        this.fuseNodes(movingNodeIndex, targetNodeIndex);
        
        // STEP 2: REBUILD the entire structure mapping
        this.rebuildStructureAfterFusion(destroyedSpaceIndex);
        
        // Clean up reconnection state (states already cleared in animateBezierReconnection)
        this.reconnectionData = null;
        this.animationPhase = 'settling';
        
        // CRITICAL: Check for one-node elimination after fusion
        if (this.isAlive && this.nodes.length <= 1) {
            console.log(`💀 Player ${this.playerId} ELIMINATED after fusion: Only ${this.nodes.length} node(s) remaining`);
            this.eliminate();
            return;
        }
        
        console.log(`✅ Structure rebuilt and unpinned - resuming battle with ${this.spacesPlot.length} spaces`);
    }

    reinitializeAfterReconnection() {
        console.log(`🔄 SAFE reinitialization after reconnection for Player ${this.playerId}`);
        
        // CRITICAL: Validate and repair structure first
        this.validateAndRepairStructure();
        
        // Recalculate layer forces for the new structure
        this.calculateLayerForces();
        
        // Reset rhythm timing system
        this.rhythmStartTime = Date.now();
        this.currentRhythmPosition = 0;
        this.activeForceNodes.clear();
        
        // Ensure center-oriented forces with magnitude limits
        const masterTime = window.colliderMasterClock ? window.colliderMasterClock.getTime() : Date.now();
        this.rhythmClockOffset = masterTime;
        
        // Safety check: verify arrays are properly sized
        const expectedForces = Math.max(0, this.nodes.length - 1);
        if (this.nodeForces.length !== expectedForces) {
            console.warn(`⚠️ Force array size mismatch after reconnection - recalculating`);
            this.calculateLayerForces();
        }
        
        console.log(`🔄 SAFE reinitialization complete: ${this.nodeForces.length} forces for ${this.nodes.length} nodes`);
    }

    fuseNodes(sourceIndex, targetIndex) {
        console.log(`🔗 Fusing nodes: ${sourceIndex} → ${targetIndex}`);
        console.log(`🔍 PRE-FUSION: sourceNode.pinned=${this.nodes[sourceIndex]?.pinned}, targetNode.pinned=${this.nodes[targetIndex]?.pinned}`);
        
        // Position the target node at the fusion point (midpoint of the two nodes)
        if (this.nodes[targetIndex] && this.nodes[sourceIndex]) {
            // Use midpoint for more natural fusion
            const midX = (this.nodes[sourceIndex].x + this.nodes[targetIndex].x) / 2;
            const midY = (this.nodes[sourceIndex].y + this.nodes[targetIndex].y) / 2;
            
            this.nodes[targetIndex].x = midX;
            this.nodes[targetIndex].y = midY;
            this.nodes[targetIndex].oldX = midX;
            this.nodes[targetIndex].oldY = midY;
            this.nodes[targetIndex].pinned = false; // CRITICAL: Ensure unpinned
            
            console.log(`🔗 Target node positioned at (${midX.toFixed(1)}, ${midY.toFixed(1)}) and unpinned`);
        }
        
        // Remove the higher-indexed node
        const removeIndex = Math.max(sourceIndex, targetIndex);
        console.log(`🗑️ Removing node ${removeIndex}, keeping node ${Math.min(sourceIndex, targetIndex)}`);
        
        this.nodes.splice(removeIndex, 1);
        this.nodeCount = this.nodes.length; // Update node count after fusion
        
        console.log(`✅ Physical fusion complete: ${this.nodes.length} nodes remaining`);
    }

    rebuildStructureAfterFusion(destroyedSpaceIndex) {
        console.log(`🔄 REBUILDING STRUCTURE: ${this.nodes.length} nodes, ${this.spacesPlot.length} spaces`);
        
        // STEP 1: Rebuild segments to match new spaces plot
        this.segments = [];
        
        // Create segments for the shortened spaces plot
        for (let i = 0; i < this.spacesPlot.length; i++) {
            const nodeA = i;
            const nodeB = i + 1; // Sequential connection (don't wrap yet)
            
            this.segments.push({
                nodeA: nodeA,
                nodeB: nodeB,
                restLength: this.calculateDistance(this.nodes[nodeA], this.nodes[nodeB]),
                originalSpaceValue: this.spacesPlot[i],
                spaceIndex: i
            });
        }
        
        // CRITICAL: Add the closing segment to complete the circle
        const lastNodeIndex = this.nodes.length - 1;
        const lastNode = this.nodes[lastNodeIndex];
        const firstNode = this.nodes[0];
        
        if (lastNode && firstNode) {
            this.segments.push({
                nodeA: lastNodeIndex,
                nodeB: 0, // Close the loop back to first node
                restLength: this.calculateDistance(lastNode, firstNode),
                originalSpaceValue: 0, // Closing segment has no space value
                spaceIndex: -1 // Mark as closing segment
            });
        } else {
            console.error(`❌ Cannot create closing segment in rebuild - missing nodes: first=${!!firstNode}, last=${!!lastNode}`);
        }
        
        console.log(`🔗 Created ${this.segments.length} segments: ${this.spacesPlot.length} space segments + 1 closing segment`);
        
        // STEP 2: CRITICAL TIMING SYNC - Get current master time FIRST to ensure consistency
        const currentMasterTime = this.getMasterTime();
        
        // STEP 3: Reset rhythm progression timing with synchronized master clock
        this.rhythmStartTime = Date.now();
        this.rhythmClockOffset = currentMasterTime; // Use consistent master time reference
        this.currentRhythmPosition = 0;
        this.activeForceNodes.clear();
        
        // STEP 4: Recalculate layer forces for the NEW spaces plot AFTER timing is synchronized
        this.calculateLayerForces();
        
        console.log(`🔄 Rhythm timing synchronized: offset=${this.rhythmClockOffset}, masterTime=${currentMasterTime}`);
        
        // CRITICAL: Validate that rhythm progression can resume immediately
        this.validateRhythmProgression();
        
        // CRITICAL: Force an immediate rhythm position update to ensure progression resumes
        setTimeout(() => {
            if (this.isAlive && !this.isInvulnerable) {
                const testPos = this.getCurrentRhythmPosition();
                console.log(`🔄 Player ${this.playerId} post-reconnection rhythm check: space ${testPos.spaceIndex}, progress ${testPos.cycleProgress.toFixed(3)}`);
            }
        }, 200); // Small delay to let timing settle
        
        console.log(`🔄 Structure rebuild complete:`);
        console.log(`   - Nodes: ${this.nodes.length}`);
        console.log(`   - Segments: ${this.segments.length} (${this.spacesPlot.length} space + 1 closing)`);
        console.log(`   - Spaces: [${this.spacesPlot.join(', ')}]`);
        console.log(`   - Forces: ${this.nodeForces.length}`);
        console.log(`   - HP: ${this.hp}`);
        
        // CRITICAL: Final check for one-node elimination after rebuild
        if (this.isAlive && this.nodes.length <= 1) {
            console.log(`💀 Player ${this.playerId} ELIMINATED after rebuild: Only ${this.nodes.length} node(s) remaining`);
            this.eliminate();
            return;
        }
    }

    // Helper method to create reconnection segments
    createReconnectionSegment(nodeAIndex, nodeBIndex) {
        if (nodeAIndex === nodeBIndex) {
            console.warn(`⚠️ Attempted to connect node ${nodeAIndex} to itself`);
            return;
        }
        
        const nodeA = this.nodes[nodeAIndex];
        const nodeB = this.nodes[nodeBIndex];
        
        if (!nodeA || !nodeB) {
            console.error(`❌ Invalid nodes for reconnection: ${nodeAIndex}, ${nodeBIndex}`);
            return;
        }
        
        if (!nodeA || !nodeB) {
            console.error(`❌ Invalid nodes for reconnection segment: nodeA=${!!nodeA}, nodeB=${!!nodeB}`);
            return;
        }
        
        const distance = this.calculateDistance(nodeA, nodeB);
        
        const reconnectionSegment = {
            nodeA: nodeAIndex,
            nodeB: nodeBIndex,
            restLength: distance,
            originalSpaceValue: 1, // Minimal value for fused connection
            spaceIndex: -1 // Mark as fusion segment
        };
        
        this.segments.push(reconnectionSegment);
        console.log(`🔗 RECONNECTION CREATED: ${nodeAIndex} <-> ${nodeBIndex} (distance: ${distance.toFixed(2)})`);
    }

    validateStructureConnectivity() {
        console.log(`🔍 VALIDATING STRUCTURE CONNECTIVITY:`);
        
        // Build adjacency list
        const connections = new Map();
        for (let i = 0; i < this.nodes.length; i++) {
            connections.set(i, []);
        }
        
        for (const segment of this.segments) {
            connections.get(segment.nodeA)?.push(segment.nodeB);
            connections.get(segment.nodeB)?.push(segment.nodeA);
        }
        
        // Find disconnected nodes
        const disconnected = [];
        for (const [nodeIndex, nodeConnections] of connections) {
            if (nodeConnections.length === 0) {
                disconnected.push(nodeIndex);
            }
            console.log(`  Node ${nodeIndex}: ${nodeConnections.length} connections [${nodeConnections.join(', ')}]`);
        }
        
        if (disconnected.length > 0) {
            console.error(`❌ DISCONNECTED NODES: ${disconnected.join(', ')}`);
            return false;
        }
        
        console.log(`✅ Structure connectivity validated - all nodes connected`);
        return true;
    }

    // Add this method to track structure integrity
    checkStructureIntegrity() {
        let totalLength = 0;
        let segmentCount = 0;
        
        for (const segment of this.segments) {
            const nodeA = this.nodes[segment.nodeA];
            const nodeB = this.nodes[segment.nodeB];
            
            if (nodeA && nodeB) {
                const length = this.calculateDistance(nodeA, nodeB);
                totalLength += length;
                segmentCount++;
            }
        }
        
        const averageLength = segmentCount > 0 ? totalLength / segmentCount : 0;
        console.log(`🔍 Structure integrity: ${segmentCount} segments, avg length: ${averageLength.toFixed(2)}`);
        
        return { segmentCount, averageLength, totalLength };
    }
    
    // CRITICAL: Method to validate and ensure rhythm progression can resume
    validateRhythmProgression() {
        if (this.spacesPlot.length === 0) {
            console.warn(`⚠️ Player ${this.playerId} has no spaces plot for rhythm progression`);
            return false;
        }
        
        // Ensure force array matches spaces plot
        if (this.nodeForces.length !== this.spacesPlot.length) {
            console.warn(`⚠️ Player ${this.playerId} force array mismatch - recalculating forces`);
            this.calculateLayerForces();
        }
        
        // Test rhythm position calculation multiple times to ensure progression
        const testRhythmPos1 = this.getCurrentRhythmPosition();
        if (testRhythmPos1.spaceIndex < 0 || testRhythmPos1.spaceIndex >= this.spacesPlot.length) {
            console.error(`❌ Player ${this.playerId} invalid rhythm position after rebuild: ${testRhythmPos1.spaceIndex}`);
            // Force reset timing if invalid
            this.rhythmClockOffset = this.getMasterTime();
            return false;
        }
        
        // Test progression by checking position slightly in the future
        setTimeout(() => {
            const testRhythmPos2 = this.getCurrentRhythmPosition();
            if (testRhythmPos2.cycleProgress === testRhythmPos1.cycleProgress) {
                console.warn(`⚠️ Player ${this.playerId} rhythm progression may be stuck - cycle progress unchanged`);
                // Force slight timing adjustment
                this.rhythmClockOffset = this.getMasterTime() - 10;
            }
        }, 50);
        
        console.log(`✅ Player ${this.playerId} rhythm progression validated - ready to resume at space ${testRhythmPos1.spaceIndex} (progress: ${testRhythmPos1.cycleProgress.toFixed(3)})`);
        return true;
    }

    // Add this method to ColliderPlayer for testing
    manualTestReconnection() {
        console.log(`🧪 MANUAL RECONNECTION TEST for Player ${this.playerId}`);
        
        if (this.nodes.length >= 2) {
            const nodeA = 0;
            const nodeB = 1;
            const midpoint = { x: 400, y: 300 };
            const duration = 10; // Short duration for testing
            
            console.log(`🧪 Calling startReconnectionWithMasterClock directly`);
            this.startReconnectionWithMasterClock(nodeA, nodeB, midpoint, duration);
        } else {
            console.log(`🧪 Not enough nodes for test`);
        }
    }

    eliminate() {
        this.isAlive = false;
        this.hp = 0;
        this.invulnerabilityGlow = 0;
        this.isInvulnerable = false;
        this.isReconnecting = false;
        
        // CRITICAL: Clear gravity cache so remaining players get recalculated gravity
        this.cachedGravity = null;
        this.lastGravityUpdate = 0;
        
        console.log(`💀 Player ${this.playerId} has been eliminated! Remaining players will get stronger gravity.`);
        
        // Notify battle controller of elimination
        if (this.parent?.battleController) {
            this.parent.battleController.onPlayerEliminated(this);
            
            // Force gravity recalculation for all remaining players
            for (const player of this.parent.battleController.players) {
                if (player.isAlive && player.playerId !== this.playerId) {
                    player.cachedGravity = null;
                    player.lastGravityUpdate = 0;
                }
            }
        }
    }

    reset() {
        console.log(`🔄 COMPREHENSIVE PLAYER RESET for Player ${this.playerId}...`);
        
        // Reset all player state for new battle
        this.isAlive = false; // Start as inactive until rhythm is set
        this.hp = 0;
        this.maxHp = 0;
        this.originalGrid = 0;
        this.invulnerabilityGlow = 0;
        this.isInvulnerable = false;
        this.isReconnecting = false;
        this.reconnectionProgress = 0;
        this.reconnectionStartTime = 0;
        this.reconnectionDuration = 0;
        this.animationPhase = 'inactive';
        
        // Reset physics parameters to defaults
        this.gravity = 0;
        this.damping = 0.995;
        this.tensionStrength = 0.3;
        this.maxSegmentLength = 50;
        
        // CRITICAL: Reset force amplitude to default
        this.forceAmplitude = 1.0;
        
        // CRITICAL: Reset master speed integration
        this.masterSpeed = 1.0;
        
        // Clear rebound velocity
        this.reboundVelocity = { x: 0, y: 0 };
        
        // Clear rhythm data completely
        this.spacesPlot = [];
        this.rhythms = [0, 0, 0, 0];
        this.ratios = [];
        this.grid = 0;
        
        // Reset nodes and segments
        this.nodes = [];
        this.segments = [];
        this.nodeCount = 0;
        this.nodeForces = [];
        this.activeForceNodes.clear();
        
        // CRITICAL: Reset all timing and animation state to ensure clean initialization
        this.isAnimating = false;
        this.animationStartTime = 0;
        this.phaseStartTime = 0;
        this.rhythmStartTime = 0;
        this.rhythmClockOffset = 0; // Will be set when battle starts
        this.currentRhythmPosition = 0;
        
        // Reset anchor pin state
        this.anchorUnpinTime = null;
        
        // Clear reconnection data
        this.reconnectionData = null;
        this.pendingReconnection = null;
        
        // Reset layer directions to ensure proper force calculations
        this.layerDirections = {};
        
        console.log(`🔄 Player ${this.playerId} completely reset - ready for fresh initialization`);
    }
    
    clearAllCaches() {
        // Clear all performance caches and timers
        this.lastForceUpdate = 0;
        this.lastGravityUpdate = 0;
        this.lastValidation = 0;
        this.lastGravityLog = 0;
        this.lastGravityCalcLog = 0;
        this.lastProgressionLog = -1; // Reset rhythm progression logging
        this.cachedGravity = null;
        
        // Clear any other cached data
        this.layerDirections = {};
        
        console.log(`🧹 Player ${this.playerId} caches cleared`);
    }
}