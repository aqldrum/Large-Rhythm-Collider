class LandmarkLights {
    constructor() {
        // Lighting state
        this.isPlaybackMode = false;
        this.currentLightIndex = 0;
        this.lightingSequence = [];
        this.activeLights = new Map();
        
        // Timing and synchronization
        this.cycleDuration = 10.0;
        this.totalLights = 0;
        this.lightInterval = null;
        
        // Layer colors (matching your vision)
        this.layerColors = {
            A: 0x00ff00,  // Green
            B: 0x0080ff,  // Blue  
            C: 0xc080ff,  // Light Purple
            D: 0xff0000   // Red
        };
        
        // Landmark references
        this.landmarkMeshes = [];
        this.originalColors = new Map();
        this.originalPositions = new Map();
        
        console.log('🌟 LandmarkLights system initialized');
        this.setupCommunication();
    }

    triggerRender() {
        // Force a render by setting the renderDirty flag on the sphere mapper
        if (this.sphereMapper) {
            this.sphereMapper.renderDirty = true;
        }
    }
    
    // ========================================
    // LANDMARK DATA INTEGRATION
    // ========================================
    
    setupLandmarks(landmarkData, sphereMapper = null) {
        if (!landmarkData || landmarkData.length === 0) {
            console.warn('No landmark data provided to lighting system');
            return;
        }
        
        console.log(`🗺️ Setting up lighting for ${landmarkData.length} landmarks`);
        
        // Store landmark references and original states
        this.landmarkData = landmarkData;
        this.totalLights = landmarkData.length;
        this.sphereMapper = sphereMapper; // Reference to sphere mapper for mesh access
        
        // Store original colors and positions for restoration
        this.storeOriginalStates();
        
        // Pre-calculate lighting sequence based on spaces plot order
        this.precalculateLightingSequence();
        
        console.log(`✅ Lighting sequence prepared: ${this.lightingSequence.length} lights`);
    }

    storeOriginalStates() {
        if (!this.sphereMapper || !this.sphereMapper.instancedLandmarks) {
            console.warn('No sphere mapper or landmark mesh available');
            return;
        }
        
        this.originalColors.clear();
        this.originalPositions.clear();
        
        // Get the instanced mesh from sphere mapper
        const instancedMesh = this.sphereMapper.instancedLandmarks;
        
        if (instancedMesh && instancedMesh.instanceColor) {
            console.log(`📦 Storing original states for ${instancedMesh.count} landmark instances`);
            
            // Store original colors from the instanced mesh
            for (let i = 0; i < instancedMesh.count; i++) {
                const color = new THREE.Color();
                instancedMesh.getColorAt(i, color);
                this.originalColors.set(i, color.clone());
                
                // Store original positions/matrices
                const matrix = new THREE.Matrix4();
                instancedMesh.getMatrixAt(i, matrix);
                this.originalPositions.set(i, matrix.clone());
            }
            
            console.log(`✅ Stored original states for ${this.originalColors.size} landmarks`);
        }
    }

    
    precalculateLightingSequence() {
        console.log('🎯 Starting precalculateLightingSequence...');
        console.log('  landmarkData:', !!this.landmarkData ? this.landmarkData.length : 'none');
        console.log('  currentSpacesPlot:', !!window.currentSpacesPlot ? window.currentSpacesPlot.length : 'none');
        
        if (!this.landmarkData || !window.currentSpacesPlot) {
            console.warn('Cannot precalculate lighting - missing data');
            console.warn('  landmarkData missing:', !this.landmarkData);
            console.warn('  currentSpacesPlot missing:', !window.currentSpacesPlot);
            return;
        }
        
        this.lightingSequence = [];
        
        // Use the landmark data which should already be in chronological order
        this.landmarkData.forEach((landmark, index) => {
            const lightInfo = {
                index: index,
                landmark: landmark,
                spaceValue: landmark.spaceValue,
                layers: landmark.contributingLayers || ['Unknown'],
                timing: this.calculateLightTiming(index),
                color: this.calculateLightColor(landmark.contributingLayers || []),
                animation: this.calculateLightAnimation(landmark.contributingLayers || [])
            };
            
            this.lightingSequence.push(lightInfo);
        });
        
        // Sort by timing to ensure proper sequence (should already be correct)
        this.lightingSequence.sort((a, b) => a.timing - b.timing);
        
        console.log('🎯 Lighting sequence precalculated:', {
            totalLights: this.lightingSequence.length,
            layerDistribution: this.analyzeLayers(),
            durationRange: `${this.lightingSequence[0]?.timing.toFixed(3)}s - ${this.lightingSequence[this.lightingSequence.length-1]?.timing.toFixed(3)}s`
        });
    }
    
    calculateLightTiming(index) {
        // Ensure timing is based on the actual spaces plot sequence
        const totalLandmarks = this.landmarkData.length;
        
        if (totalLandmarks === 0) {
            console.warn('No landmarks for timing calculation');
            return 0;
        }
        
        // Calculate precise timing position within the cycle
        const timePosition = (index / totalLandmarks) * this.cycleDuration;
        
        // Add small offset to avoid conflicts at 0 time
        const adjustedTiming = timePosition + (index * 0.001);
        
        return Math.max(0, Math.min(adjustedTiming, this.cycleDuration - 0.1));
    }
    
    calculateLightColor(contributingLayers) {
        if (!contributingLayers || contributingLayers.length === 0) {
            return 0xffffff; // Default white
        }
        
        if (contributingLayers.length === 1) {
            // Single layer - use layer color
            return this.layerColors[contributingLayers[0]] || 0xffffff;
        }
        
        // Multiple layers - blend colors
        return this.blendLayerColors(contributingLayers);
    }
    
    blendLayerColors(layers) {
        let r = 0, g = 0, b = 0;
        let validLayers = 0;
        
        layers.forEach(layer => {
            const color = this.layerColors[layer];
            if (color !== undefined) {
                r += (color >> 16) & 0xFF;
                g += (color >> 8) & 0xFF;
                b += color & 0xFF;
                validLayers++;
            }
        });
        
        if (validLayers === 0) return 0xffffff;
        
        // Average the colors
        r = Math.round(r / validLayers);
        g = Math.round(g / validLayers);
        b = Math.round(b / validLayers);
        
        return (r << 16) | (g << 8) | b;
    }
    
    calculateLightAnimation(contributingLayers) {
        const layerCount = contributingLayers ? contributingLayers.length : 1;
        
        // More dramatic scaling based on layer count
        const baseScale = 1.2; // Minimum scale multiplier
        const scaleIncrement = 0.4; // Additional scale per layer
        const baseHeight = 0.1; // Base jump height
        const heightIncrement = 0.04; // Additional height per layer
        const baseDuration = 0.8; // Base animation duration in seconds
        const durationIncrement = 0.2; // Additional duration per layer
        
        return {
            scale: baseScale + (layerCount - 1) * scaleIncrement,
            height: baseHeight + (layerCount - 1) * heightIncrement,
            duration: baseDuration + (layerCount - 1) * durationIncrement
        };
    }
    
    analyzeLayers() {
        const analysis = { A: 0, B: 0, C: 0, D: 0, Multiple: 0 };
        
        this.lightingSequence.forEach(light => {
            if (light.layers.length === 1) {
                analysis[light.layers[0]]++;
            } else if (light.layers.length > 1) {
                analysis.Multiple++;
            }
        });
        
        return analysis;
    }
    
    // ========================================
    // PLAYBACK MODE MANAGEMENT
    // ========================================
    
    handlePlaybackStart(audioData) {
        console.log('🎵 Landmark lighting: Playback started');
        
        this.isPlaybackMode = true;
        this.cycleDuration = audioData.cycleDuration || 10.0;
        this.currentLightIndex = 0;
        
        // Switch all landmarks to playback mode (white default)
        this.switchToPlaybackMode();
        
        // Start the lighting sequence
        this.startLightingSequence();
    }
    
    handlePlaybackStop() {
        console.log('🛑 Landmark lighting: Playback stopped');
        
        this.isPlaybackMode = false;
        this.currentLightIndex = 0;
        
        // Clear any active lighting
        this.stopLightingSequence();
        
        // Return to rarity colors
        this.switchToRarityMode();
    }
    
    handleTempoChange(newTempo) {
        console.log(`🎚️ Landmark lighting: Tempo changed to ${newTempo}s`);
        
        const wasPlayingBefore = this.isPlaybackMode;
        
        // Update cycle duration
        this.cycleDuration = newTempo;
        
        if (wasPlayingBefore) {
            // Stop current sequence
            this.stopLightingSequence();
            
            // Recalculate timing with new cycle duration
            this.precalculateLightingSequence();
            
            // Restart sequence immediately
            this.startLightingSequence();
            
            console.log(`✅ Lighting sequence restarted with new tempo: ${newTempo}s`);
        } else {
            // Just recalculate for when playback starts
            this.precalculateLightingSequence();
            console.log(`✅ Lighting sequence recalculated for tempo: ${newTempo}s`);
        }
    }
    
    // ========================================
    // LIGHTING MODES
    // ========================================
    
    switchToPlaybackMode() {
        // Set all landmarks to white/default state
        if (!this.sphereMapper || !this.sphereMapper.instancedLandmarks) {
            console.warn('No landmark mesh for mode switch');
            return;
        }
        
        const instancedMesh = this.sphereMapper.instancedLandmarks;
        const whiteColor = new THREE.Color(0xffffff);
        
        for (let i = 0; i < instancedMesh.count; i++) {
            instancedMesh.setColorAt(i, whiteColor);
        }
        instancedMesh.instanceColor.needsUpdate = true;
        
        // TRIGGER RENDER UPDATE
        this.triggerRender();
        
        console.log('🔄 Switched landmarks to playback mode (white)');
    }
    
    switchToRarityMode() {
        // Restore original rarity colors
        if (!this.sphereMapper || !this.sphereMapper.instancedLandmarks) {
            console.warn('No landmark mesh for mode switch');
            return;
        }
        
        const instancedMesh = this.sphereMapper.instancedLandmarks;
        
        this.originalColors.forEach((color, index) => {
            if (index < instancedMesh.count) {
                instancedMesh.setColorAt(index, color);
            }
        });
        instancedMesh.instanceColor.needsUpdate = true;
        
        // TRIGGER RENDER UPDATE
        this.triggerRender();
        
        console.log('🔄 Switched landmarks to rarity mode (color spectrum)');
    }

    // ========================================
    // LIGHTING SEQUENCE EXECUTION
    // ========================================
    
    startLightingSequence() {
        // Clear any existing sequence
        this.stopLightingSequence();
        
        if (!this.lightingSequence || this.lightingSequence.length === 0) {
            console.warn('⚠️ No lighting sequence available. Attempting to initialize...');
            this.forceInitialization();
            
            if (!this.lightingSequence || this.lightingSequence.length === 0) {
                console.error('❌ Still no lighting sequence after force init');
                return;
            }
        }
        
        // Validate cycle duration
        if (!this.cycleDuration || this.cycleDuration <= 0) {
            console.error('❌ Invalid cycle duration:', this.cycleDuration);
            return;
        }
        
        console.log(`🎬 Starting lighting sequence: ${this.lightingSequence.length} lights over ${this.cycleDuration}s`);
        
        // Clear any stale timeout references
        this.activeLightTimeouts = this.activeLightTimeouts || [];
        this.activeLightTimeouts.forEach(timeout => clearTimeout(timeout));
        this.activeLightTimeouts = [];
        
        // Schedule each light based on precalculated timing
        this.lightingSequence.forEach(lightInfo => {
            const timeout = setTimeout(() => {
                if (this.isPlaybackMode) {
                    this.illuminateLandmark(lightInfo);
                }
            }, lightInfo.timing * 1000); // Convert to milliseconds
            
            this.activeLightTimeouts.push(timeout);
        });
        
        // Set up looping with precise timing
        this.lightInterval = setTimeout(() => {
            if (this.isPlaybackMode) {
                console.log('🔄 Looping lighting sequence');
                this.startLightingSequence(); // Loop
            }
        }, this.cycleDuration * 1000);
        
        console.log('✅ Lighting sequence scheduled successfully');
    }
    
    stopLightingSequence() {
        // Clear main loop interval
        if (this.lightInterval) {
            clearTimeout(this.lightInterval);
            this.lightInterval = null;
        }
        
        // Clear all individual light timeouts
        if (this.activeLightTimeouts) {
            this.activeLightTimeouts.forEach(timeout => clearTimeout(timeout));
            this.activeLightTimeouts = [];
        }
        
        // Clear any pending timeouts in activeLights map
        this.activeLights.clear();
        
        console.log('🛑 Lighting sequence stopped and all timeouts cleared');
    }
    
    illuminateLandmark(lightInfo) {
        const { index, color, animation, layers } = lightInfo;
                
        // Start with color change and illumination effect
        this.setLandmarkColor(index, color, true);
        
        // Add a small delay before animation for visual sequencing
        setTimeout(() => {
            if (this.isPlaybackMode) {
                this.animateLandmark(index, animation);
                
                // Add pulse effect for multiple layers
                if (layers.length > 1) {
                    this.createPulseEffect(index, layers);
                }
            }
        }, 50); // 50ms delay for better visual effect
    }

    createPulseEffect(index, layers) {
        if (layers.length <= 1) return; // Only pulse for multiple layers
        
        const pulseCount = layers.length;
        let currentPulse = 0;
        
        const pulse = () => {
            if (currentPulse >= pulseCount || !this.isPlaybackMode) return;
            
            // Get the color for this pulse
            const layerColor = this.layerColors[layers[currentPulse]] || 0xffffff;
            
            // Quick color flash
            this.setLandmarkColor(index, layerColor, false);
            
            // Return to white after short delay
            setTimeout(() => {
                if (this.isPlaybackMode) {
                    this.setLandmarkColor(index, 0xffffff, false);
                }
            }, 150);
            
            currentPulse++;
            
            // Schedule next pulse
            if (currentPulse < pulseCount) {
                setTimeout(pulse, 200);
            }
        };
        
        // Start pulsing after main animation
        setTimeout(pulse, 400);
    }
    
    setLandmarkColor(index, color, animated = false) {
        if (!this.sphereMapper || !this.sphereMapper.instancedLandmarks) {
            console.warn('No landmark mesh available for coloring');
            return;
        }
        
        const instancedMesh = this.sphereMapper.instancedLandmarks;
        
        if (index >= 0 && index < instancedMesh.count) {
            // Convert hex color to Three.js Color
            const threeColor = new THREE.Color(color);
            
            // Set the color on the instanced mesh
            instancedMesh.setColorAt(index, threeColor);
            instancedMesh.instanceColor.needsUpdate = true;
            
            // Add illumination effect for playback mode
            if (this.isPlaybackMode && animated) {
                this.addIlluminationEffect(index, threeColor);
            } else if (animated && !this.isPlaybackMode) {
                // Brief flash animation for rarity mode
                this.flashLandmark(index, threeColor);
            }
            
            // TRIGGER RENDER UPDATE
            this.triggerRender();            
        }
    }

    addIlluminationEffect(index, color) {
        // Store the illumination state for this landmark
        this.activeLights.set(index, {
            color: color.clone(),
            startTime: performance.now(),
            duration: 1000 // 1 second glow duration
        });
        
        // Create a glowing effect by temporarily brightening the color
        const glowColor = color.clone();
        glowColor.multiplyScalar(2.0); // Make it twice as bright
        
        // Apply the glow color immediately
        const instancedMesh = this.sphereMapper.instancedLandmarks;
        instancedMesh.setColorAt(index, glowColor);
        instancedMesh.instanceColor.needsUpdate = true;
        
        // Schedule return to normal color
        setTimeout(() => {
            if (this.isPlaybackMode) {
                // During playback, return to white background
                const whiteColor = new THREE.Color(0xffffff);
                instancedMesh.setColorAt(index, whiteColor);
            } else {
                // During rarity mode, return to original color
                const originalColor = this.originalColors.get(index);
                if (originalColor) {
                    instancedMesh.setColorAt(index, originalColor);
                }
            }
            instancedMesh.instanceColor.needsUpdate = true;
            this.triggerRender();
        }, 800); // Slightly shorter than animation duration
    }

    createLandmarkAnimation(index, animData) {
        const startTime = performance.now();
        const { originalMatrix, targetPosition, targetScale, duration, quaternion } = animData;
        
        // Extract original data
        const origPosition = new THREE.Vector3();
        const origQuaternion = new THREE.Quaternion();
        const origScale = new THREE.Vector3();
        originalMatrix.decompose(origPosition, origQuaternion, origScale);
        
        // Calculate surface normal for potential rotation alignment
        const sphereCenter = new THREE.Vector3(0, 0, 0);
        const surfaceNormal = origPosition.clone().sub(sphereCenter).normalize();
        
        // Store original matrix for guaranteed restoration
        const storedOriginalMatrix = originalMatrix.clone();
        
        const animateLight = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Enhanced easing function for more dynamic animation
            let eased;
            if (progress < 0.5) {
                // First half: accelerate outward (ease-out)
                eased = 1 - Math.pow(1 - (progress * 2), 2);
            } else {
                // Second half: decelerate back inward (ease-in)
                const returnProgress = (progress - 0.5) * 2;
                eased = 1 - Math.pow(returnProgress, 2);
            }
            
            // Calculate current position and scale
            let currentPosition, currentScale;
            
            if (progress < 0.5) {
                // First half: animate to target
                const halfProgress = progress * 2;
                currentPosition = origPosition.clone().lerp(targetPosition, eased);
                currentScale = origScale.clone().lerp(targetScale, eased);
            } else {
                // Second half: animate back to original
                const returnProgress = (progress - 0.5) * 2;
                const returnEased = 1 - Math.pow(1 - returnProgress, 2);
                currentPosition = targetPosition.clone().lerp(origPosition, returnEased);
                currentScale = targetScale.clone().lerp(origScale, returnEased);
            }
            
            // Create new matrix
            const matrix = new THREE.Matrix4();
            matrix.compose(currentPosition, quaternion, currentScale);
            
            // Apply to instanced mesh
            if (this.sphereMapper && this.sphereMapper.instancedLandmarks) {
                this.sphereMapper.instancedLandmarks.setMatrixAt(index, matrix);
                this.sphereMapper.instancedLandmarks.instanceMatrix.needsUpdate = true;
                
                // TRIGGER RENDER UPDATE FOR ANIMATION FRAMES
                this.triggerRender();
            }
            
            // Continue animation if not complete
            if (progress < 1 && this.isPlaybackMode) {
                requestAnimationFrame(animateLight);
            } else {
                // GUARANTEED restoration to original state
                if (this.sphereMapper && this.sphereMapper.instancedLandmarks) {
                    this.sphereMapper.instancedLandmarks.setMatrixAt(index, storedOriginalMatrix);
                    this.sphereMapper.instancedLandmarks.instanceMatrix.needsUpdate = true;
                    
                    // TRIGGER FINAL RENDER UPDATE
                    this.triggerRender();
                } 
            }
        };
        
        requestAnimationFrame(animateLight);
    }

    flashLandmark(index, color) {
        // Brief flash for non-playback mode
        const originalColor = this.originalColors.get(index);
        if (!originalColor) return;
        
        // Flash sequence
        setTimeout(() => {
            this.setLandmarkColor(index, originalColor.getHex(), false);
        }, 150); // Flash duration
    }
    
    animateLandmark(index, animation) {
        if (!this.sphereMapper || !this.sphereMapper.instancedLandmarks) {
            console.warn('No landmark mesh available for animation');
            return;
        }
        
        const instancedMesh = this.sphereMapper.instancedLandmarks;
        
        if (index >= 0 && index < instancedMesh.count) {
            // Get current matrix
            const matrix = new THREE.Matrix4();
            instancedMesh.getMatrixAt(index, matrix);
            
            // Extract position, rotation, scale
            const position = new THREE.Vector3();
            const quaternion = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            matrix.decompose(position, quaternion, scale);
            
            // FIXED: Calculate surface normal direction for radial movement
            // The landmark position represents its location on the sphere surface
            const sphereCenter = new THREE.Vector3(0, 0, 0); // Sphere center at origin
            const surfaceNormal = position.clone().sub(sphereCenter).normalize();
            
            // Calculate target position by moving outward along surface normal
            const radialOffset = surfaceNormal.clone().multiplyScalar(animation.height);
            const targetPosition = position.clone().add(radialOffset);
            
            // Animate scale based on layer count
            const targetScale = scale.clone().multiplyScalar(animation.scale);
            
            // Create animation using requestAnimationFrame
            this.createLandmarkAnimation(index, {
                originalMatrix: matrix.clone(),
                targetPosition: targetPosition,
                targetScale: targetScale,
                duration: animation.duration * 1000, // Convert to milliseconds
                quaternion: quaternion
            });
        }
    }
    
    // ========================================
    // UTILITY METHODS
    // ========================================
    
    getLightingStatus() {
        return {
            isPlaybackMode: this.isPlaybackMode,
            currentLightIndex: this.currentLightIndex,
            totalLights: this.totalLights,
            cycleDuration: this.cycleDuration,
            sequenceLength: this.lightingSequence.length
        };
    }
    
    // For debugging
    testLightingSequence() {
        console.log('🧪 Testing lighting sequence...');
        this.lightingSequence.forEach((light, index) => {
            console.log(`Light ${index}: time=${light.timing.toFixed(3)}s, color=${light.color.toString(16)}, layers=[${light.layers.join(', ')}]`);
        });
    }

    testSingleLandmark(index = 0) {
        console.log(`🧪 Testing enhanced landmark ${index}...`);
        
        // Test illumination with multiple layers
        const testLightInfo = {
            index: index,
            color: 0xff00ff, // Magenta
            layers: ['A', 'B'], // Multiple layers for testing
            animation: this.calculateLightAnimation(['A', 'B'])
        };
        
        // Simulate playback mode
        const wasPlaybackMode = this.isPlaybackMode;
        this.isPlaybackMode = true;
        
        // Test the enhanced illumination
        this.illuminateLandmark(testLightInfo);
        
        // Restore original mode after test
        setTimeout(() => {
            this.isPlaybackMode = wasPlaybackMode;
            if (!wasPlaybackMode) {
                this.switchToRarityMode();
            }
        }, 3000);
    }

    forceInitialization() {
        console.log('🔧 Force initializing LandmarkLights system...');
        
        // Try to find sphere mapper
        if (!this.sphereMapper && window.sphereMapper) {
            this.sphereMapper = window.sphereMapper;
            console.log('✅ Found sphereMapper from window');
        }
        
        // Try to get landmark data
        if (!this.landmarkData && this.sphereMapper?.landmarkData) {
            this.landmarkData = this.sphereMapper.landmarkData;
            this.totalLights = this.landmarkData.length;
            console.log(`✅ Found landmarkData: ${this.landmarkData.length} landmarks`);
        }
        
        // Try to store original states
        if (this.sphereMapper?.instancedLandmarks && this.originalColors.size === 0) {
            this.storeOriginalStates();
            console.log('✅ Stored original states');
        }
        
        // Try to precalculate sequence
        if (this.landmarkData && window.currentSpacesPlot && this.lightingSequence.length === 0) {
            this.precalculateLightingSequence();
            console.log('✅ Precalculated lighting sequence');
        }
        
        const debug = this.debugInitialization();
        console.log('🔧 Force initialization result:', debug);
        
        return debug;
    }

    debugInitialization() {
        console.log('🔍 LandmarkLights Initialization Debug:');
        console.log('  landmarkData:', !!this.landmarkData ? this.landmarkData.length : 'none');
        console.log('  sphereMapper:', !!this.sphereMapper);
        console.log('  instancedLandmarks:', !!this.sphereMapper?.instancedLandmarks);
        console.log('  originalColors stored:', this.originalColors.size);
        console.log('  lightingSequence:', this.lightingSequence.length);
        console.log('  currentSpacesPlot:', !!window.currentSpacesPlot ? window.currentSpacesPlot.length : 'none');
        
        if (this.sphereMapper?.instancedLandmarks) {
            const mesh = this.sphereMapper.instancedLandmarks;
            console.log('  mesh count:', mesh.count);
            console.log('  mesh hasInstanceColor:', !!mesh.instanceColor);
            console.log('  mesh hasInstanceMatrix:', !!mesh.instanceMatrix);
        }
        
        return {
            initialized: !!(this.landmarkData && this.sphereMapper?.instancedLandmarks),
            hasSequence: this.lightingSequence.length > 0,
            hasOriginalStates: this.originalColors.size > 0
        };
    }

    testAudioIntegration() {
        console.log('🧪 Testing audio integration...');
        
        // Simulate audio start event
        const testEventDetail = {
            cycleDuration: 10.0,
            fundamentalFreq: 220,
            rhythms: [4, 3, 2, 1]
        };
        
        console.log('🧪 Simulating audioPlaybackStart event with detail:', testEventDetail);
        
        // Test direct method call
        this.handlePlaybackStart(testEventDetail);
        
        // Wait 3 seconds then stop
        setTimeout(() => {
            console.log('🧪 Simulating audioPlaybackStop event');
            this.handlePlaybackStop();
        }, 3000);
    }

    // STEP 4: Add initialization check
    // AMENDMENT 4: Add this debug method to check initialization order

    debugAudioLightingConnection() {
        console.log('🔍 Audio-Lighting Connection Debug:');
        console.log('  window.landmarkLights exists:', !!window.landmarkLights);
        console.log('  window.sphereMapper exists:', !!window.sphereMapper);
        console.log('  window.audio exists:', !!window.audio);
        
        if (window.landmarkLights) {
            console.log('  LandmarkLights initialized:', window.landmarkLights.debugInitialization());
        }
        
        if (window.audio) {
            console.log('  Audio system state:');
            console.log('    isPlaying:', window.audio.isPlaying);
            console.log('    cycleDuration:', window.audio.cycleDuration);
            console.log('    currentRhythms:', window.audio.currentRhythms);
        }
        
        // Test event dispatch
        console.log('🧪 Testing event dispatch...');
        const testEvent = new CustomEvent('test-event', { detail: { test: 'data' } });
        
        let eventReceived = false;
        const testListener = (e) => {
            console.log('✅ Test event received:', e.detail);
            eventReceived = true;
        };
        
        window.addEventListener('test-event', testListener, { once: true });
        window.dispatchEvent(testEvent);
        
        setTimeout(() => {
            if (!eventReceived) {
                console.error('❌ Test event was NOT received - event system may be broken');
            }
            window.removeEventListener('test-event', testListener);
        }, 100);
    }

    debugLandmarkMesh() {
    if (!this.sphereMapper || !this.sphereMapper.landmarkMesh) {
        console.log('❌ No landmark mesh found');
        return;
    }
    
    const mesh = this.sphereMapper.landmarkMesh;
    console.log('🔍 Landmark Mesh Debug:', {
        count: mesh.count,
        hasInstanceColor: !!mesh.instanceColor,
        hasInstanceMatrix: !!mesh.instanceMatrix,
        originalColorsStored: this.originalColors.size,
        originalPositionsStored: this.originalPositions.size
    });
}
}