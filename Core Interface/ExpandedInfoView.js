// ExpandedInfoView.js - Fullscreen Expanded Info View for Large Rhythm Collider
// Handles detailed rhythm analysis with nested ratios, mini linear plot, and comprehensive metrics

class ExpandedInfoView {
    constructor() {
        this.isActive = false;
        this.expandedContainer = null;
        this.mirrorCanvas = null;
        this.mirrorCtx = null;
        this.originalVisualizationType = null;
        this.animationFrameId = null;
        this.originalRhythmInfoDisplay = null;
        this.originalCanvasVisibility = null;
        this.originalCanvasPointerEvents = null;
        
        // State management for proper cleanup
        this.stateBeforeExpansion = {
            rhythmInfoMinimized: false,
            panels: {}
        };

        // Cached handler references for collapsible sections
        this.leftSectionCollapsibleHandler = null;
        
        console.log('📊 ExpandedInfoView initialized with live mirroring support');
    }

    // ====================================
    // MAIN SHOW/HIDE FUNCTIONALITY
    // ====================================

    show() {
        if (this.isActive) {
            console.log('Expanded view already active');
            return;
        }

        // Close Partitions if it's open (mutual exclusion)
        if (window.partitionsUI && window.partitionsUI.isActive) {
            window.partitionsUI.hide();
            console.log('🔄 Closed Partitions to open EIV');
        }

        // Save current state for restoration
        this.captureCurrentState();

        this.isActive = true;
        this.createExpandedLayout();
        this.setupLiveMirrorCanvas();
        this.populateExpandedContent();
        this.hideRhythmInfoDiv();
        this.hideVisualizationCanvas();
        this.setupRhythmGenerationListener();
        this.setupWindowResizeListener();
        
        console.log('📊 Expanded Info View activated with live mirroring');
    }

    hide() {
        if (!this.isActive) {
            console.log('Expanded view already inactive');
            return;
        }

        this.isActive = false;
        this.stopLiveMirror();
        this.removeExpandedLayout();
        this.restoreRhythmInfoDiv();
        this.restoreVisualizationCanvas();
        this.restoreSystemState();
        this.removeRhythmGenerationListener();
        this.removeWindowResizeListener();
        
        console.log('📊 Expanded Info View closed and system state restored');
    }

    // ====================================
    // LAYOUT CREATION
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
        
        // Use existing EIV container from HTML instead of creating new one
        this.expandedContainer = document.getElementById('expanded-info-view');
        if (!this.expandedContainer) {
            console.error('EIV container not found in HTML');
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
        
        // EIV-specific styles without z-index conflicts
        const style = document.createElement('style');
        style.textContent = `
            
            /* Expanded Info View - Copy exact styles from style.css */
            #expanded-info-view .scale-chart {
                margin: 12px 0;
                padding: 8px;
                background: rgba(0, 0, 0, 0.3);
                border-radius: 4px;
                border: 1px solid rgba(100, 100, 100, 0.3);
            }
            
            #expanded-info-view .pitch-count-display {
                margin-bottom: 8px;
                padding: 4px 0;
                text-align: center;
                color: #00ff88;
                font-size: 12px;
                font-weight: 600;
                border-bottom: 1px solid rgba(100, 100, 100, 0.3);
            }
            
            #expanded-info-view .scale-header {
                display: flex;
                justify-content: center;
                align-items: center;
                margin-bottom: 8px;
                padding-bottom: 6px;
            }
            
            #expanded-info-view .scale-type {
                color: #cccccc;
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            #expanded-info-view .scale-table-container {
                max-height: 300px;
                overflow-y: auto;
                border: 1px solid rgba(100, 100, 100, 0.3);
                border-radius: 4px;
            }
            
            #expanded-info-view .scale-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 10px;
                font-family: monospace;
            }
            
            #expanded-info-view .scale-table thead {
                background: rgba(0, 255, 136, 0.1);
                position: sticky;
                top: 0;
            }
            
            #expanded-info-view .scale-table th {
                padding: 6px 8px;
                text-align: left;
                color: #00ff88;
                font-weight: 600;
                font-size: 9px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                border-bottom: 1px solid rgba(100, 100, 100, 0.3);
            }
            
            #expanded-info-view .scale-table td {
                padding: 4px 8px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                color: #ffffff;
            }
            
            #expanded-info-view .scale-table tbody tr:hover {
                background: rgba(0, 255, 136, 0.1);
            }
            
            #expanded-info-view .pitch-row {
                cursor: pointer;
                transition: background-color 0.2s ease, color 0.2s ease;
            }
            
            #expanded-info-view .pitch-row.pitch-selected {
                background: rgba(255, 255, 255, 0.9) !important;
                color: #000000 !important;
            }
            
            #expanded-info-view .pitch-row.pitch-consonant {
                background: rgba(0, 255, 136, 0.4) !important;
                color: #ffffff !important;
            }
            
            #expanded-info-view .pitch-row.pitch-selected:hover,
            #expanded-info-view .pitch-row.pitch-consonant:hover {
                background: rgba(0, 255, 136, 0.6) !important;
            }
            
            /* Interconsonance styles - copied from style.css */
            #expanded-info-view .analyze-btn {
                background: #00ff88;
                color: #000;
                border: none;
                padding: 4px 8px;
                border-radius: 3px;
                font-size: 11px;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.2s;
                margin-left: 10px;
            }
            
            #expanded-info-view .analyze-btn:hover {
                background: #00cc66;
                transform: scale(1.05);
            }
            
            #expanded-info-view .analyze-btn:disabled {
                background: rgba(255, 255, 255, 0.3);
                color: rgba(255, 255, 255, 0.6);
                cursor: not-allowed;
                transform: none;
            }
            
            #expanded-info-view .interconsonance-results {
                font-family: monospace;
                font-size: 11px;
            }
            
            #expanded-info-view .analysis-summary {
                background: rgba(0, 255, 136, 0.1);
                border: 1px solid #00ff88;
                padding: 8px;
                border-radius: 4px;
                margin-bottom: 12px;
            }
            
            #expanded-info-view .analysis-summary h4 {
                color: #00ff88;
                margin-bottom: 6px;
            }
            
            #expanded-info-view .analysis-summary p {
                margin: 2px 0;
                font-size: 10px;
            }
            
            #expanded-info-view .show-intervals-btn, 
            #expanded-info-view .show-matrix-btn {
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(100, 100, 100, 0.3);
                color: #ffffff;
                padding: 4px 8px;
                border-radius: 3px;
                font-size: 10px;
                cursor: pointer;
                transition: background 0.2s;
            }
            
            #expanded-info-view .show-intervals-btn:hover, 
            #expanded-info-view .show-matrix-btn:hover {
                background: rgba(255, 255, 255, 0.2);
            }
            
            #expanded-info-view .intervals-table, 
            #expanded-info-view .full-intervals-table {
                width: 100%;
                border-collapse: collapse;
                font-family: monospace;
                font-size: 9px;
                background: rgba(0, 0, 0, 0.3);
            }
            
            #expanded-info-view .intervals-table th, 
            #expanded-info-view .intervals-table td,
            #expanded-info-view .full-intervals-table th, 
            #expanded-info-view .full-intervals-table td {
                border: 1px solid rgba(100, 100, 100, 0.3);
                padding: 3px 5px;
                text-align: left;
            }
            
            #expanded-info-view .intervals-table th, 
            #expanded-info-view .full-intervals-table th {
                background: rgba(255, 255, 255, 0.1);
                font-weight: bold;
                font-size: 8px;
            }
            
            #expanded-info-view .consonant-row {
                background: rgba(0, 255, 0, 0.1);
            }
            
            #expanded-info-view .dissonant-row {
                background: rgba(255, 0, 0, 0.1);
            }
            
            /* Disable minimize functionality in expanded view interconsonance only - but don't affect children */
            #expanded-info-view .info-subsection .subsection-header {
                cursor: default !important;
            }
            
            /* Specifically disable clicking on header text but not the entire header */
            #expanded-info-view .info-subsection .subsection-header:not(:has(button)) {
                pointer-events: none !important;
            }
            
            /* Ensure buttons in expanded view are clickable */
            #expanded-info-view button {
                pointer-events: auto !important;
                cursor: pointer !important;
                z-index: 1002;
                position: relative;
            }
            
            #expanded-info-view .show-intervals-btn,
            #expanded-info-view .show-matrix-btn {
                pointer-events: auto !important;
                cursor: pointer !important;
            }
        `;
        document.head.appendChild(style);

        // Title bar for expanded view (matches existing panel styles)
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

        // Left section (50% width)
        const leftSection = document.createElement('div');
        leftSection.className = 'expanded-left-section';
        leftSection.style.cssText = `
            width: 50%;
            padding: 20px;
            overflow-y: auto;
            background: #1a1a1a;
        `;

        // Right section (50% width, split into quadrants)
        const rightSection = document.createElement('div');
        rightSection.className = 'expanded-right-section';
        rightSection.style.cssText = `
            width: 50%;
            display: grid;
            grid-template-rows: 1fr 1fr;
            gap: 10px;
            padding: 20px;
            background: #1a1a1a;
        `;

        const title = document.createElement('h3');
        // Get current layers for title
        const rhythmInfo = window.lrcModule ? window.lrcModule.getRhythmInfoData() : null;
        const displayLayers = rhythmInfo && rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0
            ? rhythmInfo.displayLayers
            : rhythmInfo?.layers || [];
        const layersText = displayLayers.length > 0 ? displayLayers.join(':') : '';
        title.textContent = `Expanded Info View ${layersText ? '- ' + layersText : ''}`;
        title.style.cssText = `
            color: #00ff88;
            margin: 0;
            font-size: 18px;
            font-weight: 300;
            letter-spacing: 2px;
        `;

        // Mac OS style red close button
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

        // Upper right quadrant - Canvas container
        const canvasContainer = document.createElement('div');
        canvasContainer.id = 'expanded-canvas-container';
        canvasContainer.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // Lower right quadrant - Scale and Interconsonance
        const scaleInterconsonanceContainer = document.createElement('div');
        scaleInterconsonanceContainer.style.cssText = `
            background: #1a1a1a;
            padding: 10px;
            display: flex;
            gap: 1px;
            overflow: hidden;
        `;

        // Create scale section (50% of lower right)
        const scaleSection = document.createElement('div');
        scaleSection.id = 'expanded-scale-section';
        scaleSection.style.cssText = `
            flex: 1;
            overflow-y: auto;
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 4px;
            margin-right: 7px;
        `;

        // Create interconsonance section (50% of lower right)
        const interconsonanceSection = document.createElement('div');
        interconsonanceSection.id = 'expanded-interconsonance-section';
        interconsonanceSection.style.cssText = `
            flex: 1;
            overflow-y: auto;
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 4px;
            margin-left: 7px;
        `;

        // Assemble right section
        rightSection.appendChild(canvasContainer);
        scaleInterconsonanceContainer.appendChild(scaleSection);
        scaleInterconsonanceContainer.appendChild(interconsonanceSection);
        rightSection.appendChild(scaleInterconsonanceContainer);

        // Assemble content container
        contentContainer.appendChild(leftSection);
        contentContainer.appendChild(rightSection);

        // Assemble main container
        this.expandedContainer.appendChild(titleBar);
        this.expandedContainer.appendChild(contentContainer);

        // Container is already in HTML - no need to append

        // Store references
        this.leftSection = leftSection;
        this.canvasContainer = canvasContainer;
        this.scaleSection = scaleSection;
        this.interconsonanceSection = interconsonanceSection;
    }

    removeExpandedLayout() {
        this.teardownCollapsibleListeners();

        if (this.expandedContainer) {
            // Remove added styles
            const styles = document.head.querySelectorAll('style');
            styles.forEach(style => {
                if (style.textContent.includes('#expanded-info-view')) {
                    document.head.removeChild(style);
                }
            });
            
            // Clear content and hide container
            this.expandedContainer.innerHTML = '';
            this.expandedContainer.style.display = 'none';
        }
        
        // Clear all references except expandedContainer (since it stays in DOM)
        this.leftSection = null;
        this.canvasContainer = null;
        this.scaleSection = null;
        this.interconsonanceSection = null;
        
        console.log('📊 Expanded layout hidden and references cleared');
    }

    // ====================================
    // LIVE MIRROR CANVAS SYSTEM
    // ====================================

    captureCurrentState() {
        // Capture rhythm info panel state
        const rhythmInfoDiv = document.getElementById('rhythm-info-div');
        if (rhythmInfoDiv) {
            this.stateBeforeExpansion.rhythmInfoMinimized = rhythmInfoDiv.classList.contains('minimized');
        }

        console.log('📊 Captured system state:', this.stateBeforeExpansion);
    }

    setupLiveMirrorCanvas() {
        if (!this.canvasContainer) {
            console.error('Canvas container not found for mirror setup');
            return;
        }

        // Create mirror canvas that will display a live copy of the main canvas
        this.mirrorCanvas = document.createElement('canvas');
        this.mirrorCanvas.id = 'expanded-mirror-canvas';
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

        console.log('📊 Live mirror canvas setup completed');
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
        console.log('📊 Live mirroring started');
    }

    stopLiveMirror() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.mirrorCanvas && this.canvasContainer && this.canvasContainer.contains(this.mirrorCanvas)) {
            this.canvasContainer.removeChild(this.mirrorCanvas);
        }

        this.mirrorCanvas = null;
        this.mirrorCtx = null;
        console.log('📊 Live mirroring stopped');
    }

    restoreSystemState() {
        // Reset rhythm info to minimized state
        this.resetRhythmInfoToMinimized();
    }

    // ====================================
    // PANEL MANAGEMENT
    // ====================================

    hideRhythmInfoDiv() {
        // Hide the rhythm-info-div since it becomes the EIV
        const rhythmInfoDiv = document.getElementById('rhythm-info-div');
        if (rhythmInfoDiv) {
            this.originalRhythmInfoDisplay = rhythmInfoDiv.style.display;
            rhythmInfoDiv.style.display = 'none';
            console.log('📊 Hidden rhythm-info-div for EIV expansion');
        }
    }

    restoreRhythmInfoDiv() {
        // Restore rhythm-info-div visibility  
        const rhythmInfoDiv = document.getElementById('rhythm-info-div');
        if (rhythmInfoDiv) {
            rhythmInfoDiv.style.display = this.originalRhythmInfoDisplay || '';
            console.log('📊 Restored rhythm-info-div visibility');
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

    // Panels are now accessible via proper z-index layers - no repositioning needed

    resetRhythmInfoToMinimized() {
        const rhythmInfoDiv = document.getElementById('rhythm-info-div');
        const minimizeBtn = rhythmInfoDiv?.querySelector('.minimize-btn');

        if (rhythmInfoDiv && minimizeBtn) {
            // Force to minimized state
            rhythmInfoDiv.classList.add('minimized');
            minimizeBtn.textContent = '+';

            // Reset to default position
            if (window.lrcHUD) {
                window.lrcHUD.resetAllPositions();
            }
        }
    }

    // ====================================
    // CONTENT POPULATION
    // ====================================

    populateExpandedContent() {
        this.populateLeftSection();
        this.populateScaleSection();
        this.populateInterconsonanceSection();
    }

    populateLeftSection() {
        if (!this.leftSection || !window.lrcModule) return;

        const rhythmInfo = window.lrcModule.getRhythmInfoData();
        const activeLayers = (rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0)
            ? rhythmInfo.displayLayers
            : rhythmInfo.layers;

        // Calculate groupings (grid/layer for each layer)
        const groupings = (rhythmInfo.displayGroupings && rhythmInfo.displayGroupings.length > 0)
            ? rhythmInfo.displayGroupings
            : activeLayers.map(layer => Math.round(rhythmInfo.grid / layer));
        const layerDisplayText = activeLayers.length > 0 ? activeLayers.join(':') : '—';
        const groupingDisplayText = groupings.length > 0 ? groupings.join(', ') : '—';

        // Calculate nested ratios
        const nestedRatios = this.calculateNestedRatios(activeLayers, rhythmInfo.grid);
        const hasNestedRatios = nestedRatios.length > 0;

        // Create main container with flex layout
        this.leftSection.style.cssText += `
            display: flex;
            flex-direction: column;
            gap: 0;
        `;

        // Determine section heights based on whether nested ratios exist
        const metricsHeight = hasNestedRatios ? '33.33%' : '50%';
        const nestedRatiosHeight = hasNestedRatios ? '33.33%' : '0%';
        const exportHeight = hasNestedRatios ? '33.34%' : '50%';

        const content = `
            <div class="expanded-metrics-section" style="
                height: ${metricsHeight};
                overflow-y: auto;
                padding: 0 12px 15px 12px;
                border-bottom: 1px solid #333;
                margin-bottom: 15px;
            ">
                <div class="subsection-header" style="color: #00ff88; font-size: 16px; margin-bottom: 15px; font-weight: bold; padding: 8px 0 8px 12px;">
                    Metrics
                </div>
                
                <div style="display: grid; grid-template-rows: auto auto auto; gap: 12px; margin-bottom: 20px;">
                    <div class="metric-row" style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap;">
                        <div class="layers-display" style="color: #ffffff; white-space: nowrap;">Layers: <span>${layerDisplayText}</span></div>
                        <div class="grid-display" style="color: #ffffff;">Grid: <span>${rhythmInfo.grid}</span></div>
                        <div class="groupings-display" style="color: #ffffff;">Groupings: <span>${groupingDisplayText}</span></div>
                    </div>
                    <div class="metric-row" style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap;">
                        <div class="fundamental-display" style="color: #ffffff;">Fundamental: <span>${Math.round(rhythmInfo.fundamental)}</span></div>
                        ${rhythmInfo.avgDeviation !== null ? 
                            `<div class="avg-dev-display" style="color: #ffffff;">Avg Dev: <span>${rhythmInfo.avgDeviation.toFixed(3)}</span></div>` : ''
                        }
                        <div class="range-display" style="color: #ffffff;">Range: <span>${rhythmInfo.range.toFixed(2)}</span></div>
                        <div class="rhythm-density" style="color: #ffffff;">Density: <span>${rhythmInfo.density.toFixed(1)}%</span></div>
                    </div>
                    <div class="metric-row" style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap;">
                        <div class="pg-ratio" style="color: #ffffff;">P/G Ratio: <span>${rhythmInfo.pulseToGrouping.toFixed(2)}</span></div>
                        <div class="composite-length" style="color: #ffffff;">Composite Length: <span>${rhythmInfo.compositeLength}</span></div>
                        <div class="layer-sum" style="color: #ffffff;">Layer Sum: <span>${rhythmInfo.layerSum}</span></div>
                    </div>
                </div>

                ${this.getMirroredSpacesPlotSection()}
                
                ${this.getMirroredCompositeRhythmSection()}
            </div>

            ${hasNestedRatios ? `
            <div class="expanded-nested-ratios-section" style="
                height: ${nestedRatiosHeight};
                overflow-y: auto;
                padding: 0 12px 15px 12px;
                border-bottom: 1px solid #333;
                margin-bottom: 15px;
            ">
                <div class="subsection-header" style="color: #00ff88; font-size: 16px; margin-bottom: 15px; font-weight: bold; padding: 8px 0 8px 12px;">
                    Nested Ratios
                </div>
                <div style="color: #ffffff; font-size: 12px; line-height: 1.8;">
                    ${this.formatNestedRatiosInRows(nestedRatios)}
                </div>
            </div>
            ` : ''}

            <div class="expanded-export-section" style="
                height: ${exportHeight};
                overflow-y: auto;
                padding: ${hasNestedRatios ? '0' : '15px'} 12px 0 12px;
            ">
                <div class="subsection-header" style="color: #00ff88; font-size: 16px; margin-bottom: 15px; font-weight: bold; padding: 8px 0 8px 12px;">
                    Export
                </div>
                <div class="export-controls" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <button class="export-btn" id="expanded-export-pdf-btn" style="
                        background: #444;
                        border: 1px solid #666;
                        color: #fff;
                        padding: 8px 12px;
                        font-size: 12px;
                        border-radius: 3px;
                        cursor: pointer;
                        font-family: monospace;
                        transition: background 0.2s;
                    ">Export Info</button>
                    <button class="export-btn" id="expanded-export-midi-btn" style="
                        background: #444;
                        border: 1px solid #666;
                        color: #fff;
                        padding: 8px 12px;
                        font-size: 12px;
                        border-radius: 3px;
                        cursor: pointer;
                        font-family: monospace;
                        transition: background 0.2s;
                    ">Export MIDI</button>
                    <button class="export-btn" id="expanded-export-scl-btn" style="
                        background: #444;
                        border: 1px solid #666;
                        color: #fff;
                        padding: 8px 12px;
                        font-size: 12px;
                        border-radius: 3px;
                        cursor: pointer;
                        font-family: monospace;
                        transition: background 0.2s;
                    ">Export .scl (root C)</button>
                    <button class="export-btn" id="expanded-export-tun-btn" style="
                        background: #444;
                        border: 1px solid #666;
                        color: #fff;
                        padding: 8px 12px;
                        font-size: 12px;
                        border-radius: 3px;
                        cursor: pointer;
                        font-family: monospace;
                        transition: background 0.2s;
                    ">Export .tun (root A)</button>
                </div>
            </div>
        `;

        this.leftSection.innerHTML = content;
        
        // Setup direct click listeners since main system may not catch EIV elements
        this.setupDirectCollapsibleListeners();
        
        // Setup export button listeners
        this.setupExpandedExportListeners();
    }

    setupExpandedExportListeners() {
        // PDF Export
        const pdfBtn = document.getElementById('expanded-export-pdf-btn');
        if (pdfBtn) {
            pdfBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.lrcExport) {
                    window.lrcExport.export('pdf');
                } else {
                    console.error('LRCExport module not available');
                }
            });
            
            // Add hover effects
            pdfBtn.addEventListener('mouseenter', () => pdfBtn.style.background = '#555');
            pdfBtn.addEventListener('mouseleave', () => pdfBtn.style.background = '#444');
        }

        // MIDI Export
        const midiBtn = document.getElementById('expanded-export-midi-btn');
        if (midiBtn) {
            midiBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showMidiRootPopup();
            });
            
            midiBtn.addEventListener('mouseenter', () => midiBtn.style.background = '#555');
            midiBtn.addEventListener('mouseleave', () => midiBtn.style.background = '#444');
        }

        // SCL Export
        const sclBtn = document.getElementById('expanded-export-scl-btn');
        if (sclBtn) {
            sclBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.lrcExport) {
                    window.lrcExport.export('tuning', 'scl');
                } else {
                    console.error('LRCExport module not available');
                }
            });
            
            sclBtn.addEventListener('mouseenter', () => sclBtn.style.background = '#555');
            sclBtn.addEventListener('mouseleave', () => sclBtn.style.background = '#444');
        }

        // TUN Export
        const tunBtn = document.getElementById('expanded-export-tun-btn');
        if (tunBtn) {
            tunBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.lrcExport) {
                    window.lrcExport.export('tuning', 'tun');
                } else {
                    console.error('LRCExport module not available');
                }
            });
            
            tunBtn.addEventListener('mouseenter', () => tunBtn.style.background = '#555');
            tunBtn.addEventListener('mouseleave', () => tunBtn.style.background = '#444');
        }
    }

    populateScaleSection() {
        if (!this.scaleSection || !window.lrcModule) return;

        // Apply proper styling for scale section with intelligent scrolling
        this.scaleSection.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 10px;
            padding-bottom: 50px;
        `;

        // Generate the scale chart content using the same logic as the original
        const rhythmInfo = window.lrcModule.getRhythmInfoData();
        const ratios = window.lrcModule.currentRatios;
        
        if (ratios && ratios.length > 0) {
            let html = `
                <div class="subsection-header" style="color: #00ff88; font-size: 14px; margin: 0; padding: 10px 10px 5px 10px; font-weight: bold; background: #2a2a2a; border-bottom: 1px solid #444;">Scale</div>
                <div style="padding: 10px;">
                    <div class="pitch-count-display">
                        <strong>${rhythmInfo.pitchCount} ${rhythmInfo.pitchCount === 1 ? 'Pitch' : 'Pitches'}</strong>
                    </div>
                    <div class="scale-header">
                        <span class="scale-type">FUNDAMENTAL ${Number.isFinite(rhythmInfo.fundamental) ? Math.round(rhythmInfo.fundamental).toLocaleString('en-US') : '—'}</span>
                    </div>
                    <div class="scale-table-container">
                        <table class="scale-table">
                            <thead>
                                <tr>
                                    <th>Ratio</th>
                                    <th>Cents</th>
                                    <th>Count</th>
                                </tr>
                            </thead>
                            <tbody>
            `;
            
            // Add all ratios to the table with clickable pitch selection that works with expanded interconsonance
            ratios.forEach((ratio, index) => {
                const cents = ratio.cents ? ratio.cents.toFixed(1) : '0.0';
                html += `
                    <tr class="pitch-row" data-pitch-index="${index}" onclick="window.expandedInfoView.selectPitch(${index})" style="cursor: pointer;">
                        <td class="ratio-cell">${ratio.fraction}</td>
                        <td class="cents-cell">${cents}</td>
                        <td class="count-cell">${ratio.frequency ?? 0}</td>
                    </tr>
                `;
            });
            
            html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            
            this.scaleSection.innerHTML = html;
        } else {
            this.scaleSection.innerHTML = `
                <div class="subsection-header" style="color: #00ff88; font-size: 14px; margin: 0; padding: 10px 10px 5px 10px; font-weight: bold; background: #2a2a2a; border-bottom: 1px solid #444;">Scale</div>
                <div style="color: #888; padding: 10px;">No scale data available</div>
            `;
        }
    }

    populateInterconsonanceSection() {
        if (!this.interconsonanceSection) return;

        // Apply proper styling for interconsonance section
        this.interconsonanceSection.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        `;

        // Find and copy the actual interconsonance section from the original rhythm-info-div
        const originalRhythmInfoDiv = document.getElementById('rhythm-info-div');
        const originalInterconsonanceSection = originalRhythmInfoDiv?.querySelector('.info-subsection');
        
        if (originalInterconsonanceSection) {
            // Find the interconsonance subsection specifically (look for one with "Interconsonance" header)
            const interconsonanceSections = originalRhythmInfoDiv.querySelectorAll('.info-subsection');
            let targetSection = null;
            
            interconsonanceSections.forEach(section => {
                const header = section.querySelector('.subsection-header');
                if (header && header.textContent.includes('Interconsonance')) {
                    targetSection = section;
                }
            });
            
            if (targetSection) {
                // Clone the entire interconsonance section structure
                const clonedSection = targetSection.cloneNode(true);
                
                // Remove any top margin from the cloned section to align with Scale chart
                clonedSection.style.marginTop = '0';
                clonedSection.style.paddingTop = '0';
                
                // Update the header styling for expanded view and make it non-minimizable
                const header = clonedSection.querySelector('.subsection-header');
                if (header) {
                    header.style.cssText = 'color: #00ff88; font-size: 14px; margin: 0; padding: 10px 10px 5px 10px; font-weight: bold; cursor: default; background: #2a2a2a; border-bottom: 1px solid #444; user-select: none;';
                    // Remove the data-target to disable minimization
                    header.removeAttribute('data-target');
                }
                
                // Update IDs to avoid conflicts with original, but preserve functional IDs that LRCInterconsonance expects
                const elementsWithIds = clonedSection.querySelectorAll('[id]');
                const preservedIds = ['full-interval-matrix']; // IDs that should not be prefixed
                
                elementsWithIds.forEach(element => {
                    const oldId = element.id;
                    // Don't prefix IDs that start with 'family-intervals-' or are in preservedIds
                    if (!preservedIds.includes(oldId) && !oldId.startsWith('family-intervals-')) {
                        element.id = 'expanded-' + oldId;
                    }
                    // For functional IDs, keep them as-is so LRCInterconsonance functions work
                });
                
                // Force the content to be visible (expanded) and keep it that way
                const content = clonedSection.querySelector('.subsection-content');
                if (content) {
                    content.style.display = 'block';
                    content.style.padding = '10px';
                    content.id = 'expanded-' + content.id;
                }
                
                // Set the content
                this.interconsonanceSection.innerHTML = '';
                this.interconsonanceSection.appendChild(clonedSection);
                
                // Setup the cloned functionality with preserved onclick attributes
                this.setupClonedInterconsonanceSection();
            } else {
                // Fallback if interconsonance section not found
                this.createDefaultInterconsonanceSection();
            }
        } else {
            // Fallback if original rhythm info div not found
            this.createDefaultInterconsonanceSection();
        }
        
        // Don't setup behavior here - it will be called after sync in syncInterconsonanceResultsWithOnclick()
    }

    // ====================================
    // NESTED RATIOS CALCULATION
    // ====================================

    calculateNestedRatios(layers, grid) {
        const results = [];
        
        // Generate all combinations and calculate their GCD relationships
        const combinations = this.generateLayerCombinations(layers);
        
        combinations.forEach(combo => {
            const gcd = this.calculateGCD(combo.values);
            if (gcd > 1) {
                const simplified = combo.values.map(v => v / gcd);
                
                // The repetition factor is the GCD itself - it's how many times the simplified ratio occurs
                // For example: 594:330 -> GCD=66, so 66x the ratio 9:5 (since 594=9*66, 330=5*66)
                const repetitions = gcd;
                
                results.push({
                    layers: combo.layers,
                    originalValues: combo.values,
                    simplified: simplified,
                    gcdFactor: gcd,
                    repetitions: repetitions,
                    type: combo.layers.length // 2=pair, 3=triple, 4=quadruple
                });
            }
        });
        
        // Sort by repetitions (descending), then by type (quadruples first)
        results.sort((a, b) => {
            if (b.repetitions !== a.repetitions) {
                return b.repetitions - a.repetitions;
            }
            return b.type - a.type;
        });
        
        return results;
    }

    generateLayerCombinations(layers) {
        const combinations = [];
        const layerNames = ['A', 'B', 'C', 'D'];
        
        // Generate pairs
        for (let i = 0; i < layers.length; i++) {
            for (let j = i + 1; j < layers.length; j++) {
                combinations.push({
                    layers: [layerNames[i], layerNames[j]],
                    values: [layers[i], layers[j]]
                });
            }
        }
        
        // Generate triples
        for (let i = 0; i < layers.length; i++) {
            for (let j = i + 1; j < layers.length; j++) {
                for (let k = j + 1; k < layers.length; k++) {
                    combinations.push({
                        layers: [layerNames[i], layerNames[j], layerNames[k]],
                        values: [layers[i], layers[j], layers[k]]
                    });
                }
            }
        }
        
        // Generate quadruple (if 4 layers)
        if (layers.length === 4) {
            combinations.push({
                layers: ['A', 'B', 'C', 'D'],
                values: layers
            });
        }
        
        return combinations;
    }

    calculateGCD(numbers) {
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        return numbers.reduce((result, num) => gcd(result, num));
    }

    calculateLCM(numbers) {
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const lcm = (a, b) => (a * b) / gcd(a, b);
        return numbers.reduce((result, num) => lcm(result, num));
    }

    formatNestedRatios(nestedRatios) {
        if (nestedRatios.length === 0) {
            return '<div style="color: #888;">No nested structures found (coprime layers)</div>';
        }

        let html = '';
        let currentRepetitions = -1;

        nestedRatios.forEach(ratio => {
            // Add repetition header when it changes
            if (ratio.repetitions !== currentRepetitions) {
                currentRepetitions = ratio.repetitions;
                html += `<div style="color: #00ff88; font-weight: bold; margin-top: 15px; margin-bottom: 5px;">${currentRepetitions}x</div>`;
            }

            const layerStr = ratio.layers.join(':');
            const originalStr = ratio.originalValues.join(':');
            const simplifiedStr = ratio.simplified.join(':');
            
            html += `<div style="margin-left: 10px; margin-bottom: 3px;">`;
            // Use equals sign for all nested ratios (pairs, triples, quadruples)
            html += `${layerStr} ${originalStr} = ${simplifiedStr}`;
            html += `</div>`;
        });

        return html;
    }

    formatNestedRatiosInRows(nestedRatios) {
        if (nestedRatios.length === 0) {
            return '<div style="color: #888;">No nested structures found (coprime layers)</div>';
        }

        let html = '';
        let currentRepetitions = -1;
        let needsRowClose = false;
        let needsGroupClose = false;

        nestedRatios.forEach(ratio => {
            // Add repetition header when it changes
            if (ratio.repetitions !== currentRepetitions) {
                currentRepetitions = ratio.repetitions;
                
                // Close previous containers if they exist
                if (needsRowClose) {
                    html += '</div>'; // Close grid container
                    needsRowClose = false;
                }
                if (needsGroupClose) {
                    html += '</div>'; // Close group container
                    needsGroupClose = false;
                }
                
                // Start new GCD group
                html += `<div style="margin-bottom: 20px;">`;
                needsGroupClose = true;
                html += `<div style="color: #00ff88; font-weight: bold; margin-bottom: 8px;">${currentRepetitions}x</div>`;
                html += `<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-left: 10px;">`;
                needsRowClose = true;
            }

            const layerStr = ratio.layers.join(':');
            const originalStr = ratio.originalValues.join(':');
            const simplifiedStr = ratio.simplified.join(':');
            
            html += `<div style="margin-bottom: 3px;">`;
            // Use equals sign for all nested ratios (pairs, triples, quadruples)
            html += `${layerStr} ${originalStr} = ${simplifiedStr}`;
            html += `</div>`;
        });

        // Close final containers
        if (needsRowClose) {
            html += '</div>'; // Close grid container
        }
        if (needsGroupClose) {
            html += '</div>'; // Close group container
        }

        return html;
    }

    // ====================================
    // TITLE BAR PANELS
    // ====================================

    createTitleBarPanels(container) {
        // Create mini versions of the 4 main panels: Visualizations, Playback, Search, Rhythm Submit
        const panelConfigs = [
            { id: 'expanded-rhythm-submit', title: 'Input', originalId: 'rhythm-submit-div' },
            { id: 'expanded-visualizations', title: 'Viz', originalId: 'visualizations-div' },
            { id: 'expanded-playback', title: 'Play', originalId: 'playback-div' },
            { id: 'expanded-search', title: 'Search', originalId: 'search-div' }
        ];

        panelConfigs.forEach(config => {
            const miniPanel = document.createElement('div');
            miniPanel.id = config.id;
            miniPanel.className = 'expanded-title-bar-panel';
            miniPanel.style.cssText = `
                background: #2a2a2a;
                border: 1px solid #444;
                border-radius: 3px;
                padding: 4px 8px;
                font-size: 11px;
                font-weight: bold;
                color: #00ff88;
                cursor: pointer;
                user-select: none;
                position: relative;
                min-width: 45px;
                text-align: center;
                transition: background 0.2s;
            `;

            // Add minimize/expand functionality
            miniPanel.innerHTML = `
                <div class="mini-panel-header" style="pointer-events: none;">
                    ${config.title}
                </div>
                <div class="mini-panel-content" style="
                    position: absolute;
                    top: 100%;
                    right: 0;
                    background: #2a2a2a;
                    border: 1px solid #444;
                    border-radius: 4px;
                    padding: 10px;
                    min-width: 200px;
                    max-width: 300px;
                    z-index: 1002;
                    display: none;
                    max-height: 400px;
                    overflow-y: auto;
                ">
                    <div class="mini-panel-content-inner">
                        <!-- Content will be populated from original panel -->
                    </div>
                </div>
            `;

            // Add hover and click behavior
            miniPanel.addEventListener('mouseenter', () => {
                if (!miniPanel.classList.contains('expanded')) {
                    miniPanel.style.background = '#3a3a3a';
                }
            });

            miniPanel.addEventListener('mouseleave', () => {
                if (!miniPanel.classList.contains('expanded')) {
                    miniPanel.style.background = '#2a2a2a';
                }
            });

            miniPanel.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleTitleBarPanel(miniPanel, config);
            });

            container.appendChild(miniPanel);
        });

        // Store reference to container
        this.titleBarPanels = container;
    }

    toggleTitleBarPanel(miniPanel, config) {
        const content = miniPanel.querySelector('.mini-panel-content');
        const isExpanded = miniPanel.classList.contains('expanded');

        if (isExpanded) {
            // Minimize
            content.style.display = 'none';
            miniPanel.classList.remove('expanded');
            miniPanel.style.background = '#2a2a2a';
        } else {
            // Close any other expanded panels first
            this.titleBarPanels.querySelectorAll('.expanded-title-bar-panel').forEach(panel => {
                if (panel !== miniPanel) {
                    panel.querySelector('.mini-panel-content').style.display = 'none';
                    panel.classList.remove('expanded');
                    panel.style.background = '#2a2a2a';
                }
            });

            // Expand this panel
            this.populateTitleBarPanelContent(miniPanel, config);
            content.style.display = 'block';
            miniPanel.classList.add('expanded');
            miniPanel.style.background = '#3a3a3a';
        }
    }

    populateTitleBarPanelContent(miniPanel, config) {
        const originalPanel = document.getElementById(config.originalId);
        const contentInner = miniPanel.querySelector('.mini-panel-content-inner');
        
        if (originalPanel) {
            const originalContent = originalPanel.querySelector('.info-content');
            if (originalContent) {
                // Clone the original content
                contentInner.innerHTML = originalContent.innerHTML;
                
                // Setup event listeners for cloned elements
                this.setupMiniPanelEventListeners(contentInner, config.id);
            } else {
                contentInner.innerHTML = '<div style="color: #888; text-align: center;">Panel content not available</div>';
            }
        } else {
            contentInner.innerHTML = '<div style="color: #888; text-align: center;">Original panel not found</div>';
        }
    }

    setupMiniPanelEventListeners(contentContainer, panelId) {
        // Setup event listeners for cloned content based on panel type
        if (panelId === 'expanded-rhythm-submit') {
            const form = contentContainer.querySelector('form');
            if (form) {
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    // Delegate to the main form handler
                    const originalForm = document.querySelector('#rhythm-submit-div form');
                    if (originalForm) {
                        // Copy values to original form and submit
                        const inputs = form.querySelectorAll('input');
                        const originalInputs = originalForm.querySelectorAll('input');
                        inputs.forEach((input, index) => {
                            if (originalInputs[index]) {
                                originalInputs[index].value = input.value;
                            }
                        });
                        originalForm.dispatchEvent(new Event('submit'));
                    }
                });
            }
        } else if (panelId === 'expanded-visualizations') {
            // Setup visualization controls
            const select = contentContainer.querySelector('#viz-type-selector');
            if (select) {
                // Add Centrifuge and Hinges options when in Expanded View
                if (!select.querySelector('option[value="centrifuge"]')) {
                    const centrifugeOption = document.createElement('option');
                    centrifugeOption.value = 'centrifuge';
                    centrifugeOption.textContent = 'Centrifuge';
                    select.appendChild(centrifugeOption);
                }
                if (!select.querySelector('option[value="hinges"]')) {
                    const hingesOption = document.createElement('option');
                    hingesOption.value = 'hinges';
                    hingesOption.textContent = 'Hinges';
                    select.appendChild(hingesOption);
                }

                select.addEventListener('change', (e) => {
                    const nextType = e.target.value;
                    if (window.lrcHUD && window.lrcHUD.setVisualizationType) {
                        window.lrcHUD.setVisualizationType(nextType);
                    } else if (window.lrcVisuals) {
                        window.lrcVisuals.setPlotType(nextType);
                    }
                });

                const currentType = window.lrcVisuals?.currentPlotType || 'linear';
                if (window.lrcHUD && window.lrcHUD.syncVizSelectors) {
                    window.lrcHUD.syncVizSelectors(currentType);
                } else {
                    select.value = currentType;
                }
            }
            
            const layerToggles = contentContainer.querySelectorAll('.layer-toggle');
            layerToggles.forEach(toggle => {
                toggle.addEventListener('click', (e) => {
                    const layer = toggle.dataset.layer;
                    toggle.classList.toggle('active');
                    if (window.lrcVisuals) {
                        const isVisible = toggle.classList.contains('active');
                        window.lrcVisuals.toggleLayerVisibility(layer, isVisible);
                    }
                });
            });
        } else if (panelId === 'expanded-playback') {
            // Playback controls are handled by ToneRowPlayback module
            // Just need to ensure the controls work in the cloned content
        } else if (panelId === 'expanded-search') {
            // Setup search form handlers
            const forms = contentContainer.querySelectorAll('form');
            forms.forEach(form => {
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    // Delegate to original form handlers
                    const originalForm = document.querySelector(`#search-div form[id="${form.id}"]`);
                    if (originalForm) {
                        const inputs = form.querySelectorAll('input, select');
                        const originalInputs = originalForm.querySelectorAll('input, select');
                        inputs.forEach((input, index) => {
                            if (originalInputs[index]) {
                                originalInputs[index].value = input.value;
                            }
                        });
                        originalForm.dispatchEvent(new Event('submit'));
                    }
                });
            });
        }
    }

    // ====================================
    // RHYTHM GENERATION LISTENER
    // ====================================

    setupRhythmGenerationListener() {
        this.rhythmGenerationHandler = () => {
            if (!this.isActive) return;
            
            // Update title bar with new layers
            const rhythmInfo = window.lrcModule ? window.lrcModule.getRhythmInfoData() : null;
            const layersText = rhythmInfo ? rhythmInfo.layers.join(':') : '';
            const titleElement = this.expandedContainer?.querySelector('h3');
            if (titleElement) {
                titleElement.textContent = `Expanded Info View ${layersText ? '- ' + layersText : ''}`;
            }

            // Refresh expanded content
            this.populateExpandedContent();
            
            console.log('📊 Expanded Info View refreshed with new rhythm data');
        };

        // Listen for rhythm generation events
        window.addEventListener('rhythmGenerated', this.rhythmGenerationHandler);
    }

    removeRhythmGenerationListener() {
        if (this.rhythmGenerationHandler) {
            window.removeEventListener('rhythmGenerated', this.rhythmGenerationHandler);
            this.rhythmGenerationHandler = null;
        }
    }

    // ====================================
    // WINDOW RESIZE LISTENER
    // ====================================

    setupWindowResizeListener() {
        this.windowResizeHandler = () => {
            if (!this.isActive || !this.expandedContainer) return;
            
            // Just update dimensions without rebuilding entire layout
            this.resizeExpandedContainer();
            
            console.log('📊 EIV resized to match window');
        };

        // Listen for window resize events
        window.addEventListener('resize', this.windowResizeHandler);
    }

    removeWindowResizeListener() {
        if (this.windowResizeHandler) {
            window.removeEventListener('resize', this.windowResizeHandler);
            this.windowResizeHandler = null;
        }
    }

    resizeExpandedContainer() {
        // Recalculate dimensions using same logic as createExpandedLayout
        const canvas = document.getElementById('visualization-canvas');
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth;

        const logicalWidth = containerWidth;
        // Use available vertical space for maximal screen usage
        const titleBarHeight = 50;
        const bottomBuffer = 80; // Space for floating panels
        const logicalHeight = window.innerHeight - titleBarHeight - bottomBuffer;
        
        // Update only the dimensions
        this.expandedContainer.style.width = `${logicalWidth}px`;
        this.expandedContainer.style.height = `${logicalHeight}px`;
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

    setupDirectCollapsibleListeners() {
        if (!this.leftSection) return;

        this.teardownCollapsibleListeners();

        const headers = this.leftSection.querySelectorAll('.subsection-header[data-target]');
        if (headers.length === 0) {
            return;
        }

        headers.forEach(header => {
            const targetId = header.dataset.target;
            header.style.pointerEvents = 'auto';
            header.style.cursor = 'pointer';
            header.setAttribute('role', 'button');
            if (!header.hasAttribute('tabindex')) {
                header.setAttribute('tabindex', '0');
            }

            if (targetId) {
                header.setAttribute('aria-controls', targetId);
                const content = document.getElementById(targetId);
                if (content) {
                    const isVisible = content.style.display !== 'none';
                    header.classList.toggle('expanded', isVisible);
                    header.classList.toggle('collapsed', !isVisible);
                    header.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
                }
            }
        });

        this.leftSectionCollapsibleHandler = (event) => {
            if (!this.leftSection) return;

            let header = event.target.closest('.subsection-header[data-target]');

            if ((!header || !this.leftSection.contains(header)) && event.type === 'click') {
                const subsection = event.target.closest('.info-subsection');
                if (subsection && this.leftSection.contains(subsection)) {
                    header = subsection.querySelector('.subsection-header[data-target]');
                }
            }

            if (!header || !this.leftSection.contains(header)) {
                return;
            }

            if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            this.toggleExpandedSection(header);
        };

        this.leftSection.addEventListener('click', this.leftSectionCollapsibleHandler);
        this.leftSection.addEventListener('keydown', this.leftSectionCollapsibleHandler);
    }

    teardownCollapsibleListeners() {
        if (this.leftSection && this.leftSectionCollapsibleHandler) {
            this.leftSection.removeEventListener('click', this.leftSectionCollapsibleHandler);
            this.leftSection.removeEventListener('keydown', this.leftSectionCollapsibleHandler);
        }
        this.leftSectionCollapsibleHandler = null;
    }

    toggleExpandedSection(header) {
        if (!header) return;

        const targetId = header.dataset?.target;
        if (!targetId) return;

        const content = document.getElementById(targetId);
        if (!content) return;

        const isVisible = content.style.display !== 'none';
        const nextVisibleState = !isVisible;

        content.style.display = nextVisibleState ? 'block' : 'none';
        header.classList.toggle('expanded', nextVisibleState);
        header.classList.toggle('collapsed', !nextVisibleState);
        header.setAttribute('aria-expanded', nextVisibleState ? 'true' : 'false');
    }

    getMirroredSpacesPlotSection() {
        // Mirror the actual spaces plot section from rhythm-info-div
        const originalRhythmInfoDiv = document.getElementById('rhythm-info-div');
        const originalSections = originalRhythmInfoDiv?.querySelectorAll('.info-subsection');
        
        let spacesPlotSection = null;
        originalSections?.forEach(section => {
            const header = section.querySelector('.subsection-header');
            if (header && header.textContent.includes('Spaces Plot')) {
                spacesPlotSection = section;
            }
        });
        
        if (spacesPlotSection) {
            const cloned = spacesPlotSection.cloneNode(true);
            
            // Update IDs to avoid conflicts
            const header = cloned.querySelector('.subsection-header');
            const content = cloned.querySelector('.subsection-content');
            if (header && content) {
                header.setAttribute('data-target', 'expanded-spaces-plot-content');
                content.id = 'expanded-spaces-plot-content';
            }
            
            // Update the display element with fresh data
            const displayEl = cloned.querySelector('#spaces-plot-display');
            if (displayEl) {
                displayEl.id = 'expanded-spaces-plot-display';
                const spacesPlot = window.lrcModule?.currentSpacesPlot || [];
                if (spacesPlot.length > 0) {
                    displayEl.textContent = spacesPlot.join(', ');
                } else {
                    displayEl.textContent = 'Generate a rhythm to view spaces plot data';
                }
            }
            
            return cloned.outerHTML;
        }
        
        return '<div style="color: #888;">Spaces Plot section not found</div>';
    }

    getMirroredCompositeRhythmSection() {
        // Mirror the actual composite rhythm section from rhythm-info-div  
        const originalRhythmInfoDiv = document.getElementById('rhythm-info-div');
        const originalSections = originalRhythmInfoDiv?.querySelectorAll('.info-subsection');
        
        let compositeRhythmSection = null;
        originalSections?.forEach(section => {
            const header = section.querySelector('.subsection-header');
            if (header && header.textContent.includes('Composite Rhythm')) {
                compositeRhythmSection = section;
            }
        });
        
        if (compositeRhythmSection) {
            const cloned = compositeRhythmSection.cloneNode(true);
            
            // Update IDs to avoid conflicts
            const header = cloned.querySelector('.subsection-header');
            const content = cloned.querySelector('.subsection-content');
            if (header && content) {
                header.setAttribute('data-target', 'expanded-composite-rhythm-content');
                content.id = 'expanded-composite-rhythm-content';
            }
            
            // Update the display element with fresh data
            const displayEl = cloned.querySelector('#composite-rhythm-display');
            if (displayEl) {
                displayEl.id = 'expanded-composite-rhythm-display';
                const compositeRhythm = window.lrcModule?.currentCompositeRhythm || [];
                if (compositeRhythm.length > 0) {
                    displayEl.textContent = compositeRhythm.join(', ');
                } else {
                    displayEl.textContent = 'Generate a rhythm to view composite rhythm data';
                }
            }
            
            return cloned.outerHTML;
        }
        
        return '<div style="color: #888;">Composite Rhythm section not found</div>';
    }

    // ====================================
    // HELPER METHODS
    // ====================================

    setupExpandedCollapsibleSections() {
        // Setup collapsible behavior for spaces plot and composite rhythm
        const headers = this.leftSection.querySelectorAll('.expanded-collapsible-header[data-target]');
        console.log(`🔧 Found ${headers.length} collapsible headers in left section`);
        
        if (headers.length === 0) {
            console.log('🔧 No collapsible headers found. Checking left section content...');
            const leftSectionContent = this.leftSection.innerHTML;
            console.log('🔧 Left section HTML sample:', leftSectionContent.substring(0, 500));
            
            // Look for any elements with data-target
            const allDataTargets = this.leftSection.querySelectorAll('[data-target]');
            console.log(`🔧 Found ${allDataTargets.length} elements with data-target:`, 
                       Array.from(allDataTargets).map(el => ({ 
                           tagName: el.tagName, 
                           className: el.className, 
                           dataTarget: el.getAttribute('data-target') 
                       })));
        }
        headers.forEach((header, index) => {
            const targetId = header.dataset.target;
            console.log(`🔧 Setting up collapsible header ${index}: target=${targetId}`);
            
            header.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                console.log(`🔧 COLLAPSIBLE CLICK on header with target: ${targetId}`);
                
                const content = document.getElementById(targetId);
                
                if (content) {
                    const isCurrentlyVisible = content.style.display !== 'none';
                    content.style.display = isCurrentlyVisible ? 'none' : 'block';
                    
                    console.log(`🔧 Toggled ${targetId}: ${isCurrentlyVisible ? 'hidden' : 'shown'}`);
                    
                    // Visual feedback on header
                    if (isCurrentlyVisible) {
                        header.classList.remove('expanded');
                        header.classList.add('collapsed');
                        header.style.color = '#888';
                    } else {
                        header.classList.remove('collapsed');
                        header.classList.add('expanded');
                        header.style.color = '#00ff88';
                    }
                } else {
                    console.warn(`🔧 Could not find target element: ${targetId}`);
                }
            });
        });
        
        console.log(`📊 Setup ${headers.length} expandable sections in Expanded Info View`);
    }

    createDefaultInterconsonanceSection() {
        this.interconsonanceSection.innerHTML = `
            <div class="subsection-header" style="color: #00ff88; font-size: 14px; margin: 0; padding: 10px 10px 5px 10px; font-weight: bold; background: #2a2a2a; border-bottom: 1px solid #444;">Interconsonance</div>
            <div style="padding: 10px;">
                <div class="interconsonance-controls" style="margin-bottom: 15px;">
                    <button class="analyze-btn" id="expanded-run-interconsonance-btn" style="
                        background: #444;
                        border: 1px solid #666;
                        color: #fff;
                        padding: 6px 12px;
                        font-size: 12px;
                        border-radius: 3px;
                        cursor: pointer;
                        font-family: monospace;
                    ">Analyze</button>
                </div>
                <div id="expanded-interconsonance-display" style="color: #888;">
                    Click "Analyze" to run consonance analysis for this rhythm scale.
                </div>
            </div>
        `;
        
        // Setup analyzer button functionality
        this.setupInterconsonanceAnalyzer();
    }

    setupClonedInterconsonanceSection() {
        // No collapsible behavior - it should stay expanded in Expanded View
        
        // Setup the analyze button
        const analyzeBtn = this.interconsonanceSection.querySelector('#expanded-run-interconsonance-btn');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Trigger the analysis using the main interconsonance module
                if (window.lrcInterconsonance) {
                    // Run analysis and update the original display
                    window.lrcInterconsonance.runAnalysis().then(() => {
                        // Copy the results from original to expanded display, preserving onclick attributes
                        setTimeout(() => {
                            this.syncInterconsonanceResultsWithOnclick();
                        }, 100);
                    });
                } else {
                    const display = this.interconsonanceSection.querySelector('#expanded-interconsonance-display');
                    if (display) {
                        display.innerHTML = '<div style="color: #ff4444;">LRCInterconsonance module not available</div>';
                    }
                }
            });
        }
    }
    
    syncInterconsonanceResultsWithOnclick() {
        // Sync results from original interconsonance display to expanded view, preserving all onclick functionality
        const originalDisplay = document.getElementById('interconsonance-display');
        const expandedDisplay = this.interconsonanceSection.querySelector('#expanded-interconsonance-display');
        
        if (originalDisplay && expandedDisplay) {
            // Copy the innerHTML directly to preserve onclick attributes
            expandedDisplay.innerHTML = originalDisplay.innerHTML;
            
            // Don't modify onclick attributes - keep them as-is for functionality
            // The LRCInterconsonance functions should work globally
            
            console.log('🔧 Synced interconsonance results with preserved onclick attributes');
            
            // Debug: Log what interactive elements we have
            const interactiveElements = expandedDisplay.querySelectorAll('[onclick]');
            console.log(`🔧 Found ${interactiveElements.length} interactive elements:`, 
                       Array.from(interactiveElements).map(el => ({ 
                           tag: el.tagName, 
                           onclick: el.getAttribute('onclick'), 
                           text: el.textContent.trim() 
                       })));
            
            // NOW setup the behavior after sync is complete
            this.setupExpandedInterconsonanceBehavior();
            
            // Setup click intercepts for interconsonance buttons
            this.setupInterconsonanceClickIntercepts(expandedDisplay);
            
            // Ensure pitch selection continues to work after syncing
            this.refreshExpandedPitchSelection();
        }
    }

    syncInterconsonanceResults() {
        // Sync results from original interconsonance display to expanded view
        const originalDisplay = document.getElementById('interconsonance-display');
        const expandedDisplay = this.interconsonanceSection.querySelector('#expanded-interconsonance-display');
        
        if (originalDisplay && expandedDisplay) {
            expandedDisplay.innerHTML = originalDisplay.innerHTML;
            
            // Setup interactive behavior for the synced content
            this.setupExpandedInterconsonanceBehavior();
            
            // Ensure pitch selection continues to work after syncing
            this.refreshExpandedPitchSelection();
        }
    }

    refreshExpandedPitchSelection() {
        // Re-enable pitch selection after interconsonance analysis
        if (window.lrcInterconsonance && window.lrcInterconsonance.selectedPitch !== null) {
            this.updateExpandedPitchLighting(window.lrcInterconsonance.selectedPitch);
        }
    }

    setupInterconsonanceAnalyzer() {
        const analyzeBtn = document.getElementById('expanded-run-interconsonance-btn');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Trigger the analysis using the main interconsonance module
                if (window.lrcInterconsonance) {
                    window.lrcInterconsonance.runAnalysis().then(() => {
                        // Update the expanded view with the new analysis
                        setTimeout(() => {
                            this.populateInterconsonanceSection();
                            this.setupExpandedInterconsonanceBehavior();
                        }, 100);
                    });
                } else {
                    const display = document.getElementById('expanded-interconsonance-display');
                    if (display) {
                        display.innerHTML = '<div style="color: #ff4444;">LRCInterconsonance module not available</div>';
                    }
                }
            });
        }
    }

    setupExpandedInterconsonanceBehavior() {
        // Setup interactive elements in interconsonance display
        const expandedDisplay = document.getElementById('expanded-interconsonance-display');
        if (!expandedDisplay) {
            console.warn('🔧 No expanded interconsonance display found for setup');
            return;
        }

        let expandableSections = 0;
        let sortableHeaders = 0;

        // Debug: Check what elements exist
        const allButtons = expandedDisplay.querySelectorAll('button');
        console.log(`🔧 Found ${allButtons.length} buttons in expanded display`);
        
        if (allButtons.length === 0) {
            console.log('🔧 No buttons found - analysis results may not be synced yet');
            return; // Exit early if no elements to setup
        }
        
        // Don't override onclick attributes - let them work directly
        // The LRCInterconsonance functions expect to find elements by their original IDs
        const matrixButtons = expandedDisplay.querySelectorAll('.show-matrix-btn, button[onclick*="toggleIntervalMatrix"]');
        console.log(`🔧 Found ${matrixButtons.length} matrix buttons with onclick attributes`);
        expandableSections += matrixButtons.length;

        // Don't override clear selection buttons - they should work directly
        const clearButtons = expandedDisplay.querySelectorAll('.clear-selection-btn, button[onclick*="clearSelection"]');
        console.log(`🔧 Found ${clearButtons.length} clear selection buttons`);
        expandableSections += clearButtons.length;

        // Don't override sorting functionality - let onclick work directly
        const sortButtons = expandedDisplay.querySelectorAll('button[onclick*="sortFamilies"], .sort-btn, select[onchange]');
        console.log(`🔧 Found ${sortButtons.length} sort controls`);
        sortableHeaders += sortButtons.length;

        // Don't override pagination buttons - let onclick work directly
        const paginationButtons = expandedDisplay.querySelectorAll('button[onclick*="Page"], .page-btn');
        console.log(`🔧 Found ${paginationButtons.length} pagination buttons`);
        expandableSections += paginationButtons.length;
        
        // Also check for family interval buttons
        const familyButtons = expandedDisplay.querySelectorAll('button[onclick*="toggleFamilyIntervals"]');
        console.log(`🔧 Found ${familyButtons.length} family interval toggle buttons`);
        expandableSections += familyButtons.length;

        console.log(`📊 Setup ${expandableSections} interactive sections and ${sortableHeaders} sortable headers in Interconsonance`);
    }
    
    debugButtonClicks(containerElement) {
        const allButtons = containerElement.querySelectorAll('button[onclick]');
        console.log(`🔧 Adding click debugging to ${allButtons.length} buttons with onclick`);
        
        allButtons.forEach((button, index) => {
            const originalOnclick = button.getAttribute('onclick');
            console.log(`🔧 Button ${index}: "${button.textContent.trim()}" has onclick: ${originalOnclick}`);
            
            // Add both event listener and onclick debugging
            button.addEventListener('click', (e) => {
                console.log(`🔧 CLICK RECEIVED on button ${index}: "${button.textContent.trim()}"`);
                console.log(`🔧 Event details:`, {
                    target: e.target,
                    currentTarget: e.currentTarget,
                    bubbles: e.bubbles,
                    cancelable: e.cancelable,
                    defaultPrevented: e.defaultPrevented
                });
                
                // Try to execute the onclick manually if it exists
                if (originalOnclick) {
                    console.log(`🔧 Attempting to execute: ${originalOnclick}`);
                    try {
                        eval(originalOnclick);
                    } catch (error) {
                        console.error(`🔧 Error executing onclick: ${error}`);
                    }
                }
            });
            
            // Also test if the button is actually clickable
            const computedStyle = window.getComputedStyle(button);
            console.log(`🔧 Button ${index} CSS:`, {
                pointerEvents: computedStyle.pointerEvents,
                position: computedStyle.position,
                zIndex: computedStyle.zIndex,
                display: computedStyle.display,
                visibility: computedStyle.visibility
            });
        });
    }
    
    setupInterconsonanceClickIntercepts(container) {
        const allButtons = container.querySelectorAll('button[onclick]');
        console.log(`🔧 Setting up click intercepts for ${allButtons.length} buttons`);
        
        allButtons.forEach((button, index) => {
            const originalOnclick = button.getAttribute('onclick');
            console.log(`🔧 Button ${index}: "${button.textContent.trim()}" has onclick: ${originalOnclick}`);
            
            // Remove the original onclick to prevent it from executing
            button.removeAttribute('onclick');
            
            // Add our intercepting event listener
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                console.log(`🔧 INTERCEPTED CLICK on: "${button.textContent.trim()}"`);
                
                // Parse and redirect the original onclick to work with expanded view
                this.handleInterconsonanceClick(originalOnclick, container);
            });
        });
    }
    
    handleInterconsonanceClick(onclickCode, container) {
        console.log(`🔧 Handling click: ${onclickCode}`);
        
        if (onclickCode.includes('toggleIntervalMatrix')) {
            // Find the interval matrix in the expanded view
            const matrixDiv = container.querySelector('#full-interval-matrix');
            if (matrixDiv) {
                console.log(`🔧 Toggling interval matrix in expanded view`);
                matrixDiv.style.display = matrixDiv.style.display === 'none' ? 'block' : 'none';
            } else {
                console.warn(`🔧 Could not find interval matrix in expanded view`);
            }
        } else if (onclickCode.includes('toggleFamilyIntervals')) {
            // Extract the family index from the onclick code
            const match = onclickCode.match(/toggleFamilyIntervals\((\d+)\)/);
            if (match) {
                const familyIndex = match[1];
                const detailDiv = container.querySelector(`#family-intervals-${familyIndex}`);
                if (detailDiv) {
                    console.log(`🔧 Toggling family ${familyIndex} intervals in expanded view`);
                    detailDiv.style.display = detailDiv.style.display === 'none' ? 'block' : 'none';
                } else {
                    console.warn(`🔧 Could not find family-intervals-${familyIndex} in expanded view`);
                }
            }
        } else if (onclickCode.includes('clearSelection')) {
            // Handle clear selection
            if (window.lrcInterconsonance && window.lrcInterconsonance.clearSelection) {
                console.log(`🔧 Clearing selection via expanded view`);
                window.lrcInterconsonance.clearSelection();
                // Update both views
                setTimeout(() => {
                    this.syncInterconsonanceResultsWithOnclick();
                }, 100);
            }
        } else if (onclickCode.includes('goToFamilyPage') || onclickCode.includes('changeFamilySort')) {
            // Handle pagination and sorting - these should affect the original and then sync
            console.log(`🔧 Executing pagination/sorting: ${onclickCode}`);
            try {
                eval(onclickCode);
                // Sync the results after the change
                setTimeout(() => {
                    this.syncInterconsonanceResultsWithOnclick();
                }, 100);
            } catch (error) {
                console.error(`🔧 Error executing: ${error}`);
            }
        }
    }
    
    handleInterconsonanceSortChange(onchangeCode, container) {
        console.log(`🔧 Handling sort change: ${onchangeCode}`);
        
        try {
            // Execute the original onchange which should be something like 'window.lrcInterconsonance.changeFamilySort()'
            eval(onchangeCode);
            
            // Sync the results after the sort change
            setTimeout(() => {
                this.syncInterconsonanceResultsWithOnclick();
            }, 100);
        } catch (error) {
            console.error(`🔧 Error executing sort change: ${error}`);
        }
    }

    // ====================================
    // PITCH SELECTION COMMUNICATION
    // ====================================

    selectPitch(pitchIndex) {
        // Check if this pitch is already selected (for deselection)
        const isAlreadySelected = window.lrcInterconsonance && 
                                 window.lrcInterconsonance.selectedPitch === pitchIndex;
        
        if (isAlreadySelected) {
            // Deselect the pitch
            if (window.lrcInterconsonance.clearSelection) {
                window.lrcInterconsonance.clearSelection();
            }
            this.clearExpandedPitchLighting();
        } else {
            // Select the pitch
            if (window.lrcInterconsonance) {
                window.lrcInterconsonance.selectPitch(pitchIndex);
                
                // Update the expanded view highlighting
                this.updateExpandedPitchLighting(pitchIndex);
            }
        }
    }

    updateExpandedPitchLighting(selectedPitchIndex) {
        // Clear previous highlighting in expanded view
        this.clearExpandedPitchLighting();
        
        if (selectedPitchIndex === null || !window.lrcInterconsonance || !window.lrcInterconsonance.currentAnalysis) {
            return;
        }
        
        // Get consonant relationships from the main interconsonance analyzer
        const pitchConsonanceMap = window.lrcInterconsonance.pitchConsonanceMap;
        const selectedPitchData = pitchConsonanceMap.get(selectedPitchIndex);
        
        if (!selectedPitchData) return;
        
        // Highlight selected pitch in expanded view
        const selectedRow = this.scaleSection.querySelector(`[data-pitch-index="${selectedPitchIndex}"]`);
        if (selectedRow) {
            selectedRow.classList.add('pitch-selected');
        }
        
        // Highlight consonant pitches in expanded view
        selectedPitchData.consonantWith.forEach(consonantPitchIndex => {
            const consonantRow = this.scaleSection.querySelector(`[data-pitch-index="${consonantPitchIndex}"]`);
            if (consonantRow) {
                consonantRow.classList.add('pitch-consonant');
            }
        });
        
        console.log(`💡 Expanded view lighting: pitch ${selectedPitchIndex + 1} selected, ${selectedPitchData.consonantWith.size} consonant pitches highlighted`);
    }

    clearExpandedPitchLighting() {
        const pitchRows = this.scaleSection.querySelectorAll('.pitch-row');
        pitchRows.forEach(row => {
            row.classList.remove('pitch-selected', 'pitch-consonant');
        });
    }

    // ====================================
    // PUBLIC API
    // ====================================

    isExpanded() {
        return this.isActive;
    }

    toggle() {
        if (this.isActive) {
            this.hide();
        } else {
            this.show();
        }
    }

    showMidiRootPopup() {
        const popup = document.getElementById('midi-root-popup');
        const rootCBtn = document.getElementById('midi-root-c');
        const rootABtn = document.getElementById('midi-root-a');
        
        if (!popup || !rootCBtn || !rootABtn) {
            console.error('MIDI root popup elements not found');
            return;
        }
        
        // Remove any existing event listeners
        const newRootCBtn = rootCBtn.cloneNode(true);
        const newRootABtn = rootABtn.cloneNode(true);
        rootCBtn.parentNode.replaceChild(newRootCBtn, rootCBtn);
        rootABtn.parentNode.replaceChild(newRootABtn, rootABtn);
        
        // Add event listeners for root note selection
        newRootCBtn.addEventListener('click', () => {
            popup.style.display = 'none';
            if (window.lrcExport) {
                window.lrcExport.exportMIDI('C');
            }
        });
        
        newRootABtn.addEventListener('click', () => {
            popup.style.display = 'none';
            if (window.lrcExport) {
                window.lrcExport.exportMIDI('A');
            }
        });
        
        // Close popup when clicking overlay
        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                popup.style.display = 'none';
            }
        });
        
        // Show popup
        popup.style.display = 'flex';
    }
}

// Initialize ExpandedInfoView when DOM is loaded
let expandedInfoView;

document.addEventListener('DOMContentLoaded', () => {
    expandedInfoView = new ExpandedInfoView();
    window.expandedInfoView = expandedInfoView; // Make globally accessible
});
