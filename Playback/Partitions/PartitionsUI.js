// PartitionsUI.js - Expanded Playback View with Partitions for Large Rhythm Collider
// Handles the UI container, canvas mirroring, and partition layer controls
// Audio/playback logic will be in PartitionsPlayback.js

class PartitionsUI {
    constructor() {
        this.isActive = false;
        this.expandedContainer = null;
        this.mirrorCanvas = null;
        this.mirrorCtx = null;
        this.animationFrameId = null;
        this.originalPlaybackDisplay = null;
        this.originalCanvasVisibility = null;
        this.originalCanvasPointerEvents = null;

        // State management for proper cleanup
        this.stateBeforeExpansion = {
            playbackMinimized: false,
            panels: {}
        };

        // Section references
        this.leftSection = null;
        this.canvasContainer = null;
        this.layerControlsSection = null;
        this.layerControlsOriginalParent = null;
        this.layerControlsOriginalNextSibling = null;

        // Partition layer configurations (will be populated by PartitionsPlayback.js)
        this.partitionLayers = [];
        this.samplesStore = null;
        this.userSampleUrls = new Map();
        this.isLayoutBuilt = false;
        this.needsRhythmReset = false;
        this.rhythmGeneratedHandler = () => this.handleRhythmGenerated();
        window.addEventListener('rhythmGenerated', this.rhythmGeneratedHandler);

        console.log('🥁 PartitionsUI initialized');
    }

    // ====================================
    // MAIN SHOW/HIDE FUNCTIONALITY
    // ====================================

    show() {
        if (this.isActive) {
            console.log('Partitions view already active');
            return;
        }

        // Close EIV if it's open (mutual exclusion)
        if (window.expandedInfoView && window.expandedInfoView.isActive) {
            window.expandedInfoView.hide();
            console.log('🔄 Closed EIV to open Partitions');
        }

        // Save current state for restoration
        this.captureCurrentState();

        this.isActive = true;
        if (!this.isLayoutBuilt) {
            this.createExpandedLayout();
            this.isLayoutBuilt = true;
        } else if (this.expandedContainer) {
            this.expandedContainer.style.display = 'flex';
            this.attachLayerControls();
            if (this.needsRhythmReset) {
                this.updatePartitionOptions();
                this.needsRhythmReset = false;
            }
            this.updateTitle();
            this.handleResize();
        }
        this.setupLiveMirrorCanvas();
        if (!this.leftSection || !this.leftSection.hasChildNodes()) {
            this.populatePartitionsContent();
            this.needsRhythmReset = false;
        }
        this.hidePlaybackDiv();
        this.hideVisualizationCanvas();
        this.setupEventListeners();

        console.log('🥁 Partitions view activated with live mirroring');
    }

    hide() {
        if (!this.isActive) {
            return;
        }

        // Clean up animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Remove event listeners
        this.removeEventListeners();

        this.restoreLayerControls();
        if (this.expandedContainer) {
            this.expandedContainer.style.display = 'none';
        }

        // Restore playback div visibility
        this.restorePlaybackDiv();
        this.restoreVisualizationCanvas();

        // Restore previous state
        this.restoreState();

        this.isActive = false;

        console.log('🥁 Partitions view deactivated');
    }

    // ====================================
    // STATE MANAGEMENT
    // ====================================

    captureCurrentState() {
        const playbackDiv = document.getElementById('playback-div');

        this.stateBeforeExpansion = {
            playbackMinimized: playbackDiv ? playbackDiv.classList.contains('minimized') : false,
            panels: {}
        };

        // Capture all panel states for clean restoration
        const panels = document.querySelectorAll('.panel');
        panels.forEach(panel => {
            this.stateBeforeExpansion.panels[panel.id] = {
                minimized: panel.classList.contains('minimized'),
                position: {
                    left: panel.style.left,
                    top: panel.style.top,
                    right: panel.style.right,
                    bottom: panel.style.bottom
                }
            };
        });

        console.log('📸 Captured state before Partitions expansion');
    }

    restoreState() {
        // Restore panel states if needed
        // For now, we just ensure playback div is back to its previous state
        const playbackDiv = document.getElementById('playback-div');
        if (playbackDiv && this.stateBeforeExpansion.playbackMinimized) {
            playbackDiv.classList.add('minimized');
            const btn = playbackDiv.querySelector('.minimize-btn');
            if (btn) btn.textContent = '+';
        }

        console.log('🔄 Restored state after Partitions close');
    }

    // ====================================
    // LAYOUT CREATION (matching EIV pattern exactly)
    // ====================================

    createExpandedLayout() {
        // Match the canvas dimensions exactly using the same logic as LRCVisuals.resizeCanvas()
        const canvas = document.getElementById('visualization-canvas');
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth;

        const logicalWidth = containerWidth;
        // Use available vertical space for maximal screen usage
        const titleBarHeight = 50;
        const bottomBuffer = 80; // Space for floating panels
        const logicalHeight = window.innerHeight - titleBarHeight - bottomBuffer;

        // Use existing container from HTML instead of creating new one
        this.expandedContainer = document.getElementById('expanded-playback-view');
        if (!this.expandedContainer) {
            console.error('Partitions container not found in HTML');
            return;
        }

        // Position at top: 0 since canvas-background already accounts for title bar
        this.expandedContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: ${logicalWidth}px;
            height: ${logicalHeight}px;
            background: #1a1a1a;
            z-index: 500;
            display: flex;
            flex-direction: column;
            font-family: 'Segoe UI', 'Roboto', sans-serif;
            border: 1px solid #444;
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        `;

        // Title bar for expanded view (matches EIV panel styles)
        const titleBar = document.createElement('div');
        titleBar.className = 'info-header';
        titleBar.style.cssText = `
            background: #2a2a2a;
            padding: 10px 15px;
            border-bottom: 1px solid #444;
            display: flex;
            justify-content: space-between;
            align-items: center;
            height: 50px;
            box-sizing: border-box;
            flex-shrink: 0;
            z-index: 1001;
            pointer-events: auto;
        `;

        // Content container below title bar
        const contentContainer = document.createElement('div');
        contentContainer.style.cssText = `
            flex: 1;
            display: flex;
            overflow: hidden;
            pointer-events: auto;
        `;

        // Left section (50% width) - will be styled after title bar setup
        const leftSection = document.createElement('div');
        leftSection.className = 'partitions-left-section';

        // Right section (50% width) - will be styled after title bar setup
        const rightSection = document.createElement('div');
        rightSection.className = 'partitions-right-section';

        // Get current layers for title
        const rhythmInfo = window.lrcModule ? window.lrcModule.getRhythmInfoData() : null;
        const displayLayers = rhythmInfo && rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0
            ? rhythmInfo.displayLayers
            : rhythmInfo?.layers || [];
        const layersText = displayLayers.length > 0 ? displayLayers.join(':') : '';

        const title = document.createElement('h3');
        title.textContent = `Partitions ${layersText ? '- ' + layersText : ''}`;
        title.style.cssText = `
            color: #00ff88;
            margin: 0;
            font-size: 18px;
            font-weight: 300;
            letter-spacing: 2px;
        `;

        // Mac OS style red close button (matching EIV)
        const closeButton = document.createElement('button');
        closeButton.className = 'expanded-close-btn';
        closeButton.style.cssText = `
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #ff5f56;
            border: 1px solid #e0443e;
            cursor: pointer;
            position: relative;
            transition: background-color 0.2s;
        `;

        // Add close button hover effect and click handler
        closeButton.addEventListener('mouseenter', () => {
            closeButton.style.background = '#ff3333';
        });
        closeButton.addEventListener('mouseleave', () => {
            closeButton.style.background = '#ff5f56';
        });
        closeButton.addEventListener('click', () => {
            this.hide();
        });

        titleBar.appendChild(title);
        titleBar.appendChild(closeButton);

        // Left section (50% width) - Main Controls bar at top, then partition layers below
        leftSection.style.cssText = `
            width: 50%;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: #1a1a1a;
        `;

        // Main Controls bar (horizontal strip at top of left section)
        const mainControlsContainer = document.createElement('div');
        mainControlsContainer.id = 'partitions-main-controls-container';
        mainControlsContainer.style.cssText = `
            flex-shrink: 0;
            border-bottom: 1px solid #444;
        `;

        // Left section content (partition layers, scrollable)
        const leftContent = document.createElement('div');
        leftContent.id = 'partitions-left-content';
        leftContent.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 20px;
        `;

        // Assemble left section
        leftSection.appendChild(mainControlsContainer);
        leftSection.appendChild(leftContent);

        // Right section (50% width, split into quadrants like EIV)
        rightSection.style.cssText = `
            width: 50%;
            display: grid;
            grid-template-rows: 1fr 1fr;
            gap: 10px;
            padding: 20px;
            background: #1a1a1a;
        `;

        // Upper right quadrant - Canvas container (matching EIV exactly)
        const canvasContainer = document.createElement('div');
        canvasContainer.id = 'partitions-canvas-container';
        canvasContainer.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // Lower right quadrant - Tone Controls (Scale Selection + Consonance Families side by side)
        const lowerRightContainer = document.createElement('div');
        lowerRightContainer.id = 'partitions-lower-right';
        lowerRightContainer.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 10px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;
        lowerRightContainer.innerHTML = `
            <div style="display: flex; gap: 12px; flex: 1; min-height: 0;">
                <!-- Layer Controls Column -->
                <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
                    <h4 style="color: #00ff88; margin: 0 0 8px 0; font-size: 13px; flex-shrink: 0;">Layer Controls</h4>
                    <div id="partitions-layer-controls" style="flex: 1; overflow-y: auto; background: #1a1a1a; border-radius: 4px; padding: 6px; border: 1px solid #333;">
                        <!-- Layer controls moved from playback -->
                    </div>
                </div>
                <!-- Scale + Families Column -->
                <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
                    <h4 style="color: #00ff88; margin: 0 0 8px 0; font-size: 13px; flex-shrink: 0;">Scale Selection</h4>
                    <div class="scale-controls" style="margin-bottom: 6px;">
                        <button class="control-btn" data-scale-action="select-all">Select All</button>
                        <button class="control-btn" data-scale-action="select-none">None</button>
                        <span id="partitions-selected-notes-count" data-scale-count style="color: #666; font-size: 10px;">0 of 0 notes selected</span>
                    </div>
                    <div id="partitions-scale-families-scroll" style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 4px;">
                        <div id="partitions-scale-container" style="background: #1a1a1a; border-radius: 4px; border: 1px solid #333;">
                            <!-- Scale chart populated by ToneRowPlayback -->
                        </div>
                        <div style="margin-top: 6px;">
                            <div style="color: #888; font-size: 11px; margin-bottom: 5px;">Consonance Families</div>
                            <div id="partitions-families-container" style="background: #1a1a1a; border-radius: 4px; border: 1px solid #333;">
                                <!-- Families populated by ToneRowPlayback -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Assemble right section
        rightSection.appendChild(canvasContainer);
        rightSection.appendChild(lowerRightContainer);

        // Assemble content container
        contentContainer.appendChild(leftSection);
        contentContainer.appendChild(rightSection);

        // Assemble main container
        this.expandedContainer.appendChild(titleBar);
        this.expandedContainer.appendChild(contentContainer);

        // Store references
        this.leftSection = leftContent; // Point to the scrollable content area
        this.canvasContainer = canvasContainer;
        this.mainControlsContainer = mainControlsContainer;
        this.lowerRightContainer = lowerRightContainer;
        this.titleElement = title;

        // Initialize global controls in the main controls container
        if (window.partitionsGlobalControls) {
            window.partitionsGlobalControls.init(mainControlsContainer);
        }

        if (window.toneRowPlayback) {
            window.toneRowPlayback.setupScaleControls();
            window.toneRowPlayback.updateScaleDisplay('partitions-scale-container');
            window.toneRowPlayback.updateInterconsonanceFamilies('partitions-families-container', null);
            window.toneRowPlayback.updateSelectedNotesCount();
        }

        this.attachLayerControls();

        console.log('📐 Created Partitions expanded layout (matching EIV dimensions)');
    }

    removeExpandedLayout() {
        // Destroy global controls before clearing container
        if (window.partitionsGlobalControls) {
            window.partitionsGlobalControls.destroy();
        }
        this.restoreLayerControls();

        if (this.expandedContainer) {
            // Clear content and hide container
            this.expandedContainer.innerHTML = '';
            this.expandedContainer.style.display = 'none';
        }

        // Clear all references
        this.leftSection = null;
        this.canvasContainer = null;
        this.mainControlsContainer = null;
        this.lowerRightContainer = null;
        this.titleElement = null;
        this.layerControlsSection = null;
        this.layerControlsOriginalParent = null;
        this.layerControlsOriginalNextSibling = null;
        this.isLayoutBuilt = false;

        console.log('📐 Partitions layout hidden and references cleared');
    }

    // ====================================
    // CANVAS MIRRORING (same pattern as EIV)
    // ====================================

    setupLiveMirrorCanvas() {
        if (!this.canvasContainer) {
            console.error('Canvas container not found for mirror setup');
            return;
        }

        const existingCanvas = this.canvasContainer.querySelector('#partitions-mirror-canvas');
        if (existingCanvas) {
            this.mirrorCanvas = existingCanvas;
        }

        if (!this.mirrorCanvas) {
            // Create mirror canvas that will display a live copy of the main canvas
            this.mirrorCanvas = document.createElement('canvas');
            this.mirrorCanvas.id = 'partitions-mirror-canvas';
            this.mirrorCanvas.style.cssText = `
                width: 100%;
                height: 100%;
                display: block;
                background: #000000;
            `;
        }

        // Get container dimensions and set canvas size
        const containerWidth = this.canvasContainer.clientWidth - 10;
        const containerHeight = this.canvasContainer.clientHeight - 10;

        // Set canvas dimensions
        this.mirrorCanvas.width = containerWidth;
        this.mirrorCanvas.height = containerHeight;
        this.mirrorCtx = this.mirrorCanvas.getContext('2d');

        // Add mirror canvas to container
        if (!existingCanvas) {
            this.canvasContainer.innerHTML = '';
            this.canvasContainer.appendChild(this.mirrorCanvas);
        }

        // Start the live mirroring process
        this.startLiveMirror();

        console.log('🪞 Live mirror canvas setup completed for Partitions');
    }

    startLiveMirror() {
        const originalCanvas = document.getElementById('visualization-canvas');
        if (!originalCanvas || !this.mirrorCanvas) return;

        const mirrorFrame = () => {
            if (!this.isActive || !this.mirrorCtx) return;

            // Clear mirror canvas
            this.mirrorCtx.clearRect(0, 0, this.mirrorCanvas.width, this.mirrorCanvas.height);

            // Draw scaled copy of main canvas to mirror canvas
            if (originalCanvas.width > 0 && originalCanvas.height > 0) {
                // Calculate scaling to fit mirror canvas while maintaining aspect ratio
                const scaleX = this.mirrorCanvas.width / originalCanvas.width;
                const scaleY = this.mirrorCanvas.height / originalCanvas.height;
                const scale = Math.min(scaleX, scaleY);

                const scaledWidth = originalCanvas.width * scale;
                const scaledHeight = originalCanvas.height * scale;

                // Center the scaled image
                const offsetX = (this.mirrorCanvas.width - scaledWidth) / 2;
                const offsetY = (this.mirrorCanvas.height - scaledHeight) / 2;

                this.mirrorCtx.drawImage(
                    originalCanvas,
                    offsetX, offsetY,
                    scaledWidth, scaledHeight
                );
            }

            // Continue mirroring
            this.animationFrameId = requestAnimationFrame(mirrorFrame);
        };

        // Start the mirroring loop
        this.animationFrameId = requestAnimationFrame(mirrorFrame);
        console.log('🪞 Live mirroring started for Partitions');
    }

    // ====================================
    // LAYER CONTROLS MIRRORING
    // ====================================

    attachLayerControls() {
        const target = document.getElementById('partitions-layer-controls');
        if (!target) return;

        const layerControlsContent = document.getElementById('layer-controls-content');
        const section = layerControlsContent ? layerControlsContent.closest('.playback-section') : null;
        if (!section) return;

        if (!this.layerControlsSection) {
            this.layerControlsSection = section;
            this.layerControlsOriginalParent = section.parentElement;
            this.layerControlsOriginalNextSibling = section.nextSibling;
        }

        target.innerHTML = '';
        target.appendChild(section);
    }

    restoreLayerControls() {
        if (!this.layerControlsSection || !this.layerControlsOriginalParent) return;

        if (this.layerControlsOriginalNextSibling) {
            this.layerControlsOriginalParent.insertBefore(this.layerControlsSection, this.layerControlsOriginalNextSibling);
        } else {
            this.layerControlsOriginalParent.appendChild(this.layerControlsSection);
        }
    }

    // ====================================
    // PLAYBACK DIV VISIBILITY
    // ====================================

    hidePlaybackDiv() {
        const playbackDiv = document.getElementById('playback-div');
        if (playbackDiv) {
            this.originalPlaybackDisplay = playbackDiv.style.display;
            playbackDiv.style.display = 'none';
        }
    }

    restorePlaybackDiv() {
        const playbackDiv = document.getElementById('playback-div');
        if (playbackDiv) {
            playbackDiv.style.display = this.originalPlaybackDisplay || '';
        }
    }

    hideVisualizationCanvas() {
        const canvas = document.getElementById('visualization-canvas');
        if (!canvas) return;
        this.originalCanvasVisibility = canvas.style.visibility;
        this.originalCanvasPointerEvents = canvas.style.pointerEvents;
        canvas.style.visibility = 'hidden';
        canvas.style.pointerEvents = 'none';
    }

    restoreVisualizationCanvas() {
        const canvas = document.getElementById('visualization-canvas');
        if (!canvas) return;
        canvas.style.visibility = this.originalCanvasVisibility || '';
        canvas.style.pointerEvents = this.originalCanvasPointerEvents || '';
        this.originalCanvasVisibility = null;
        this.originalCanvasPointerEvents = null;
    }

    // ====================================
    // EVENT LISTENERS
    // ====================================

    setupEventListeners() {
        // Listen for window resize
        this.resizeHandler = () => {
            if (this.isActive) {
                this.handleResize();
            }
        };
        window.addEventListener('resize', this.resizeHandler);

        this.navigationGuardHandler = (event) => {
            if (!this.isActive || !this.expandedContainer) return;
            if (!this.expandedContainer.contains(event.target)) return;
            if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
            const scrollContainer = event.target.closest('.partition-blocks-scroll');
            if (!scrollContainer) {
                event.preventDefault();
                return;
            }
            const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth;
            if (maxScroll <= 0) {
                event.preventDefault();
                return;
            }
            const atStart = scrollContainer.scrollLeft <= 0;
            const atEnd = scrollContainer.scrollLeft >= maxScroll - 1;
            if ((event.deltaX < 0 && atStart) || (event.deltaX > 0 && atEnd)) {
                event.preventDefault();
            }
        };
        document.addEventListener('wheel', this.navigationGuardHandler, { passive: false });
    }

    removeEventListeners() {
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
        if (this.navigationGuardHandler) {
            document.removeEventListener('wheel', this.navigationGuardHandler);
            this.navigationGuardHandler = null;
        }
    }

    handleRhythmGenerated() {
        this.needsRhythmReset = true;
        if (this.leftSection) {
            this.updatePartitionOptions();
            this.updateTitle();
            this.needsRhythmReset = false;
        }
    }

    handleResize() {
        // Recalculate container dimensions on resize (matching EIV pattern)
        const canvas = document.getElementById('visualization-canvas');
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth;

        const logicalWidth = containerWidth;
        // Use available vertical space for maximal screen usage
        const titleBarHeight = 50;
        const bottomBuffer = 80; // Space for floating panels
        const logicalHeight = window.innerHeight - titleBarHeight - bottomBuffer;

        // Update only the dimensions
        if (this.expandedContainer) {
            this.expandedContainer.style.width = `${logicalWidth}px`;
            this.expandedContainer.style.height = `${logicalHeight}px`;
        }
        this.resizeMirrorCanvas();
    }

    resizeMirrorCanvas() {
        if (!this.canvasContainer || !this.mirrorCanvas) return;
        const containerWidth = this.canvasContainer.clientWidth - 10;
        const containerHeight = this.canvasContainer.clientHeight - 10;
        if (containerWidth <= 0 || containerHeight <= 0) return;
        if (this.mirrorCanvas.width === containerWidth && this.mirrorCanvas.height === containerHeight) return;
        this.mirrorCanvas.width = containerWidth;
        this.mirrorCanvas.height = containerHeight;
        this.mirrorCtx = this.mirrorCanvas.getContext('2d');
    }

    updateTitle() {
        if (!this.titleElement) return;

        const rhythmInfo = window.lrcModule ? window.lrcModule.getRhythmInfoData() : null;
        const displayLayers = rhythmInfo && rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0
            ? rhythmInfo.displayLayers
            : rhythmInfo?.layers || [];
        const layersText = displayLayers.length > 0 ? displayLayers.join(':') : '';

        this.titleElement.textContent = `Partitions ${layersText ? '- ' + layersText : ''}`;
    }

    // ====================================
    // PARTITIONS CONTENT
    // ====================================

    populatePartitionsContent() {
        if (!this.leftSection) return;

        // Check if we have rhythm data
        const rhythmInfo = window.lrcModule?.getRhythmInfoData?.();
        const hasRhythm = rhythmInfo && rhythmInfo.grid > 0;

        if (!hasRhythm) {
            this.leftSection.innerHTML = `
                <div class="partitions-placeholder" style="color: #888; text-align: center; padding: 40px;">
                    <p>Generate a rhythm first to create partitions.</p>
                </div>
            `;
            return;
        }

        const activeLayers = (rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0)
            ? rhythmInfo.displayLayers
            : rhythmInfo.layers;

        this.leftSection.innerHTML = `
            <div class="partitions-info" style="color: #ccc; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #333;">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
                    <div>
                        <p style="margin: 0 0 5px 0;"><strong style="color: #00ff88;">Current Rhythm:</strong> ${activeLayers.join(':')}</p>
                        <p style="margin: 0; font-size: 12px; color: #888;">Grid: ${rhythmInfo.grid} | Fundamental: ${rhythmInfo.fundamental}</p>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <button class="partitions-export-midi-btn" style="
                                background: #222;
                                color: #00ff88;
                                border: 1px solid #444;
                                border-radius: 4px;
                                padding: 4px 8px;
                                font-size: 11px;
                                cursor: pointer;
                                white-space: nowrap;
                            ">Export MIDI</button>
                            <button class="partitions-upload-samples-btn" style="
                                background: #222;
                                color: #00ff88;
                                border: 1px solid #444;
                                border-radius: 4px;
                                padding: 4px 8px;
                                font-size: 11px;
                                cursor: pointer;
                                white-space: nowrap;
                            ">Upload Samples</button>
                        </div>
                        <span class="partitions-upload-status" style="font-size: 11px; color: #777;">No user samples</span>
                    </div>
                </div>
            </div>

            <div class="partition-layers-container" style="display: flex; flex-direction: column; gap: 15px;">
                ${this.createPartitionLayerHTML(0, 'Kick', '#ff6b6b')}
                ${this.createPartitionLayerHTML(1, 'Snare', '#4ecdc4')}
                ${this.createPartitionLayerHTML(2, 'Hi-Hat', '#00a638ff')}
                ${this.createPartitionLayerHTML(3, 'Perc', '#f9ca24')}
            </div>
        `;

        const exportBtn = this.leftSection.querySelector('.partitions-export-midi-btn');
        const uploadBtn = this.leftSection.querySelector('.partitions-upload-samples-btn');
        const uploadStatus = this.leftSection.querySelector('.partitions-upload-status');
        const sampleSelects = Array.from(this.leftSection.querySelectorAll('.partition-sample-select'));

        const refreshUserSamples = async () => {
            if (typeof PartitionsSamples !== 'function') return;
            if (!this.samplesStore) {
                this.samplesStore = new PartitionsSamples();
            }
            let samples = [];
            try {
                samples = await this.samplesStore.getAllSamples();
            } catch (error) {
                console.warn('[PartitionsUI] Failed to load user samples', error);
            }
            const ids = new Set(samples.map((sample) => sample.id));
            this.userSampleUrls.forEach((url, id) => {
                if (!ids.has(id)) {
                    URL.revokeObjectURL(url);
                    this.userSampleUrls.delete(id);
                }
            });
            const userSamples = samples.map((sample) => {
                let url = this.userSampleUrls.get(sample.id);
                if (!url) {
                    url = URL.createObjectURL(sample.blob);
                    this.userSampleUrls.set(sample.id, url);
                }
                return { id: sample.id, name: sample.name, url };
            });

            sampleSelects.forEach((select) => {
                const currentValue = select.value;
                const existingGroup = select.querySelector('optgroup[data-user-samples]');
                if (existingGroup) existingGroup.remove();
                if (userSamples.length) {
                    const group = document.createElement('optgroup');
                    group.label = 'User Samples';
                    group.dataset.userSamples = 'true';
                    userSamples.forEach((sample) => {
                        const option = document.createElement('option');
                        option.value = sample.url;
                        option.textContent = sample.name;
                        option.dataset.userSample = 'true';
                        group.appendChild(option);
                    });
                    select.appendChild(group);
                }
                if (currentValue && Array.from(select.options).some((opt) => opt.value === currentValue)) {
                    select.value = currentValue;
                }
            });

            if (uploadStatus) {
                uploadStatus.textContent = userSamples.length
                    ? `${userSamples.length} user sample${userSamples.length === 1 ? '' : 's'}`
                    : 'No user samples';
            }
        };

        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => {
                if (typeof PartitionsSamples !== 'function') return;
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'audio/*';
                input.multiple = true;
                input.addEventListener('change', async () => {
                    const files = Array.from(input.files || []).filter((file) => {
                        if (file.type && file.type.startsWith('audio/')) return true;
                        return /\.(wav|mp3|ogg|flac|aiff?)$/i.test(file.name || '');
                    });
                    if (!files.length) return;
                    if (!this.samplesStore) {
                        this.samplesStore = new PartitionsSamples();
                    }
                    try {
                        await this.samplesStore.addFiles(files);
                        await refreshUserSamples();
                    } catch (error) {
                        console.warn('[PartitionsUI] Failed to store user samples', error);
                    }
                });
                input.click();
            });
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                if (!window.lrcExport || typeof window.lrcExport.exportPartitionsMIDI !== 'function') {
                    console.error('📤 Partitions MIDI export not available');
                    return;
                }
                window.lrcExport.exportPartitionsMIDI();
            });
        }

        refreshUserSamples();

        this.leftSection.querySelectorAll('.partition-layer').forEach(layer => {
            const p1Input = layer.querySelector('.partition-count-input-primary');
            const p2Input = layer.querySelector('.partition-count-input-secondary');
            const label = layer.querySelector('.partition-count-label');
            const modeSelect = layer.querySelector('.partition-mode-select');
            const preview = layer.querySelector('.partition-preview');
            const layerIndex = Number(layer.getAttribute('data-layer-index'));
            if (!p1Input || !p2Input || !label || !modeSelect || !preview || Number.isNaN(layerIndex)) return;
            const getLinkedColor = () => this.getLayerColor(Number(layer.dataset.linkedLayer ?? layerIndex));

            const parseValue = (value) => {
                const num = Number(value);
                return Number.isFinite(num) ? Math.floor(num) : null;
            };

            const getCommittedValue = (input, fallback) => {
                const committed = parseValue(input.dataset.committed ?? '');
                if (committed != null) return committed;
                const current = parseValue(input.value);
                if (current != null) return current;
                return fallback;
            };

            const clampInput = (input, min, max, fallback) => {
                const raw = parseValue(input.value);
                if (raw == null) {
                    if (fallback != null) input.value = fallback;
                    return fallback ?? null;
                }
                const clamped = Math.min(max, Math.max(min, raw));
                input.value = clamped;
                return clamped;
            };

            const commitInput = (input, min, max, fallback) => {
                const committed = clampInput(input, min, max, fallback);
                if (committed != null) {
                    input.dataset.committed = String(committed);
                } else {
                    input.dataset.committed = '';
                }
                return committed;
            };

            const updateMax = (forceValue = null) => {
                const linkedLayerIndex = Number(layer.dataset.linkedLayer ?? layerIndex);
                const max = this.getPartitionMax(linkedLayerIndex, modeSelect.value, rhythmInfo);
                p1Input.max = max;
                if (forceValue != null) {
                    p1Input.value = forceValue;
                } else if (modeSelect.value === 'sequence') {
                    p1Input.value = max;
                } else if (Number(p1Input.value) > max) {
                    p1Input.value = max;
                }
                const p1Value = commitInput(p1Input, 1, max, 1);
                p2Input.max = p1Value;
                if (p2Input.value) {
                    commitInput(p2Input, 1, p1Value, p2Input.value);
                } else {
                    p2Input.dataset.committed = '';
                }
                this.updatePartitionBlocks(preview, getLinkedColor(), p1Value, modeSelect.value, rhythmInfo, layerIndex, linkedLayerIndex, p2Input.dataset.committed || '');
            };

            const updateValue = () => {
                const linkedLayerIndex = Number(layer.dataset.linkedLayer ?? layerIndex);
                const max = this.getPartitionMax(linkedLayerIndex, modeSelect.value, rhythmInfo);
                const p1Value = getCommittedValue(p1Input, 1);
                p2Input.max = p1Value;
                const p2Value = getCommittedValue(p2Input, '');
                this.updatePartitionBlocks(preview, getLinkedColor(), p1Value, modeSelect.value, rhythmInfo, layerIndex, linkedLayerIndex, p2Value === '' ? '' : String(p2Value));
            };

            const commitValue = () => {
                const linkedLayerIndex = Number(layer.dataset.linkedLayer ?? layerIndex);
                const max = this.getPartitionMax(linkedLayerIndex, modeSelect.value, rhythmInfo);
                const p1Value = commitInput(p1Input, 1, max, 1);
                p2Input.max = p1Value;
                if (p2Input.value) {
                    commitInput(p2Input, 1, p1Value, p2Input.value);
                } else {
                    p2Input.dataset.committed = '';
                }
                updateValue();
                window.partitionsBlockLights?.clearAll?.();
                window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
            };
            const handleKeydown = (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    commitValue();
                    event.target.blur();
                }
            };
            const clampOnInput = (input) => {
                const max = Number(input.max);
                const min = Number(input.min) || 1;
                if (!input.value) return;
                const raw = parseValue(input.value);
                if (raw == null) return;
                if (Number.isFinite(max) && raw > max) {
                    input.value = max;
                } else if (raw < min) {
                    input.value = min;
                }
            };
            p1Input.addEventListener('input', () => clampOnInput(p1Input));
            p2Input.addEventListener('input', () => clampOnInput(p2Input));
            p1Input.addEventListener('blur', commitValue);
            p2Input.addEventListener('blur', commitValue);
            p1Input.addEventListener('keydown', handleKeydown);
            p2Input.addEventListener('keydown', handleKeydown);
            modeSelect.addEventListener('change', () => {
                const forceValue = modeSelect.value === 'sequence' ? null : 1;
                updateMax(forceValue);
                window.partitionsBlockLights?.clearAll?.();
                window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
            });

            updateMax();
        });

        this.leftSection.querySelectorAll('.partition-volume-slider').forEach(slider => {
            const label = slider.closest('div')?.querySelector('.partition-volume-value');
            const updateValue = () => {
                if (label) {
                    label.textContent = `${slider.value} dB`;
                }
                const layer = slider.closest('.partition-layer');
                const layerIndex = Number(layer?.dataset?.layerIndex);
                if (Number.isFinite(layerIndex) && window.partitionsPlayback) {
                    window.partitionsPlayback.updateLayerVolume(layerIndex, Number(slider.value));
                }
            };
            slider.addEventListener('input', updateValue);
            slider.addEventListener('input', () => {
                window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
            });
            updateValue();
        });

        this.leftSection.querySelectorAll('.partition-layer').forEach(layer => {
            const title = layer.querySelector('.partition-layer-title');
            const select = layer.querySelector('.partition-sample-select');
            const resetBtn = layer.querySelector('.partition-reset-btn');
            const settingsBtn = layer.querySelector('.partition-settings-btn');
            const mainPanel = layer.querySelector('.partition-main-panel');
            const settingsPanel = layer.querySelector('.partition-settings-panel');
            const adsrContainer = layer.querySelector('.partition-adsr-controls');
            const transposeContainer = layer.querySelector('.partition-transpose-controls');
            const hipassInput = layer.querySelector('.partition-hipass-input');
            const lopassInput = layer.querySelector('.partition-lopass-input');
            const p1Input = layer.querySelector('.partition-count-input-primary');
            const p2Input = layer.querySelector('.partition-count-input-secondary');
            const label = layer.querySelector('.partition-count-label');
            if (!title || !select) return;
            const updateTitle = () => {
                const selected = select.selectedOptions?.[0]?.textContent?.trim();
                const labelText = selected || select.value;
                title.textContent = labelText.replace(/(^|[-_])(\w)/g, (_, p1, p2) => (p1 ? ' ' : '') + p2.toUpperCase());
            };
            select.addEventListener('change', updateTitle);
            select.addEventListener('change', () => {
                if (window.partitionsPlayback && typeof window.partitionsPlayback.invalidateSampleCache === 'function') {
                    window.partitionsPlayback.invalidateSampleCache(select.value);
                }
                window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
            });
            updateTitle();

            if (resetBtn && p1Input && p2Input && label) {
                resetBtn.addEventListener('click', () => {
                    const modeSelect = layer.querySelector('.partition-mode-select');
                    const linkedLayerIndex = Number(layer.dataset.linkedLayer ?? layer.dataset.layerIndex ?? layerIndex);
                    if (modeSelect && modeSelect.value === 'sequence') {
                        const max = this.getPartitionMax(linkedLayerIndex, modeSelect.value, rhythmInfo);
                        p1Input.value = max;
                    } else {
                        p1Input.value = '1';
                    }
                    p2Input.value = '';
                    p1Input.dataset.committed = p1Input.value;
                    p2Input.dataset.committed = '';
                    const preview = layer.querySelector('.partition-preview');
                    if (preview) {
                        preview.dataset.mutedIndices = '';
                        preview.dataset.orderIndices = '';
                        preview.dataset.p2MutedBackup = '';
                        preview.dataset.p2OrderBackup = '';
                        preview.dataset.p2Coverages = '';
                        this.updatePartitionBlocks(preview, this.getLayerColor(linkedLayerIndex), p1Input.value, modeSelect?.value || 'grid', rhythmInfo, Number(layer.dataset.layerIndex), linkedLayerIndex, p2Input.value);
                    }
                    window.partitionsBlockLights?.clearAll?.();
                    window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
                });
            }

            if (settingsBtn && mainPanel && settingsPanel) {
                settingsBtn.addEventListener('click', () => {
                    const isMain = settingsBtn.dataset.mode !== 'settings';
                    if (isMain) {
                        settingsBtn.dataset.mode = 'settings';
                        settingsBtn.textContent = '↩︎';
                        settingsBtn.title = 'Back to partitions';
                        mainPanel.style.display = 'none';
                        settingsPanel.style.display = 'block';
                        if (resetBtn) resetBtn.style.display = 'none';
                        if (adsrContainer && !adsrContainer.dataset.ready) {
                            adsrContainer.dataset.ready = 'true';
                            const knobConfigs = {
                                attack: { min: 0.001, max: 5, step: 0.001, unit: 'ms', precision: 0 },
                                decay: { min: 0.001, max: 5, step: 0.001, unit: 'ms', precision: 0 },
                                sustain: { min: 0.001, max: 1, step: 0.01, unit: '', precision: 2 },
                                release: { min: 0.001, max: 5, step: 0.001, unit: 'ms', precision: 0 }
                            };
                            Object.entries(knobConfigs).forEach(([param, config]) => {
                                if (typeof ADSRKnob === 'function') {
                                    const defaults = { attack: 0.001, decay: 0.2, sustain: 0.7, release: 0.3 };
                                    const knob = new ADSRKnob(adsrContainer, param, defaults[param], config);
                                    knob.onChange = (value) => {
                                        if (window.partitionsPlayback) {
                                            window.partitionsPlayback.updateLayerADSR(layerIndex, param, value);
                                        }
                                        window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
                                    };
                                }
                            });
                        }
                        if (transposeContainer && !transposeContainer.dataset.ready) {
                            transposeContainer.dataset.ready = 'true';
                            if (typeof TransposeUI === 'function') {
                                const knob = new TransposeUI(transposeContainer, 0, {
                                    min: -24,
                                    max: 24,
                                    step: 0.1,
                                    precision: 1,
                                    label: 'transpose',
                                    unit: 'st'
                                });
                                knob.onChange = (value) => {
                                    if (window.partitionsPlayback) {
                                        window.partitionsPlayback.updateLayerTranspose(layerIndex, value);
                                    }
                                    window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
                                };
                            }
                        }
                    } else {
                        settingsBtn.dataset.mode = 'main';
                        settingsBtn.textContent = 'Settings';
                        settingsBtn.title = 'Layer settings';
                        mainPanel.style.display = 'block';
                        settingsPanel.style.display = 'none';
                        if (resetBtn) resetBtn.style.display = '';
                    }
                });
            }

            const layerIndex = Number(layer.dataset.layerIndex);
            const updateFilters = () => {
                if (!window.partitionsPlayback) return;
                const highpass = hipassInput ? parseFloat(hipassInput.value) : null;
                const lowpass = lopassInput ? parseFloat(lopassInput.value) : null;
                window.partitionsPlayback.updateLayerFilters(layerIndex, { highpass, lowpass });
            };
            if (hipassInput) {
                hipassInput.addEventListener('input', updateFilters);
                hipassInput.addEventListener('change', updateFilters);
            }
            if (lopassInput) {
                lopassInput.addEventListener('input', updateFilters);
                lopassInput.addEventListener('change', updateFilters);
            }
        });

        const layerLetters = ['A', 'B', 'C', 'D'];
        const applyLinkedLayer = (layer, linkedLayerIndex, rhythmInfo) => {
            const color = this.getLayerColor(linkedLayerIndex);
            layer.dataset.linkedLayer = String(linkedLayerIndex);
            const toggleBtn = layer.querySelector('.partition-layer-toggle');
            const title = layer.querySelector('.partition-layer-title');
            if (toggleBtn) {
                toggleBtn.textContent = layerLetters[linkedLayerIndex] || 'A';
                toggleBtn.style.background = color;
            }
            if (title) {
                title.style.color = color;
            }
            layer.style.borderColor = `${color}40`;
            layer.style.borderLeftColor = color;

            const preview = layer.querySelector('.partition-preview');
            const modeSelect = layer.querySelector('.partition-mode-select');
            const p1Input = layer.querySelector('.partition-count-input-primary');
            const p2Input = layer.querySelector('.partition-count-input-secondary');
            if (preview && modeSelect && p1Input && p2Input) {
                const max = this.getPartitionMax(linkedLayerIndex, modeSelect.value, rhythmInfo);
                p1Input.max = max;
                if (modeSelect.value === 'sequence') {
                    p1Input.value = max;
                } else if (Number(p1Input.value) > max) {
                    p1Input.value = max;
                }
                p2Input.max = Number(p1Input.value) || max;
                if (p2Input.value && Number(p2Input.value) > Number(p2Input.max)) {
                    p2Input.value = p2Input.max;
                }
                p1Input.dataset.committed = String(p1Input.value || 1);
                p2Input.dataset.committed = p2Input.value || '';
                this.updatePartitionBlocks(preview, color, p1Input.dataset.committed, modeSelect.value, rhythmInfo, Number(layer.dataset.layerIndex), linkedLayerIndex, p2Input.dataset.committed);
            }
        };

        this.leftSection.querySelectorAll('.partition-layer').forEach(layer => {
            const toggleBtn = layer.querySelector('.partition-layer-toggle');
            if (!toggleBtn) return;
            const layerIndex = Number(layer.dataset.layerIndex) || 0;
            if (!layer.dataset.linkedLayer) {
                layer.dataset.linkedLayer = String(layerIndex);
            }
            applyLinkedLayer(layer, Number(layer.dataset.linkedLayer), rhythmInfo);
            const setEnabled = (enabled) => {
                layer.dataset.enabled = enabled ? 'true' : 'false';
                toggleBtn.style.opacity = enabled ? '1' : '0.35';
                toggleBtn.style.filter = enabled ? 'none' : 'grayscale(0.6)';
                toggleBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            };
            const isEnabled = layer.dataset.enabled === 'true';
            setEnabled(isEnabled);
            toggleBtn.addEventListener('click', (event) => {
                if (event.shiftKey) {
                    event.preventDefault();
                    const current = Number(layer.dataset.linkedLayer ?? layerIndex);
                    const next = (current + 1) % 4;
                    applyLinkedLayer(layer, next, rhythmInfo);
                    window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
                    return;
                }
                setEnabled(layer.dataset.enabled !== 'true');
                window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
            });
        });

        console.log('📋 Populated Partitions content');
    }

    createPartitionLayerHTML(index, name, color) {
        const layerNames = ['A', 'B', 'C', 'D'];
        const layerName = layerNames[index] || name || 'A';
        const defaultSamples = [
            'assets/audio/kick1.wav',
            'assets/audio/snare1.wav',
            'assets/audio/hat1.wav',
            'assets/audio/cym1.wav'
        ];
        const defaultSample = defaultSamples[index] || 'assets/audio/kick1.wav';

        return `
            <div class="partition-layer" data-layer-index="${index}" data-linked-layer="${index}" data-enabled="false" style="
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid ${color}40;
                border-left: 3px solid ${color};
                border-radius: 6px;
                padding: 12px 15px;
            ">
                <div class="partition-layer-header" style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <button class="partition-layer-toggle" style="
                        background: ${color};
                        color: #000;
                        border: none;
                        border-radius: 4px;
                        font-weight: 700;
                        font-size: 12px;
                        width: 28px;
                        height: 24px;
                        cursor: pointer;
                    ">${layerName}</button>
                    <span class="partition-layer-title" style="color: ${color}; font-weight: 600; font-size: 13px;">${name}</span>
                    <div style="margin-left: auto; display: flex; align-items: center; gap: 6px;">
                        <button class="partition-reset-btn" title="Reset partitions to 1" style="
                            background: #1b2a22;
                            color: #00ff88;
                            border: 1px solid #2f5d45;
                            border-radius: 4px;
                            padding: 2px 6px;
                            font-size: 12px;
                            cursor: pointer;
                            height: 24px;
                        ">⟲</button>
                        <button class="partition-settings-btn" title="Layer settings" data-mode="main" style="
                            background: #222;
                            color: #00ff88;
                            border: 1px solid #444;
                            border-radius: 4px;
                            padding: 4px 8px;
                            font-size: 10px;
                            cursor: pointer;
                            height: 24px;
                        ">Settings</button>
                    </div>
                </div>
                <div class="partition-main-panel">
                    <div class="partition-layer-controls" style="display: grid; grid-template-columns: 0.9fr 0.9fr 1fr 0.9fr; gap: 8px; align-items: start;">
                        <div style="color: #aaa; font-size: 11px; position: relative;">
                            <label class="partition-count-label" style="display: block; margin-bottom: 3px;">Partitions</label>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <input type="number" class="partition-count-input-primary" min="1" max="64" value="1" style="width: 52px; padding: 4px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 11px;">
                                <span style="color: #666;">-</span>
                                <input type="number" class="partition-count-input-secondary" min="1" max="64" value="" placeholder="" style="width: 52px; padding: 4px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 11px;">
                            </div>
                        </div>
                        <div style="color: #aaa; font-size: 11px;">
                            <label style="display: block; margin-bottom: 3px;">Mode</label>
                            <select class="partition-mode-select" style="width: 100%; padding: 5px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 11px;">
                                <option value="sequence" selected>Sequence</option>
                                <option value="grid">Grid</option>
                                <option value="grouping">Grouping</option>
                            </select>
                        </div>
                        <div style="color: #aaa; font-size: 11px;">
                            <label style="display: block; margin-bottom: 3px;">Sample</label>
                            <select class="partition-sample-select" style="width: 100%; padding: 5px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 11px;">
                                <option value="assets/audio/kick1.wav" ${defaultSample === 'assets/audio/kick1.wav' ? 'selected' : ''}>Kick 1</option>
                                <option value="assets/audio/kick2.wav" ${defaultSample === 'assets/audio/kick2.wav' ? 'selected' : ''}>Kick 2</option>
                                <option value="assets/audio/kick3.wav" ${defaultSample === 'assets/audio/kick3.wav' ? 'selected' : ''}>Kick 3</option>
                                <option value="assets/audio/kick4.wav" ${defaultSample === 'assets/audio/kick4.wav' ? 'selected' : ''}>Kick 4</option>
                                <option value="assets/audio/snare1.wav" ${defaultSample === 'assets/audio/snare1.wav' ? 'selected' : ''}>Snare 1</option>
                                <option value="assets/audio/snare2.wav" ${defaultSample === 'assets/audio/snare2.wav' ? 'selected' : ''}>Snare 2</option>
                                <option value="assets/audio/snare3.wav" ${defaultSample === 'assets/audio/snare3.wav' ? 'selected' : ''}>Snare 3</option>
                                <option value="assets/audio/snare4.wav" ${defaultSample === 'assets/audio/snare4.wav' ? 'selected' : ''}>Snare 4</option>
                                <option value="assets/audio/hat1.wav" ${defaultSample === 'assets/audio/hat1.wav' ? 'selected' : ''}>Hat 1</option>
                                <option value="assets/audio/hat2.wav" ${defaultSample === 'assets/audio/hat2.wav' ? 'selected' : ''}>Hat 2</option>
                                <option value="assets/audio/hat3.wav" ${defaultSample === 'assets/audio/hat3.wav' ? 'selected' : ''}>Hat 3</option>
                                <option value="assets/audio/hat4.wav" ${defaultSample === 'assets/audio/hat4.wav' ? 'selected' : ''}>Hat 4</option>
                                <option value="assets/audio/perc1.wav" ${defaultSample === 'assets/audio/perc1.wav' ? 'selected' : ''}>Perc 1</option>
                                <option value="assets/audio/perc2.wav" ${defaultSample === 'assets/audio/perc2.wav' ? 'selected' : ''}>Perc 2</option>
                                <option value="assets/audio/perc3.wav" ${defaultSample === 'assets/audio/perc3.wav' ? 'selected' : ''}>Perc 3</option>
                                <option value="assets/audio/perc4.wav" ${defaultSample === 'assets/audio/perc4.wav' ? 'selected' : ''}>Perc 4</option>
                                <option value="assets/audio/cym1.wav" ${defaultSample === 'assets/audio/cym1.wav' ? 'selected' : ''}>Cym 1</option>
                                <option value="assets/audio/cym2.wav" ${defaultSample === 'assets/audio/cym2.wav' ? 'selected' : ''}>Cym 2</option>
                                <option value="assets/audio/cym3.wav" ${defaultSample === 'assets/audio/cym3.wav' ? 'selected' : ''}>Cym 3</option>
                                <option value="assets/audio/cym4.wav" ${defaultSample === 'assets/audio/cym4.wav' ? 'selected' : ''}>Cym 4</option>
                            </select>
                        </div>
                        <div style="color: #aaa; font-size: 11px;">
                            <label style="display: block; margin-bottom: 3px;">Volume: <span class="partition-volume-value">-18 dB</span></label>
                            <input type="range" class="partition-volume-slider" min="-40" max="0" value="-18" style="width: 100%; height: 10px; margin-top: 6px;">
                        </div>
                    </div>
                    <div class="partition-preview" style="margin-top: 10px; padding: 10px; background: #111; border-radius: 4px; font-family: monospace; font-size: 11px; color: ${color}80;">
                        [Partition blocks placeholder]
                    </div>
                </div>
                <div class="partition-settings-panel" style="display: none; margin-top: 6px;">
                    <div style="display: grid; grid-template-columns: 1fr 0.45fr 1fr; gap: 10px; align-items: start;">
                        <div>
                            <div style="color: #aaa; font-size: 11px; margin-bottom: 6px;">Amplitude Envelope</div>
                            <div class="partition-adsr-controls" style="display: flex; gap: 24px; flex-wrap: wrap; justify-content: center;"></div>
                        </div>
                        <div>
                            <div style="color: #aaa; font-size: 11px; margin-bottom: 6px;">Pitch Shift</div>
                            <div class="partition-transpose-controls" style="display: flex; justify-content: center; margin-top: 7px;"></div>
                        </div>
                        <div>
                            <div style="color: #aaa; font-size: 11px; margin-bottom: 6px;">Filters</div>
                            <div style="display: grid; gap: 4px;">
                                <label style="color: #aaa; font-size: 10px;">
                                    Hi-Pass (Hz)
                                    <input type="number" class="partition-hipass-input" min="20" max="20000" value="20" style="width: 100%; margin-top: 3px; padding: 3px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 10px;">
                                </label>
                                <label style="color: #aaa; font-size: 10px;">
                                    Lo-Pass (Hz)
                                    <input type="number" class="partition-lopass-input" min="20" max="20000" value="20000" style="width: 100%; margin-top: 3px; padding: 3px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 10px;">
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    updatePartitionOptions() {
        // Called when rhythm changes - update target options based on new layers
        this.populatePartitionsContent();
    }

    updatePartitionBlocks(preview, color, partitions, mode, rhythmInfo, layerIndex, linkedLayerIndex = layerIndex, p2Value = '') {
        if (!preview || !window.PartitionsBlocks) return;
        const total = this.getPartitionMax(linkedLayerIndex, mode, rhythmInfo);
        const { sizes, baseSize } = window.PartitionsBlocks.calculatePartitionSizes(total, partitions);
        const partitionsValue = Number(partitions) || 1;
        const secondaryValue = Number(p2Value);
        const hasSecondary = Number.isFinite(secondaryValue) && secondaryValue > 0;
        const lastPartitions = Number(preview.dataset.lastPartitions || 0);
        const lastBlockCount = Number(preview.dataset.lastBlockCount || 0);
        const lastMode = preview.dataset.lastMode || '';
        if (lastMode && lastMode !== mode) {
            preview.dataset.mutedIndices = '';
            preview.dataset.orderIndices = '';
        }
        preview.dataset.lastMode = mode;

        const p2Count = hasSecondary ? Math.min(sizes.length, Math.floor(secondaryValue)) : 0;
        const activeL2 = hasSecondary && p2Count > 0;
        const blockCount = activeL2 ? p2Count : sizes.length;

        let mutedSet = new Set();
        if (preview.dataset.mutedIndices) {
            try {
                const muted = JSON.parse(preview.dataset.mutedIndices);
                if (Array.isArray(muted)) {
                    mutedSet = new Set(muted.filter((index) => index < blockCount));
                    preview.dataset.mutedIndices = JSON.stringify(Array.from(mutedSet));
                } else {
                    preview.dataset.mutedIndices = '';
                }
            } catch (_) {
                preview.dataset.mutedIndices = '';
            }
        }
        if (!activeL2) {
            if (preview.dataset.p2MutedBackup) {
                preview.dataset.mutedIndices = preview.dataset.p2MutedBackup;
                preview.dataset.orderIndices = preview.dataset.p2OrderBackup || preview.dataset.orderIndices;
                preview.dataset.p2MutedBackup = '';
                preview.dataset.p2OrderBackup = '';
                preview.dataset.p2Coverages = '';
                mutedSet = new Set();
                if (preview.dataset.mutedIndices) {
                    try {
                        const muted = JSON.parse(preview.dataset.mutedIndices);
                        if (Array.isArray(muted)) {
                            mutedSet = new Set(muted.filter((index) => index < sizes.length));
                        }
                    } catch (_) { /* ignore */ }
                }
            } else {
                if (partitionsValue > 32 && lastPartitions <= 32) {
                    mutedSet = new Set(sizes.map((_, index) => index));
                    preview.dataset.mutedIndices = JSON.stringify(Array.from(mutedSet));
                } else if (partitionsValue <= 32 && lastPartitions > 32) {
                    mutedSet = new Set();
                    preview.dataset.mutedIndices = '';
                } else if (partitionsValue > 32 && sizes.length > lastBlockCount) {
                    for (let i = lastBlockCount; i < sizes.length; i += 1) {
                        mutedSet.add(i);
                    }
                    preview.dataset.mutedIndices = JSON.stringify(Array.from(mutedSet));
                }
            }
        } else if (!preview.dataset.p2MutedBackup) {
            preview.dataset.p2MutedBackup = preview.dataset.mutedIndices || '';
            preview.dataset.p2OrderBackup = preview.dataset.orderIndices || '';
            preview.dataset.orderIndices = '';
            preview.dataset.mutedIndices = '';
            mutedSet = new Set();
        }
        preview.dataset.lastPartitions = String(partitionsValue);
        preview.dataset.lastBlockCount = String(blockCount);
        let order = null;
        if (preview.dataset.orderIndices) {
            try {
                const parsed = JSON.parse(preview.dataset.orderIndices);
                if (Array.isArray(parsed) && parsed.length === blockCount) {
                    order = parsed;
                } else {
                    preview.dataset.orderIndices = '';
                }
            } catch (_) {
                preview.dataset.orderIndices = '';
            }
        }

        const render = () => {
            if (activeL2 && window.PartitionsBlocks) {
                let l1Order = null;
                if (preview.dataset.p2OrderBackup) {
                    try {
                        const parsed = JSON.parse(preview.dataset.p2OrderBackup);
                        if (Array.isArray(parsed) && parsed.length === sizes.length) {
                            l1Order = parsed;
                        }
                    } catch (_) { /* identity */ }
                }
                const coverages = window.PartitionsBlocks.computeL2Coverages(sizes, l1Order, sizes.length, p2Count);
                if (!coverages || coverages.length === 0) return;
                const blockColors = window.PartitionsBlocks.computeL2BlockColors(coverages, color);
                const l2Total = coverages.reduce((sum, c) => sum + c, 0);
                preview.dataset.p2Coverages = JSON.stringify(coverages);
                preview.dataset.p2DisplayMap = '';
                preview.dataset.p2MutedIndices = '';

                window.PartitionsBlocks.renderBlocks(preview, coverages, 0, color, l2Total, mutedSet, (index) => {
                    if (mutedSet.has(index)) {
                        mutedSet.delete(index);
                    } else {
                        mutedSet.add(index);
                    }
                    preview.dataset.mutedIndices = JSON.stringify(Array.from(mutedSet));
                    window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
                    render();
                }, order, (fromIndex, toIndex) => {
                    if (!order) {
                        order = coverages.map((_, idx) => idx);
                    }
                    if (fromIndex === toIndex) return;
                    const moved = order.splice(fromIndex, 1)[0];
                    order.splice(toIndex, 0, moved);
                    preview.dataset.orderIndices = JSON.stringify(order);
                    window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
                    render();
                }, { allowDrag: true, blockColors });
            } else {
                preview.dataset.p2DisplayMap = '';
                preview.dataset.p2MutedIndices = '';
                preview.dataset.p2Coverages = '';

                window.PartitionsBlocks.renderBlocks(preview, sizes, baseSize, color, total, mutedSet, (index) => {
                    if (mutedSet.has(index)) {
                        mutedSet.delete(index);
                    } else {
                        mutedSet.add(index);
                    }
                    preview.dataset.mutedIndices = JSON.stringify(Array.from(mutedSet));
                    window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
                    render();
                }, order, (fromIndex, toIndex) => {
                    if (!order) {
                        order = sizes.map((_, idx) => idx);
                    }
                    if (fromIndex === toIndex) return;
                    const moved = order.splice(fromIndex, 1)[0];
                    order.splice(toIndex, 0, moved);
                    preview.dataset.orderIndices = JSON.stringify(order);
                    window.dispatchEvent(new CustomEvent('partitionsConfigChanged'));
                    render();
                }, { allowDrag: true });
            }
        };

        render();
    }


    getPartitionMax(layerIndex, mode, rhythmInfo) {
        if (!rhythmInfo) return 1;
        const layers = rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0
            ? rhythmInfo.displayLayers
            : rhythmInfo.layers || [];
        const layerValue = layers[layerIndex] || 0;
        if (mode === 'sequence') {
            return Math.max(1, Math.floor(layerValue || 1));
        }
        if (mode === 'grouping') {
            if (!layerValue) return 1;
            return Math.max(1, Math.floor(rhythmInfo.grid / layerValue));
        }
        return Math.max(1, Math.floor(rhythmInfo.grid || 1));
    }

    getLayerColor(layerIndex) {
        const colors = ['#ff6b6b', '#4ecdc4', '#00a638ff', '#f9ca24'];
        return colors[layerIndex] || '#00ff88';
    }

    // ====================================
    // PUBLIC API
    // ====================================

    toggle() {
        if (this.isActive) {
            this.hide();
        } else {
            this.show();
        }
    }
}

// Initialize and expose globally
document.addEventListener('DOMContentLoaded', () => {
    // Wait for other modules to be ready
    setTimeout(() => {
        window.partitionsUI = new PartitionsUI();
        console.log('🥁 PartitionsUI ready');
    }, 200);
});
