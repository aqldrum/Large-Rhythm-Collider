// ====================================
// COLLISION DETECTION SYSTEM
// ====================================

class CollisionDetector {
    constructor() {
        this.baseCollisionTolerance = 2; // Base geometric tolerance (independent of visual thickness)
        this.reboundForceMultiplier = 80; // Multiplier for rebound force (tweakable for battle optimization)
        this.currentVisualThickness = 3; // Visual thickness for rendering (doesn't affect collision)
        this.debugCollisionTolerance = false; // Enable debug logging for collision tolerance
    }
    
    setDebugMode(enabled) {
        this.debugCollisionTolerance = enabled;
        if (enabled) {
            console.log('🎯 Collision detection debug mode ENABLED - tolerance calculations will be logged');
        } else {
            console.log('🎯 Collision detection debug mode DISABLED');
        }
    }
    
    updateVisualThickness(thickness) {
        if (this.currentVisualThickness !== thickness) {
            if (this.debugCollisionTolerance) {
                console.log(`🎯 Visual thickness updated: ${thickness}px (collision detection uses geometric tolerance)`);
            }
            this.currentVisualThickness = thickness;
        }
    }
    
    // Legacy method for backward compatibility - now uses geometric calculation
    getCollisionTolerance() {
        // For backward compatibility when no player is provided
        return this.baseCollisionTolerance + 1.5; // Conservative default
    }
    
    getGeometricCollisionTolerance(player) {
        // Calculate collision tolerance based on the actual geometry of the player's rhythm
        if (!player || !player.segments || player.segments.length === 0) {
            return this.baseCollisionTolerance + 1.5; // Safe fallback
        }
        
        // Find the smallest segment length to use as geometric reference
        const segmentLengths = player.segments
            .filter(segment => segment.restLength > 0)
            .map(segment => segment.restLength);
            
        if (segmentLengths.length === 0) {
            return this.baseCollisionTolerance + 1.5; // Safe fallback
        }
        
        const minSegmentLength = Math.min(...segmentLengths);
        const averageSegmentLength = segmentLengths.reduce((sum, len) => sum + len, 0) / segmentLengths.length;
        
        // Base geometric tolerance: 25% of the smallest segment length
        // This ensures collision detection scales with the actual rhythm geometry
        const geometricTolerance = Math.min(minSegmentLength * 0.25, averageSegmentLength * 0.15);
        
        // Visual thickness multiplier (clamped to reasonable range)
        // At visual thickness = 3px (default), multiplier = 1.0 (no change)
        // This allows some scaling with visual thickness but prevents extreme values
        const thicknessMultiplier = Math.max(0.5, Math.min(2.0, this.currentVisualThickness / 3.0));
        
        const finalTolerance = geometricTolerance * thicknessMultiplier + this.baseCollisionTolerance;
        
        if (this.debugCollisionTolerance) {
            console.log(`🎯 Player ${player.playerId} collision tolerance: ${finalTolerance.toFixed(2)}px (geometric: ${geometricTolerance.toFixed(2)}px, multiplier: ${thicknessMultiplier.toFixed(2)}x, visual: ${this.currentVisualThickness}px)`);
        }
        
        return finalTolerance;
    }
    
    getNodeCollisionRadius(player, nodeIndex = -1) {
        // Calculate node collision radius based on connected segments
        if (!player || !player.segments || player.segments.length === 0) {
            return 3; // Safe fallback
        }
        
        // Find segments connected to this node
        const connectedSegments = player.segments.filter(segment => 
            segment.nodeA === nodeIndex || segment.nodeB === nodeIndex
        );
        
        if (connectedSegments.length === 0) {
            return 3; // Safe fallback
        }
        
        // Base radius on the average length of connected segments
        const avgConnectedLength = connectedSegments
            .reduce((sum, segment) => sum + segment.restLength, 0) / connectedSegments.length;
        
        // Node collision radius: 20% of average connected segment length
        const geometricRadius = avgConnectedLength * 0.2;
        
        // Minimum and maximum bounds for node collision radius
        const minRadius = 2;
        const maxRadius = 15;
        
        return Math.max(minRadius, Math.min(maxRadius, geometricRadius));
    }

    checkAllCollisions(players) {
        const collisions = [];

        // FAIRNESS: Create randomized player pair order to prevent systematic bias
        const playerPairs = [];
        for (let i = 0; i < players.length; i++) {
            for (let j = i + 1; j < players.length; j++) {
                playerPairs.push([i, j]);
            }
        }
        
        // Shuffle the pairs to randomize collision detection order
        for (let i = playerPairs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [playerPairs[i], playerPairs[j]] = [playerPairs[j], playerPairs[i]];
        }

        for (const [i, j] of playerPairs) {
            const playerA = players[i];
            const playerB = players[j];
            
            if (!playerA.isAlive || !playerB.isAlive) continue;
            if (playerA.animationPhase !== 'settling' || playerB.animationPhase !== 'settling') continue;
            
            // Check node-segment collisions (both directions)
            const collisionsAB = this.checkNodeSegmentCollisions(playerA, playerB);
            const collisionsBA = this.checkNodeSegmentCollisions(playerB, playerA);
            
            // Check node-node collisions
            const nodeCollisions = this.checkNodeNodeCollisions(playerA, playerB);
            
            collisions.push(...collisionsAB, ...collisionsBA, ...nodeCollisions);
        }
        
        return collisions;
    }

    checkNodeSegmentCollisions(attackerPlayer, defenderPlayer) {
        const collisions = [];
        
        // CRITICAL: Multiple checks for invulnerability
        if (defenderPlayer.isInvulnerable) {
            return collisions;
        }
        
        const attackerNodes = attackerPlayer.getNodePositions();
        const defenderSegments = defenderPlayer.getSegments();
        
        // Calculate geometric collision tolerance for the defender
        const collisionTolerance = this.getGeometricCollisionTolerance(defenderPlayer);
        
        for (const node of attackerNodes) {
            // Check invulnerability again at node level (in case it changed mid-frame)
            if (defenderPlayer.isInvulnerable) {
                break;
            }
            
            // Calculate node collision radius for the attacker
            const nodeCollisionRadius = this.getNodeCollisionRadius(attackerPlayer, node.index);
            const totalCollisionDistance = collisionTolerance + nodeCollisionRadius;
            
            for (const segment of defenderSegments) {
                // SAFETY CHECK: Ensure segment has valid nodes and coordinates
                if (!segment.nodeA || !segment.nodeB ||
                    typeof segment.nodeA.x !== 'number' || typeof segment.nodeA.y !== 'number' ||
                    typeof segment.nodeB.x !== 'number' || typeof segment.nodeB.y !== 'number') {
                    continue;
                }
                
                const distance = this.distanceToLineSegment(
                    node.x, node.y,
                    segment.nodeA.x, segment.nodeA.y,
                    segment.nodeB.x, segment.nodeB.y
                );
                
                if (distance <= totalCollisionDistance) {
                    // Final invulnerability check before registering collision
                    if (defenderPlayer.isInvulnerable) {
                        return collisions;
                    }
                    
                    // Get the attacking force for this node
                    const forceIndex = node.index - 1; // Skip anchor node
                    let attackingForce = { x: 0, y: 0 };
                    
                    if (forceIndex >= 0 && forceIndex < attackerPlayer.nodeForces.length) {
                        const force = attackerPlayer.nodeForces[forceIndex];
                        attackingForce = { 
                            x: force.x * this.reboundForceMultiplier, 
                            y: force.y * this.reboundForceMultiplier 
                        };
                        // Layer force applied for collision
                    }
                    
                    collisions.push({
                        type: 'node-segment',
                        attacker: attackerPlayer.playerId,
                        defender: defenderPlayer.playerId,
                        attackingNode: node,
                        defendingSegment: segment,
                        attackingForce: attackingForce,
                        collisionDistance: distance,
                        collisionTolerance: totalCollisionDistance
                    });
                    
                    // IMPORTANT: Return immediately after first collision to prevent multiple hits
                    return collisions;
                }
            }
        }
        
        return collisions;
    }

    checkNodeNodeCollisions(playerA, playerB) {
        const collisions = [];
        
        // Skip if either player is invulnerable
        if (playerA.isInvulnerable || playerB.isInvulnerable) return collisions;
        
        const nodesA = playerA.getNodePositions();
        const nodesB = playerB.getNodePositions();
        
        for (const nodeA of nodesA) {
            for (const nodeB of nodesB) {
                const distance = Math.sqrt(
                    Math.pow(nodeA.x - nodeB.x, 2) + 
                    Math.pow(nodeA.y - nodeB.y, 2)
                );
                
                // Calculate geometric collision radii for both nodes
                const radiusA = this.getNodeCollisionRadius(playerA, nodeA.index);
                const radiusB = this.getNodeCollisionRadius(playerB, nodeB.index);
                const totalCollisionDistance = radiusA + radiusB;
                
                if (distance <= totalCollisionDistance) {
                    // Get layer forces for both colliding nodes
                    const forceIndexA = nodeA.index - 1; // Skip anchor node
                    const forceIndexB = nodeB.index - 1; // Skip anchor node
                    
                    let forceA = { x: 0, y: 0 };
                    let forceB = { x: 0, y: 0 };
                    
                    // Use the actual layer forces from each player's node
                    if (forceIndexA >= 0 && forceIndexA < playerA.nodeForces.length) {
                        const force = playerA.nodeForces[forceIndexA];
                        forceA = { 
                            x: force.x * this.reboundForceMultiplier, 
                            y: force.y * this.reboundForceMultiplier 
                        };
                    }
                    
                    if (forceIndexB >= 0 && forceIndexB < playerB.nodeForces.length) {
                        const force = playerB.nodeForces[forceIndexB];
                        forceB = { 
                            x: force.x * this.reboundForceMultiplier, 
                            y: force.y * this.reboundForceMultiplier 
                        };
                    }
                    
                    collisions.push({
                        type: 'node-node',
                        playerA: playerA.playerId,
                        playerB: playerB.playerId,
                        nodeA: nodeA,
                        nodeB: nodeB,
                        forceA: forceA,
                        forceB: forceB,
                        collisionDistance: distance,
                        collisionTolerance: totalCollisionDistance
                    });
                    
                    // Return immediately after first node-node collision
                    return collisions;
                }
            }
        }
        
        return collisions;
    }

    distanceToLineSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSquared = dx * dx + dy * dy;
        
        if (lengthSquared === 0) {
            // Line segment is a point
            return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
        }
        
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
        const projectionX = x1 + t * dx;
        const projectionY = y1 + t * dy;
        
        return Math.sqrt((px - projectionX) * (px - projectionX) + (py - projectionY) * (py - projectionY));
    }
}