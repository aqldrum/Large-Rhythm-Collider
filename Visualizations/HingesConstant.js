// HingesConstant.js - Constant Force Mode for Hinges Visualization
// Applies all vector forces simultaneously and continuously
class HingesConstant {
    constructor(hingesInstance) {
        this.hinges = hingesInstance;
        this.isActive = false;
        this.lastTriggerTime = 0;
        this.originalPhase = null;
    }

    enterConstantMode() {
        if (!this.hinges.isAnimating) {
            console.warn("⚠️ Constant mode requires animation to be running");
            return;
        }

        this.isActive = true;
        this.lastTriggerTime = Date.now();

        // Unlike Tension mode, we don't change the animation phase
        // This allows controls to remain accessible

        // Activate all force nodes immediately
        this.activateAllForces();

        console.log('🌊 Constant mode activated - all forces engaged');
    }

    exitConstantMode() {
        this.isActive = false;
        this.lastTriggerTime = 0;

        // Clear all active forces
        this.hinges.activeForceNodes.clear();

        // Resume normal rhythm timing
        this.hinges.rhythmStartTime = Date.now();

        console.log('🛑 Constant mode deactivated');
    }

    activateAllForces() {
        // Activate all nodes to apply their forces simultaneously
        this.hinges.activeForceNodes.clear();

        if (this.hinges.nodeForces && this.hinges.nodeForces.length > 0) {
            for (let i = 0; i < this.hinges.nodeForces.length; i++) {
                this.hinges.activeForceNodes.add(i);
            }
        }
    }

    updateConstantMode() {
        if (!this.isActive) return;

        // Check if we should retrigger based on cycle duration
        const currentTime = Date.now();
        const elapsed = currentTime - this.lastTriggerTime;

        // Retrigger all forces at intervals defined by the cycle duration
        if (elapsed >= this.hinges.cycleDuration) {
            this.lastTriggerTime = currentTime;
            this.activateAllForces();
        }

        // Keep all forces active continuously
        // This is different from normal progression where only one node is active at a time
        if (this.hinges.activeForceNodes.size === 0) {
            this.activateAllForces();
        }
    }

    applyConstantPhysics() {
        // Update the constant mode timing
        this.updateConstantMode();

        // The actual force application happens in the main Hinges applyPhysics method
        // We just need to make sure all forces stay active

        // Apply Verlet integration to non-pinned nodes with all forces
        for (let i = 1; i < this.hinges.nodes.length; i++) {
            const node = this.hinges.nodes[i];

            if (!node.pinned) {
                // Store current position
                const tempX = node.x;
                const tempY = node.y;

                // Apply damping
                let velocityX = (node.x - node.oldX) * this.hinges.damping;
                let velocityY = (node.y - node.oldY) * this.hinges.damping;

                // Apply all layer-based directional forces continuously
                if (this.hinges.nodeForces) {
                    const forceIndex = i - 1; // Convert node index to force index (skip anchor node)

                    // Apply force if this node has an active force
                    if (this.hinges.activeForceNodes.has(forceIndex) && this.hinges.nodeForces[forceIndex]) {
                        const force = this.hinges.nodeForces[forceIndex];
                        const forceMultiplier = 0.8; // Same as regular progression

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

        // Apply constraints
        const iterations = 15;
        for (let i = 0; i < iterations; i++) {
            this.hinges.constrainSegments();
        }
    }

    shouldOverridePhysics() {
        // Constant mode should override normal physics, but NOT if Anchors Expand is active
        if (!this.isActive) return false;

        // Check if Anchors Expand is active
        const advanced = this.hinges.advanced;
        if (advanced && advanced.shouldRunAnchorsExpansion && advanced.shouldRunAnchorsExpansion()) {
            return false; // Let Anchors Expand take priority
        }

        return true;
    }
}

// Integration with existing Hinges system
function integrateConstantMode() {
    const hingesViz = window.lrcVisuals?.plotTypes?.['hinges'];
    if (!hingesViz) {
        console.error("Hinges visualization not found for Constant mode integration");
        return;
    }

    const hingesConstant = new HingesConstant(hingesViz);

    // Add to Hinges instance
    hingesViz.constant = hingesConstant;

    // Extend physics update to handle Constant mode
    const originalUpdatePhysics = hingesViz.updatePhysics.bind(hingesViz);
    hingesViz.updatePhysics = function() {
        // Check if Constant mode should override
        if (this.constant && this.constant.shouldOverridePhysics()) {
            this.constant.applyConstantPhysics();
            return;
        }

        // Otherwise use original physics
        originalUpdatePhysics();
    };

    // Extend rhythmic progression to respect Constant mode
    const originalUpdateRhythmic = hingesViz.updateRhythmicProgression.bind(hingesViz);
    hingesViz.updateRhythmicProgression = function() {
        // Skip normal progression if Constant mode is active
        if (this.constant && this.constant.isActive) {
            return;
        }

        originalUpdateRhythmic();
    };

    console.log('🌊 Constant mode integrated');
}

// Auto-integration
if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            // Wait for Hinges to be available
            const checkInterval = setInterval(() => {
                if (window.lrcVisuals?.plotTypes?.['hinges']) {
                    clearInterval(checkInterval);
                    integrateConstantMode();
                }
            }, 100);

            // Timeout after 10 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
            }, 10000);
        }, 1500); // Wait a bit longer than other integrations
    });
}
