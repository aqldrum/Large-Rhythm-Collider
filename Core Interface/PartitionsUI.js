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
        this.createExpandedLayout();
        this.setupLiveMirrorCanvas();
        this.populatePartitionsContent();
        this.hidePlaybackDiv();
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

        // Remove the expanded layout
        this.removeExpandedLayout();

        // Restore playback div visibility
        this.restorePlaybackDiv();

        // Restore previous state
        this.restoreState();

        this.isActive = false;
        this.mirrorCanvas = null;
        this.mirrorCtx = null;

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
        const aspectRatio = 2; // 2:1 aspect ratio

        // Use exact same calculation as LRCVisuals and EIV for consistency
        const logicalWidth = containerWidth;
        const logicalHeight = logicalWidth / aspectRatio - 20; // Include the -20px adjustment

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

        // Create mirror canvas that will display a live copy of the main canvas
        this.mirrorCanvas = document.createElement('canvas');
        this.mirrorCanvas.id = 'partitions-mirror-canvas';
        this.mirrorCanvas.style.cssText = `
            width: 100%;
            height: 100%;
            display: block;
            background: #000000;
        `;

        // Get container dimensions and set canvas size
        const containerWidth = this.canvasContainer.clientWidth - 10;
        const containerHeight = this.canvasContainer.clientHeight - 10;

        // Set canvas dimensions
        this.mirrorCanvas.width = containerWidth;
        this.mirrorCanvas.height = containerHeight;
        this.mirrorCtx = this.mirrorCanvas.getContext('2d');

        // Add mirror canvas to container
        this.canvasContainer.appendChild(this.mirrorCanvas);

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

    // ====================================
    // EVENT LISTENERS
    // ====================================

    setupEventListeners() {
        // Listen for rhythm generation to update partition options
        this.rhythmGeneratedHandler = () => {
            if (this.isActive) {
                this.updatePartitionOptions();
                this.updateTitle();
            }
        };
        window.addEventListener('rhythmGenerated', this.rhythmGeneratedHandler);

        // Listen for window resize
        this.resizeHandler = () => {
            if (this.isActive) {
                this.handleResize();
            }
        };
        window.addEventListener('resize', this.resizeHandler);
    }

    removeEventListeners() {
        if (this.rhythmGeneratedHandler) {
            window.removeEventListener('rhythmGenerated', this.rhythmGeneratedHandler);
            this.rhythmGeneratedHandler = null;
        }
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }
    }

    handleResize() {
        // Recalculate container dimensions on resize (matching EIV pattern)
        const canvas = document.getElementById('visualization-canvas');
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth;
        const aspectRatio = 2;

        const logicalWidth = containerWidth;
        const logicalHeight = logicalWidth / aspectRatio - 20;

        // Update only the dimensions
        if (this.expandedContainer) {
            this.expandedContainer.style.width = `${logicalWidth}px`;
            this.expandedContainer.style.height = `${logicalHeight}px`;
        }
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
        const hasRhythm = window.lrcModule && window.lrcModule.grid > 0;

        if (!hasRhythm) {
            this.leftSection.innerHTML = `
                <div class="partitions-placeholder" style="color: #888; text-align: center; padding: 40px;">
                    <p>Generate a rhythm first to create partitions.</p>
                </div>
            `;
            return;
        }

        // Get rhythm info for display
        const rhythmInfo = window.lrcModule.getRhythmInfoData();
        const activeLayers = (rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0)
            ? rhythmInfo.displayLayers
            : rhythmInfo.layers;

        this.leftSection.innerHTML = `
            <div class="partitions-info" style="color: #ccc; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #333;">
                <p style="margin: 0 0 5px 0;"><strong style="color: #00ff88;">Current Rhythm:</strong> ${activeLayers.join(':')}</p>
                <p style="margin: 0; font-size: 12px; color: #888;">Grid: ${rhythmInfo.grid} | Fundamental: ${rhythmInfo.fundamental}</p>
            </div>

            <div class="partition-layers-container" style="display: flex; flex-direction: column; gap: 15px;">
                ${this.createPartitionLayerHTML(0, 'Kick', '#ff6b6b')}
                ${this.createPartitionLayerHTML(1, 'Snare', '#4ecdc4')}
                ${this.createPartitionLayerHTML(2, 'Hi-Hat', '#ffe66d')}
                ${this.createPartitionLayerHTML(3, 'Perc', '#95e1d3')}
            </div>

            <div class="partitions-footer" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #333;">
                <p style="color: #666; font-size: 11px; text-align: center; margin: 0;">
                    Partition controls - UI scaffold. Playback engine coming next.
                </p>
            </div>
        `;

        console.log('📋 Populated Partitions content');
    }

    createPartitionLayerHTML(index, name, color) {
        // Get available layer targets from current rhythm
        const rhythmInfo = window.lrcModule ? window.lrcModule.getRhythmInfoData() : null;
        const activeLayers = rhythmInfo?.displayLayers || rhythmInfo?.layers || [];

        let layerOptions = '<option value="grid">Entire Grid</option>';
        const layerNames = ['A', 'B', 'C', 'D'];

        activeLayers.forEach((layerValue, i) => {
            if (layerValue > 0) {
                const layerName = layerNames[i];
                const grouping = Math.round(rhythmInfo.grid / layerValue);
                layerOptions += `<option value="layer-${layerName.toLowerCase()}-freq">Layer ${layerName} Frequency (${layerValue})</option>`;
                layerOptions += `<option value="layer-${layerName.toLowerCase()}-group">Layer ${layerName} Grouping (${grouping})</option>`;
            }
        });

        return `
            <div class="partition-layer" data-layer-index="${index}" style="
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid ${color}40;
                border-left: 3px solid ${color};
                border-radius: 6px;
                padding: 12px 15px;
            ">
                <div class="partition-layer-header" style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <span style="color: ${color}; font-weight: 600; font-size: 14px;">${name}</span>
                    <label style="margin-left: auto; color: #888; font-size: 12px; display: flex; align-items: center; gap: 5px;">
                        <input type="checkbox" class="partition-layer-enabled" checked style="accent-color: ${color};"> Enabled
                    </label>
                </div>
                <div class="partition-layer-controls" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div class="partition-target" style="color: #aaa; font-size: 11px;">
                        <label style="display: block; margin-bottom: 4px;">Target:</label>
                        <select class="partition-target-select" style="width: 100%; padding: 5px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 11px;">
                            ${layerOptions}
                        </select>
                    </div>
                    <div class="partition-count" style="color: #aaa; font-size: 11px;">
                        <label style="display: block; margin-bottom: 4px;">Partition into:</label>
                        <input type="number" class="partition-count-input" value="4" min="1" max="64" style="width: 100%; padding: 5px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 11px; box-sizing: border-box;">
                    </div>
                    <div class="partition-distribution" style="color: #aaa; font-size: 11px; grid-column: span 2;">
                        <label style="display: block; margin-bottom: 4px;">Distribution:</label>
                        <select class="partition-distribution-select" style="width: 100%; padding: 5px; background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 11px;">
                            <option value="euclidean">Euclidean (Maximally Even)</option>
                            <option value="symmetric">Symmetric</option>
                            <option value="random">Random</option>
                            <option value="manual">Manual</option>
                        </select>
                    </div>
                </div>
                <div class="partition-preview" style="margin-top: 10px; padding: 8px; background: #111; border-radius: 4px; font-family: monospace; font-size: 11px; color: ${color}80;">
                    Preview: [distribution will appear here]
                </div>
            </div>
        `;
    }

    updatePartitionOptions() {
        // Called when rhythm changes - update target options based on new layers
        this.populatePartitionsContent();
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
