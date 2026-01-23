// PlaybackMainUI.js - Renders the main playback panel UI and wiring

class PlaybackMainUI {
    constructor(playback) {
        this.playback = playback;
    }

    generatePlaybackHTML() {
        const container = document.getElementById('playback-controls-container');
        if (!container) return;

        const { min: filterMin, max: filterMax } = this.playback.filterLimits;

        container.innerHTML = `
            <!-- Main Section (always expanded) -->
            <div class="playback-section main-section">
                <div class="section-header">
                    <h4>Main Controls</h4>
                </div>
                <div class="section-content">
                    <div class="playback-controls">
                        <button id="play-stop-btn" class="play-btn">▶</button>
                        
                        <div class="control-group">
                            <label>Cycle Time (s):</label>
                            <input type="number" id="cycle-duration" min="${this.playback.cycleDurationLimits.min}" max="${this.playback.cycleDurationLimits.max}" step="0.1" value="${this.playback.cycleDuration}">
                        </div>
                        
                        <div class="control-group">
                            <label>Fundamental (Hz):</label>
                            <input type="number" id="fundamental-freq" min="${this.playback.fundamentalLimits.min}" max="${this.playback.fundamentalLimits.max}" value="${this.playback.fundamentalFreq}">
                        </div>
                        
                        <div class="control-group">
                            <label>Master Volume:</label>
                            <input type="range" id="master-volume" min="-40" max="0" value="${this.playback.masterVolumeDb}">
                            <span id="master-volume-value">${this.playback.masterVolumeDb} dB</span>
                        </div>
                    </div>
                    
                    <!-- Global Filters -->
                    <div class="global-filters">
                        <div class="control-group">
                            <label>Hi-Pass (Hz):</label>
                            <input type="number" id="global-hipass-freq" min="${filterMin}" max="${filterMax}" value="${this.playback.globalFilterSettings.highpass}">
                        </div>
                        <div class="control-group">
                            <label>Lo-Pass (Hz):</label>
                            <input type="number" id="global-lopass-freq" min="${filterMin}" max="${filterMax}" value="${this.playback.globalFilterSettings.lowpass}">
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Layer Controls Section (collapsible) -->
            <div class="playback-section collapsible-section">
                <button class="collapse-btn layer-controls-header" data-target="layer-controls-content">
                    Layer Controls
                </button>
                <div id="layer-controls-content" class="collapse-content">
                    <!-- Layer Toggle Buttons -->
                    <div class="playback-layer-toggles">
                        <button class="playback-layer-btn active" data-layer="a" style="background: #ff6b6b;">A</button>
                        <button class="playback-layer-btn" data-layer="b" style="background: #4ecdc4;">B</button>
                        <button class="playback-layer-btn" data-layer="c" style="background: #00a638ff;">C</button>
                        <button class="playback-layer-btn" data-layer="d" style="background: #f9ca24;">D</button>
                    </div>

                    <div class="playback-legato-row">
                        <button id="legato-toggle" class="legato-toggle-btn" title="Sustain layer notes until another retriggers">Legato</button>
                    </div>
                    
                    <!-- Dynamic Layer Controls -->
                    <div id="layer-controls-container"></div>
                </div>
            </div>
            
            <!-- Scale Section (collapsible) -->
            <div class="playback-section collapsible-section">
                <button class="collapse-btn scale-header" data-target="scale-content">
                    Scale Selection
                </button>
                <div id="scale-content" class="collapse-content">
                    <div class="scale-controls">
                        <button id="select-all-notes" class="control-btn" data-scale-action="select-all">Select All</button>
                        <button id="select-none-notes" class="control-btn" data-scale-action="select-none">None</button>
                        <span id="selected-notes-count" data-scale-count>0 of 0 notes selected</span>
                    </div>
                    <div id="scale-chart-container" class="scale-chart-container">
                        <!-- Scale chart will be populated by JavaScript -->
                    </div>
                </div>
            </div>
            
            <!-- Interconsonance Section (collapsible) -->
            <div class="playback-section collapsible-section">
                <button class="collapse-btn interconsonance-header" data-target="interconsonance-families-content">
                    Consonance Families
                </button>
                <div id="interconsonance-families-content" class="collapse-content">
                    <div class="families-controls-playback" id="families-controls-playback" style="display: none;">
                        <div class="sort-controls">
                            <label>Sort by:</label>
                            <select id="playback-family-sort-by" onchange="window.toneRowPlayback.changeFamilySort()">
                                <option value="size">Member Count</option>                                
                                <option value="avgDeviation">Average Deviation</option>
                            </select>
                            <select id="playback-family-sort-order" onchange="window.toneRowPlayback.changeFamilySort()">
                                <option value="desc">Descending</option>
                                <option value="asc">Ascending</option>
                            </select>
                        </div>
                    </div>
                    <div id="consonance-families-container">
                        <!-- Consonance families will be populated by JavaScript -->
                    </div>
                </div>
            </div>
        `;

        console.log('🎛️ Enhanced Playback HTML generated with collapsible sections');
    }

    setupMasterControls() {
        const playBtn = document.getElementById('play-stop-btn');
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                this.playback.togglePlayback();
            });
        }

        const cycleDurationInput = document.getElementById('cycle-duration');
        if (cycleDurationInput) {
            cycleDurationInput.addEventListener('input', (e) => {
                this.playback.updateTempo(parseFloat(e.target.value), { syncInput: false });
            });

            const snapCycleDuration = () => {
                this.playback.updateTempo(parseFloat(cycleDurationInput.value));
            };

            cycleDurationInput.addEventListener('blur', snapCycleDuration);
            cycleDurationInput.addEventListener('change', snapCycleDuration);
            cycleDurationInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapCycleDuration();
                }
            });
        }

        const freqInput = document.getElementById('fundamental-freq');
        if (freqInput) {
            freqInput.addEventListener('input', (e) => {
                this.playback.updateFundamentalFreq(parseFloat(e.target.value), { syncInput: false });
            });

            const snapToBounds = () => {
                this.playback.updateFundamentalFreq(parseFloat(freqInput.value));
            };

            freqInput.addEventListener('blur', snapToBounds);
            freqInput.addEventListener('change', snapToBounds);
            freqInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapToBounds();
                }
            });
        }

        const volumeSlider = document.getElementById('master-volume');
        const volumeValue = document.getElementById('master-volume-value');
        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                const dbValue = parseFloat(e.target.value);
                volumeValue.textContent = `${dbValue} dB`;
                this.playback.updateMasterVolume(dbValue);
            });
        }

        const globalHipassInput = document.getElementById('global-hipass-freq');
        if (globalHipassInput) {
            globalHipassInput.addEventListener('input', (e) => {
                this.playback.setGlobalHighpass(parseFloat(e.target.value), { syncInput: false });
            });

            const snapGlobalHipass = () => {
                this.playback.setGlobalHighpass(parseFloat(globalHipassInput.value));
            };

            globalHipassInput.addEventListener('blur', snapGlobalHipass);
            globalHipassInput.addEventListener('change', snapGlobalHipass);
            globalHipassInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapGlobalHipass();
                }
            });
        }

        const globalLopassInput = document.getElementById('global-lopass-freq');
        if (globalLopassInput) {
            globalLopassInput.addEventListener('input', (e) => {
                this.playback.setGlobalLowpass(parseFloat(e.target.value), { syncInput: false });
            });

            const snapGlobalLopass = () => {
                this.playback.setGlobalLowpass(parseFloat(globalLopassInput.value));
            };

            globalLopassInput.addEventListener('blur', snapGlobalLopass);
            globalLopassInput.addEventListener('change', snapGlobalLopass);
            globalLopassInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapGlobalLopass();
                }
            });
        }

        this.playback.setGlobalHighpass(this.playback.globalFilterSettings.highpass);
        this.playback.setGlobalLowpass(this.playback.globalFilterSettings.lowpass);

        this.setupCollapsibleSections();
        this.playback.setupScaleControls();

        console.log('✅ Enhanced master controls setup complete');
    }

    setupCollapsibleSections() {
        const collapseBtns = document.querySelectorAll('.collapse-btn');
        collapseBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-target');
                const content = document.getElementById(target);
                
                if (content) {
                    const isExpanded = content.style.display !== 'none';
                    content.style.display = isExpanded ? 'none' : 'block';
                    btn.classList.toggle('collapsed', isExpanded);
                    
                    console.log(`${target} section ${isExpanded ? 'collapsed' : 'expanded'}`);
                }
            });
        });

        document.querySelectorAll('.collapse-content').forEach(content => {
            content.style.display = 'block';
        });

        console.log('✅ Collapsible sections setup complete');
    }
}

window.PlaybackMainUI = PlaybackMainUI;
