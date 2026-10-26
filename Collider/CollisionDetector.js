// ====================================
// COLLISION DETECTION SYSTEM
// ====================================

class CollisionDetector {
    constructor() {
        this.baseCollisionTolerance = 2; // Base geometric tolerance (independent of visual thickness)
        this.currentVisualThickness = 3; // Visual thickness for rendering (doesn't affect collision)
        this.debugCollisionTolerance = false; // Enable debug logging for collision tolerance
        this.arena = null; // Set by BattleController; wrap mode needs toroidal distances
    }

    // In a wrapping arena, shift a point by whichever multiple of the arena size
    // brings it closest to a reference point, so contacts across an edge register.
    nearestImage(px, py, refX, refY) {
        if (!this.arena || this.arena.boundaryMode !== 'wrap') return { x: px, y: py };
        const W = this.arena.width;
        const H = this.arena.height;
        return {
            x: px - Math.round((px - refX) / W) * W,
            y: py - Math.round((py - refY) / H) * H
        };
    }

    // Unit vector from (fromX, fromY) to (toX, toY); falls back to +x when coincident.
    unitVector(fromX, fromY, toX, toY) {
        const dx = toX - fromX;
        const dy = toY - fromY;
        const length = Math.sqrt(dx * dx + dy * dy);
        return length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
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
                
                const midX = (segment.nodeA.x + segment.nodeB.x) / 2;
                const midY = (segment.nodeA.y + segment.nodeB.y) / 2;
                const point = this.nearestImage(node.x, node.y, midX, midY);

                const distance = this.distanceToLineSegment(
                    point.x, point.y,
                    segment.nodeA.x, segment.nodeA.y,
                    segment.nodeB.x, segment.nodeB.y
                );

                if (distance <= totalCollisionDistance) {
                    // Final invulnerability check before registering collision
                    if (defenderPlayer.isInvulnerable) {
                        return collisions;
                    }

                    // Rebound normal: from the struck segment's midpoint toward the
                    // attacking node, so the bodies always push apart (GRIDLOCK model)
                    const normal = this.unitVector(midX, midY, point.x, point.y);

                    collisions.push({
                        type: 'node-segment',
                        attacker: attackerPlayer.playerId,
                        defender: defenderPlayer.playerId,
                        attackingNode: node,
                        defendingSegment: segment,
                        normal: normal,
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
                const pointA = this.nearestImage(nodeA.x, nodeA.y, nodeB.x, nodeB.y);
                const distance = Math.sqrt(
                    Math.pow(pointA.x - nodeB.x, 2) +
                    Math.pow(pointA.y - nodeB.y, 2)
                );

                // Calculate geometric collision radii for both nodes
                const radiusA = this.getNodeCollisionRadius(playerA, nodeA.index);
                const radiusB = this.getNodeCollisionRadius(playerB, nodeB.index);
                const totalCollisionDistance = radiusA + radiusB;

                if (distance <= totalCollisionDistance) {
                    // Rebound normal: from node B toward node A (A moves +normal, B moves -normal)
                    const normal = this.unitVector(nodeB.x, nodeB.y, pointA.x, pointA.y);

                    collisions.push({
                        type: 'node-node',
                        playerA: playerA.playerId,
                        playerB: playerB.playerId,
                        nodeA: nodeA,
                        nodeB: nodeB,
                        normal: normal,
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