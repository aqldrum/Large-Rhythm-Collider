// Hinges.js - Large Rhythm Collider Hinges Visualization
// Creates physics-based chain animation using spaces plot data as segment lengths

class LRCHinges {
    constructor(lrcVisuals) {
        this.parent = lrcVisuals;
        this.canvas = null;
        this.ctx = null;
        
        // Animation state
        this.isAnimating = false;
        this.animationId = null;
        this.startTime = 0;
        this.cycleDuration = 10000; // ms
        this.animationPhase = 'hanging'; // 'hanging', 'connecting', 'settling'
        this.phaseStartTime = 0;
        
        // Rhythmic progression tracking
        this.rhythmStartTime = 0;
        this.currentRhythmPosition = 0; // Current position in spaces plot (0 to length-1)
        this.activeForceNodes = new Set(); // Which nodes currently have active forces
        
        // Data
        this.spacesPlot = [];
        this.rhythms = [1, 1, 1, 1];
        this.totalLength = 0;
        
        // Physics parameters
        this.gravity = 0; // NO GRAVITY - pure layer force system
        this.damping = 0.995;
        this.tensionStrength = 0.3;
        this.maxSegmentLength = 50; // Max visual length for scaling

        // Chain structure
        this.nodes = [];
        this.segments = [];
        this.isConnected = false;
        
        // Visual elements
        this.centerX = 0;
        this.centerY = 0;
        this.chainColor = '#00ff88';
        this.highlightColor = '#ffff00';
        this.currentHighlight = -1;
        this.showForces = false;

        // Tension/Expansion integration flags
        this.tensionModeEnabled = false;
        this.pendingTensionActivation = false;
        
        // Chain structure
        this.nodes = [];
        this.segments = [];
        this.isConnected = false;

        // Force amplitude control
        this.forceAmplitude = 1.0; // Default scaling (middle of slider)
        this.lastForceUpdateTime = 0; // Throttle immediate updates
        this.forceAmplitudeSlider = {
            x: 10, y: 10, width: 150, height: 20,
            min: 0.1, max: 100.0,
            dragging: false, hovered: false
        };

        // Always rely on overlay controls for amplitude (hide legacy in-canvas slider)
        this.useOverlayAmplitude = true;

        // Auto-bounding camera system
        this.camera = {
            x: 0,           // Translation X
            y: 0,           // Translation Y
            scale: 1,       // Zoom level
            targetX: 0,     // Target translation X
            targetY: 0,     // Target translation Y
            targetScale: 1, // Target zoom level
            smoothing: 0.08 // Camera smoothing factor (0.01=very smooth, 0.2=snappy)
        };
    }

    // ====================================
    // SETUP AND DATA MANAGEMENT
    // ====================================

    updateData(spacesPlot, rhythms, grid, ratios, spacesLayerMap = null) {
        this.spacesPlot = spacesPlot || [];
        this.rhythms = rhythms || [1, 1, 1, 1];
        this.grid = grid || 1; // Store the grid value
        
        // Use passed spacesLayerMap or try to get from global LRC system
        this.spacesLayerMap = spacesLayerMap || 
                             window.lrcModule?.currentSpacesLayerMap || 
                             [];
        
        if (this.spacesPlot.length > 0) {
            this.calculateTotalLength();
            this.initializeChain();
            this.calculateLayerForces();
        }
    }

    setupEventListeners() {
        // Add mouse event listeners when Hinges becomes active
        if (this.parent && this.parent.canvas) {
            this.boundMouseMove = this.handleMouseMove.bind(this);
            this.boundMouseDown = this.handleMouseDown.bind(this);
            this.boundMouseUp = this.handleMouseUp.bind(this);
            
            this.parent.canvas.addEventListener('mousemove', this.boundMouseMove);
            this.parent.canvas.addEventListener('mousedown', this.boundMouseDown);
            this.parent.canvas.addEventListener('mouseup', this.boundMouseUp);
        }
    }

    handleMouseMove(event) {
        if (!this.isAnimating) return;
        if (this.useOverlayAmplitude || this.tensionModeEnabled || this.animationPhase === 'expanding') return;
        
        const rect = this.parent.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        const slider = this.forceAmplitudeSlider;
        
        // Check if mouse is over slider
        slider.hovered = (mouseX >= slider.x && mouseX <= slider.x + slider.width && 
                         mouseY >= slider.y && mouseY <= slider.y + slider.height);
        
        // Handle slider dragging
        if (slider.dragging) {
            const relativeX = Math.max(0, Math.min(slider.width, mouseX - slider.x));
            const progress = relativeX / slider.width;
            const newAmplitude = slider.min + (progress * (slider.max - slider.min));
            
            // Only recalculate forces if amplitude actually changed
            if (Math.abs(newAmplitude - this.forceAmplitude) > 0.01) {
                this.forceAmplitude = newAmplitude;
                this.calculateLayerForces(); // Recalculate forces with new amplitude
                
                // Immediately apply new forces to currently active nodes
                this.applyImmediateForceUpdate();
            }
        }
    }

    handleMouseDown(event) {
        if (!this.isAnimating) return;
        if (this.useOverlayAmplitude || this.tensionModeEnabled || this.animationPhase === 'expanding') return;
        
        const rect = this.parent.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        const slider = this.forceAmplitudeSlider;
        
        // Check if click is on slider
        if (mouseX >= slider.x && mouseX <= slider.x + slider.width && 
            mouseY >= slider.y && mouseY <= slider.y + slider.height) {
            
            slider.dragging = true;
            
            // Set initial value based on click position
            const relativeX = Math.max(0, Math.min(slider.width, mouseX - slider.x));
            const progress = relativeX / slider.width;
            const newAmplitude = slider.min + (progress * (slider.max - slider.min));
            
            if (Math.abs(newAmplitude - this.forceAmplitude) > 0.01) {
                this.forceAmplitude = newAmplitude;
                this.calculateLayerForces(); // Recalculate forces with new amplitude
                
                // Immediately apply new forces to currently active nodes
                this.applyImmediateForceUpdate();
            }
        }
    }

    handleMouseUp(event) {
        this.forceAmplitudeSlider.dragging = false;
    }

    applyImmediateForceUpdate() {
        // Throttle updates to prevent too frequent applications
        const now = Date.now();
        if (now - this.lastForceUpdateTime < 50) { // Max 20 times per second
            return;
        }
        this.lastForceUpdateTime = now;

        // Apply updated forces immediately to currently active nodes without waiting for cycle
        if (this.animationPhase !== 'settling' || !this.nodeForces || this.activeForceNodes.size === 0) {
            return;
        }
        
        // Apply a burst of the new force values to active nodes
        for (let i = 1; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            
            if (!node.pinned) {
                const forceIndex = i - 1; // Convert node index to force index (skip anchor node)
                
                // Apply immediate force if this node is currently active
                if (this.activeForceNodes.has(forceIndex) && this.nodeForces[forceIndex]) {
                    const force = this.nodeForces[forceIndex];
                    const immediateForceMultiplier = 0.3; // Immediate burst, not too strong
                    
                    // Apply velocity directly
                    const velocityX = force.x * immediateForceMultiplier;
                    const velocityY = force.y * immediateForceMultiplier;
                    
                    node.x += velocityX;
                    node.y += velocityY;
                    
                    // Update old position to maintain velocity for next frame
                    node.oldX = node.x - velocityX;
                    node.oldY = node.y - velocityY;
                    
                }
            }
        }
        
        // Apply constraint pass to maintain structure integrity
        for (let i = 0; i < 3; i++) {
            this.constrainSegments();
        }
    }

    calculateLayerForces() {
        // Define directional vectors for each layer (in radians) - only initialize if not yet set
        if (!this.layerDirections) {
            this.layerDirections = {
                'A': 0,                  // Right (0°)
                'B': 3 * Math.PI / 2,    // Up (270°) - negative Y in canvas coords
                'C': Math.PI,            // Left (180°)
                'D': Math.PI / 2         // Down (90°) - positive Y in canvas coords
            };
        }
        
        // Safety checks for initialization
        if (!this.spacesPlot || this.spacesPlot.length === 0) {
            this.nodeForces = [];
            return;
        }
        
        // Ensure forceAmplitude is initialized
        if (typeof this.forceAmplitude === 'undefined') {
            this.forceAmplitude = 1.0; // Default value
        }
        
        // Ensure maxSegmentLength is initialized
        if (typeof this.maxSegmentLength === 'undefined') {
            this.maxSegmentLength = 50; // Default value
        }
        
        // Calculate force scaling factor (similar to segment scaling)
        const maxSpace = Math.max(...this.spacesPlot);
        if (maxSpace <= 0) {
            this.nodeForces = [];
            return;
        }
        
        const baseScaleFactor = this.maxSegmentLength / maxSpace;
        
        // Calculate force vectors for each node based on contributing layers
        this.nodeForces = [];
        
        if (!this.spacesLayerMap || this.spacesLayerMap.length === 0) {
            return;
        }
        
        for (let i = 0; i < this.spacesPlot.length; i++) {
            const spaceValue = this.spacesPlot[i];
            const contributingLayers = this.spacesLayerMap[i] || [];
            
            let forceX = 0;
            let forceY = 0;
            
            // Sum up forces from all contributing layers
            contributingLayers.forEach(layer => {
                if (this.layerDirections[layer] !== undefined) {
                    const direction = this.layerDirections[layer];
                    // Base magnitude scaled by structure size
                    const baseMagnitude = spaceValue * 0.12 * baseScaleFactor;
                    // Apply amplitude multiplier from slider
                    const finalMagnitude = baseMagnitude * this.forceAmplitude;
                    
                    forceX += Math.cos(direction) * finalMagnitude;
                    forceY += Math.sin(direction) * finalMagnitude;
                }
            });
            
            this.nodeForces.push({ 
                x: forceX, 
                y: forceY, 
                magnitude: Math.sqrt(forceX * forceX + forceY * forceY),
                layers: contributingLayers.slice() // Copy array
            });
        }
        
        const totalForces = this.nodeForces.filter(f => f.magnitude > 0).length;
        
        // Safe logging with proper checks
        const amplitudeStr = (typeof this.forceAmplitude === 'number') ? this.forceAmplitude.toFixed(2) : 'unknown';
        const scaleStr = (typeof baseScaleFactor === 'number') ? baseScaleFactor.toFixed(3) : 'unknown';
        
    }

    activate() {
        if (this.parent && this.parent.spacesPlot) {
            // Get grid from LRCModule like the integration code does
            const currentData = window.lrcModule?.getCurrentData();
            const grid = currentData?.grid || window.lrcModule?.currentGrid || 1;
            
            this.updateData(
                this.parent.spacesPlot,
                this.parent.rhythms,
                grid,  // ← Use correct grid
                this.parent.ratios || [],
                currentData?.spacesLayerMap || []
            );
            this.draw();
        }
    }

    calculateTotalLength() {
        this.totalLength = this.spacesPlot.reduce((sum, space) => sum + space, 0);
    }

    initializeChain() {
        this.nodes = [];
        this.segments = [];
        this.isConnected = false;
        
        // Determine canvas dimensions
        const width = parseInt(this.parent.canvas.style.width) || 800;
        const height = parseInt(this.parent.canvas.style.height) || 400;
        
        // Start chain in center area (camera will adjust automatically)
        this.centerX = width / 2;
        this.centerY = height / 2;
        
        // Scale segment lengths to fit nicely 
        const maxSpace = Math.max(...this.spacesPlot);
        const scaleFactor = this.maxSegmentLength / maxSpace;
        
        // Create first node at center - KEEP PINNED during connection animation
        this.nodes.push({
            x: this.centerX,
            y: this.centerY - 100,
            oldX: this.centerX,
            oldY: this.centerY - 100,
            pinned: true, // Keep pinned until connection completes
            velocity: { x: 0, y: 0 }
        });
        
        // Create subsequent nodes along vertical hanging line
        let currentX = this.centerX;
        let currentY = this.centerY - 100;
        
        for (let i = 0; i < this.spacesPlot.length; i++) {
            const segmentLength = this.spacesPlot[i] * scaleFactor;
            currentY += segmentLength;
            
            // Create node
            this.nodes.push({
                x: currentX,
                y: currentY,
                oldX: currentX,
                oldY: currentY,
                pinned: false,
                velocity: { x: 0, y: 0 }
            });
            
            // Create segment
            this.segments.push({
                nodeA: i,
                nodeB: i + 1,
                restLength: segmentLength,
                originalSpaceValue: this.spacesPlot[i]
            });
        }
        
        // Initialize camera to frame the initial chain
        this.camera.x = 0;
        this.camera.y = 0;
        this.camera.scale = 1;
        this.camera.targetX = 0;
        this.camera.targetY = 0;
        this.camera.targetScale = 1;
    }

    // ====================================
    // RHYTHMIC PROGRESSION SYSTEM
    // ====================================
    
    updateRhythmicProgression() {
        if (this.animationPhase !== 'settling' || this.spacesPlot.length === 0) {
            return;
        }
        
        const currentTime = Date.now();
        const elapsed = currentTime - this.rhythmStartTime;
        const cycleProgress = (elapsed % this.cycleDuration) / this.cycleDuration;
        
        // Calculate current position in spaces plot
        const exactPosition = cycleProgress * this.spacesPlot.length;
        this.currentRhythmPosition = exactPosition;
        const currentIndex = Math.floor(exactPosition);
        
        // Clear previous forces, activate current only
        this.activeForceNodes.clear();
        
        if (currentIndex < this.spacesPlot.length && currentIndex < this.nodeForces.length) {
            this.activeForceNodes.add(currentIndex);
        }
    }

    updateActiveForceMomentum(currentTime) {
        // Remove expired forces and update strength of active ones
        for (const [forceIndex, forceData] of this.activeForces.entries()) {
            const elapsed = currentTime - forceData.startTime;
            
            if (elapsed > forceData.duration) {
                // Force has expired
                this.activeForces.delete(forceIndex);
            } else {
                // Update force strength (fade out over time for smoother motion)
                const progress = elapsed / forceData.duration;
                forceData.strength = Math.cos(progress * Math.PI * 0.5); // Cosine fade-out
            }
        }
    }
    
    // ====================================
    // AUTO-BOUNDING CAMERA SYSTEM
    // ====================================
    
    calculateBoundingBox() {
        if (this.nodes.length === 0) {
            return { minX: 0, maxX: 100, minY: 0, maxY: 100, width: 100, height: 100 };
        }
        
        let minX = this.nodes[0].x;
        let maxX = this.nodes[0].x;
        let minY = this.nodes[0].y;
        let maxY = this.nodes[0].y;
        
        // Find extremes across all nodes
        for (const node of this.nodes) {
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y);
        }
        
        // Add padding around the shape
        const padding = 60;
        minX -= padding;
        maxX += padding;
        minY -= padding;
        maxY += padding;
        
        return {
            minX, maxX, minY, maxY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }
    
    updateCamera(canvasWidth, canvasHeight) {
        const bounds = this.calculateBoundingBox();
        
        // Calculate scale to fit the bounding box in the canvas
        const scaleX = canvasWidth / bounds.width;
        const scaleY = canvasHeight / bounds.height;
        this.camera.targetScale = Math.min(scaleX, scaleY, 2.0); // Cap max zoom at 2x
        
        // Calculate translation to center the bounding box
        this.camera.targetX = canvasWidth / 2 - bounds.centerX * this.camera.targetScale;
        this.camera.targetY = canvasHeight / 2 - bounds.centerY * this.camera.targetScale;
        
        // Smooth interpolation toward target camera state
        this.camera.x += (this.camera.targetX - this.camera.x) * this.camera.smoothing;
        this.camera.y += (this.camera.targetY - this.camera.y) * this.camera.smoothing;
        this.camera.scale += (this.camera.targetScale - this.camera.scale) * this.camera.smoothing;
    }
    
    applyCameraTransform(ctx) {
        ctx.save();
        ctx.translate(this.camera.x, this.camera.y);
        ctx.scale(this.camera.scale, this.camera.scale);
    }
    
    restoreCameraTransform(ctx) {
        ctx.restore();
    }

    // ====================================
    // PHYSICS SIMULATION
    // ====================================

    updatePhysics() {
        if (this.nodes.length === 0) return;
        
        const currentTime = Date.now();
        const elapsed = currentTime - this.phaseStartTime;
        
        // Handle animation phases
        if (this.animationPhase === 'hanging') {
            // Let chain display for 2 seconds (no physics needed - just static display)
            if (elapsed > 2000) {
                this.startConnectionPhase();
            }
            // No physics during hanging - chain just stays in initialized position
            return;
        } else if (this.animationPhase === 'connecting') {
            // Animate connection over 3 seconds for more dramatic effect
            const progress = Math.min(elapsed / 3000, 1);
            this.animateConnection(progress);
            
            if (progress >= 1) {
                this.completeConnection();
            }
        }
        
        // Apply physics to all nodes (rhythm progression happens inside applyPhysics now)
        this.applyPhysics();
        
        // Many more constraint iterations for rigid segments
        const iterations = this.animationPhase === 'connecting' ? 8 : 15; // Greatly increased
        for (let i = 0; i < iterations; i++) {
            this.constrainSegments();
        }
    }

    startConnectionPhase() {
        this.animationPhase = 'connecting';
        this.phaseStartTime = Date.now();
        
        // Store original position of last node for arc animation
        const lastNode = this.nodes[this.nodes.length - 1];
        const firstNode = this.nodes[0];
        
        this.connectionStart = { x: lastNode.x, y: lastNode.y };
        this.connectionTarget = { x: firstNode.x, y: firstNode.y };
        
        // Create arc path - upward and to the left
        this.arcMidpoint = {
            x: this.connectionStart.x - 100, // Pull left
            y: Math.min(this.connectionStart.y - 150, firstNode.y - 50) // Pull upward
        };
    }

    animateConnection(progress) {
        // Smooth easing function for more natural movement
        const eased = 1 - Math.pow(1 - progress, 2);
        
        const lastNode = this.nodes[this.nodes.length - 1];
        
        // Create quadratic bezier curve path (upward arc)
        const t = eased;
        const invT = 1 - t;
        
        // Bezier curve: P(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
        lastNode.x = Math.pow(invT, 2) * this.connectionStart.x + 
                    2 * invT * t * this.arcMidpoint.x + 
                    Math.pow(t, 2) * this.connectionTarget.x;
                    
        lastNode.y = Math.pow(invT, 2) * this.connectionStart.y + 
                    2 * invT * t * this.arcMidpoint.y + 
                    Math.pow(t, 2) * this.connectionTarget.y;
        
        // Update velocity for more natural physics interaction
        lastNode.oldX = lastNode.x - (lastNode.x - this.connectionStart.x) * 0.1;
        lastNode.oldY = lastNode.y - (lastNode.y - this.connectionStart.y) * 0.1;
        
        // Make the end node temporarily "pulled" during animation
        lastNode.pinned = true;
    }

    completeConnection() {
        this.animationPhase = 'settling';
        this.isConnected = true;
        
        // Unpin BOTH the last node AND the anchor so entire structure can move
        const lastNode = this.nodes[this.nodes.length - 1];
        const anchorNode = this.nodes[0];
        
        lastNode.pinned = false;  // Free the end node
        anchorNode.pinned = false; // Free the anchor node - NOW the whole structure is mobile
        
        // Create closing segment
        this.segments.push({
            nodeA: this.segments.length,
            nodeB: 0,
            restLength: this.calculateDistance(this.nodes[this.nodes.length - 1], this.nodes[0]),
            originalSpaceValue: 0 // This represents the cycle closure
        });
        
        // START RHYTHM TIMING HERE - AFTER CONNECTION COMPLETES
        this.rhythmStartTime = Date.now();
        this.currentRhythmPosition = 0;
        this.activeForceNodes.clear();
        
        // Optimize physics for layer-force-only system (no gravity)
        this.tensionStrength = 0.9;
        this.damping = 0.96;
        

        if ((this.tensionModeEnabled || this.pendingTensionActivation) && this.expansion) {
            this.pendingTensionActivation = false;
            if (this.animationPhase !== 'expanding') {
                this.expansion.enterExpansionMode();
            }
        }
    }
   
    applyPhysics() {
        // Update rhythm progression first
        this.updateRhythmicProgression();
        
        // Apply Verlet integration to non-pinned nodes
        for (let i = 1; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            
            if (!node.pinned) {
                // Store current position
                const tempX = node.x;
                const tempY = node.y;
                
                // Apply only damping (NO GRAVITY)
                let velocityX = (node.x - node.oldX) * this.damping;
                let velocityY = (node.y - node.oldY) * this.damping;
                
                // Apply layer-based directional forces for the current rhythm position
                if (this.animationPhase === 'settling' && this.nodeForces) {
                    const forceIndex = i - 1; // Convert node index to force index (skip anchor node)
                    
                    // Only apply force if this is the currently active rhythm position
                    if (this.activeForceNodes.has(forceIndex) && this.nodeForces[forceIndex]) {
                        const force = this.nodeForces[forceIndex];
                        const forceMultiplier = 0.8;
                        
                        velocityX += force.x * forceMultiplier;
                        velocityY += force.y * forceMultiplier;
                    }
                }
                
                // Update position
                node.x += velocityX;
                node.y += velocityY;
                
                // Store old position
                node.oldX = tempX;
                node.oldY = tempY;
            }
        }
    }

    constrainSegments() {
        for (const segment of this.segments) {
            const nodeA = this.nodes[segment.nodeA];
            const nodeB = this.nodes[segment.nodeB];
            
            if (!nodeA || !nodeB) continue; // Safety check
            
            const deltaX = nodeB.x - nodeA.x;
            const deltaY = nodeB.y - nodeA.y;
            const currentLength = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            
            if (currentLength === 0) continue; // Avoid division by zero
            
            const difference = segment.restLength - currentLength;
            const percent = difference / currentLength / 2;
            
            const offsetX = deltaX * percent * this.tensionStrength;
            const offsetY = deltaY * percent * this.tensionStrength;
            
            // Apply constraint forces (more aggressively)
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
        const deltaX = nodeB.x - nodeA.x;
        const deltaY = nodeB.y - nodeA.y;
        return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    }

    // ====================================
    // RENDERING
    // ====================================

    draw() {
        if (!this.parent || !this.parent.ctx || this.nodes.length === 0) return;
        
        const ctx = this.parent.ctx;
        const width = parseInt(this.parent.canvas.style.width) || 800;
        const height = parseInt(this.parent.canvas.style.height) || 400;
        
        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        // Update and apply camera transformation
        this.updateCamera(width, height);
        this.applyCameraTransform(ctx);
        
        // Draw segments
        const baseLineWidth = this.calculateLineWidth(); // Calculate based on grid size
        ctx.strokeStyle = this.chainColor;
        ctx.lineWidth = baseLineWidth;
        ctx.lineCap = 'round';

        for (let i = 0; i < this.segments.length; i++) {
            const segment = this.segments[i];
            const nodeA = this.nodes[segment.nodeA];
            const nodeB = this.nodes[segment.nodeB];
            
            if (!nodeA || !nodeB) continue;
            
            // Special highlighting during connection phase
            if (this.animationPhase === 'connecting') {
                // Highlight the segments near the end being pulled
                const isNearEnd = i >= this.segments.length - 5;
                if (isNearEnd) {
                    ctx.strokeStyle = this.highlightColor;
                    ctx.lineWidth = baseLineWidth * 1.5; // 50% thicker for highlights
                } else {
                    ctx.strokeStyle = this.chainColor;
                    ctx.lineWidth = baseLineWidth;
                }
            } else if (i === this.currentHighlight && this.isAnimating) {
                ctx.strokeStyle = this.highlightColor;
                ctx.lineWidth = baseLineWidth * 1.5; // 50% thicker for current highlight
            } else {
                ctx.strokeStyle = this.chainColor;
                ctx.lineWidth = baseLineWidth;
            }
            
            ctx.beginPath();
            ctx.moveTo(nodeA.x, nodeA.y);
            ctx.lineTo(nodeB.x, nodeB.y);
            ctx.stroke();
        }
        
        // Draw arc path visualization during connection
        if (this.animationPhase === 'connecting' && this.arcMidpoint) {
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(this.connectionStart.x, this.connectionStart.y);
            ctx.quadraticCurveTo(
                this.arcMidpoint.x, this.arcMidpoint.y,
                this.connectionTarget.x, this.connectionTarget.y
            );
            ctx.stroke();
            ctx.setLineDash([]);
        }
        
        // Draw nodes
        ctx.fillStyle = this.chainColor;
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            let radius = 2;
            
            // Special highlighting for end node during connection
            if (this.animationPhase === 'connecting' && i === this.nodes.length - 1) {
                ctx.fillStyle = this.highlightColor;
                radius = 6;
            } else if (i === 0) {
                // Anchor node - different appearance based on whether it's pinned
                if (node.pinned) {
                    ctx.fillStyle = '#ffffff'; // White when pinned (during connection)
                    radius = 4;
                } else {
                    ctx.fillStyle = '#ffff88'; // Yellow when free (during settling)
                    radius = 3;
                }
            } else {
                ctx.fillStyle = this.chainColor;
                radius = 2;
            }
            
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Outline for anchor to show its special status
            if (i === 0) {
                ctx.strokeStyle = node.pinned ? '#ffffff' : '#ffff88';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            
            // Special highlight for anchor and active end node
            if ((i === 0 && !node.pinned) || (this.animationPhase === 'connecting' && i === this.nodes.length - 1)) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
        
        // Draw force vectors (only during settling phase)
        if (this.nodeForces && this.showForces && this.animationPhase === 'settling') {
            const forceLineWidth = Math.max(1, baseLineWidth * 0.6); // Thinner than main chain
            ctx.lineWidth = forceLineWidth;
            
            for (let i = 0; i < Math.min(this.nodes.length - 1, this.nodeForces.length); i++) {
                const node = this.nodes[i + 1]; // Skip anchor node
                const force = this.nodeForces[i];
                
                if (force.magnitude > 0.1) { // Only show significant forces
                    const forceScale = 15; // Larger scale for better visibility
                    
                    // Color-code forces by contributing layers
                    let forceColor = 'rgba(255, 255, 255, 0.6)';
                    if (force.layers && force.layers.length === 1) {
                        switch (force.layers[0]) {
                            case 'A': forceColor = 'rgba(255, 107, 107, 0.8)'; break; // Red
                            case 'B': forceColor = 'rgba(78, 205, 196, 0.8)'; break;  // Cyan
                            case 'C': forceColor = 'rgba(69, 183, 209, 0.8)'; break;  // Blue
                            case 'D': forceColor = 'rgba(249, 202, 36, 0.8)'; break;  // Yellow
                        }
                    }
                    
                    ctx.strokeStyle = forceColor;
                    ctx.beginPath();
                    ctx.moveTo(node.x, node.y);
                    ctx.lineTo(
                        node.x + force.x * forceScale,
                        node.y + force.y * forceScale
                    );
                    ctx.stroke();
                    
                    // Draw arrowhead
                    const angle = Math.atan2(force.y, force.x);
                    const arrowLength = 4;
                    ctx.beginPath();
                    ctx.moveTo(
                        node.x + force.x * forceScale,
                        node.y + force.y * forceScale
                    );
                    ctx.lineTo(
                        node.x + force.x * forceScale - arrowLength * Math.cos(angle - 0.3),
                        node.y + force.y * forceScale - arrowLength * Math.sin(angle - 0.3)
                    );
                    ctx.moveTo(
                        node.x + force.x * forceScale,
                        node.y + force.y * forceScale
                    );
                    ctx.lineTo(
                        node.x + force.x * forceScale - arrowLength * Math.cos(angle + 0.3),
                        node.y + force.y * forceScale - arrowLength * Math.sin(angle + 0.3)
                    );
                    ctx.stroke();
                }
            }
        }
        
        // Restore camera transform before drawing UI elements
        this.restoreCameraTransform(ctx);

        // Draw force amplitude slider (in screen space)
        this.drawForceAmplitudeSlider(ctx, width, height);
        
        // Visual indicator when forces become active (drawn in screen space)
        // Removed overlay text to clean up viewport
        
        // Draw phase indicator and camera info (in screen space)
        this.drawPhaseIndicator(ctx, width, height);
    }

    drawForceAmplitudeSlider(ctx, width, height) {
        if (this.useOverlayAmplitude) return; // draw handled by overlay UI
        if (this.tensionModeEnabled || this.animationPhase === 'expanding') {
            this.forceAmplitudeSlider.hovered = false;
            this.forceAmplitudeSlider.dragging = false;
            return;
        }
        // Calculate responsive position - always 10px from top-left corner of visible area
        const sliderX = 12;
        const sliderY = 24;
        const sliderWidth = Math.min(150, width - 20); // Responsive width, never exceed canvas
        const sliderHeight = 20
        
        // Update slider bounds for mouse interaction
        this.forceAmplitudeSlider.x = sliderX;
        this.forceAmplitudeSlider.y = sliderY;
        this.forceAmplitudeSlider.width = sliderWidth;
        this.forceAmplitudeSlider.height = sliderHeight;
        
        const slider = this.forceAmplitudeSlider;
        
        // Slider track background
        ctx.fillStyle = slider.hovered || slider.dragging ? '#555555' : '#333333';
        ctx.fillRect(sliderX, sliderY, sliderWidth, sliderHeight);
        
        // Slider track border
        ctx.strokeStyle = slider.hovered || slider.dragging ? '#ffffff' : '#666666';
        ctx.lineWidth = 1;
        ctx.strokeRect(sliderX, sliderY, sliderWidth, sliderHeight);
        
        // Calculate slider handle position
        const progress = (this.forceAmplitude - slider.min) / (slider.max - slider.min);
        const handleX = sliderX + (progress * sliderWidth);
        const handleWidth = 8;
        
        // Slider handle
        ctx.fillStyle = slider.dragging ? '#00ff88' : (slider.hovered ? '#ffffff' : '#cccccc');
        ctx.fillRect(handleX - handleWidth/2, sliderY - 2, handleWidth, sliderHeight + 4);
        
        // Slider label
        ctx.fillStyle = '#ffffff';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Force Amplitude', sliderX, sliderY - 15);
        
        // Slider value
        ctx.fillStyle = '#00ff88';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${this.forceAmplitude.toFixed(2)}x`, sliderX + sliderWidth, sliderY - 15);
        
        // Min/max labels
        ctx.fillStyle = '#888888';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${slider.min}`, sliderX, sliderY + sliderHeight + 12);
        ctx.textAlign = 'right';
        ctx.fillText(`${slider.max}`, sliderX + sliderWidth, sliderY + sliderHeight + 12);
        
        // Reset text alignment
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
    }

    calculateLineWidth() {
        if (!this.grid || this.grid <= 0) {
            return 2; // Default fallback
        }
        
        // Logarithmic scaling works well for wide range of grid values
        // Base thickness increases with log of grid size
        const baseThickness = Math.log10(this.grid) * 1;
        
        // Apply bounds: minimum 1px, maximum 8px
        const lineWidth = Math.max(1, Math.min(10000, baseThickness));
        return lineWidth;
    }

    drawPhaseIndicator(ctx, width, height) {
        // Camera info only
        ctx.fillStyle = '#888888';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`Camera: ${(this.camera.scale * 100).toFixed(0)}% zoom`, 10, height - 20);
    }

    // ====================================
    // ANIMATION CONTROL
    // ====================================

    startAnimation() {
        if (this.isAnimating) return;
        
        this.isAnimating = true;
        this.startTime = Date.now();
        this.phaseStartTime = this.startTime;
        this.animationPhase = 'hanging';
        this.currentHighlight = -1;
        
        // Setup mouse interaction
        this.setupEventListeners();
        
        // Reset physics parameters (gravity-free system)
        this.gravity = 0;
        this.tensionStrength = 0.3;
        this.damping = 0.995;
        
        // Reset chain to initial hanging position
        this.initializeChain();

        if (this.tensionModeEnabled) {
            this.pendingTensionActivation = true;
        }

        this.animate();
    }

    stopAnimation() {
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // Clean up event listeners
        if (this.parent && this.parent.canvas) {
            this.parent.canvas.removeEventListener('mousemove', this.boundMouseMove);
            this.parent.canvas.removeEventListener('mousedown', this.boundMouseDown);
            this.parent.canvas.removeEventListener('mouseup', this.boundMouseUp);
        }
        
        this.currentHighlight = -1;
        this.animationPhase = 'hanging';
    }

    animate() {
        if (!this.isAnimating) return;
        
        this.updatePhysics();
        this.updateHighlight();
        this.draw(); // Camera update happens inside draw()
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    updateHighlight() {
        // Only highlight during the settling phase when forces are active
        if (!this.isAnimating || this.segments.length === 0 || this.animationPhase !== 'settling') {
            this.currentHighlight = -1; // No highlight during hanging/connecting
            return;
        }
        
        const currentTime = Date.now();
        const cycleTime = currentTime - this.rhythmStartTime; // Use rhythm start time, not animation start time
        const progress = (cycleTime % this.cycleDuration) / this.cycleDuration;
        
        // Highlight segments sequentially in sync with rhythm progression
        const exactPosition = progress * this.segments.length;
        this.currentHighlight = Math.floor(exactPosition);
    }

    setCycleDuration(duration) {
        this.cycleDuration = duration * 1000; // Convert to ms
    }

    // ====================================
    // INTEGRATION METHODS
    // ====================================

    deactivate() {
        this.stopAnimation();
    }
}

// ====================================
// HINGES-SPECIFIC UI CONTROLS
// ====================================

function addHingesControls() {
    // Create Hinges control container
    const hingesControls = document.createElement('div');
    hingesControls.id = 'hinges-controls';
    hingesControls.className = 'hinges-controls';
    hingesControls.style.display = 'none'; // Hidden by default
    hingesControls.innerHTML = `
        <button id="hinges-animate-btn" class="hinges-animate-btn">🔗 Animate Chain</button>
        <div class="hinges-info">
            <span id="hinges-status">Ready</span>
        </div>
        <label class="hinges-debug">
            <input type="checkbox" id="hinges-show-forces"> Show Forces
        </label>
        <style>
            .hinges-controls {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-left: 12px;
                padding: 8px 12px;
                background: rgba(0, 255, 136, 0.1);
                border: 1px solid rgba(0, 255, 136, 0.3);
                border-radius: 4px;
            }
            
            .hinges-animate-btn {
                background: var(--hud-accent);
                border: none;
                color: #000;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-weight: bold;
                transition: all 0.2s;
                white-space: nowrap;
            }
            
            .hinges-animate-btn:hover {
                background: #00dd77;
                transform: translateY(-1px);
            }
            
            .hinges-animate-btn.animating {
                background: #ff4444;
                animation: pulse 1.5s infinite;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
            
            .hinges-info {
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            
            #hinges-status {
                font-size: 10px;
                color: var(--hud-accent);
                font-family: monospace;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .hinges-debug {
                font-size: 10px;
                color: var(--hud-text-muted);
                display: flex;
                align-items: center;
                gap: 4px;
                cursor: pointer;
            }
            
            .hinges-debug input[type="checkbox"] {
                margin: 0;
            }
        </style>
    `;
    
    // Find visualization controls container and add Hinges controls
    const vizControls = document.querySelector('.viz-controls');
    if (vizControls) {
        vizControls.appendChild(hingesControls);
        
        // Add event listener for animate button
        const animateBtn = document.getElementById('hinges-animate-btn');
        const statusSpan = document.getElementById('hinges-status');
        const showForcesCheck = document.getElementById('hinges-show-forces');
        
        if (animateBtn && statusSpan) {
            animateBtn.addEventListener('click', () => {
                const hingesViz = window.lrcVisuals?.plotTypes?.['hinges'];
                if (hingesViz) {
                    if (hingesViz.isAnimating) {
                        hingesViz.stopAnimation();
                        animateBtn.textContent = '🔗 Animate Chain';
                        animateBtn.classList.remove('animating');
                        statusSpan.textContent = 'Ready';
                    } else {
                        hingesViz.startAnimation();
                        animateBtn.textContent = '⏹ Stop Animation';
                        animateBtn.classList.add('animating');
                        statusSpan.textContent = 'Animating...';
                        
                        // Monitor animation phases
                        monitorHingesAnimation(hingesViz, statusSpan);
                    }
                }
            });
        }
        
        if (showForcesCheck) {
            showForcesCheck.addEventListener('change', (e) => {
                const hingesViz = window.lrcVisuals?.plotTypes?.['hinges'];
                if (hingesViz) {
                    hingesViz.showForces = e.target.checked;
                }
            });
        }
    } else {
        console.warn('🔗 Visualization controls container not found');
    }
}

function monitorHingesAnimation(hingesViz, statusSpan) {
    const updateStatus = () => {
        if (!hingesViz.isAnimating) {
            statusSpan.textContent = 'Ready';
            return;
        }
        
        let phase = 'Unknown';
        switch (hingesViz.animationPhase) {
            case 'hanging':
                phase = 'Hanging Chain...';
                break;
            case 'connecting':
                phase = 'Connecting Loop...';
                break;
            case 'settling':
                phase = 'Layer Forces Active...';
                break;
        }
        statusSpan.textContent = phase;
        
        if (hingesViz.isAnimating) {
            setTimeout(updateStatus, 100);
        }
    };
    
    updateStatus();
}

function getPrimaryHingesSection() {
    const mainPanel = document.getElementById('visualizations-div');
    if (mainPanel) {
        const section = mainPanel.querySelector('#hinges-controls-section');
        if (section) {
            return section;
        }
    }
    return document.getElementById('hinges-controls-section');
}

function showHingesControls() {
    const hingesControls = getPrimaryHingesSection();
    if (hingesControls) {
        hingesControls.style.display = 'block';
    }
}

function hideHingesControls() {
    const hingesControls = getPrimaryHingesSection();
    if (hingesControls) {
        hingesControls.style.display = 'none';
    }
    
    resetHingesControlsUI();
}

function resetHingesControlsUI() {
    document.querySelectorAll('#hinges-animate-btn').forEach((animateBtn) => {
        animateBtn.textContent = '🔗 Animate Chain';
        animateBtn.classList.remove('animating');
    });
    
    document.querySelectorAll('#hinges-status').forEach((statusSpan) => {
        statusSpan.textContent = 'Ready';
    });
    
    document.querySelectorAll('#hinges-show-forces').forEach((checkbox) => {
        checkbox.checked = false;
    });
    
    document.querySelectorAll('#hinges-mode').forEach((modeSelect) => {
        modeSelect.value = 'progression';
    });
    
    document.querySelectorAll('#hinges-tension-btn').forEach((tensionBtn) => {
        tensionBtn.classList.remove('active');
        tensionBtn.textContent = '⚡ Tension';
    });
}

if (typeof window !== 'undefined') {
    window.resetHingesControlsUI = resetHingesControlsUI;
}

// ====================================
// INTEGRATION WITH LRC SYSTEM
// ====================================

function integrateHingesVisualization() {
    if (!window.lrcVisuals) {
        console.error('🔗 LRCVisuals not found for Hinges integration');
        return;
    }

    // Create hinges instance
    const hinges = new LRCHinges(window.lrcVisuals);
    
    // Add to LRCVisuals plot types
    if (!window.lrcVisuals.plotTypes) {
        window.lrcVisuals.plotTypes = {};
    }
    window.lrcVisuals.plotTypes['hinges'] = hinges;
    
    // Add to dropdown if it exists
    const plotSelect = document.getElementById('plot-type');
    if (plotSelect) {
        const option = document.createElement('option');
        option.value = 'hinges';
        option.textContent = 'Hinges';
        plotSelect.appendChild(option);
    }
    
    // Add Hinges-specific controls (disabled - now using section-based controls)
    // addHingesControls();
    
    // Extend the main visualization draw method
    const originalDrawPlot = window.lrcVisuals.drawPlot.bind(window.lrcVisuals);
    let hingesWasActive = false;
    window.lrcVisuals.drawPlot = function() {
        if (this.currentPlotType === 'hinges') {
            const hingesViz = this.plotTypes['hinges'];
            if (hingesViz) {
                // Get the current data from LRCModule
                const currentData = window.lrcModule?.getCurrentData();
                
                const spacesLayerMap = currentData?.spacesLayerMap || [];
                const grid = currentData?.grid || window.lrcModule?.currentGrid || 1;
                hingesViz.updateData(
                    this.spacesPlot, 
                    this.rhythms, 
                    grid,
                    this.ratios,
                    spacesLayerMap
                );
                hingesViz.activate();
                showHingesControls();
                hingesWasActive = true;
            }
        } else {
            // Only deactivate hinges if it was previously active
            if (this.plotTypes['hinges'] && hingesWasActive) {
                this.plotTypes['hinges'].deactivate();
                hingesWasActive = false;
            }
            hideHingesControls();
            originalDrawPlot();
        }
    };

    // Extend animation control
    const originalStartAnimation = window.lrcVisuals.startAnimation.bind(window.lrcVisuals);
    window.lrcVisuals.startAnimation = function() {
        if (this.currentPlotType === 'hinges') {
            const hingesViz = this.plotTypes['hinges'];
            if (hingesViz) {
                hingesViz.startAnimation();
            }
        } else {
            originalStartAnimation();
        }
    };

    const originalStopAnimation = window.lrcVisuals.stopAnimation.bind(window.lrcVisuals);
    window.lrcVisuals.stopAnimation = function() {
        if (this.currentPlotType === 'hinges') {
            const hingesViz = this.plotTypes['hinges'];
            if (hingesViz) {
                hingesViz.stopAnimation();
            }
        } else {
            originalStopAnimation();
        }
    };

    // Extend cycle duration setting
    const originalSetCycleDuration = window.lrcVisuals.setCycleDuration.bind(window.lrcVisuals);
    window.lrcVisuals.setCycleDuration = function(duration) {
        originalSetCycleDuration(duration);
        
        if (this.plotTypes['hinges']) {
            this.plotTypes['hinges'].setCycleDuration(duration);
        }
    };
    
}

// Auto-integration when DOM and LRCVisuals are ready
if (typeof window !== 'undefined') {
    window.LRCHinges = LRCHinges;
    
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (window.lrcVisuals) {
                integrateHingesVisualization();
            } else {
                const checkInterval = setInterval(() => {
                    if (window.lrcVisuals) {
                        clearInterval(checkInterval);
                        integrateHingesVisualization();
                    }
                }, 100);
                
                setTimeout(() => {
                    clearInterval(checkInterval);
                    console.warn('🔗 LRCVisuals not found after 5 seconds');
                }, 5000);
            }
        }, 100);
    });
}
