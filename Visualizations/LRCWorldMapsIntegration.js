// LRCWorldMapsIntegration.js - WorldMaps Integration for LRC Interface
// Adapts the standalone WorldMaps system to work within the main LRC interface

class LRCWorldMapsWrapper {
    constructor(lrcVisuals) {
        this.parent = lrcVisuals;
        this.container = null;
        this.worldMapsInstance = null;
        this.landmarkLights = null;
        this.aroundTheWorld = null;
        
        // Animation state
        this.isAnimating = false;
        this.cycleDuration = 10000; // ms
        this.currentBeatIndex = 0;
        
        // Data
        this.spacesPlot = [];
        this.rhythms = [1, 1, 1, 1];
        this.ratios = [];
        this.grid = 1;
        
        console.log('🌍 WorldMaps wrapper initialized');
    }

    // ====================================
    // SETUP AND CONTAINER MANAGEMENT
    // ====================================

    initializeContainer() {
        if (this.container) return this.container;
        
        // Create container for WorldMaps 3D canvas
        this.container = document.createElement('div');
        this.container.id = 'worldmaps-visualization-container';
        this.container.style.cssText = `
            position: relative;
            width: 100%;
            height: 100%;
            background: #000;
            overflow: hidden;
        `;
        
        // Create the canvas for Three.js
        const canvas = document.createElement('canvas');
        canvas.id = 'worldmaps-threejs-canvas';
        canvas.style.cssText = `
            width: 100%;
            height: 100%;
            display: block;
        `;
        
        this.container.appendChild(canvas);
        
        // Add WorldMaps-specific controls overlay
        this.addWorldMapsControls();
        
        return this.container;
    }

    addWorldMapsControls() {
        const controlsOverlay = document.createElement('div');
        controlsOverlay.innerHTML = `
            <div class="worldmaps-controls-overlay" style="
                position: absolute;
                top: 10px;
                right: 10px;
                background: rgba(0, 0, 0, 0.8);
                border: 1px solid #444;
                border-radius: 6px;
                padding: 8px;
                color: #00ff88;
                font-family: monospace;
                font-size: 10px;
                z-index: 1000;
                min-width: 180px;
            ">
                <div style="font-weight: bold; margin-bottom: 6px; font-size: 11px;">🌍 WorldMaps Controls</div>
                
                <div style="margin: 4px 0;">
                    <label style="display: inline-block; width: 80px;">Landmarks:</label>
                    <input type="checkbox" id="worldmaps-show-landmarks" checked>
                </div>
                
                <div style="margin: 4px 0;">
                    <label style="display: inline-block; width: 80px;">Terrain:</label>
                    <input type="checkbox" id="worldmaps-show-terrain" checked>
                </div>
                
                <div style="margin: 4px 0;">
                    <label style="display: inline-block; width: 80px;">Lights:</label>
                    <input type="checkbox" id="worldmaps-show-lights" checked>
                </div>
                
                <div style="margin: 6px 0 4px 0; font-size: 9px; color: #888;">
                    WASD: Fly • Arrows: Rotate • Scroll: Zoom • Shift: Reset
                </div>
            </div>
        `;
        
        this.container.appendChild(controlsOverlay);
        this.setupControlEventListeners();
    }

    setupControlEventListeners() {
        // Wait for next tick to ensure elements are in DOM
        setTimeout(() => {
            const landmarksCheck = document.getElementById('worldmaps-show-landmarks');
            const terrainCheck = document.getElementById('worldmaps-show-terrain');
            const lightsCheck = document.getElementById('worldmaps-show-lights');
            
            if (landmarksCheck) {
                landmarksCheck.addEventListener('change', (e) => {
                    if (this.worldMapsInstance && this.worldMapsInstance.toggleLandmarks) {
                        this.worldMapsInstance.toggleLandmarks(e.target.checked);
                    }
                });
            }
            
            if (terrainCheck) {
                terrainCheck.addEventListener('change', (e) => {
                    if (this.worldMapsInstance && this.worldMapsInstance.toggleTerrain) {
                        this.worldMapsInstance.toggleTerrain(e.target.checked);
                    }
                });
            }
            
            if (lightsCheck) {
                lightsCheck.addEventListener('change', (e) => {
                    if (this.landmarkLights) {
                        this.landmarkLights.enabled = e.target.checked;
                    }
                });
            }
        }, 100);
    }

    // ====================================
    // WORLDMAPS INITIALIZATION
    // ====================================

    async initializeWorldMaps() {
        if (!this.container) {
            console.error('🌍 Container not initialized');
            return false;
        }
        
        try {
            // Initialize the main WorldMaps system without audio
            this.worldMapsInstance = new window.WorldMapsSphereMapper();
            
            // Initialize the lighting system
            if (window.LandmarkLights) {
                this.landmarkLights = new window.LandmarkLights();
            }
            
            // Initialize the animation system
            if (window.AroundTheWorld) {
                this.aroundTheWorld = new window.AroundTheWorld();
            }
            
            console.log('🌍 WorldMaps systems initialized without audio');
            return true;
            
        } catch (error) {
            console.error('🌍 Failed to initialize WorldMaps:', error);
            return false;
        }
    }

    // ====================================
    // DATA UPDATES AND VISUALIZATION
    // ====================================

    updateData(spacesPlot, rhythms, grid, ratios) {
        this.spacesPlot = spacesPlot || [];
        this.rhythms = rhythms || [1, 1, 1, 1];
        this.grid = grid || 1;
        this.ratios = ratios || [];
        
        if (this.worldMapsInstance) {
            // Generate the world map based on current data
            this.generateWorldMap();
        }
        
        console.log('🌍 WorldMaps data updated:', {
            spacesLength: this.spacesPlot.length,
            rhythms: this.rhythms,
            grid: this.grid,
            ratiosCount: this.ratios.length
        });
    }

    generateWorldMap() {
        if (!this.worldMapsInstance || this.spacesPlot.length === 0) return;
        
        try {
            // Clear existing mapping
            this.worldMapsInstance.clearMapping();
            
            // Generate new mapping using current data
            this.worldMapsInstance.updateMapping(this.spacesPlot, this.ratios);
            
            // Reset animation system
            if (this.aroundTheWorld) {
                this.aroundTheWorld.reset();
            }
            
            console.log('🌍 World map generated with', this.spacesPlot.length, 'spaces');
            
        } catch (error) {
            console.error('🌍 Error generating world map:', error);
        }
    }

    // ====================================
    // DRAWING AND ANIMATION
    // ====================================

    draw() {
        if (!this.container || !this.worldMapsInstance) return;
        
        try {
            // Render the 3D scene
            this.worldMapsInstance.render();
            
        } catch (error) {
            console.error('🌍 Error drawing WorldMaps:', error);
        }
    }

    startAnimation() {
        if (this.isAnimating) return;
        
        this.isAnimating = true;
        this.currentBeatIndex = 0;
        
        if (this.landmarkLights) {
            this.landmarkLights.startAnimation(this.cycleDuration);
        }
        
        if (this.aroundTheWorld) {
            this.aroundTheWorld.start();
        }
        
        console.log('🌍 WorldMaps animation started with cycle duration:', this.cycleDuration);
    }

    stopAnimation() {
        this.isAnimating = false;
        
        if (this.landmarkLights) {
            this.landmarkLights.stopAnimation();
        }
        
        if (this.aroundTheWorld) {
            this.aroundTheWorld.stop();
        }
        
        console.log('🌍 WorldMaps animation stopped');
    }

    setCycleDuration(duration) {
        this.cycleDuration = duration * 1000; // Convert to ms
        
        if (this.landmarkLights) {
            this.landmarkLights.setCycleDuration(this.cycleDuration);
        }
        
        console.log('🌍 WorldMaps cycle duration set to:', duration, 'seconds');
    }

    // ====================================
    // PLAYBACK SYNCHRONIZATION
    // ====================================

    onBeatIndex(beatIndex, totalBeats) {
        this.currentBeatIndex = beatIndex;
        
        // Light up corresponding landmarks
        if (this.landmarkLights && this.spacesPlot.length > 0) {
            const normalizedIndex = Math.floor((beatIndex / totalBeats) * this.spacesPlot.length);
            this.landmarkLights.lightLandmark(normalizedIndex);
        }
    }

    // ====================================
    // CLEANUP
    // ====================================

    dispose() {
        this.stopAnimation();
        
        if (this.worldMapsInstance && this.worldMapsInstance.dispose) {
            this.worldMapsInstance.dispose();
        }
        
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        
        this.worldMapsInstance = null;
        this.landmarkLights = null;
        this.aroundTheWorld = null;
        this.container = null;
        
        console.log('🌍 WorldMaps wrapper disposed');
    }
}

// ====================================
// INTEGRATION WITH LRC VISUALS SYSTEM
// ====================================

function integrateWorldMapsVisualization() {
    if (!window.lrcVisuals) {
        console.error('🌍 LRCVisuals not found for WorldMaps integration');
        return;
    }

    // Create WorldMaps wrapper instance
    const worldMaps = new LRCWorldMapsWrapper(window.lrcVisuals);
    
    // Add to LRCVisuals plot types
    if (!window.lrcVisuals.plotTypes) {
        window.lrcVisuals.plotTypes = {};
    }
    window.lrcVisuals.plotTypes['worldmaps'] = worldMaps;
    
    // Add to dropdown if it exists
    const plotSelect = document.getElementById('plot-type');
    if (plotSelect) {
        const option = document.createElement('option');
        option.value = 'worldmaps';
        option.textContent = 'WorldMaps 3D';
        plotSelect.appendChild(option);
        console.log('🌍 WorldMaps option added to plot selector');
    }
    
    // Extend the main visualization draw method
    const originalDrawPlot = window.lrcVisuals.drawPlot.bind(window.lrcVisuals);
    window.lrcVisuals.drawPlot = function() {
        if (this.currentPlotType === 'worldmaps') {
            this.drawWorldMapsPlot();
        } else {
            originalDrawPlot();
        }
    };
    
    // Add WorldMaps-specific draw method
    window.lrcVisuals.drawWorldMapsPlot = function() {
        const worldMapsViz = this.plotTypes['worldmaps'];
        if (!worldMapsViz) return;
        
        // Initialize container if needed
        if (!worldMapsViz.container) {
            const canvas = document.getElementById('plot-canvas');
            if (canvas && canvas.parentNode) {
                // Hide the 2D canvas and show 3D container
                canvas.style.display = 'none';
                
                const container = worldMapsViz.initializeContainer();
                canvas.parentNode.appendChild(container);
                
                // Initialize WorldMaps after container is ready
                setTimeout(() => {
                    worldMapsViz.initializeWorldMaps().then(success => {
                        if (success) {
                            worldMapsViz.updateData(
                                this.spacesPlot,
                                this.rhythms,
                                window.lrcModule ? window.lrcModule.currentGrid : 1,
                                window.lrcModule ? window.lrcModule.currentRatios : []
                            );
                        }
                    });
                }, 100);
            }
        }
        
        // Update data and draw
        worldMapsViz.updateData(
            this.spacesPlot,
            this.rhythms,
            window.lrcModule ? window.lrcModule.currentGrid : 1,
            window.lrcModule ? window.lrcModule.currentRatios : []
        );
        worldMapsViz.draw();
    };
    
    // Handle plot type switching
    const originalHandlePlotTypeChange = window.lrcVisuals.handlePlotTypeChange?.bind(window.lrcVisuals);
    window.lrcVisuals.handlePlotTypeChange = function(newType) {
        // Hide/show appropriate canvases
        const canvas2D = document.getElementById('plot-canvas');
        const worldMapsContainer = document.getElementById('worldmaps-visualization-container');
        
        if (newType === 'worldmaps') {
            if (canvas2D) canvas2D.style.display = 'none';
            if (worldMapsContainer) worldMapsContainer.style.display = 'block';
        } else {
            if (canvas2D) canvas2D.style.display = 'block';
            if (worldMapsContainer) worldMapsContainer.style.display = 'none';
        }
        
        if (originalHandlePlotTypeChange) {
            originalHandlePlotTypeChange(newType);
        }
        
        this.currentPlotType = newType;
        this.drawPlot();
    };
    
    // Extend animation methods for playback synchronization
    const originalStartAnimation = window.lrcVisuals.startAnimation || function() {};
    window.lrcVisuals.startAnimation = function() {
        if (this.currentPlotType === 'worldmaps' && this.plotTypes['worldmaps']) {
            this.plotTypes['worldmaps'].setCycleDuration(this.cycleDuration / 1000);
            this.plotTypes['worldmaps'].startAnimation();
        } else {
            originalStartAnimation.call(this);
        }
    };
    
    const originalStopAnimation = window.lrcVisuals.stopAnimation || function() {};
    window.lrcVisuals.stopAnimation = function() {
        if (this.plotTypes['worldmaps']) {
            this.plotTypes['worldmaps'].stopAnimation();
        }
        originalStopAnimation.call(this);
    };
    
    // Listen for playback events from ToneRowPlayback
    window.addEventListener('playbackStarted', (e) => {
        if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'worldmaps' && window.lrcVisuals.plotTypes['worldmaps']) {
            console.log('🌍 WorldMaps responding to playbackStarted event');
            const cycleDuration = e.detail?.cycleDuration || 10.0;
            window.lrcVisuals.plotTypes['worldmaps'].setCycleDuration(cycleDuration);
            window.lrcVisuals.plotTypes['worldmaps'].startAnimation();
        }
    });
    
    window.addEventListener('playbackStopped', () => {
        if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'worldmaps' && window.lrcVisuals.plotTypes['worldmaps']) {
            console.log('🌍 WorldMaps responding to playbackStopped event');
            window.lrcVisuals.plotTypes['worldmaps'].stopAnimation();
        }
    });
    
    window.addEventListener('tempoChanged', (e) => {
        if (window.lrcVisuals && window.lrcVisuals.plotTypes['worldmaps']) {
            const cycleDuration = e.detail?.cycleDuration || 10.0;
            window.lrcVisuals.plotTypes['worldmaps'].setCycleDuration(cycleDuration);
        }
    });
    
    // Listen for beat events for landmark lighting
    window.addEventListener('beatIndex', (e) => {
        if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'worldmaps' && window.lrcVisuals.plotTypes['worldmaps']) {
            const { beatIndex, totalBeats } = e.detail;
            window.lrcVisuals.plotTypes['worldmaps'].onBeatIndex(beatIndex, totalBeats);
        }
    });
    
    console.log('🌍 WorldMaps visualization integrated with LRC interface');
}

// Auto-integration when DOM and dependencies are ready
if (typeof window !== 'undefined') {
    window.LRCWorldMapsWrapper = LRCWorldMapsWrapper;
    
    document.addEventListener('DOMContentLoaded', () => {
        // Wait for all dependencies to load
        setTimeout(() => {
            if (window.lrcVisuals && window.WorldMapsSphereMapper) {
                integrateWorldMapsVisualization();
            } else {
                console.log('🌍 Dependencies not ready, waiting...');
                const checkInterval = setInterval(() => {
                    if (window.lrcVisuals && window.WorldMapsSphereMapper) {
                        clearInterval(checkInterval);
                        integrateWorldMapsVisualization();
                    }
                }, 200);
                
                setTimeout(() => {
                    clearInterval(checkInterval);
                    // console.warn('🌍 Dependencies not found after 10 seconds');
                }, 10000);
            }
        }, 200);
    });
}