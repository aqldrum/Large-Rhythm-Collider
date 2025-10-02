// AroundTheWorld.js - Cinematic Export System
// Creates a smooth camera path following illuminating landmarks

class AroundTheWorld {
    constructor() {
        // Camera and animation state
        this.isRecording = false;
        this.recordingStartTime = 0;
        this.currentLandmarkIndex = 0;
        this.cameraPath = [];
        this.frames = [];
        
        // Recording settings
        this.targetFPS = 30;
        this.frameInterval = 1000 / this.targetFPS;
        this.lastFrameTime = 0;
        
        // Camera movement parameters for superhero-scale flight
        this.globeScale = 1.0; // Make world feel much larger
        this.cameraDistance = 0.05; // Closer to surface for horizon view
        this.cameraHeight = 0.08; // Low flight altitude
        this.smoothingFactor = 0.9; // Camera movement smoothness
        this.lookAheadDistance = 0.3; // Look further ahead for smooth trajectory
        this.spiralAwareness = true; // Follow spiral direction intelligently
        this.minCameraSpeed = 0.05; // Minimum movement to avoid stopping
        
        // Original camera state for restoration
        this.originalCameraPosition = null;
        this.originalCameraTarget = null;
        
        // Progress tracking
        this.totalFrames = 0;
        this.recordedFrames = 0;
        
        console.log('🎬 AroundTheWorld system initialized');
        this.setupUI();
    }

    
    setupUI() {
        // Create the Around the World button and progress UI
        const sphereContainer = document.getElementById('sphereContainer');
        if (!sphereContainer) {
            console.error('❌ Could not find sphere container for UI');
            return;
        }
        
        // Add the button AFTER the sphere container, not inside it
        // to avoid the overflow: hidden CSS issue
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            justify-content: center;
            align-items: center;
            margin-top: 10px;
            gap: 10px;
        `;
        
        // Create the main button
        const exportButton = document.createElement('button');
        exportButton.id = 'aroundWorldBtn';
        exportButton.innerHTML = '🌍 Around the World';
        exportButton.style.cssText = `
            padding: 12px 24px;
            background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        `;
        
        exportButton.addEventListener('mouseenter', () => {
            exportButton.style.transform = 'translateY(-2px)';
            exportButton.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
        });
        
        exportButton.addEventListener('mouseleave', () => {
            exportButton.style.transform = 'translateY(0)';
            exportButton.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
        });
        
        exportButton.addEventListener('click', () => {
            this.startAroundTheWorldExport();
        });
        
        buttonContainer.appendChild(exportButton);
        
        // Create progress container (initially hidden)
        const progressContainer = document.createElement('div');
        progressContainer.id = 'aroundWorldProgress';
        progressContainer.style.cssText = `
            display: none;
            flex-direction: column;
            align-items: center;
            margin-top: 15px;
            padding: 20px;
            background: rgba(0,0,0,0.8);
            border-radius: 10px;
            color: white;
        `;
        
        progressContainer.innerHTML = `
            <div style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">
                🎬 Rendering Around the World
            </div>
            <div style="width: 100%; background: #333; border-radius: 10px; overflow: hidden; margin-bottom: 10px;">
                <div id="aroundWorldProgressBar" style="
                    width: 0%;
                    height: 20px;
                    background: linear-gradient(45deg, #667eea 0%, #764ba2 100%);
                    transition: width 0.3s ease;
                    border-radius: 10px;
                "></div>
            </div>
            <div id="aroundWorldStatus" style="font-size: 14px; color: #ccc;">
                Preparing camera path...
            </div>
            <div id="aroundWorldActions" style="margin-top: 10px;">
                <button id="cancelAroundWorld" style="
                    padding: 8px 16px;
                    background: #d63031;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                ">Cancel</button>
            </div>
        `;
        
        buttonContainer.appendChild(progressContainer);
        
        // Insert AFTER the sphere container, not inside it
        sphereContainer.parentNode.insertBefore(buttonContainer, sphereContainer.nextSibling);
        
        // Setup cancel button
        setTimeout(() => {
            const cancelBtn = document.getElementById('cancelAroundWorld');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    this.cancelExport();
                });
            }
        }, 100);
        
        console.log('🎬 AroundTheWorld UI setup complete');
    }
    
    async startAroundTheWorldExport() {
        if (this.isRecording) {
            console.log('⚠️ Already recording');
            return;
        }
        
        // Validate prerequisites
        if (!this.validatePrerequisites()) {
            return;
        }
        
        console.log('🎬 Starting Around the World export...');
        
        try {
            // Show progress UI
            this.showProgressUI();
            
            // Prepare for recording
            await this.prepareRecording();
            
            // Calculate camera path
            this.calculateCameraPath();
            
            // Start the recording process
            this.startRecording();
            
        } catch (error) {
            console.error('❌ Error starting Around the World export:', error);
            this.showError('Failed to start export: ' + error.message);
            this.hideProgressUI();
        }
    }
    
    validatePrerequisites() {
        // Check if lighting system is ready
        if (!window.landmarkLights) {
            this.showError('Lighting system not found. Please generate a map first.');
            return false;
        }
        
        if (!window.landmarkLights.lightingSequence || window.landmarkLights.lightingSequence.length === 0) {
            this.showError('No lighting sequence found. Please generate a map first.');
            return false;
        }
        
        // Check if sphere mapper is ready
        if (!window.sphereMapper || !window.sphereMapper.instancedLandmarks) {
            this.showError('3D landmarks not found. Please generate a map first.');
            return false;
        }
        
        // Check if audio system is available
        if (!window.audio) {
            this.showError('Audio system not found.');
            return false;
        }
        
        return true;
    }
    
    async prepareRecording() {
        // Store original camera state
        if (window.sphereMapper && window.sphereMapper.camera) {
            this.originalCameraPosition = window.sphereMapper.camera.position.clone();
            this.originalCameraTarget = new THREE.Vector3(0, 0, 0);
        }
        
        // Get actual cycle duration at recording time
        this.actualCycleDuration = window.landmarkLights.cycleDuration;
        this.actualCurrentRhythms = [...(window.audio?.currentRhythms || [1,1,1,1])];
        
        console.log(`🎵 Recording synced to cycle duration: ${this.actualCycleDuration}s`);
        console.log(`🎵 Recording synced to rhythms: [${this.actualCurrentRhythms.join(', ')}]`);
        
        // FIXED: Ensure lighting system uses the same duration
        if (window.landmarkLights) {
            window.landmarkLights.cycleDuration = this.actualCycleDuration;
            console.log('💡 Lighting system synchronized to recording duration');
        }
        
        // Scale up the world for superhero perspective
        this.scaleWorldForRecording();
        
        // Calculate total duration and frames based on ACTUAL cycle duration
        this.totalFrames = Math.ceil(this.actualCycleDuration * this.targetFPS);
        this.recordedFrames = 0;
        
        // Reset frame storage
        this.frames = [];
        
        console.log(`🎬 Prepared recording: ${this.actualCycleDuration}s, ${this.totalFrames} frames at ${this.targetFPS}FPS`);
        console.log(`🌍 World scaled up ${this.globeScale}x for cinematic effect`);
    }
    
    scaleWorldForRecording() {
        // Scale the entire 3D scene but keep it reasonable
        if (window.sphereMapper && window.sphereMapper.scene) {
            const scene = window.sphereMapper.scene;
            const reasonableScale = Math.min(this.globeScale, 10); // Cap at 10x
            scene.scale.setScalar(reasonableScale);
            
            // Update camera far plane for larger world
            const camera = window.sphereMapper.camera;
            camera.far = 1000 * reasonableScale;
            camera.updateProjectionMatrix();
            
            console.log(`🔍 Scaled world by ${reasonableScale}x (capped from ${this.globeScale}x) for perspective`);
        }
    }
    
    restoreWorldScale() {
        // Restore original world scale
        if (window.sphereMapper && window.sphereMapper.scene) {
            const scene = window.sphereMapper.scene;
            scene.scale.setScalar(1.0);
            
            // Restore camera settings
            const camera = window.sphereMapper.camera;
            camera.far = 1000;
            camera.updateProjectionMatrix();
            
            console.log('🔄 Restored original world scale');
        }
    }

    calculateHorizonLookAhead(sequence, currentIndex, cameraPos, tangent) {
        // Look ahead along the horizon, not at the globe center
        const lookAheadDistance = 2.0 * this.globeScale;
        
        if (currentIndex < sequence.length - 1) {
            // Calculate direction to next few landmarks
            let avgDirection = new THREE.Vector3();
            let validPoints = 0;
            
            for (let i = 1; i <= Math.min(3, sequence.length - currentIndex - 1); i++) {
                const nextIndex = currentIndex + i;
                if (nextIndex < sequence.length) {
                    const nextLandmark = sequence[nextIndex].landmark;
                    if (nextLandmark && nextLandmark.position) {
                        // FIXED: Use globe-relative positioning for next camera
                        const nextLandmarkPos = nextLandmark.position.clone(); // Original position
                        const nextSurfaceNormal = nextLandmarkPos.clone().normalize();
                        const nextCameraPos = nextSurfaceNormal.clone()
                            .multiplyScalar((1.0 + this.cameraDistance) * this.globeScale);
                        
                        const direction = nextCameraPos.clone().sub(cameraPos).normalize();
                        avgDirection.add(direction);
                        validPoints++;
                    }
                }
            }
            
            if (validPoints > 0) {
                avgDirection.divideScalar(validPoints).normalize();
                return cameraPos.clone().add(avgDirection.multiplyScalar(lookAheadDistance));
            }
        }
        
        // Fallback: look ahead along tangent direction
        return cameraPos.clone().add(tangent.multiplyScalar(lookAheadDistance));
    }

    calculateCameraPath() {
        const lightingSequence = window.landmarkLights.lightingSequence;
        const cycleDuration = this.actualCycleDuration;
        
        this.cameraPath = [];
        
        console.log(`🎬 Building horizon-level flight path for ${cycleDuration}s duration`);
        
        lightingSequence.forEach((lightInfo, index) => {
            const landmark = lightInfo.landmark;
            const timing = (index / (lightingSequence.length - 1)) * cycleDuration;
            
            if (landmark && landmark.position) {
                // Get landmark position on original globe surface
                const landmarkPos = landmark.position.clone();
                
                // Calculate camera position for horizon-level flight
                // Camera flies AROUND the globe, not above it
                const globeRadius = 1.0;
                const flightRadius = globeRadius + this.cameraDistance; // Slightly outside globe surface
                
                // Position camera on the same "line" as landmark but at flight altitude
                const surfaceNormal = landmarkPos.clone().normalize();
                const cameraPos = surfaceNormal.clone()
                    .multiplyScalar(flightRadius)
                    .multiplyScalar(this.globeScale); // Apply world scaling
                
                // UNDERGROUND FIX: Ensure camera never goes below surface
                const distanceFromCenter = cameraPos.length();
                const minimumDistance = this.globeScale; // Globe surface after scaling
                if (distanceFromCenter < minimumDistance) {
                    console.warn(`Fixed camera position: was ${distanceFromCenter.toFixed(3)}, now ${minimumDistance.toFixed(3)}`);
                    cameraPos.normalize().multiplyScalar(minimumDistance + (this.cameraDistance * this.globeScale));
                }
                
                // Look FORWARD along the horizon, not down at globe
                // Calculate forward direction by looking towards next landmark position
                let forwardDirection;
                
                if (index < lightingSequence.length - 1) {
                    // Look towards next landmark
                    const nextLandmark = lightingSequence[index + 1].landmark;
                    if (nextLandmark && nextLandmark.position) {
                        const nextPos = nextLandmark.position.clone().normalize()
                            .multiplyScalar(flightRadius)
                            .multiplyScalar(this.globeScale);
                        
                        forwardDirection = nextPos.clone().sub(cameraPos).normalize();
                    } else {
                        // Fallback: calculate tangent direction
                        const up = new THREE.Vector3(0, 1, 0);
                        forwardDirection = surfaceNormal.clone().cross(up).normalize();
                    }
                } else {
                    // For last point, use tangent direction
                    const up = new THREE.Vector3(0, 1, 0);
                    forwardDirection = surfaceNormal.clone().cross(up).normalize();
                }
                
                // Look ahead along the horizon
                const lookAheadDistance = 3.0 * this.globeScale;
                const lookAtTarget = cameraPos.clone().add(forwardDirection.multiplyScalar(lookAheadDistance));
                
                this.cameraPath.push({
                    time: timing,
                    position: cameraPos,
                    target: lookAtTarget,
                    landmarkIndex: index,
                    surfaceNormal: surfaceNormal.clone(),
                    forwardDirection: forwardDirection.clone()
                });
            }
        });
        
        // Apply smoothing to prevent jerky turns
        this.smoothHorizonFlight();
        
        console.log(`🎬 Horizon-level flight path created: ${this.cameraPath.length} waypoints`);
        this.updateStatus(`Horizon flight path: ${this.cameraPath.length} waypoints over ${cycleDuration}s`);
    }

    calculateTiltedLookDirection(cameraPos, forwardDirection, surfaceNormal) {
        const globeCenter = new THREE.Vector3(0, 0, 0);
        
        // Direction straight down to globe center
        const downwardDirection = globeCenter.clone().sub(cameraPos).normalize();
        
        // Direction to nearest surface point (more natural than globe center)
        const nearestSurfacePoint = surfaceNormal.clone().multiplyScalar(this.globeScale);
        const toSurfaceDirection = nearestSurfacePoint.clone().sub(cameraPos).normalize();
        
        // Blend forward direction with surface-focused direction
        let blendedDirection = forwardDirection.clone()
            .multiplyScalar(1 - this.downwardTilt)
            .add(toSurfaceDirection.clone().multiplyScalar(this.downwardTilt))
            .normalize();
        
        // Optional: Add surface focus blend for more natural viewing
        if (this.surfaceFocusBlend > 0) {
            blendedDirection = blendedDirection.clone()
                .multiplyScalar(1 - this.surfaceFocusBlend)
                .add(toSurfaceDirection.clone().multiplyScalar(this.surfaceFocusBlend))
                .normalize();
        }
        
        return blendedDirection;
    }

    updateCameraConstants(newConstants = {}) {
        // Update any provided constants
        if (newConstants.globeScale !== undefined) {
            this.globeScale = newConstants.globeScale;
            console.log(`🌍 Updated globeScale to: ${this.globeScale}`);
        }
        
        if (newConstants.cameraDistance !== undefined) {
            this.cameraDistance = newConstants.cameraDistance;
            console.log(`📏 Updated cameraDistance to: ${this.cameraDistance}`);
        }
        
        if (newConstants.cameraHeight !== undefined) {
            this.cameraHeight = newConstants.cameraHeight;
            console.log(`📐 Updated cameraHeight to: ${this.cameraHeight}`);
        }
        
        if (newConstants.lookAheadDistance !== undefined) {
            this.lookAheadDistance = newConstants.lookAheadDistance;
            console.log(`👀 Updated lookAheadDistance to: ${this.lookAheadDistance}`);
        }
        
        if (newConstants.smoothingFactor !== undefined) {
            this.smoothingFactor = newConstants.smoothingFactor;
            console.log(`🎚️ Updated smoothingFactor to: ${this.smoothingFactor}`);
        }
        
        // Clear cached camera path to force regeneration
        this.cameraPath = [];
        console.log('🗑️ Cleared cached camera path - will regenerate on next recording');
        
        // If a recording is in progress, regenerate the path immediately
        if (this.isRecording) {
            console.log('🔄 Regenerating camera path during active recording...');
            this.calculateCameraPath();
        }
    }

    setupCameraControls() {
        const sphereContainer = document.getElementById('sphereContainer');
        if (!sphereContainer) return;
        
        // Create camera controls panel
        const controlsPanel = document.createElement('div');
        controlsPanel.id = 'cameraControlsPanel';
        controlsPanel.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            padding: 15px;
            border-radius: 8px;
            color: white;
            font-size: 12px;
            min-width: 200px;
            z-index: 1000;
            display: none;
        `;
        
        controlsPanel.innerHTML = `
            <h4 style="margin: 0 0 10px 0; color: #00ff00;">Camera Controls</h4>
            <div style="margin-bottom: 8px;">
                <label>Globe Scale:</label>
                <input type="range" id="globeScaleSlider" min="10" max="100" value="${this.globeScale}" step="5" style="width: 100%;">
                <span id="globeScaleValue">${this.globeScale}</span>
            </div>
            <div style="margin-bottom: 8px;">
                <label>Camera Distance:</label>
                <input type="range" id="cameraDistanceSlider" min="0.01" max="0.5" value="${this.cameraDistance}" step="0.01" style="width: 100%;">
                <span id="cameraDistanceValue">${this.cameraDistance}</span>
            </div>
            <div style="margin-bottom: 8px;">
                <label>Camera Height:</label>
                <input type="range" id="cameraHeightSlider" min="0" max="0.3" value="${this.cameraHeight}" step="0.01" style="width: 100%;">
                <span id="cameraHeightValue">${this.cameraHeight}</span>
            </div>
            <div style="margin-bottom: 8px;">
                <label>Look Ahead:</label>
                <input type="range" id="lookAheadSlider" min="0.1" max="1.0" value="${this.lookAheadDistance}" step="0.05" style="width: 100%;">
                <span id="lookAheadValue">${this.lookAheadDistance}</span>
            </div>
            <button id="applyCameraSettings" style="width: 100%; padding: 5px; margin-top: 10px; background: #00ff00; color: black; border: none; border-radius: 3px; cursor: pointer;">Apply Changes</button>
            <button id="debugCameraBtn" style="width: 100%; padding: 5px; margin-top: 5px; background: #666; color: white; border: none; border-radius: 3px; cursor: pointer;">Debug Constants</button>
        `;
        
        sphereContainer.appendChild(controlsPanel);
        
        // Add toggle button to existing Around the World button
        const aroundWorldBtn = document.getElementById('aroundWorldBtn');
        if (aroundWorldBtn) {
            const toggleBtn = document.createElement('button');
            toggleBtn.innerHTML = '⚙️';
            toggleBtn.style.cssText = `
                margin-left: 5px;
                padding: 5px 8px;
                background: #333;
                color: white;
                border: none;
                border-radius: 3px;
                cursor: pointer;
                font-size: 12px;
            `;
            
            toggleBtn.addEventListener('click', () => {
                const panel = document.getElementById('cameraControlsPanel');
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            });
            
            aroundWorldBtn.parentNode.insertBefore(toggleBtn, aroundWorldBtn.nextSibling);
        }
        
        // Add event listeners for real-time updates
        ['globeScale', 'cameraDistance', 'cameraHeight', 'lookAhead'].forEach(param => {
            const slider = document.getElementById(param + 'Slider');
            const valueSpan = document.getElementById(param + 'Value');
            
            if (slider && valueSpan) {
                slider.addEventListener('input', (e) => {
                    const value = parseFloat(e.target.value);
                    valueSpan.textContent = value;
                    
                    // Update the constant immediately for preview
                    if (param === 'globeScale') this.globeScale = value;
                    else if (param === 'cameraDistance') this.cameraDistance = value;
                    else if (param === 'cameraHeight') this.cameraHeight = value;
                    else if (param === 'lookAhead') this.lookAheadDistance = value;
                });
            }
        });
        
        // Apply button event listener
        document.getElementById('applyCameraSettings')?.addEventListener('click', () => {
            this.updateCameraConstants(); // This will regenerate the camera path
            console.log('🎬 Camera settings applied - path will regenerate on next recording');
        });
        
        // Debug button event listener
        document.getElementById('debugCameraBtn')?.addEventListener('click', () => {
            this.debugCameraConstants();
        });
    }

    startRecording() {
        if (!window.sphereMapper || !window.sphereMapper.camera) {
            this.showError('Camera not available');
            return;
        }
        
        this.isRecording = true;
        this.recordingStartTime = performance.now();
        this.lastFrameTime = 0;
        this.currentLandmarkIndex = 0;
        
        console.log('🎬 Recording started');
        this.updateStatus('Recording in progress...');
        
        // Start lighting sequence immediately and synchronously
        window.landmarkLights.isPlaybackMode = true;
        window.landmarkLights.switchToPlaybackMode();
        window.landmarkLights.currentLightIndex = 0;
        window.landmarkLights.startLightingSequence();
        
        console.log('💡 Lighting sequence started synchronously with recording');

        // Start the recording loop
        this.recordFrame();
    }
    
    recordFrame() {
        if (!this.isRecording) return;
        
        const currentTime = performance.now();
        const elapsed = (currentTime - this.recordingStartTime) / 1000; // Convert to seconds
        
        // Check if we should record this frame
        if (currentTime - this.lastFrameTime >= this.frameInterval) {
            // Update camera position based on current time
            this.updateCameraPosition(elapsed);
            
            // Capture frame
            this.captureFrame(elapsed);
            
            this.lastFrameTime = currentTime;
            this.recordedFrames++;
            
            // Update progress
            const progress = (this.recordedFrames / this.totalFrames) * 100;
            this.updateProgress(progress);
        }
        
        // FIXED: Check completion against ACTUAL cycle duration
        if (elapsed >= this.actualCycleDuration) {
            this.completeRecording();
        } else {
            requestAnimationFrame(() => this.recordFrame());
        }
    }
    
    updateCameraPosition(elapsed) {
        if (!window.sphereMapper || !window.sphereMapper.camera) return;
        
        const camera = window.sphereMapper.camera;
        
        // Find current camera path segment
        const pathSegment = this.findCameraPathSegment(elapsed);
        if (!pathSegment) return;
        
        const { position, target } = pathSegment;
        
        // Set camera position (flying around the globe at horizon level)
        camera.position.copy(position);
        
        // CRITICAL FIX: Set "up" vector to point away from globe center
        // This ensures the camera never goes upside down - like airplane flight
        const globeCenter = new THREE.Vector3(0, 0, 0);
        const upVector = position.clone().sub(globeCenter).normalize();
        
        // Set the up vector BEFORE calling lookAt
        camera.up.copy(upVector);
        
        // Look forward along the horizon
        camera.lookAt(target);
        
        // Trigger render
        if (window.sphereMapper.triggerRender) {
            window.sphereMapper.triggerRender();
        } else {
            window.sphereMapper.renderDirty = true;
        }
    }
    
    findCameraPathSegment(elapsed) {
        if (this.cameraPath.length === 0) {
            console.warn('No camera path available');
            return null;
        }
        
        // Handle edge cases
        if (elapsed <= this.cameraPath[0].time) {
            return this.cameraPath[0];
        }
        
        if (elapsed >= this.cameraPath[this.cameraPath.length - 1].time) {
            return this.cameraPath[this.cameraPath.length - 1];
        }
        
        // Find the appropriate camera position for current time
        for (let i = 0; i < this.cameraPath.length - 1; i++) {
            const current = this.cameraPath[i];
            const next = this.cameraPath[i + 1];
            
            if (elapsed >= current.time && elapsed <= next.time) {
                // Simple linear interpolation between current and next
                const t = (elapsed - current.time) / (next.time - current.time);
                
                // UNDERGROUND FIX: Ensure interpolated position stays above surface
                const interpolatedPos = current.position.clone().lerp(next.position, t);
                const distanceFromCenter = interpolatedPos.length();
                const minimumDistance = this.globeScale;
                
                if (distanceFromCenter < minimumDistance) {
                    // Project back to safe distance
                    interpolatedPos.normalize().multiplyScalar(minimumDistance + (this.cameraDistance * this.globeScale));
                }
                
                return {
                    position: interpolatedPos,
                    target: current.target.clone().lerp(next.target, t)
                };
            }
        }
        
        // Fallback to last position
        console.warn(`Camera path segment not found for elapsed=${elapsed}, using last position`);
        return this.cameraPath[this.cameraPath.length - 1];
    }

    calculateCameraPath() {
        const lightingSequence = window.landmarkLights.lightingSequence;
        const cycleDuration = this.actualCycleDuration;
        
        this.cameraPath = [];
        
        console.log(`🎬 Building horizon-level flight path for ${cycleDuration}s duration`);
        
        lightingSequence.forEach((lightInfo, index) => {
            const landmark = lightInfo.landmark;
            const timing = (index / (lightingSequence.length - 1)) * cycleDuration;
            
            if (landmark && landmark.position) {
                // Get landmark position on original globe surface
                const landmarkPos = landmark.position.clone();
                
                // Calculate camera position for horizon-level flight
                // Camera flies AROUND the globe, not above it
                const globeRadius = 1.0;
                const flightRadius = globeRadius + this.cameraDistance; // Slightly outside globe surface
                
                // Position camera on the same "line" as landmark but at flight altitude
                const surfaceNormal = landmarkPos.clone().normalize();
                const cameraPos = surfaceNormal.clone()
                    .multiplyScalar(flightRadius)
                    .multiplyScalar(this.globeScale); // Apply world scaling
                
                // UNDERGROUND FIX: Ensure camera never goes below surface
                const distanceFromCenter = cameraPos.length();
                const minimumDistance = this.globeScale; // Globe surface after scaling
                if (distanceFromCenter < minimumDistance) {
                    console.warn(`Fixed camera position: was ${distanceFromCenter.toFixed(3)}, now ${minimumDistance.toFixed(3)}`);
                    cameraPos.normalize().multiplyScalar(minimumDistance + (this.cameraDistance * this.globeScale));
                }
                
                // Look FORWARD along the horizon, not down at globe
                // Calculate forward direction by looking towards next landmark position
                let forwardDirection;
                
                if (index < lightingSequence.length - 1) {
                    // Look towards next landmark
                    const nextLandmark = lightingSequence[index + 1].landmark;
                    if (nextLandmark && nextLandmark.position) {
                        const nextPos = nextLandmark.position.clone().normalize()
                            .multiplyScalar(flightRadius)
                            .multiplyScalar(this.globeScale);
                        
                        forwardDirection = nextPos.clone().sub(cameraPos).normalize();
                    } else {
                        // Fallback: calculate tangent direction
                        const up = new THREE.Vector3(0, 1, 0);
                        forwardDirection = surfaceNormal.clone().cross(up).normalize();
                    }
                } else {
                    // For last point, use tangent direction
                    const up = new THREE.Vector3(0, 1, 0);
                    forwardDirection = surfaceNormal.clone().cross(up).normalize();
                }
                
                // Look ahead along the horizon
                const lookAheadDistance = 3.0 * this.globeScale;
                const lookAtTarget = cameraPos.clone().add(forwardDirection.multiplyScalar(lookAheadDistance));
                
                this.cameraPath.push({
                    time: timing,
                    position: cameraPos,
                    target: lookAtTarget,
                    landmarkIndex: index,
                    surfaceNormal: surfaceNormal.clone(),
                    forwardDirection: forwardDirection.clone()
                });
            }
        });
        
        // Apply smoothing to prevent jerky turns
        this.smoothHorizonFlight();
        
        console.log(`🎬 Horizon-level flight path created: ${this.cameraPath.length} waypoints`);
        this.updateStatus(`Horizon flight path: ${this.cameraPath.length} waypoints over ${cycleDuration}s`);
    }

    smoothHorizonFlight() {
        if (this.cameraPath.length < 3) return;
        
        const globeRadius = 1.0;
        const flightRadius = (globeRadius + this.cameraDistance) * this.globeScale;
        
        // Smooth the flight path while maintaining horizon-level flight
        for (let i = 1; i < this.cameraPath.length - 1; i++) {
            const prev = this.cameraPath[i - 1];
            const current = this.cameraPath[i];
            const next = this.cameraPath[i + 1];
            
            // Smooth position using weighted average
            let smoothedPos = new THREE.Vector3()
                .addScaledVector(prev.position, 0.25)
                .addScaledVector(current.position, 0.5)
                .addScaledVector(next.position, 0.25);
            
            // UNDERGROUND FIX: Project back to correct flight radius
            smoothedPos.normalize().multiplyScalar(flightRadius);
            
            // Smooth the forward direction to prevent jerky turns
            let smoothedForward = new THREE.Vector3()
                .addScaledVector(prev.forwardDirection, 0.25)
                .addScaledVector(current.forwardDirection, 0.5)
                .addScaledVector(next.forwardDirection, 0.25)
                .normalize();
            
            // Calculate smooth look-at target
            const lookAheadDistance = 3.0 * this.globeScale;
            const smoothedTarget = smoothedPos.clone().add(smoothedForward.multiplyScalar(lookAheadDistance));
            
            this.cameraPath[i].position = smoothedPos;
            this.cameraPath[i].target = smoothedTarget;
            this.cameraPath[i].forwardDirection = smoothedForward;
        }
        
        console.log('✨ Horizon flight path smoothed for continuous circumnavigation');
    }


    captureFrame(elapsed) {
        if (!window.sphereMapper || !window.sphereMapper.renderer) {
            console.warn('No renderer available for frame capture');
            return;
        }
        
        // Capture the actual canvas frame
        const canvas = window.sphereMapper.renderer.domElement;
        
        try {
            const frameData = canvas.toDataURL('image/png');
            
            this.frames.push({
                time: elapsed,
                frameData: frameData,
                frameIndex: this.recordedFrames,
                cameraPosition: window.sphereMapper.camera.position.clone(),
                cameraTarget: new THREE.Vector3()
            });            
        } catch (error) {
            console.error('Frame capture error:', error);
            // Store frame without data as fallback
            this.frames.push({
                time: elapsed,
                frameData: null,
                frameIndex: this.recordedFrames,
                cameraPosition: window.sphereMapper.camera.position.clone(),
                cameraTarget: new THREE.Vector3()
            });
        }
    }
    
    completeRecording() {
        console.log('🎬 Recording complete!');
        
        this.isRecording = false;
        window.landmarkLights.isPlaybackMode = false;
        window.landmarkLights.stopLightingSequence();
        
        // Restore original camera position
        this.restoreCamera();
        
        // Update UI to show completion
        this.updateProgress(100);
        this.updateStatus('🎬 Recording complete! Video ready for download.');
        
        // Show summary
        console.log('🎬 RECORDING SUMMARY:');
        console.log(`   Frames captured: ${this.frames.length}`);
        console.log(`   Duration: ${window.landmarkLights.cycleDuration}s`);
        console.log(`   FPS: ${this.targetFPS}`);
        
        // Show download buttons
        this.showDownloadButton();
    }

    setupDownloadButtons(baseFilename) {
        const videoBtn = document.getElementById('downloadVideo');
        const dataBtn = document.getElementById('downloadFrames');
        
        if (videoBtn) {
            videoBtn.addEventListener('click', async () => {
                videoBtn.textContent = '⏳ Generating Video...';
                videoBtn.disabled = true;
                
                try {
                    console.log('Creating video from', this.frames.length, 'frames');
                    const videoBlob = await this.createVideoFromFrames();
                    
                    if (videoBlob) {
                        this.downloadVideo(videoBlob, `${baseFilename}.webm`);
                        videoBtn.textContent = '✅ Video Downloaded!';
                    } else {
                        throw new Error('Video generation failed');
                    }
                } catch (error) {
                    console.error('Video generation error:', error);
                    videoBtn.textContent = '❌ Video Failed';
                }
                
                setTimeout(() => {
                    videoBtn.textContent = '📹 Download Video';
                    videoBtn.disabled = false;
                }, 3000);
            });
        }
        
        if (dataBtn) {
            dataBtn.addEventListener('click', () => {
                const rhythms = window.audio?.currentRhythms || [1,1,1,1];
                const exportData = {
                    metadata: {
                        duration: window.landmarkLights.cycleDuration,
                        fps: this.targetFPS,
                        totalFrames: this.frames.length,
                        rhythms: rhythms,
                        timestamp: new Date().toISOString()
                    },
                    frames: this.frames.map((frame, i) => ({
                        index: i,
                        time: frame.time,
                        hasData: !!frame.frameData
                    }))
                };
                
                const dataStr = JSON.stringify(exportData, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json' });
                this.downloadVideo(blob, `${baseFilename}_data.json`);
                
                dataBtn.textContent = '✅ Downloaded!';
                setTimeout(() => {
                    dataBtn.textContent = '📦 Download Data';
                }, 2000);
            });
        }
    }

    reset() {
        // Force stop any active recording first
        if (this.isRecording) {
            this.forceStop();
            return; // forceStop already does the cleanup
        }
        
        // Clear any recorded data
        this.frames = [];
        this.cameraPath = [];
        this.recordedFrames = 0;
        this.totalFrames = 0;
        this.isRecording = false;
        
        // Clear stored timing data
        this.actualCycleDuration = null;
        this.actualCurrentRhythms = null;
        
        // Reset UI to initial state
        const aroundWorldBtn = document.getElementById('aroundWorldBtn');
        const aroundWorldProgress = document.getElementById('aroundWorldProgress');
        
        if (aroundWorldBtn) {
            aroundWorldBtn.style.display = 'block';
        }
        
        if (aroundWorldProgress) {
            aroundWorldProgress.style.display = 'none';
        }
        
        console.log('🔄 AroundTheWorld system reset');
    }

    forceStop() {
        console.log('🛑 Force stopping AroundTheWorld recording...');
        
        // Stop recording immediately
        this.isRecording = false;
        
        // Stop lighting system
        if (window.landmarkLights) {
            window.landmarkLights.isPlaybackMode = false;
            window.landmarkLights.stopLightingSequence();
        }
        
        // Restore camera and world scale
        this.restoreCamera();
        
        // Clear any pending animation frames or timeouts
        if (this.recordingAnimationFrame) {
            cancelAnimationFrame(this.recordingAnimationFrame);
            this.recordingAnimationFrame = null;
        }
        
        // Reset UI
        this.hideProgressUI();
        
        // Reset state
        this.frames = [];
        this.cameraPath = [];
        this.recordedFrames = 0;
        
        console.log('✅ AroundTheWorld force stopped and cleaned up');
    }

    debugTiming() {
        console.log('🔍 AroundTheWorld Timing Debug:');
        console.log('  actualCycleDuration:', this.actualCycleDuration);
        console.log('  totalFrames:', this.totalFrames);
        console.log('  cameraPath length:', this.cameraPath.length);
        
        if (this.cameraPath.length > 0) {
            console.log('  First path point:', this.cameraPath[0].time);
            console.log('  Last path point:', this.cameraPath[this.cameraPath.length - 1].time);
            console.log('  Path spans:', this.cameraPath[this.cameraPath.length - 1].time - this.cameraPath[0].time);
        }
        
        // Test a few time points
        const testTimes = [0, this.actualCycleDuration * 0.25, this.actualCycleDuration * 0.5, this.actualCycleDuration * 0.75, this.actualCycleDuration];
        testTimes.forEach(time => {
            const segment = this.findCameraPathSegment(time);
            console.log(`  Time ${time.toFixed(2)}s -> segment found:`, !!segment);
        });
    }

    showDownloadButton() {
        // Update the actions area to show download options
        const actionsDiv = document.getElementById('aroundWorldActions');
        if (!actionsDiv) {
            console.error('❌ aroundWorldActions div not found');
            return;
        }
        
        const rhythms = this.actualCurrentRhythms || window.audio?.currentRhythms || [1,1,1,1];
        const baseFilename = `ATW_${rhythms[0]}-${rhythms[1]}-${rhythms[2]}-${rhythms[3]}`;
        
        actionsDiv.innerHTML = `
            <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;">
                <button id="downloadVideo" style="
                    padding: 12px 20px;
                    background: linear-gradient(45deg, #00b894 0%, #00cec9 100%);
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 14px;
                ">📹 Download Video</button>
                <button id="downloadFrames" style="
                    padding: 12px 20px;
                    background: linear-gradient(45deg, #a29bfe 0%, #6c5ce7 100%);
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: 14px;
                ">📦 Download Data</button>
            </div>
            <div style="margin-top: 10px; font-size: 12px; color: #999; text-align: center;">
                Filename: ${baseFilename}.[format] (${this.frames.length} frames captured)
            </div>
        `;
        
        // Setup download button event listeners
        setTimeout(() => {
            this.setupDownloadButtons(baseFilename);
        }, 100);
        
        console.log('✅ Download options ready');
    }
    
    async createVideoFromFrames() {
        return new Promise((resolve) => {
            try {
                if (this.frames.length === 0 || !this.frames[0].frameData) {
                    console.error('No valid frame data for video creation');
                    resolve(null);
                    return;
                }
                
                // Create a temporary canvas for video encoding
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                const firstFrame = new Image();
                firstFrame.onload = () => {
                    canvas.width = firstFrame.width;
                    canvas.height = firstFrame.height;
                    
                    try {
                        // Create MediaRecorder stream
                        const stream = canvas.captureStream(this.targetFPS);
                        const mediaRecorder = new MediaRecorder(stream, {
                            mimeType: 'video/webm;codecs=vp8'
                        });
                        
                        const chunks = [];
                        mediaRecorder.ondataavailable = (event) => {
                            if (event.data.size > 0) {
                                chunks.push(event.data);
                            }
                        };
                        
                        mediaRecorder.onstop = () => {
                            const blob = new Blob(chunks, { type: 'video/webm' });
                            resolve(blob);
                        };
                        
                        mediaRecorder.onerror = (error) => {
                            console.error('MediaRecorder error:', error);
                            resolve(null);
                        };
                        
                        // Start recording
                        mediaRecorder.start();
                        
                        // Play frames at correct framerate
                        let frameIndex = 0;
                        const frameInterval = 1000 / this.targetFPS;
                        
                        const playFrame = () => {
                            if (frameIndex >= this.frames.length) {
                                setTimeout(() => mediaRecorder.stop(), 500);
                                return;
                            }
                            
                            const frame = this.frames[frameIndex];
                            if (frame.frameData) {
                                const img = new Image();
                                img.onload = () => {
                                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                                    ctx.drawImage(img, 0, 0);
                                    frameIndex++;
                                    
                                    if (frameIndex < this.frames.length) {
                                        setTimeout(playFrame, frameInterval);
                                    } else {
                                        setTimeout(() => mediaRecorder.stop(), 500);
                                    }
                                };
                                img.onerror = () => {
                                    frameIndex++;
                                    setTimeout(playFrame, frameInterval);
                                };
                                img.src = frame.frameData;
                            } else {
                                frameIndex++;
                                setTimeout(playFrame, frameInterval);
                            }
                        };
                        
                        playFrame();
                        
                    } catch (error) {
                        console.error('MediaRecorder setup error:', error);
                        resolve(null);
                    }
                };
                
                firstFrame.onerror = () => {
                    console.error('First frame load error');
                    resolve(null);
                };
                
                firstFrame.src = this.frames[0].frameData;
                
            } catch (error) {
                console.error('Video creation error:', error);
                resolve(null);
            }
        });
    }

    downloadVideo(blob, filename) {
        try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Clean up the URL after a delay
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            
            console.log(`📥 Download triggered: ${filename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
            return true;
        } catch (error) {
            console.error('Download failed:', error);
            return false;
        }
    }

    restoreCamera() {
        if (this.originalCameraPosition && window.sphereMapper && window.sphereMapper.camera) {
            // Restore world scale first
            this.restoreWorldScale();
            
            // Then restore camera position
            window.sphereMapper.camera.position.copy(this.originalCameraPosition);
            window.sphereMapper.camera.lookAt(0, 0, 0);
            window.sphereMapper.renderDirty = true;
            console.log('📷 Camera and world scale restored to original state');
        }
    }
    
    cancelExport() {
        if (this.isRecording) {
            this.isRecording = false;
            window.landmarkLights.isPlaybackMode = false;
            window.landmarkLights.stopLightingSequence();
            this.restoreCamera();
            console.log('❌ Recording cancelled');
        }
        this.hideProgressUI();
    }
    
    // UI Update Methods
    showProgressUI() {
        document.getElementById('aroundWorldBtn').style.display = 'none';
        document.getElementById('aroundWorldProgress').style.display = 'flex';
    }
    
    hideProgressUI() {
        // Don't auto-hide anymore - let user manually close after download
        // document.getElementById('aroundWorldBtn').style.display = 'block';
        // document.getElementById('aroundWorldProgress').style.display = 'none';
        
        // Add a close button instead
        const actionsDiv = document.getElementById('aroundWorldActions');
        if (actionsDiv && !document.getElementById('closeAroundWorld')) {
            const closeBtn = document.createElement('button');
            closeBtn.id = 'closeAroundWorld';
            closeBtn.innerHTML = '✕ Close';
            closeBtn.style.cssText = `
                padding: 8px 16px;
                background: #636e72;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                margin-top: 10px;
                font-size: 12px;
            `;
            
            closeBtn.addEventListener('click', () => {
                document.getElementById('aroundWorldBtn').style.display = 'block';
                document.getElementById('aroundWorldProgress').style.display = 'none';
            });
            
            actionsDiv.appendChild(closeBtn);
        }
    }
    
    updateProgress(percentage) {
        const progressBar = document.getElementById('aroundWorldProgressBar');
        if (progressBar) {
            progressBar.style.width = `${Math.min(percentage, 100)}%`;
        }
    }
    
    updateStatus(message) {
        const status = document.getElementById('aroundWorldStatus');
        if (status) {
            status.textContent = message;
        }
    }

    debugCameraConstants() {
        console.log('🔍 Camera Constants Debug:');
        console.log(`  globeScale: ${this.globeScale}`);
        console.log(`  cameraDistance: ${this.cameraDistance}`);
        console.log(`  cameraHeight: ${this.cameraHeight}`);
        console.log(`  lookAheadDistance: ${this.lookAheadDistance}`);
        console.log(`  smoothingFactor: ${this.smoothingFactor}`);
        console.log(`  targetFPS: ${this.targetFPS}`);
        console.log(`  Camera path length: ${this.cameraPath.length}`);
        
        if (this.cameraPath.length > 0) {
            const firstPos = this.cameraPath[0].position;
            const lastPos = this.cameraPath[this.cameraPath.length - 1].position;
            console.log(`  First camera position: (${firstPos.x.toFixed(2)}, ${firstPos.y.toFixed(2)}, ${firstPos.z.toFixed(2)})`);
            console.log(`  Last camera position: (${lastPos.x.toFixed(2)}, ${lastPos.y.toFixed(2)}, ${lastPos.z.toFixed(2)})`);
            console.log(`  Flight radius (calculated): ${firstPos.length().toFixed(3)}`);
        }
    }

    updateDownwardTilt(newTilt) {
        this.downwardTilt = Math.max(0, Math.min(1, newTilt)); // Clamp 0-1
        console.log(`📐 Updated downward tilt to: ${this.downwardTilt}`);
        
        // Clear path to force regeneration
        this.cameraPath = [];
        console.log('🗑️ Camera path cleared - will regenerate on next recording');
    }
    
    showError(message) {
        alert(`Around the World Export Error:\n${message}`);
    }
}

// Global initialization
let aroundTheWorldSystem = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for other systems to initialize
    setTimeout(() => {
        aroundTheWorldSystem = new AroundTheWorld();
        window.aroundTheWorld = aroundTheWorldSystem;
        console.log('🌍 AroundTheWorld system ready');
    }, 1000);
});