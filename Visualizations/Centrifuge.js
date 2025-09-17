// Centrifuge.js - Large Rhythm Collider Centrifuge Visualization
// Creates rotating disc visualization with ratio ring and arc sector lighting

class LRCCentrifuge {
    constructor(lrcVisuals) {
        this.parent = lrcVisuals;
        this.canvas = null;
        this.ctx = null;
        
        // Animation state
        this.isAnimating = false;
        this.animationId = null;
        this.startTime = 0;
        this.cycleDuration = 10000; // ms
        
        // Data
        this.spacesPlot = [];
        this.rhythms = [1, 1, 1, 1];
        this.grid = 1;
        this.ratios = [];
        this.uniqueRatios = [];
        
        // Visual elements
        this.centerX = 0;
        this.centerY = 0;
        this.maxRadius = 0;
        this.layerDiscs = [];
        this.ratioRing = [];
        this.currentLitRatio = -1;
        this.currentLitArcs = new Set();
        this.previousAngles = []; // Track previous angles for crossing detection
        
        // Colors
        this.layerColors = {
            'A': '#ff6b6b',
            'B': '#4ecdc4',
            'C': '#00a638ff',
            'D': '#f9ca24'
        };
        
        console.log('🌀 Centrifuge visualization initialized');
    }

    // ====================================
    // SETUP AND DRAWING
    // ====================================

    decimalToFraction(decimal) {
        // Simple fraction conversion with limited precision
        const tolerance = 1e-6;
        let numerator = 1;
        let denominator = 1;
        let bestError = Math.abs(decimal - 1);
        let bestNum = 1;
        let bestDen = 1;
        
        // Try denominators up to 64 (common in musical ratios)
        for (let den = 1; den <= 64; den++) {
            const num = Math.round(decimal * den);
            const error = Math.abs(decimal - num / den);
            
            if (error < bestError && error < tolerance) {
                bestError = error;
                bestNum = num;
                bestDen = den;
            }
        }
        
        // Reduce fraction
        const gcd = this.calculateGCD(bestNum, bestDen);
        bestNum /= gcd;
        bestDen /= gcd;
        
        return `${bestNum}/${bestDen}`;
    }

    calculateGCD(a, b) {
        while (b !== 0) {
            const temp = b;
            b = a % b;
            a = temp;
        }
        return a;
    }

    updateData(spacesPlot, rhythms, grid, ratios) {
        this.spacesPlot = spacesPlot || [];
        this.rhythms = rhythms || [1, 1, 1, 1];
        this.grid = grid || 1;
        this.ratios = ratios || [];
        
        console.log('🌀 Centrifuge updateData called with ratios:', ratios);
        
        // Extract unique ratios excluding 2/1 (octave)
        this.uniqueRatios = this.extractUniqueRatios(ratios);
        
        // Calculate layer disc properties
        this.calculateLayerDiscs();
        
        // Setup ratio ring
        this.setupRatioRing();
        
        console.log('🌀 Centrifuge data updated:', {
            spacesLength: this.spacesPlot.length,
            rhythms: this.rhythms,
            grid: this.grid,
            originalRatios: ratios.length,
            uniqueRatios: this.uniqueRatios.length,
            uniqueRatiosList: this.uniqueRatios,
            hasLayerMap: !!this.parent.layerMap,
            layerMapLength: this.parent.layerMap ? this.parent.layerMap.length : 0
        });
    }

    extractUniqueRatios(ratios) {
        const unique = new Set();
        
        ratios.forEach(ratioObj => {
            // Handle both object format (from LRCModule) and string format
            let ratioString;
            if (typeof ratioObj === 'object' && ratioObj.fraction) {
                ratioString = ratioObj.fraction;
            } else if (typeof ratioObj === 'string') {
                ratioString = ratioObj;
            } else {
                console.log('🌀 Skipping unknown ratio format:', ratioObj);
                return;
            }
            
            // Exclude 2/1 (octave)
            if (ratioString !== '2/1') {
                unique.add(ratioString);
            }
        });
        
        // Convert to array and sort properly
        let sortedRatios = Array.from(unique);
        
        // Sort ratios numerically (convert fractions to decimals for sorting)
        sortedRatios.sort((a, b) => {
            const valueA = this.ratioToDecimal(a);
            const valueB = this.ratioToDecimal(b);
            return valueA - valueB;
        });
        
        console.log('🌀 Extracted and sorted ratios:', sortedRatios);
        return sortedRatios;
    }

    ratioToDecimal(ratio) {
        const [numerator, denominator] = ratio.split('/').map(Number);
        return numerator / denominator;
    }

    setupRatioRing() {
        this.ratioRing = [];
        if (this.uniqueRatios.length === 0) {
            console.log('🌀 No unique ratios to create ring');
            return;
        }
        
        // Ensure 1/1 is first (it should be from sorting, but double-check)
        let orderedRatios = [...this.uniqueRatios];
        const oneOverOneIndex = orderedRatios.indexOf('1/1');
        if (oneOverOneIndex > 0) {
            // Move 1/1 to front if it's not already there
            orderedRatios.splice(oneOverOneIndex, 1);
            orderedRatios.unshift('1/1');
        }
        
        const angleStep = (Math.PI * 2) / orderedRatios.length;
        
        orderedRatios.forEach((ratio, index) => {
            // Start at top (1/1) and go clockwise
            const angle = -Math.PI / 2 + (index * angleStep);
            
            this.ratioRing.push({
                ratio: ratio,
                angle: angle,
                x: 0, // Will be calculated in draw()
                y: 0,
                isLit: false,
                litIntensity: 0
            });
        });
        
        console.log(`🌀 Created ratio ring with ${this.ratioRing.length} ratios:`, 
                    this.ratioRing.map(r => r.ratio));
    }

    calculateLayerDiscs() {
        this.layerDiscs = [];
        this.previousAngles = [];
        const activeRhythms = this.rhythms.filter(r => r > 1);
        
        activeRhythms.forEach((rhythm, index) => {
            const groupingSize = this.grid / rhythm;
            const normalizedRadius = groupingSize / Math.max(...activeRhythms.map(r => this.grid / r));
            
            this.layerDiscs.push({
                rhythm: rhythm,
                groupingSize: groupingSize,
                normalizedRadius: normalizedRadius,
                color: this.layerColors[['A', 'B', 'C', 'D'][this.rhythms.indexOf(rhythm)]],
                layerName: ['A', 'B', 'C', 'D'][this.rhythms.indexOf(rhythm)],
                rotationsPerCycle: rhythm,
                currentAngle: -Math.PI / 2, // Start at top (0 degrees)
                completedRotations: 0 // Track completed rotations
            });
            
            this.previousAngles.push(-Math.PI / 2); // Initialize previous angles
        });
        
        // Sort by radius (largest first)
        this.layerDiscs.sort((a, b) => b.normalizedRadius - a.normalizedRadius);
    }

    setupCanvas() {
        this.canvas = this.parent.canvas;
        this.ctx = this.parent.ctx;
        
        if (!this.canvas || !this.ctx) {
            console.error('🌀 Centrifuge: Canvas not available');
            return false;
        }
        
        this.updateDimensions();
        return true;
    }

    updateDimensions() {
        if (!this.canvas) return;
        
        // Don't interfere with LRCVisuals' canvas setup - use its calculated dimensions
        const logicalWidth = parseInt(this.canvas.style.width) || this.canvas.width;
        const logicalHeight = parseInt(this.canvas.style.height) || this.canvas.height;
        
        this.centerX = logicalWidth / 2;
        this.centerY = logicalHeight / 2;
        this.maxRadius = Math.min(this.centerX, this.centerY) - 60;
    }

    draw() {
        if (!this.setupCanvas()) return;
        
        // Clear the canvas using parent's method (which handles DPR scaling correctly)
        this.parent.clearCanvas();
        
        // Update dimensions to match current canvas state
        this.updateDimensions();
        
        // Draw centrifuge elements (no save/restore needed - work with existing context)
        this.drawBackground();
        this.drawRatioRing();
        this.drawLayerDiscs();
        this.drawCenterPoint();
        this.drawDebugInfo();
    }

    drawBackground() {
        // No background circle needed - just individual ratio dots
    }

    drawRatioRing() {
        if (this.ratioRing.length === 0) {
            console.log('🌀 No ratio ring to draw');
            return;
        }
        
        const ringRadius = this.maxRadius + 30; // Move ring OUTSIDE the centrifuge
        
        console.log(`🌀 Drawing ratio ring with ${this.ratioRing.length} ratios at radius ${ringRadius}`);
        
        this.ratioRing.forEach((ratioPoint, index) => {
            ratioPoint.x = this.centerX + ringRadius * Math.cos(ratioPoint.angle);
            ratioPoint.y = this.centerY + ringRadius * Math.sin(ratioPoint.angle);
            
            // Draw individual ratio dot (larger and more visible)
            const intensity = ratioPoint.isLit ? ratioPoint.litIntensity : 0.8;
            const baseColor = ratioPoint.isLit ? '#00ff88' : '#fff';
            const dotSize = ratioPoint.isLit ? 8 : 5;
            
            this.ctx.fillStyle = baseColor;
            this.ctx.globalAlpha = intensity;
            this.ctx.beginPath();
            this.ctx.arc(ratioPoint.x, ratioPoint.y, dotSize, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.globalAlpha = 1;
            
            // Draw ratio label (positioned outside the dot)
            this.ctx.fillStyle = ratioPoint.isLit ? '#00ff88' : '#ccc';
            this.ctx.font = '11px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            const labelRadius = ringRadius + 20;
            const labelX = this.centerX + labelRadius * Math.cos(ratioPoint.angle);
            const labelY = this.centerY + labelRadius * Math.sin(ratioPoint.angle);
            
            this.ctx.fillText(ratioPoint.ratio, labelX, labelY);
        });
    }

    drawLayerDiscs() {
        let drawnArcs = [];
        
        this.layerDiscs.forEach((disc, index) => {
            const discRadius = disc.normalizedRadius * (this.maxRadius - 40);
            
            // Draw disc outline
            this.ctx.strokeStyle = disc.color;
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 0.6;
            this.ctx.beginPath();
            this.ctx.arc(this.centerX, this.centerY, discRadius, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
            
            // Draw layer dot on radius
            const dotX = this.centerX + discRadius * Math.cos(disc.currentAngle);
            const dotY = this.centerY + discRadius * Math.sin(disc.currentAngle);
            
            this.ctx.fillStyle = disc.color;
            this.ctx.beginPath();
            this.ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Draw arc sector if this layer is lit
            if (this.currentLitArcs.has(index)) {
                this.drawArcSector(index, discRadius, disc.color, disc.currentAngle);
                drawnArcs.push(`${disc.layerName}(${index})`);
            }
        });
        
        // Log drawn arcs every 200th frame
        if (Math.floor(performance.now() / 16) % 200 === 0) {
            //console.log(`🌀 Currently drawing arcs: ${drawnArcs.join(', ')}`);
        }
    }

    drawArcSector(layerIndex, radius, color, currentAngle) {
        const topAngle = -Math.PI / 2; // 0 degrees (top of circle)
        
        // Calculate inner radius (next smaller disc radius, or center if outermost)
        let innerRadius = 0;
        if (layerIndex < this.layerDiscs.length - 1) {
            const nextSmallerDisc = this.layerDiscs[layerIndex + 1];
            innerRadius = nextSmallerDisc.normalizedRadius * (this.maxRadius - 40);
        }
        
        // Determine rotation direction
        const isClockwise = layerIndex % 2 === 0;
        
        // Draw highlighted annular arc segment
        this.ctx.save();
        
        // Create more vibrant version of the color
        const vibrantColor = this.makeColorVibrant(color);
        
        // Draw thick outline arcs (both inner and outer)
        this.ctx.strokeStyle = vibrantColor;
        this.ctx.lineWidth = 4;
        this.ctx.globalAlpha = 0.8;
        
        // Draw arc in the correct direction
        this.ctx.beginPath();
        if (isClockwise) {
            this.ctx.arc(this.centerX, this.centerY, radius, topAngle, currentAngle);
        } else {
            this.ctx.arc(this.centerX, this.centerY, radius, currentAngle, topAngle);
        }
        this.ctx.stroke();
        
        // Inner arc (if there is one)
        if (innerRadius > 0) {
            this.ctx.beginPath();
            if (isClockwise) {
                this.ctx.arc(this.centerX, this.centerY, innerRadius, topAngle, currentAngle);
            } else {
                this.ctx.arc(this.centerX, this.centerY, innerRadius, currentAngle, topAngle);
            }
            this.ctx.stroke();
        }
        
        // Draw filled annular sector
        this.ctx.fillStyle = vibrantColor;
        this.ctx.globalAlpha = 0.4;
        this.ctx.beginPath();
        
        // Create the annular sector path based on direction
        if (isClockwise) {
            // Clockwise: from top to current position
            const startX = this.centerX + innerRadius * Math.cos(topAngle);
            const startY = this.centerY + innerRadius * Math.sin(topAngle);
            this.ctx.moveTo(startX, startY);
            this.ctx.arc(this.centerX, this.centerY, innerRadius, topAngle, currentAngle);
            const outerEndX = this.centerX + radius * Math.cos(currentAngle);
            const outerEndY = this.centerY + radius * Math.sin(currentAngle);
            this.ctx.lineTo(outerEndX, outerEndY);
            this.ctx.arc(this.centerX, this.centerY, radius, currentAngle, topAngle, true);
        } else {
            // Counterclockwise: from current position to top
            const startX = this.centerX + innerRadius * Math.cos(currentAngle);
            const startY = this.centerY + innerRadius * Math.sin(currentAngle);
            this.ctx.moveTo(startX, startY);
            this.ctx.arc(this.centerX, this.centerY, innerRadius, currentAngle, topAngle);
            const outerEndX = this.centerX + radius * Math.cos(topAngle);
            const outerEndY = this.centerY + radius * Math.sin(topAngle);
            this.ctx.lineTo(outerEndX, outerEndY);
            this.ctx.arc(this.centerX, this.centerY, radius, topAngle, currentAngle, true);
        }
        
        this.ctx.closePath();
        this.ctx.fill();
        
        this.ctx.restore();
    }

    makeColorVibrant(hexColor) {
        // Convert hex to more saturated version
        const colorMap = {
            '#ff6b6b': '#ff2020', // More vibrant red
            '#4ecdc4': '#00ffdd', // More vibrant teal  
            '#00a638ff': '#00ff44', // More vibrant green
            '#f9ca24': '#ffdd00'  // More vibrant yellow
        };
        
        return colorMap[hexColor] || hexColor;
    }

    drawCenterPoint() {
        this.ctx.fillStyle = '#00ff88';
        this.ctx.beginPath();
        this.ctx.arc(this.centerX, this.centerY, 3, 0, Math.PI * 2);
        this.ctx.fill();
    }

    drawDebugInfo() {
        // Only show debug info if explicitly enabled (avoid cluttering the production interface)
        if (!window.centrifugeDebug) return;
        
        this.ctx.fillStyle = '#888';
        this.ctx.font = '11px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        
        const info = [
            `Grid: ${this.grid}`,
            `Layers: ${this.rhythms.filter(r => r > 1).join(':')}`,
            `Ratios: ${this.uniqueRatios.length}`,
            `Spaces: ${this.spacesPlot.length}`
        ];
        
        info.forEach((line, index) => {
            this.ctx.fillText(line, 10, 10 + (index * 14));
        });
    }

    // ====================================
    // ANIMATION SYSTEM
    // ====================================

    startAnimation() {
        if (this.isAnimating) return;
        
        this.isAnimating = true;
        this.startTime = performance.now();
        
        // Reset timing calculation
        this.cumulativeTimes = null;
        
        // Initialize separate rotation tracking array
        this.rotationCounts = this.layerDiscs.map(() => 0);
        
        // Start all discs at the top position
        this.layerDiscs.forEach(disc => {
            disc.currentAngle = -Math.PI / 2; // Start at top
        });
        
        // Initially light up all arcs
        this.currentLitArcs.clear();
        this.layerDiscs.forEach((disc, index) => {
            this.currentLitArcs.add(index);
        });
        
        console.log('🌀 Centrifuge animation started with proper timing sync');
        
        this.animate();
    }

    stopAnimation() {
        if (!this.isAnimating) return;
        
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // Reset rotation tracking
        this.rotationCounts = null;
        
        // Reset other state
        this.currentLitRatio = -1;
        this.currentLitArcs.clear();
        
        this.ratioRing.forEach(r => {
            r.isLit = false;
            r.litIntensity = 0;
        });
        
        this.layerDiscs.forEach(disc => {
            disc.currentAngle = -Math.PI / 2;
        });
        
        console.log('🌀 Centrifuge animation stopped and reset');
    }

    animate() {
        if (!this.isAnimating) return;
        
        const currentTime = performance.now();
        const elapsed = currentTime - this.startTime;
        const progress = (elapsed % this.cycleDuration) / this.cycleDuration;
        
        // Update layer disc rotations and check for crossings
        this.updateLayerRotations(progress);
        
        // Update ratio ring lighting (separate system)
        this.updateLighting(progress);
        
        // Redraw
        this.draw();
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    updateLayerRotations(progress) {
        const topAngle = -Math.PI / 2; // 0 degrees (top of circle)
        const discsThatCrossed = [];
        
        // Initialize rotation tracking if not exists
        if (!this.rotationCounts) {
            this.rotationCounts = this.layerDiscs.map(() => 0);
        }
        
        // STEP 1: Update all disc positions and collect crossings
        this.layerDiscs.forEach((disc, index) => {
            // Get previous rotation count from our tracking array
            const prevRotationCount = this.rotationCounts[index];
            
            // Calculate total rotations
            const totalRotations = disc.rotationsPerCycle * progress;
            const currentRotationCount = Math.floor(totalRotations);
            
            // Determine rotation direction based on layer
            // D(0): clockwise, C(1): counterclockwise, B(2): clockwise, A(3): counterclockwise
            const isClockwise = index % 2 === 0; // Even indices clockwise, odd counterclockwise
            const rotationMultiplier = isClockwise ? 1 : -1;
            
            // Calculate visual angle with direction
            disc.currentAngle = topAngle + (rotationMultiplier * totalRotations * Math.PI * 2) % (Math.PI * 2);
            
            // Debug rotation direction occasionally
            if (Math.floor(progress * 1000) % 200 === 0 && index === 0) {
                console.log(`🌀 Layer ${disc.layerName} (${index}): ${isClockwise ? 'clockwise' : 'counterclockwise'}, angle=${(disc.currentAngle * 180 / Math.PI).toFixed(1)}°`);
            }
            
            // Check if rotation count increased (crossing detection remains the same)
            if (currentRotationCount > prevRotationCount) {
                discsThatCrossed.push({
                    index: index,
                    layerName: disc.layerName,
                    prevCount: prevRotationCount,
                    newCount: currentRotationCount,
                    direction: isClockwise ? 'CW' : 'CCW'
                });
                
                console.log(`🌀 *** CROSSING: ${disc.layerName} (${isClockwise ? 'CW' : 'CCW'}) went from ${prevRotationCount} to ${currentRotationCount} rotations ***`);
            }
            
            // Update rotation count in our tracking array
            this.rotationCounts[index] = currentRotationCount;
        });
        
        // STEP 2: If ANY disc crossed, clear ALL arcs and light only the new ones
        if (discsThatCrossed.length > 0) {
            console.log(`🌀 CLEARING ALL ARCS - Discs that crossed: ${discsThatCrossed.map(d => `${d.layerName}(${d.direction})`).join(', ')}`);
            
            // Clear ALL existing arcs first
            this.currentLitArcs.clear();
            
            // Light up ONLY the discs that just crossed
            discsThatCrossed.forEach(crossedDisc => {
                this.currentLitArcs.add(crossedDisc.index);
            });
            
            console.log(`🌀 Now lighting arcs: ${discsThatCrossed.map(d => d.layerName).join(', ')}`);
        }
    }  
    
    updateLighting(progress) {
        if (this.spacesPlot.length === 0 || this.ratioRing.length === 0) return;
        
        // Calculate cumulative times for each spaces plot position
        if (!this.cumulativeTimes) {
            this.cumulativeTimes = [];
            let cumulative = 0;
            const gridTotal = this.spacesPlot.reduce((sum, space) => sum + space, 0);
            
            this.spacesPlot.forEach((space, index) => {
                this.cumulativeTimes[index] = cumulative / gridTotal;
                cumulative += space;
            });
            
            console.log('🌀 Calculated cumulative times:', this.cumulativeTimes);
            console.log('🌀 Grid total:', gridTotal);
        }
        
        // Find which spaces plot position we should be at based on current progress
        let currentSpacesIndex = 0;
        for (let i = 0; i < this.cumulativeTimes.length; i++) {
            if (progress >= this.cumulativeTimes[i]) {
                currentSpacesIndex = i;
            } else {
                break;
            }
        }
        
        const spaceValue = this.spacesPlot[currentSpacesIndex];
        const ratioToLight = this.findRatioForSpaceValue(spaceValue, currentSpacesIndex);
        
        // Reset all ratios
        this.ratioRing.forEach(r => {
            r.isLit = false;
            r.litIntensity = 0;
        });
        
        // Light up current ratio
        if (ratioToLight) {
            const ratioIndex = this.ratioRing.findIndex(r => r.ratio === ratioToLight);
            if (ratioIndex >= 0) {
                this.ratioRing[ratioIndex].isLit = true;
                this.ratioRing[ratioIndex].litIntensity = 1;
                this.currentLitRatio = ratioIndex;
                
                // Debug occasionally
                if (Math.floor(progress * 100) % 20 === 0) {
                    console.log(`🌀 TIMING SYNC: progress=${progress.toFixed(3)}, spacesIndex=${currentSpacesIndex}, space=${spaceValue}, ratio=${ratioToLight}`);
                }
            }
        }
    }

    findRatioForSpaceValue(spaceValue, spacesIndex) {
        if (this.spacesPlot.length === 0 || this.uniqueRatios.length === 0) return null;
        
        // Calculate ratio the same way as scale generation
        const fundamental = Math.max(...this.spacesPlot);
        let ratio = fundamental / spaceValue;
        
        // Octaviate the ratio (compress to single octave between 1/1 and 2/1)
        while (ratio >= 2) ratio /= 2;
        while (ratio < 1) ratio *= 2;
        
        // Convert to fraction format
        const fraction = this.decimalToFraction(ratio);
        
        // Find this ratio in our unique ratios list
        const matchingRatio = this.uniqueRatios.find(r => r === fraction);
        
        // Debug logging occasionally
        if (spacesIndex % 20 === 0) {
            console.log(`🌀 Space ${spaceValue} → ratio ${ratio.toFixed(4)} → fraction ${fraction} → found: ${!!matchingRatio}`);
        }
        
        return matchingRatio;
    }

    // ====================================
    // PUBLIC API
    // ====================================

    setCycleDuration(duration) {
        this.cycleDuration = duration * 1000; // Convert to ms
        console.log(`🌀 Centrifuge cycle duration set to ${duration}s`);
    }

    setVisible(visible) {
        if (visible) {
            this.draw();
        } else {
            this.stopAnimation();
        }
    }
}

// Integration with existing LRCVisuals system
function integrateCentrifugeVisualization() {
    if (!window.lrcVisuals || window.lrcVisuals.centrifuge) return;
    
    console.log('🌀 Starting Centrifuge integration...');
    
    // Create centrifuge instance
    window.lrcVisuals.centrifuge = new LRCCentrifuge(window.lrcVisuals);
    
    // Add centrifuge option to existing viz type selector  
    const vizTypeSelect = document.getElementById('viz-type-selector');
    if (vizTypeSelect) {
        // Check if centrifuge option already exists
        const existingOption = vizTypeSelect.querySelector('option[value="centrifuge"]');
        if (!existingOption) {
            const option = document.createElement('option');
            option.value = 'centrifuge';
            option.textContent = 'Centrifuge';
            vizTypeSelect.appendChild(option);
            console.log('🌀 Centrifuge option added to existing viz type selector');
        }
        
        // Add event listener for plot type changes
        vizTypeSelect.addEventListener('change', (e) => {
            if (window.lrcVisuals) {
                window.lrcVisuals.currentPlotType = e.target.value;
                window.lrcVisuals.drawPlot();
            }
        });
    } else {
        console.warn('🌀 Viz type selector not found - will retry later');
        // Try again after a short delay
        setTimeout(integrateCentrifugeVisualization, 500);
        return;
    }
    
    // Store original methods but don't override them immediately
    const originalDrawPlot = window.lrcVisuals.drawPlot.bind(window.lrcVisuals);
    const originalSetupEventListeners = window.lrcVisuals.setupEventListeners.bind(window.lrcVisuals);

    // Only override drawPlot when specifically needed
    window.lrcVisuals.drawPlot = function() {
        if (this.currentPlotType === 'centrifuge') {
            // Only use centrifuge logic for centrifuge plots
            if (!this.centrifuge) return;
            if (this.spacesPlot && this.spacesPlot.length > 0) {
                this.drawCentrifugePlot();
            } else {
                this.clearCanvas();
            }
        } else {
            // Use completely original method for linear/circular - no interference
            originalDrawPlot();
        }
    };
    
    // Add centrifuge-specific draw method
    window.lrcVisuals.drawCentrifugePlot = function() {
        if (!this.centrifuge) return;
        
        // Get current ratios from LRCModule
        let currentRatios = [];
        if (window.lrcModule && window.lrcModule.currentRatios) {
            currentRatios = window.lrcModule.currentRatios;
            console.log('🌀 Getting ratios from LRCModule:', currentRatios);
        } else {
            console.log('🌀 No ratios available from LRCModule');
        }
        
        this.centrifuge.updateData(
            this.spacesPlot,
            this.rhythms,
            window.lrcModule ? window.lrcModule.currentGrid : 1,
            currentRatios
        );
        this.centrifuge.draw();
    };
    
    // Extend animation methods - hook into existing playback events
    const originalStartAnimation = window.lrcVisuals.startAnimation || function() {};
    window.lrcVisuals.startAnimation = function() {
        if (this.currentPlotType === 'centrifuge' && this.centrifuge) {
            this.centrifuge.setCycleDuration(this.cycleDuration / 1000);
            this.centrifuge.startAnimation();
        } else {
            originalStartAnimation.call(this);
        }
    };
    
    const originalStopAnimation = window.lrcVisuals.stopAnimation || function() {};
    window.lrcVisuals.stopAnimation = function() {
        if (this.centrifuge) {
            this.centrifuge.stopAnimation();
        }
        originalStopAnimation.call(this);
    };
    
    // Listen for playback events from ToneRowPlayback
    window.addEventListener('playbackStarted', (e) => {
        if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'centrifuge' && window.lrcVisuals.centrifuge) {
            console.log('🌀 Centrifuge responding to playbackStarted event');
            const cycleDuration = e.detail?.cycleDuration || 10.0;
            window.lrcVisuals.centrifuge.setCycleDuration(cycleDuration);
            window.lrcVisuals.centrifuge.startAnimation();
            console.log('🌀 Centrifuge animation started with cycle duration:', cycleDuration);
        }
    });
    
    window.addEventListener('playbackStopped', () => {
        if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'centrifuge' && window.lrcVisuals.centrifuge) {
            console.log('🌀 Centrifuge responding to playbackStopped event');
            window.lrcVisuals.centrifuge.stopAnimation();
            console.log('🌀 Centrifuge animation stopped');
        }
    });
    
    // Also listen for cycle duration changes
    window.addEventListener('tempoChanged', (e) => {
        if (window.lrcVisuals && window.lrcVisuals.centrifuge) {
            const cycleDuration = e.detail?.cycleDuration || 10.0;
            window.lrcVisuals.centrifuge.setCycleDuration(cycleDuration);
            console.log('🌀 Centrifuge cycle duration updated to:', cycleDuration);
        }
    });
    
    // Extend setCycleDuration
    const originalSetCycleDuration = window.lrcVisuals.setCycleDuration || function() {};
    window.lrcVisuals.setCycleDuration = function(duration) {
        originalSetCycleDuration.call(this, duration);
        if (this.centrifuge) {
            this.centrifuge.setCycleDuration(duration);
        }
    }; 
    
    console.log('🌀 Centrifuge visualization integrated with LRC interface');
}

// Integration with existing LRCVisuals system
if (typeof window !== 'undefined') {
    window.LRCCentrifuge = LRCCentrifuge;
    
    // Wait for both DOM and LRCVisuals to be ready
    document.addEventListener('DOMContentLoaded', () => {
        // Give LRCVisuals time to initialize
        setTimeout(() => {
            if (window.lrcVisuals) {
                integrateCentrifugeVisualization();
            } else {
                console.log('🌀 LRCVisuals not ready, waiting...');
                // Check periodically for LRCVisuals
                const checkInterval = setInterval(() => {
                    if (window.lrcVisuals) {
                        clearInterval(checkInterval);
                        integrateCentrifugeVisualization();
                    }
                }, 100);
                
                // Stop checking after 5 seconds
                setTimeout(() => {
                    clearInterval(checkInterval);
                    console.warn('🌀 LRCVisuals not found after 5 seconds');
                }, 5000);
            }
        }, 100);
    });
}