// LRC HUD Interface Controller - Chronosmos Style
// Handles dragging, minimizing, and interface state management

class LRCHUDController {
    constructor() {
        this.isFirstRhythmInput = true;
        this.dragState = {
            isDragging: false,
            currentElement: null,
            offset: { x: 0, y: 0 }
        };
        
        this.defaultPositions = {
            'rhythm-submit-div': { bottom: 20, left: 'calc(10% - 120px)' },
            'rhythm-info-div': { bottom: 20, left: 'calc(30% - 120px)' },
            'visualizations-div': { bottom: 20, left: 'calc(50% - 120px)' },
            'playback-div': { bottom: 20, left: 'calc(70% - 120px)' },
            'search-div': { bottom: 20, left: 'calc(90% - 120px)' }
        };
        
        this.lightsEnabled = true; // Track lightswitch state

        this.mobileBreakpoint = window.matchMedia('(max-width: 900px)');
        this.isMobileModeActive = false;
        this.handleMobileModeChange = (matches) => {
            const shouldEnable = typeof matches === 'boolean' ? matches : matches.matches;
            if (shouldEnable === this.isMobileModeActive) {
                return;
            }
            this.isMobileModeActive = shouldEnable;
            if (document && document.body) {
                document.body.classList.toggle('mobile-mode', this.isMobileModeActive);
            }
            console.log('📱 Mobile mode:', this.isMobileModeActive);
            this.resetAllPositions();
        };
        this.handleMobileModeChange(this.mobileBreakpoint.matches);
        if (this.mobileBreakpoint.addEventListener) {
            this.mobileBreakpoint.addEventListener('change', (event) => this.handleMobileModeChange(event.matches));
        } else if (this.mobileBreakpoint.addListener) {
            this.mobileBreakpoint.addListener((event) => this.handleMobileModeChange(event.matches));
        }
        
        this.init();
    }

    init() {
        this.setupDragAndDrop();
        this.setupMinimize(); // Use Chronosmos pattern
        this.setupResetDisplay();
        this.debugResetButton();
        this.setupRhythmForm();
        this.setupCollapsibleSections();
        this.setupVisualizationControls();
        this.setupPlaybackControls();
        
        // Set initial positions
        this.resetAllPositions();
        
        console.log('LRC HUD Controller initialized with Chronosmos pattern');
    }

    // ====================================
    // MINIMIZATION
    // ====================================

    setupMinimize() {
        // List all panel IDs that should be minimizable
        const panels = [
            'rhythm-submit-div',
            'rhythm-info-div',
            'visualizations-div',
            'playback-div',
            'search-div'
        ];
        
        panels.forEach(panelId => {
            this.addMinimizeHandler(panelId);
        });
    }

    addMinimizeHandler(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) {
            console.warn(`Panel not found: ${panelId}`);
            return;
        }
        
        const btn = panel.querySelector('.minimize-btn');
        if (!btn) {
            console.warn(`Minimize button not found in panel: ${panelId}`);
            return;
        }

        const content = panel.querySelector('.info-content');
        if (content && !content.id) {
            content.id = `${panelId}-content`;
        }
        const heading = panel.querySelector('.info-header h2');
        const panelLabel = heading ? heading.textContent.trim() : panelId.replace(/-/g, ' ');

        btn.dataset.panelLabel = panelLabel;
        this.setPanelAccessibilityState(panel, btn, !panel.classList.contains('minimized'));
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            if (panel.classList.contains('minimized')) {
                // EXPANDING
                this.expandPanel(panel, btn);
            } else {
                // MINIMIZING  
                this.minimizePanel(panel, btn);
            }
            
            e.target.blur();
        });
        
        console.log(`✅ Minimize handler added for: ${panelId}`);
    }

    expandPanel(panel, btn) {
        // Save current position
        panel.dataset.minimizedLeft = panel.style.left;
        panel.dataset.minimizedTop = panel.style.top;
        panel.dataset.minimizedRight = panel.style.right;
        panel.dataset.minimizedBottom = panel.style.bottom;
        
        // Expand
        panel.classList.remove('minimized');
        btn.textContent = '−';
        this.setPanelAccessibilityState(panel, btn, true);
        
        // Apply constraints after expansion
        requestAnimationFrame(() => {
            this.constrainPanelToBounds(panel);
        });
    }

    minimizePanel(panel, btn) {
        // Minimize first
        panel.classList.add('minimized');
        btn.textContent = '+';
        this.setPanelAccessibilityState(panel, btn, false);
        
        // Restore position after minimize
        requestAnimationFrame(() => {
            if (panel.dataset.minimizedLeft) {
                panel.style.left = panel.dataset.minimizedLeft;
                panel.style.top = panel.dataset.minimizedTop;
                panel.style.right = panel.dataset.minimizedRight;
                panel.style.bottom = panel.dataset.minimizedBottom;
            }
        });
    }

    setPanelAccessibilityState(panel, btn, expanded) {
        const content = panel.querySelector('.info-content');
        const label = btn.dataset.panelLabel || panel.id.replace(/-/g, ' ');

        btn.setAttribute('aria-expanded', String(expanded));
        btn.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${label} panel`);

        if (content) {
            if (!content.id) {
                content.id = `${panel.id}-content`;
            }
            btn.setAttribute('aria-controls', content.id);
            content.setAttribute('aria-hidden', expanded ? 'false' : 'true');
        }

        panel.setAttribute('aria-expanded', String(expanded));
    }

    constrainPanelToBounds(panel) {
        const rect = panel.getBoundingClientRect();
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight - 50 // Account for title bar
        };
        
        let newX = rect.left;
        let newY = rect.top - 50; // Subtract title bar height
        
        // Check right boundary
        if (rect.right > viewport.width) {
            newX = viewport.width - rect.width;
        }
        
        // Check left boundary
        if (newX < 0) {
            newX = 0;
        }
        
        // Check bottom boundary
        if (rect.bottom > viewport.height + 50) { // Add title bar back for comparison
            newY = viewport.height - rect.height;
        }
        
        // Check top boundary
        if (newY < 0) {
            newY = 0;
        }
        
        // Apply constraints if needed
        if (newX !== rect.left || newY !== (rect.top - 50)) {
            panel.style.left = newX + 'px';
            panel.style.top = (newY + 50) + 'px'; // Add title bar offset back
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            
            console.log(`📐 Constrained panel ${panel.id} to bounds`);
        }
    }

    // ====================================
    // DRAG AND DROP FUNCTIONALITY (Updated for .panel)
    // ====================================

    setupDragAndDrop() {
        const panels = document.querySelectorAll('.panel');
        
        panels.forEach(panel => {
            const header = panel.querySelector('.info-header');
            
            header.addEventListener('mousedown', (e) => {
                // Don't start drag on minimize button
                if (e.target.classList.contains('minimize-btn')) return;
                
                this.startDrag(e, panel);
            });

            // EIV double-click handler
            if (panel.id === 'rhythm-info-div') {
                header.addEventListener('dblclick', (e) => {
                    // Don't trigger on minimize button
                    if (e.target.classList.contains('minimize-btn')) return;

                    e.preventDefault();
                    e.stopPropagation();

                    if (window.expandedInfoView) {
                        window.expandedInfoView.show();
                        console.log('📊 Opened Expanded Info View via double-click');
                    }
                });
            }

            // Partitions double-click handler
            if (panel.id === 'playback-div') {
                header.addEventListener('dblclick', (e) => {
                    // Don't trigger on minimize button
                    if (e.target.classList.contains('minimize-btn')) return;

                    e.preventDefault();
                    e.stopPropagation();

                    if (window.partitionsUI) {
                        window.partitionsUI.show();
                        console.log('🥁 Opened Partitions view via double-click');
                    }
                });
            }
        });

        // Global mouse events
        document.addEventListener('mousemove', (e) => this.handleDrag(e));
        document.addEventListener('mouseup', () => this.endDrag());
    }

    startDrag(e, element) {
        if (this.isMobileModeActive) {
            return;
        }
        this.dragState.isDragging = true;
        this.dragState.currentElement = element;
        
        const rect = element.getBoundingClientRect();
        this.dragState.offset = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        
        element.classList.add('dragging');
        
        // Prevent text selection and improve responsiveness
        e.preventDefault();
        e.stopPropagation();
        
        // Immediately update position to eliminate delay
        this.handleDrag(e);
    }

    handleDrag(e) {
        if (this.isMobileModeActive) {
            return;
        }
        if (!this.dragState.isDragging || !this.dragState.currentElement) return;
        
        const element = this.dragState.currentElement;
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight - 50 // Account for title bar
        };
        
        // Calculate new position
        let newX = e.clientX - this.dragState.offset.x;
        let newY = e.clientY - this.dragState.offset.y - 50; // Account for title bar
        
        // Get element dimensions
        const rect = element.getBoundingClientRect();
        
        // Constrain to viewport bounds
        newX = Math.max(0, Math.min(newX, viewport.width - rect.width));
        newY = Math.max(0, Math.min(newY, viewport.height - rect.height));
        
        // Apply position
        element.style.left = newX + 'px';
        element.style.top = (newY + 50) + 'px'; // Add title bar offset back
        element.style.right = 'auto';
        element.style.bottom = 'auto';
    }

    endDrag() {
        if (this.isMobileModeActive) {
            this.dragState.isDragging = false;
            this.dragState.currentElement = null;
            return;
        }
        if (this.dragState.currentElement) {
            this.dragState.currentElement.classList.remove('dragging');
            
            // Clear saved minimized position since user manually moved it
            const panel = this.dragState.currentElement;
            delete panel.dataset.minimizedLeft;
            delete panel.dataset.minimizedTop;
            delete panel.dataset.minimizedRight;
            delete panel.dataset.minimizedBottom;
        }
        
        this.dragState.isDragging = false;
        this.dragState.currentElement = null;
    }

    // ====================================
    // RESET DISPLAY FUNCTIONALITY
    // ====================================

    setupResetDisplay() {
        const resetBtn = document.getElementById('reset-display-btn');
        
        if (!resetBtn) {
            console.error('❌ Reset button not found!');
            return;
        }
        
        // Single, clean click event listener
        resetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.executeReset();
        });
        
        console.log('✅ Reset button click handler attached');
    }

    executeReset() {
        console.log('🔥 EXECUTING RESET - Click event confirmed working!');
        
        // Add visual feedback
        const resetBtn = document.getElementById('reset-display-btn');
        resetBtn.style.background = 'rgba(0, 255, 136, 0.8)';
        setTimeout(() => {
            resetBtn.style.background = '';
        }, 200);
        
        this.fullReset();
    }

    fullReset() {
        console.log('🔄 ===== STARTING FULL RESET =====');
        
        // 0. STOP ALL SYSTEMS FIRST
        console.log('🔄 Step 0: Stopping all systems...');
        if (window.lrcModule && window.lrcModule.stopAllSystems) {
            window.lrcModule.stopAllSystems();
        }
        
        // Clear visualization completely for reset
        if (window.lrcVisuals && window.lrcVisuals.clearVisualization) {
            window.lrcVisuals.clearVisualization();
        }
        
        // 1. RESET PANEL POSITIONS (with detailed logging)
        console.log('🔄 Step 1: Resetting panel positions...');
        this.resetAllPositions();
        
        if (window.resetHingesControlsUI) {
            window.resetHingesControlsUI();
        }
        
        // 2. RESET PANEL STATES
        console.log('🔄 Step 2: Resetting panel minimize states...');
        const panelsToMinimize = ['rhythm-info-div', 'visualizations-div', 'playback-div', 'search-div'];
        panelsToMinimize.forEach(panelId => {
            const panel = document.getElementById(panelId);
            const btn = panel?.querySelector('.minimize-btn');
            
            console.log(`🔍 Panel ${panelId}:`, {
                panel: !!panel,
                btn: !!btn,
                isMinimized: panel?.classList.contains('minimized')
            });
            
            if (panel && btn && !panel.classList.contains('minimized')) {
                panel.classList.add('minimized');
                btn.textContent = '+';
                console.log(`✅ Minimized ${panelId}`);
            }
        });
        
        // Ensure rhythm input is expanded
        const rhythmPanel = document.getElementById('rhythm-submit-div');
        const rhythmBtn = rhythmPanel?.querySelector('.minimize-btn');
        console.log('🔍 Rhythm panel state:', {
            panel: !!rhythmPanel,
            btn: !!rhythmBtn,
            isMinimized: rhythmPanel?.classList.contains('minimized')
        });
        
        if (rhythmPanel?.classList.contains('minimized')) {
            rhythmPanel.classList.remove('minimized');
            rhythmBtn.textContent = '−';
            console.log('✅ Expanded rhythm input panel');
        }
        
        // 3. RESET FORM VALUES
        console.log('🔄 Step 3: Resetting form values...');
        const formResets = [
            { id: 'layer-a', value: '8' },
            { id: 'layer-b', value: '7' },
            { id: 'layer-c', value: '6' },
            { id: 'layer-d', value: '5' }
        ];
        
        formResets.forEach(({ id, value }) => {
            const element = document.getElementById(id);
            console.log(`🔍 Form element ${id}:`, {
                element: !!element,
                currentValue: element?.value,
                newValue: value
            });
            
            if (element) {
                element.value = value;
                console.log(`✅ Set ${id} to ${value}`);
            }
        });
        
        // 4. CLEAR DISPLAYS
        console.log('🔄 Step 4: Clearing rhythm displays...');
        this.clearRhythmDisplays();
        
        // 5. RESET OTHER SYSTEMS
        console.log('🔄 Step 5: Resetting other systems...');
        const canvas = document.getElementById('visualization-canvas');
        if (canvas) {
            const wasActive = canvas.classList.contains('active');
            canvas.classList.remove('active');
            console.log(`🔍 Canvas reset: was active: ${wasActive}`);
        }
        
        this.isFirstRhythmInput = true;
        console.log('✅ Reset first rhythm input flag');
        
        if (window.clearAllSearchResults) {
            window.clearAllSearchResults();
            console.log('✅ Cleared search results');
        }
        
        if (window.toneRowPlayback?.isPlaying) {
            window.toneRowPlayback.stopPlayback();
            const playBtn = document.getElementById('play-stop-btn');
            if (playBtn) {
                playBtn.textContent = '▶';
                playBtn.classList.remove('playing');
            }
            console.log('✅ Stopped playback');
        }
        
        console.log('🔄 ===== FULL RESET COMPLETE =====');
    }

    resetAllPositions() {
        if (this.isMobileModeActive) {
            const panels = document.querySelectorAll('.panel');
            panels.forEach((element) => {
                element.style.left = '';
                element.style.top = '';
                element.style.right = '';
                element.style.bottom = '';
                delete element.dataset.minimizedLeft;
                delete element.dataset.minimizedTop;
                delete element.dataset.minimizedRight;
                delete element.dataset.minimizedBottom;
            });
            return;
        }

        console.log('🔄 === RESETTING PANEL POSITIONS ===');
        console.log('🔍 Default positions:', this.defaultPositions);
        
        Object.entries(this.defaultPositions).forEach(([id, pos]) => {
            const element = document.getElementById(id);
            
            console.log(`🔍 Processing panel ${id}:`, {
                element: !!element,
                defaultPos: pos,
                currentStyles: element ? {
                    left: element.style.left,
                    top: element.style.top,
                    right: element.style.right,
                    bottom: element.style.bottom
                } : null
            });
            
            if (!element) {
                console.warn(`❌ Panel ${id} not found`);
                return;
            }
            
            // Clear ALL positioning styles first
            const oldStyles = {
                left: element.style.left,
                top: element.style.top,
                right: element.style.right,
                bottom: element.style.bottom
            };
            
            element.style.left = '';
            element.style.top = '';
            element.style.right = '';
            element.style.bottom = '';
            
            // Clear any saved minimized positions
            delete element.dataset.minimizedLeft;
            delete element.dataset.minimizedTop;
            delete element.dataset.minimizedRight;
            delete element.dataset.minimizedBottom;
            
            console.log(`🔍 Cleared styles for ${id}:`, oldStyles);
            
            // Apply default bottom position
            if (pos.bottom !== undefined) {
                element.style.bottom = pos.bottom + 'px';
                console.log(`✅ Set ${id} bottom: ${pos.bottom}px`);
            }
            if (pos.left !== undefined) {
                element.style.left = pos.left;
                console.log(`✅ Set ${id} left: ${pos.left}`);
            }
            if (pos.top !== undefined) {
                element.style.top = pos.top + 'px';
                console.log(`✅ Set ${id} top: ${pos.top}px`);
            }
            if (pos.right !== undefined) {
                element.style.right = pos.right + 'px';
                console.log(`✅ Set ${id} right: ${pos.right}px`);
            }
            
            // Verify the styles were applied
            const appliedStyles = {
                left: element.style.left,
                top: element.style.top,
                right: element.style.right,
                bottom: element.style.bottom
            };
            console.log(`🔍 Applied styles for ${id}:`, appliedStyles);
            
            // Check computed styles
            const computedStyles = window.getComputedStyle(element);
            console.log(`🔍 Computed styles for ${id}:`, {
                left: computedStyles.left,
                top: computedStyles.top,
                right: computedStyles.right,
                bottom: computedStyles.bottom
            });
        });
        
        console.log('🔄 === PANEL POSITION RESET COMPLETE ===');
    }

    clearRhythmDisplays() {
        // Clear rhythm info displays
        const displays = [
            'layers-display', 'grid-display', 'fundamental-display', 
            'avg-dev-display', 'range-display', 'rhythm-density',
            'composite-length', 'layer-sum', 'spaces-plot-display',
            'composite-rhythm-display'
        ];
        
        displays.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = '--';
            }
        });
        
        // Clear scale chart
        const scaleChart = document.getElementById('scale-chart');
        if (scaleChart) {
            scaleChart.innerHTML = '<div style="color: #888;">No scale data</div>';
        }
    }

    // Add this to init() method for debugging
    debugResetButton() {
        setTimeout(() => {
            console.log('🧪 === RESET BUTTON DEBUG ===');
            
            const resetBtn = document.getElementById('reset-display-btn');
            console.log('Reset button found:', !!resetBtn);
            
            if (resetBtn) {
                console.log('Button properties:', {
                    id: resetBtn.id,
                    className: resetBtn.className,
                    innerHTML: resetBtn.innerHTML,
                    style: resetBtn.style.cssText,
                    parentElement: resetBtn.parentElement?.tagName
                });
                
                console.log('Button position:', resetBtn.getBoundingClientRect());
                console.log('Button computed style:', window.getComputedStyle(resetBtn));
            }
            
            // Check title bar
            const titleBar = document.getElementById('title-bar');
            console.log('Title bar found:', !!titleBar);
            if (titleBar) {
                console.log('Title bar class:', titleBar.className);
                console.log('Title bar children:', Array.from(titleBar.children).map(c => c.tagName + '#' + c.id));
            }
            
            console.log('🧪 === END DEBUG ===');
        }, 2000);
    }

    // ====================================
    // RHYTHM FORM HANDLING
    // ====================================

    setupRhythmForm() {
        const form = document.getElementById('rhythm-form');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRhythmSubmission();
        });
    }

    handleRhythmSubmission() {
        console.log('🎯 Processing rhythm submission...');
        
        // Get input values
        const layerA = parseInt(document.getElementById('layer-a').value) || 0;
        const layerB = parseInt(document.getElementById('layer-b').value) || 0;
        const layerC = parseInt(document.getElementById('layer-c').value) || 0;
        const layerD = parseInt(document.getElementById('layer-d').value) || 0;
        
        // VALIDATION: Reorder layers in descending order (a > b > c > d)
        const originalLayers = [layerA, layerB, layerC, layerD];
        const sortedLayers = [...originalLayers].sort((a, b) => b - a);
        
        // Check if reordering is needed
        const needsReordering = !originalLayers.every((layer, index) => layer === sortedLayers[index]);
        
        if (needsReordering) {
            console.log(`🔄 Reordering layers from [${originalLayers.join(', ')}] to [${sortedLayers.join(', ')}]`);
            
            // Update the input fields with reordered values
            document.getElementById('layer-a').value = sortedLayers[0];
            document.getElementById('layer-b').value = sortedLayers[1];
            document.getElementById('layer-c').value = sortedLayers[2];
            document.getElementById('layer-d').value = sortedLayers[3];
            
            // Brief visual feedback for the reordering
            const layerInputs = document.querySelectorAll('.layer-input input');
            layerInputs.forEach(input => {
                input.style.backgroundColor = '#004488';
                setTimeout(() => {
                    input.style.backgroundColor = '';
                }, 300);
            });
        }
        
        // Trigger LRCModule generation with properly ordered layers
        if (window.lrcModule) {
            window.lrcModule.setRhythms(sortedLayers[0], sortedLayers[1], sortedLayers[2], sortedLayers[3]);
            // setRhythms() calls generateRhythm() which dispatches 'rhythmGenerated' event
            // All modules (LRCVisuals, ToneRowPlayback, etc.) listen to this event and update automatically
            // No manual updates needed - prevents duplicate processing
            
            this.activateVisualization();
        }
    }

    dissolveTitle() {
        const titleBar = document.getElementById('title-bar');
        titleBar.classList.add('dissolve');
        
        // Remove from DOM after animation
        setTimeout(() => {
            titleBar.style.display = 'none';
        }, 300);
    }

    activateVisualization() {
        const canvas = document.getElementById('visualization-canvas');
        canvas.classList.add('active');
        
        // Canvas setup already done in LRCVisuals constructor
        // No need to call setupCanvas() again as it clears the canvas
        if (window.lrcVisuals) {
            window.lrcVisuals.invertedMode = true; // Flag for upside-down rendering
        }
    }

    updateRhythmInfo() {
        // This method is now handled by updateRhythmInfoFromModule
        // Keep this for backwards compatibility but delegate to the new method
        this.updateRhythmInfoFromModule();
    }

    updateRhythmInfoFromModule() {
        if (!window.lrcModule) return;
        
        const rhythmInfo = window.lrcModule.getRhythmInfoData();
        console.log('Updating rhythm info:', rhythmInfo);
        
        // Update all rhythm info displays
        const displayLayers = (rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0)
            ? rhythmInfo.displayLayers
            : rhythmInfo.layers;
        const layersDisplayText = displayLayers.length > 0 ? displayLayers.join(':') : '—';
        const updates = [
            { id: 'layers-display', value: layersDisplayText },
            { id: 'grid-display', value: rhythmInfo.grid },
            { id: 'fundamental-display', value: Math.round(rhythmInfo.fundamental) },
            { id: 'range-display', value: rhythmInfo.range.toFixed(2) },
            { id: 'rhythm-density', value: rhythmInfo.density.toFixed(1) },
            { id: 'pg-ratio', value: rhythmInfo.pulseToGrouping.toFixed(2) },
            { id: 'composite-length', value: rhythmInfo.compositeLength },
            { id: 'layer-sum', value: rhythmInfo.layerSum }
        ];
        
        updates.forEach(({ id, value }) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
                console.log(`Updated ${id} to:`, value);
            } else {
                console.warn(`Element not found: ${id}`);
            }
        });
        
        // Handle Average Deviation (only display for 12-tone scales)
        const avgDevDisplay = document.getElementById('avg-dev-display');
        const avgDevContainer = avgDevDisplay ? avgDevDisplay.parentElement : null;
        
        if (rhythmInfo.avgDeviation !== null) {
            if (avgDevDisplay) avgDevDisplay.textContent = rhythmInfo.avgDeviation.toFixed(3);
            if (avgDevContainer) avgDevContainer.style.display = 'block';
            console.log('Average deviation displayed:', rhythmInfo.avgDeviation.toFixed(3));
        } else {
            if (avgDevContainer) avgDevContainer.style.display = 'none';
            console.log('Average deviation hidden (not 12-tone scale)');
        }
        
        // Update scale chart with improved styling
        this.updateScaleChart(rhythmInfo.pitchCount);
    }

    updateScaleChart(pitchCount) {
        const scaleChart = document.getElementById('scale-chart');
        if (!scaleChart || !window.lrcModule.currentRatios) {
            console.warn('Scale chart element or ratios not found');
            return;
        }
        
        const ratios = window.lrcModule.currentRatios;
        
        if (ratios.length === 0) {
            scaleChart.innerHTML = '<div class="no-scale-data">No scale data available</div>';
            return;
        }
        
        // Add pitch count display above the scale chart
        let html = `
            <div class="pitch-count-display">
                <strong>${pitchCount} ${pitchCount === 1 ? 'Pitch' : 'Pitches'}</strong>
            </div>
            <div class="scale-header">
                <span class="scale-type">${pitchCount === 12 ? '12-Tone Scale' : 'Custom Scale'}</span>
            </div>
            <div class="scale-table-container">
                <table class="scale-table">
                    <thead>
                        <tr>
                            <th>Ratio</th>
                            <th>Cents</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        // Add all ratios to the table with clickable pitch selection
        ratios.forEach((ratio, index) => {
            const cents = ratio.cents ? ratio.cents.toFixed(1) : '0.0';
            html += `
                <tr class="pitch-row" data-pitch-index="${index}" onclick="window.lrcHUD && window.lrcHUD.handlePitchSelection(${index})" style="cursor: pointer;">
                    <td class="ratio-cell">${ratio.fraction}</td>
                    <td class="cents-cell">${cents}</td>
                </tr>
            `;
        });
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        scaleChart.innerHTML = html;
        console.log('Scale chart updated with', ratios.length, 'ratios in table format');
    }

    updateSpacesPlotDisplay(spacesPlot) {
        const display = document.getElementById('spaces-plot-display');
        if (!spacesPlot || spacesPlot.length === 0) {
            display.textContent = 'No data';
            return;
        }
        
        display.textContent = '[' + spacesPlot.join(', ') + ']';
    }

    updateCompositeRhythmDisplay(compositeRhythm) {
        const display = document.getElementById('composite-rhythm-display');
        if (!compositeRhythm || compositeRhythm.length === 0) {
            display.textContent = 'No data';
            return;
        }
        
        display.textContent = '[' + compositeRhythm.join(', ') + ']';
    }

    // ====================================
    // COLLAPSIBLE SECTIONS
    // ====================================

    setupCollapsibleSections() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('subsection-header')) {
                const targetId = e.target.dataset.target;
                const content = document.getElementById(targetId);
                
                if (content) {
                    // Toggle visibility
                    const isCurrentlyVisible = content.style.display !== 'none';
                    content.style.display = isCurrentlyVisible ? 'none' : 'block';
                    
                    // Visual feedback on header
                    if (isCurrentlyVisible) {
                        e.target.classList.remove('expanded');
                        e.target.classList.add('collapsed');
                    } else {
                        e.target.classList.remove('collapsed');
                        e.target.classList.add('expanded');
                    }
                }
            }
        });
    }

    // ====================================
    // VISUALIZATION CONTROLS
    // ====================================

    setupVisualizationControls() {
        // Visualization type selector
        const vizTypeSelector = this.getPrimaryVizSelector();
        if (vizTypeSelector) {
            vizTypeSelector.addEventListener('change', (e) => {
                const nextType = e.target.value;
                if (window.lrcVisuals) {
                    window.lrcVisuals.setPlotType(nextType);
                }
                this.syncVizSelectors(nextType);
                this.updateVisualizationSections(nextType);
            });
            
            // Set initial state
            this.syncVizSelectors(vizTypeSelector.value);
            this.updateVisualizationSections(vizTypeSelector.value);
        } else {
            console.warn('Visualization type selector not found for HUD controls');
        }
        
        // Lightswitch toggle - turns ALL lights off/on
        const lightswitchBtn = document.getElementById('lightswitch-toggle');
        if (lightswitchBtn) {
            lightswitchBtn.setAttribute('aria-pressed', String(this.lightsEnabled));
            lightswitchBtn.setAttribute('aria-label', this.lightsEnabled ? 'Turn layer lights off' : 'Turn layer lights on');
            lightswitchBtn.addEventListener('click', () => {
                this.toggleLights();
            });
        }
        
        // Initialize layer toggle accessibility states
        document.querySelectorAll('.layer-toggle').forEach((btn) => {
            const layer = btn.dataset.layer || '';
            const isActive = btn.classList.contains('active');
            btn.setAttribute('aria-label', `${isActive ? 'Hide' : 'Show'} layer ${layer}`);
            btn.setAttribute('aria-pressed', String(isActive));
        });
        
        // Layer toggles - individual layer visibility
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('layer-toggle')) {
                const layer = e.target.dataset.layer;
                this.toggleLayer(layer, e.target);
            }
        });
        
        // Setup Hinges controls
        this.setupHingesControls();
        
        // Setup Centrifuge controls
        this.setupCentrifugeControls();
    }
    
    updateVisualizationSections(selectedType) {
        // Hide all sections first
        const sections = ['linear-controls', 'centrifuge-controls', 'hinges-controls-section'];
        sections.forEach(sectionId => {
            const section = document.getElementById(sectionId);
            if (section) {
                section.style.display = 'none';
            }
        });
        
        // Show the appropriate section
        let targetSectionId = null;
        switch(selectedType) {
            case 'linear':
                targetSectionId = 'linear-controls';
                break;
            case 'centrifuge':
                targetSectionId = 'centrifuge-controls';
                break;
            case 'hinges':
                targetSectionId = 'hinges-controls-section';
                break;
        }
        
        if (targetSectionId) {
            const targetSection = document.getElementById(targetSectionId);
            if (targetSection) {
                targetSection.style.display = 'block';
            }
        }
    }

    getPrimaryVizSelector() {
        const vizPanel = document.getElementById('visualizations-div');
        if (vizPanel) {
            const primary = vizPanel.querySelector('#viz-type-selector');
            if (primary) {
                return primary;
            }
        }
        return document.querySelector('#viz-type-selector');
    }

    syncVizSelectors(value) {
        if (value === undefined || value === null) {
            return;
        }
        document.querySelectorAll('select#viz-type-selector').forEach((select) => {
            if (select) {
                select.value = value;
            }
        });
    }

    setVisualizationType(type) {
        if (type === undefined || type === null) {
            return;
        }
        const primary = this.getPrimaryVizSelector();
        if (!primary) {
            console.warn('Primary visualization selector not available');
            return;
        }
        
        if (primary.value !== type) {
            primary.value = type;
        }
        
        this.syncVizSelectors(type);
        
        const changeEvent = new Event('change', { bubbles: true });
        primary.dispatchEvent(changeEvent);
    }
    
    setupHingesControls() {
        const getHingesViz = () => window.lrcVisuals?.plotTypes?.['hinges'];
        const tensionBtn = document.getElementById('hinges-tension-btn');
        const animateBtn = document.getElementById('hinges-animate-btn');

        const applyTensionUIState = (hingesViz, enable) => {
            const controlsSection = document.getElementById('hinges-controls-section');
            if (controlsSection) {
                controlsSection.classList.toggle('tension-mode-active', enable);
            }

            const showForcesLabel = document.querySelector('#hinges-controls-section .hinges-show-forces');
            if (showForcesLabel) {
                showForcesLabel.style.display = enable ? 'none' : '';
            }

            const adv = hingesViz?.advanced;
            if (adv && adv.overlays) {
                const { cycleGroup, forcesPanel } = adv.overlays;
                if (cycleGroup) cycleGroup.style.display = enable ? 'none' : '';
                if (forcesPanel) forcesPanel.style.display = enable ? 'none' : '';
            }

            if (hingesViz) {
                if (!enable && hingesViz._tensionUIOverlayTimer) {
                    clearTimeout(hingesViz._tensionUIOverlayTimer);
                    hingesViz._tensionUIOverlayTimer = null;
                }

                if (enable) {
                    const advOverlaysReady = adv && adv.overlays && (adv.overlays.cycleGroup || adv.overlays.forcesPanel);
                    if (!advOverlaysReady) {
                        if (hingesViz._tensionUIOverlayTimer) {
                            clearTimeout(hingesViz._tensionUIOverlayTimer);
                        }
                        hingesViz._tensionUIOverlayTimer = setTimeout(() => {
                            applyTensionUIState(hingesViz, enable);
                            hingesViz._tensionUIOverlayTimer = null;
                        }, 250);
                    }
                }
            }
        };

        const setTensionState = (hingesViz, enable) => {
            if (tensionBtn) {
                tensionBtn.classList.toggle('active', !!enable);
                tensionBtn.textContent = enable ? '↩️ Release Tension' : '⚡ Tension';
            }

            applyTensionUIState(hingesViz, enable);

            if (!hingesViz) return;

            if (!hingesViz.expansion) {
                if (enable) {
                    console.warn('Tension mode requested but Hinges expansion module is unavailable.');
                }
                enable = false;
            }

            hingesViz.tensionModeEnabled = enable;

            if (enable) {
                if (hingesViz.isAnimating) {
                    if (hingesViz.animationPhase === 'settling') {
                        hingesViz.pendingTensionActivation = false;
                        if (hingesViz.animationPhase !== 'expanding') {
                            hingesViz.expansion.enterExpansionMode();
                        }
                    } else if (hingesViz.animationPhase !== 'expanding') {
                        hingesViz.pendingTensionActivation = true;
                    }
                } else {
                    hingesViz.pendingTensionActivation = true;
                }
            } else {
                hingesViz.pendingTensionActivation = false;
                if (hingesViz.expansion && hingesViz.animationPhase === 'expanding') {
                    hingesViz.expansion.exitExpansionMode();
                }
            }
        };

        if (tensionBtn) {
            tensionBtn.addEventListener('click', () => {
                const hingesViz = getHingesViz();
                const nextState = !(hingesViz ? hingesViz.tensionModeEnabled : tensionBtn.classList.contains('active'));
                setTensionState(hingesViz, nextState);
            });
        }

        if (animateBtn) {
            animateBtn.addEventListener('click', () => {
                const hingesViz = getHingesViz();
                if (!hingesViz) return;

                const modeSelect = document.getElementById('hinges-mode');
                if (modeSelect && hingesViz.advanced) {
                    const advancedMode = (modeSelect.value === 'mirror' || modeSelect.value === 'anchors') ? modeSelect.value : 'off';
                    hingesViz.advanced.setMode(advancedMode);
                }

                if (hingesViz.isAnimating) {
                    hingesViz.stopAnimation();
                    animateBtn.textContent = '🔗 Animate Chain';
                    animateBtn.classList.remove('animating');
                } else {
                    hingesViz.startAnimation();
                    animateBtn.textContent = '⏹ Stop Animation';
                    animateBtn.classList.add('animating');

                    if (hingesViz.tensionModeEnabled) {
                        setTensionState(hingesViz, true);
                    }
                }
            });
        }
        
        // Show Forces checkbox
        const showForcesCheck = document.getElementById('hinges-show-forces');
        if (showForcesCheck) {
            showForcesCheck.addEventListener('change', (e) => {
                const hingesViz = window.lrcVisuals?.plotTypes?.['hinges'];
                if (hingesViz) {
                    hingesViz.showForces = e.target.checked;
                }
            });
        }
        
        // Mode selector
        const modeSelect = document.getElementById('hinges-mode');
        if (modeSelect) {
            modeSelect.addEventListener('change', () => {
                const hingesViz = getHingesViz();
                if (!hingesViz) return;

                const val = modeSelect.value;
                const advancedMode = (val === 'mirror' || val === 'anchors') ? val : 'off';

                if (hingesViz.expansion && hingesViz.animationPhase === 'expanding') {
                    hingesViz.expansion.exitExpansionMode();
                }

                if (hingesViz.isAnimating) {
                    hingesViz.stopAnimation();
                    if (animateBtn) {
                        animateBtn.textContent = '🔗 Animate Chain';
                        animateBtn.classList.remove('animating');
                    }
                }

                if (hingesViz.advanced) {
                    hingesViz.advanced.setMode(advancedMode);
                }

                if (typeof hingesViz.initializeChain === 'function') {
                    hingesViz.initializeChain();
                    hingesViz.animationPhase = 'hanging';
                    hingesViz.draw();
                }

                setTensionState(hingesViz, hingesViz.tensionModeEnabled);
            });
        }

        window.addEventListener('rhythmGenerated', () => {
            const hingesViz = getHingesViz();
            const animateBtnEl = document.getElementById('hinges-animate-btn');
            if (hingesViz && hingesViz.isAnimating) {
                hingesViz.stopAnimation();
            }
            if (animateBtnEl) {
                animateBtnEl.textContent = '🔗 Animate Chain';
                animateBtnEl.classList.remove('animating');
            }

            if (hingesViz) {
                hingesViz.pendingTensionActivation = hingesViz.tensionModeEnabled;
                setTensionState(hingesViz, hingesViz.tensionModeEnabled);
            }
        });

        // Initialize UI state
        setTensionState(getHingesViz(), false);
    }
    
    setupCentrifugeControls() {
        const sliceButtons = Array.from(document.querySelectorAll('.slice-toggle'));
        if (sliceButtons.length === 0) return;

        sliceButtons.forEach((btn) => {
            const layer = btn.dataset.slice || '';
            const isActive = btn.classList.contains('active');
            btn.setAttribute('aria-pressed', String(isActive));
            btn.setAttribute('aria-label', `${isActive ? 'Hide' : 'Show'} layer ${layer} slice`);
        });

        const getCentrifuge = () => window.lrcVisuals && window.lrcVisuals.centrifuge ? window.lrcVisuals.centrifuge : null;

        const applySliceVisibility = () => {
            const centrifuge = getCentrifuge();
            if (!centrifuge) return;

            const visibleLayers = new Set();
            sliceButtons.forEach(btn => {
                if (btn.classList.contains('active')) {
                    const layer = btn.dataset.slice;
                    if (layer) visibleLayers.add(layer);
                }
            });

            centrifuge.setVisibleLayers(visibleLayers);

            if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'centrifuge') {
                window.lrcVisuals.drawCentrifugePlot();
            }
        };

        sliceButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                const isActive = btn.classList.contains('active');
                const layer = btn.dataset.slice || '';
                btn.setAttribute('aria-pressed', String(isActive));
                btn.setAttribute('aria-label', `${isActive ? 'Hide' : 'Show'} layer ${layer} slice`);
                applySliceVisibility();
            });
        });

        // Ensure state reapplies when rhythm regenerates or centrifuge initializes
        window.addEventListener('rhythmGenerated', () => applySliceVisibility());

        const waitForCentrifuge = () => {
            if (getCentrifuge()) {
                applySliceVisibility();
            } else {
                setTimeout(waitForCentrifuge, 200);
            }
        };

        waitForCentrifuge();
    }

    toggleLights() {
        this.lightsEnabled = !this.lightsEnabled;
        const lightswitchBtn = document.getElementById('lightswitch-toggle');
        
        if (this.lightsEnabled) {
            lightswitchBtn.classList.remove('lights-off');
            lightswitchBtn.querySelector('.lightswitch-icon').textContent = '💡';
        } else {
            lightswitchBtn.classList.add('lights-off');
            lightswitchBtn.querySelector('.lightswitch-icon').textContent = '🔒';
        }

        if (lightswitchBtn) {
            lightswitchBtn.setAttribute('aria-pressed', String(this.lightsEnabled));
            lightswitchBtn.setAttribute('aria-label', this.lightsEnabled ? 'Turn layer lights off' : 'Turn layer lights on');
        }
        
        // Use the new dedicated method for lighting control
        if (window.lrcVisuals) {
            window.lrcVisuals.setLightsEnabled(this.lightsEnabled);
        }
        
        console.log(`Lightswitch ${this.lightsEnabled ? 'ON' : 'OFF'} - Layer overlay lights ${this.lightsEnabled ? 'enabled' : 'disabled'}`);
    }

    toggleLayer(layer, button) {
        button.classList.toggle('active');
        const isVisible = button.classList.contains('active');
        button.setAttribute('aria-pressed', String(isVisible));
        if (layer) {
            button.setAttribute('aria-label', `${isVisible ? 'Hide' : 'Show'} layer ${layer}`);
        }
        
        // Communicate to visualization system
        if (window.lrcVisuals) {
            window.lrcVisuals.toggleLayerVisibility(layer, isVisible);
        }
    }

    // ====================================
    // PLAYBACK CONTROLS
    // ====================================

    setupPlaybackControls() {        
        // Tempo control
        const cycleDurationInput = document.getElementById('cycle-duration');
        if (cycleDurationInput) {
            cycleDurationInput.addEventListener('change', (e) => {
                if (window.toneRowPlayback) {
                    window.toneRowPlayback.updateTempo(parseFloat(e.target.value));
                }
            });
        }
        
        // Fundamental frequency
        const fundamentalInput = document.getElementById('fundamental-freq');
        if (fundamentalInput) {
            fundamentalInput.addEventListener('change', (e) => {
                if (window.toneRowPlayback) {
                    window.toneRowPlayback.updateFundamentalFreq(parseFloat(e.target.value));
                }
            });
        }
        
        console.log('✅ Playback controls setup (play button handled by ToneRowPlayback)');
    }

    // ====================================
    // SEARCH ALGORITHMS
    // ====================================

    setupSearchAlgorithms() {
        // ====================================
        // RHYTHM LAYER SEARCH
        // ====================================
        window.rhythmLayerSearch = () => {
            if (window.lrcSearch) {
                window.lrcSearch.performRhythmLayerSearch();
            } else {
                console.warn('LRCSearch module not available');
                document.getElementById('rhythm-search-results').innerHTML = 
                    '<div style="color: #ff4444;">LRCSearch module not loaded</div>';
            }
        };

        // ====================================
        // GRID SEARCH
        // ====================================
        window.gridSearch = () => {
            if (window.lrcSearch) {
                window.lrcSearch.performGridSearch();
            } else {
                console.warn('LRCSearch module not available');
                document.getElementById('grid-search-results').innerHTML = 
                    '<div style="color: #ff4444;">LRCSearch module not loaded</div>';
            }
        };

        // ====================================
        // FUNDAMENTAL SEARCH
        // ====================================
        window.fundamentalSearch = () => {
            if (window.lrcSearch) {
                window.lrcSearch.performFundamentalSearch();
            } else {
                console.warn('LRCSearch module not available');
                document.getElementById('fundamental-search-results').innerHTML = 
                    '<div style="color: #ff4444;">LRCSearch module not loaded</div>';
            }
        };

        // ====================================
        // INVERSE PG SEARCH
        // ====================================
        window.inversePGSearch = () => {
            if (window.lrcSearch) {
                window.lrcSearch.performInversePGSearch();
            } else {
                console.warn('LRCSearch module not available');
                document.getElementById('inverse-pg-results').innerHTML = 
                    '<div style="color: #ff4444;">LRCSearch module not loaded</div>';
            }
        };

        // ====================================
        // CLEAR ALL RESULTS
        // ====================================
        window.clearAllSearchResults = () => {
            const resultDivs = [
                'rhythm-search-results',
                'grid-search-results', 
                'fundamental-search-results',
                'inverse-pg-results'
            ];
            
            resultDivs.forEach(id => {
                const div = document.getElementById(id);
                if (div) div.innerHTML = '';
            });

            // Clear the accumulated results in LRCSearch if available
            if (window.lrcSearch) {
                ['rhythm', 'grid', 'fundamental', 'inversePG'].forEach(algorithm => {
                    window.lrcSearch.clearAlgorithmResults(algorithm);
                });
            }
            
            console.log('✅ All search results cleared');
        };

        console.log('✅ Search algorithms setup complete - 4 algorithms available');
    }

    // ====================================
    // PUBLIC API
    // ====================================

    // Method to manually trigger rhythm info update
    refreshDisplay() {
        if (!this.isFirstRhythmInput) {
            this.updateRhythmInfo();
        }
    }

    // Method to programmatically set rhythm values
    setRhythmValues(a, b, c, d) {
        document.getElementById('layer-a').value = a;
        document.getElementById('layer-b').value = b;
        document.getElementById('layer-c').value = c;
        document.getElementById('layer-d').value = d;
    }

    // Handle pitch selection with deselection support
    handlePitchSelection(pitchIndex) {
        // Check if this pitch is already selected (for deselection)
        const isAlreadySelected = window.lrcInterconsonance && 
                                 window.lrcInterconsonance.selectedPitch === pitchIndex;
        
        if (isAlreadySelected) {
            // Deselect the pitch
            if (window.lrcInterconsonance.clearSelection) {
                window.lrcInterconsonance.clearSelection();
            }
        } else {
            // Select the pitch
            if (window.lrcInterconsonance) {
                window.lrcInterconsonance.selectPitch(pitchIndex);
            }
        }
    }
}

// Initialize HUD Controller when DOM is ready
let lrcHUD;

// Wait for both DOM and LRCModule to be ready
function initializeHUD() {
    if (window.lrcModule) {
        lrcHUD = new LRCHUDController();
        window.lrcHUD = lrcHUD;
        console.log('LRC HUD Interface ready');
    } else {
        // Retry if LRCModule not ready yet
        setTimeout(initializeHUD, 50);
    }
}

// Start initialization after DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initializeHUD, 100);
});
