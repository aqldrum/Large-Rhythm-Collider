// HingeExpand.js - Expansion Mode for Hinges Visualization
class HingeExpand {
    constructor(hingesInstance) {
        this.hinges = hingesInstance;
        this.expansionStrength = 0.8;
        this.originalPhase = null;
        this.expansionForces = [];
    }

    enterExpansionMode() {
        if (!this.hinges.isAnimating) {
            console.warn("⚠️ Expansion mode requires animation to be running");
            return;
        }
        
        // Save original state
        this.originalPhase = this.hinges.animationPhase;
        this.hinges.animationPhase = 'expanding';
        
        // Clear any existing forces
        this.hinges.activeForceNodes.clear();
        
        // Optimize physics for expansion
        this.hinges.tensionStrength = 0.95;
        this.hinges.damping = 0.97;
    }

    exitExpansionMode() {
        if (!this.originalPhase) return;
        
        this.hinges.animationPhase = this.originalPhase;
        this.originalPhase = null;
        this.expansionForces = [];
        
        // Restore physics settings
        this.hinges.tensionStrength = 0.3;
        this.hinges.damping = 0.995;
    }

    calculateExpansionForces() {
        this.expansionForces = [];
        
        // Calculate forces for each node (except the first and last)
        for (let i = 1; i < this.hinges.nodes.length - 1; i++) {
            const prevNode = this.hinges.nodes[i - 1];
            const node = this.hinges.nodes[i];
            const nextNode = this.hinges.nodes[i + 1];
            
            // Vector from current node to previous node
            const vecToPrev = {
                x: prevNode.x - node.x,
                y: prevNode.y - node.y
            };
            
            // Vector from current node to next node
            const vecToNext = {
                x: nextNode.x - node.x,
                y: nextNode.y - node.y
            };
            
            // Calculate desired position for maximum angle (180°)
            // This is the point that would make the two segments colinear
            const desiredPosition = {
                x: node.x - (vecToNext.x + vecToPrev.x) * 0.5,
                y: node.y - (vecToNext.y + vecToPrev.y) * 0.5
            };
            
            // Force direction is toward the desired position
            const force = {
                x: (desiredPosition.x - node.x) * this.expansionStrength,
                y: (desiredPosition.y - node.y) * this.expansionStrength,
                magnitude: 0
            };
            
            // Calculate magnitude
            force.magnitude = Math.sqrt(force.x * force.x + force.y * force.y);
            this.expansionForces.push(force);
        }
    }

    applyExpansionPhysics() {
        this.calculateExpansionForces();
        
        for (let i = 1; i < this.hinges.nodes.length - 1; i++) {
            const node = this.hinges.nodes[i];
            const force = this.expansionForces[i - 1]; // Forces start at index 0
            
            if (!node.pinned) {
                // Apply Verlet integration
                const tempX = node.x;
                const tempY = node.y;
                
                // Apply force
                let velocityX = (node.x - node.oldX) * this.hinges.damping;
                let velocityY = (node.y - node.oldY) * this.hinges.damping;
                
                velocityX += force.x;
                velocityY += force.y;
                
                node.x += velocityX;
                node.y += velocityY;
                
                node.oldX = tempX;
                node.oldY = tempY;
            }
        }
        
        // Maintain constraints
        for (let i = 0; i < 15; i++) {
            this.hinges.constrainSegments();
        }
    }

    drawExpansionForces(ctx) {
        if (!this.expansionForces.length) return;
        
        ctx.strokeStyle = 'rgba(255, 100, 255, 0.7)';
        ctx.lineWidth = 1;
        
        for (let i = 1; i < this.hinges.nodes.length - 1; i++) {
            const node = this.hinges.nodes[i];
            const force = this.expansionForces[i - 1];
            const forceScale = 20;
            
            if (force.magnitude > 0.1) {
                ctx.beginPath();
                ctx.moveTo(node.x, node.y);
                ctx.lineTo(
                    node.x + force.x * forceScale,
                    node.y + force.y * forceScale
                );
                ctx.stroke();
            }
        }
    }
}

// Integration with existing Hinges system
function integrateExpansionMode() {
    // Create expansion instance
    const hingesViz = window.lrcVisuals?.plotTypes?.['hinges'];
    if (!hingesViz) {
        console.error("Hinges visualization not found for expansion integration");
        return;
    }
    
    const hingeExpand = new HingeExpand(hingesViz);
    
    // Add to Hinges instance
    hingesViz.expansion = hingeExpand;
    
    // Extend physics update
    const originalUpdatePhysics = hingesViz.updatePhysics.bind(hingesViz);
    hingesViz.updatePhysics = function() {
        if (this.animationPhase === 'expanding') {
            this.expansion.applyExpansionPhysics();
        } else {
            originalUpdatePhysics();
        }
    };
    
    // Extend drawing
    const originalDraw = hingesViz.draw.bind(hingesViz);
    hingesViz.draw = function() {
        originalDraw();
        
        if (this.animationPhase === 'expanding' && this.expansion) {
            const ctx = this.parent.ctx;
            this.applyCameraTransform(ctx);
        //  this.expansion.drawExpansionForces(ctx);
            this.restoreCameraTransform(ctx);
        }
    };
    
    // Add expansion control button
    addExpansionControl();
}

function addExpansionControl() {
    const hingesControls = document.getElementById('hinges-controls');
    if (!hingesControls) return;
    
    // Create expansion button
    const expandBtn = document.createElement('button');
    expandBtn.id = 'hinges-expand-btn';
    expandBtn.className = 'hinges-expand-btn';
    expandBtn.textContent = '⚡ Expand';
    expandBtn.title = 'Toggle Expansion Mode';
    
    // Style the button
    expandBtn.style.marginLeft = '10px';
    expandBtn.style.background = 'linear-gradient(to right, #8a2be2, #4b0082)';
    expandBtn.style.color = 'white';
    expandBtn.style.border = 'none';
    expandBtn.style.borderRadius = '4px';
    expandBtn.style.padding = '6px 12px';
    expandBtn.style.cursor = 'pointer';
    expandBtn.style.fontWeight = 'bold';
    
    // Add to controls
    hingesControls.appendChild(expandBtn);
    
    // Add event listener
    expandBtn.addEventListener('click', () => {
        const hingesViz = window.lrcVisuals?.plotTypes?.['hinges'];
        if (!hingesViz) return;
        
        if (hingesViz.animationPhase === 'expanding') {
            hingesViz.expansion.exitExpansionMode();
            expandBtn.textContent = '⚡ Expand';
            expandBtn.style.background = 'linear-gradient(to right, #8a2be2, #4b0082)';
        } else {
            hingesViz.expansion.enterExpansionMode();
            expandBtn.textContent = '↩️ Contract';
            expandBtn.style.background = 'linear-gradient(to right, #ff00ff, #8a2be2)';
        }
    });
}

// Auto-integration
if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (window.lrcVisuals) {
                integrateExpansionMode();
            } else {
                const checkInterval = setInterval(() => {
                    if (window.lrcVisuals) {
                        clearInterval(checkInterval);
                        integrateExpansionMode();
                    }
                }, 100);
            }
        }, 1000);
    });
}
