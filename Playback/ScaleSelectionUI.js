// ScaleSelectionUI.js - Scale selection rendering and interactions

class ScaleSelectionUI {
    constructor(playback) {
        this.playback = playback;
    }

    setupScaleControls() {
        const selectAllBtns = document.querySelectorAll('[data-scale-action="select-all"]');
        selectAllBtns.forEach(btn => {
            if (btn.dataset.scaleBound === 'true') return;
            btn.addEventListener('click', () => {
                this.selectAllNotes();
            });
            btn.dataset.scaleBound = 'true';
        });

        const selectNoneBtns = document.querySelectorAll('[data-scale-action="select-none"]');
        selectNoneBtns.forEach(btn => {
            if (btn.dataset.scaleBound === 'true') return;
            btn.addEventListener('click', () => {
                this.selectNoNotes();
            });
            btn.dataset.scaleBound = 'true';
        });

        console.log('✅ Scale controls setup complete');
    }

    selectAllNotes() {
        this.playback.selectedNotes.clear();
        this.playback.availableRatios.forEach(ratioObj => {
            this.playback.selectedNotes.add(ratioObj.fraction);
        });

        this.updateScaleDisplay();
        this.updateLinearPlotVisibility();
        this.updateSelectedNotesCount();
        this.playback.generateToneRowData();
        this.dispatchSelectedNotesEvent();

        this.playback.enforceMinCycleDuration();

        console.log(`✅ Selected all ${this.playback.selectedNotes.size} notes`);
        this.playback.checkActiveFamilyIntegrity();
    }

    selectNoNotes() {
        this.playback.selectedNotes.clear();

        this.updateScaleDisplay();
        this.updateLinearPlotVisibility();
        this.updateSelectedNotesCount();
        this.playback.generateToneRowData();
        this.dispatchSelectedNotesEvent();

        console.log('✅ Deselected all notes');
        this.playback.checkActiveFamilyIntegrity();
    }

    toggleNoteSelection(ratioFraction) {
        if (this.playback.selectedNotes.has(ratioFraction)) {
            this.playback.selectedNotes.delete(ratioFraction);
        } else {
            this.playback.selectedNotes.add(ratioFraction);
        }

        this.updateScaleDisplay();
        this.updateLinearPlotVisibility();
        this.updateSelectedNotesCount();
        this.playback.generateToneRowData();

        if (this.playback.isPlaying) {
            this.applyRealtimeNoteChanges();
        }

        this.dispatchSelectedNotesEvent();

        if (this.playback.selectedNotes.size === this.playback.availableRatios.length) {
            this.playback.enforceMinCycleDuration();
        }

        console.log(`🎵 Toggled note ${ratioFraction} (${this.playback.selectedNotes.has(ratioFraction) ? 'selected' : 'deselected'})`);
        this.playback.checkActiveFamilyIntegrity();
    }

    updateSelectedNotesCount() {
        const countText = `${this.playback.selectedNotes.size} of ${this.playback.availableRatios.length} notes selected`;
        const countElements = document.querySelectorAll('[data-scale-count]');
        countElements.forEach(element => {
            element.textContent = countText;
        });
    }

    applyRealtimeNoteChanges() {
        if (this.playback.legatoEnabled) {
            this.playback.activeLayerVoices.forEach((voice, layerIndex) => {
                if (!voice) return;
                const shouldMute = voice.noteData?.isMutedByFrequency || this.isNoteMutedBySelection(voice.noteData?.globalSpacesIndex);
                if (shouldMute) {
                    this.playback.releaseLayerVoice(layerIndex);
                }
            });
        }

        console.log('🔄 Real-time note selection changes are active - scheduled notes will check current state');
    }

    dispatchSelectedNotesEvent() {
        const selectedArray = Array.from(this.playback.selectedNotes);
        window.dispatchEvent(new CustomEvent('scaleSelectionChanged', {
            detail: {
                selectedNotes: selectedArray
            }
        }));
    }

    getRatioFractionFromFrequency(frequency) {
        for (const ratioObj of this.playback.availableRatios) {
            const expectedFreq = this.playback.fundamentalFreq * ratioObj.ratio;
            if (Math.abs(expectedFreq - frequency) < 0.1) {
                return ratioObj.fraction;
            }
        }
        return null;
    }

    isNoteMutedBySelection(globalSpacesIndex) {
        if (this.playback.selectedNotes.size === 0) return false;
        
        for (const [fraction, spacesIndices] of this.playback.noteToSpacesMapping.entries()) {
            if (spacesIndices.includes(globalSpacesIndex)) {
                return !this.playback.selectedNotes.has(fraction);
            }
        }
        
        return false;
    }

    updateScaleDisplay(containerId = 'scale-chart-container') {
        const container = document.getElementById(containerId);
        if (!container || !this.playback.availableRatios.length) {
            if (container) {
                container.innerHTML = '<p style="color: #666; font-size: 11px; padding: 8px;">No scale data available.</p>';
            }
            return;
        }

        const scrollableElement = container.querySelector('.scale-chart-scroll');
        const currentScrollTop = scrollableElement ? scrollableElement.scrollTop : 0;

        const scrollClass = containerId === 'partitions-scale-container'
            ? 'scale-chart-scroll partitions-scale-scroll'
            : 'scale-chart-scroll';
        let html = `
            <div class="${scrollClass} ${this.playback.availableRatios.length > 15 ? 'scrollable' : ''}">
                <table class="scale-chart-table">
                    <thead>
                        <tr>
                            <th>Ratio</th>
                            <th>Cents</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        this.playback.availableRatios.forEach(ratioObj => {
            const isSelected = this.playback.selectedNotes.has(ratioObj.fraction);
            const rowClass = isSelected ? 'note-selected' : 'note-deselected';
            html += `
                <tr class="scale-row ${rowClass}" data-ratio="${ratioObj.fraction}">
                    <td>${ratioObj.fraction}</td>
                    <td>${ratioObj.cents.toFixed(1)}</td>
                    <td>${ratioObj.frequency}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;

        const newScrollableElement = container.querySelector('.scale-chart-scroll');
        if (newScrollableElement && currentScrollTop > 0) {
            newScrollableElement.scrollTop = currentScrollTop;
        }

        container.querySelectorAll('.scale-row').forEach(row => {
            row.addEventListener('click', () => {
                const ratioFraction = row.getAttribute('data-ratio');
                if (ratioFraction) {
                    this.toggleNoteSelection(ratioFraction);
                }
            });
        });

        if (containerId === 'scale-chart-container') {
            const partitionsContainer = document.getElementById('partitions-scale-container');
            if (partitionsContainer) {
                this.updateScaleDisplay('partitions-scale-container');
            }
        }
    }

    updateLinearPlotVisibility() {
        const hiddenSpacesIndices = new Set();
        
        if (this.playback.selectedNotes.size > 0) {
            this.playback.availableRatios.forEach(ratioObj => {
                if (!this.playback.selectedNotes.has(ratioObj.fraction)) {
                    const spacesIndices = this.playback.noteToSpacesMapping.get(ratioObj.fraction) || [];
                    spacesIndices.forEach(index => {
                        hiddenSpacesIndices.add(index);
                    });
                }
            });
        }
        
        const selectedRatios = Array.from(this.playback.selectedNotes);
        const hiddenIndices = Array.from(hiddenSpacesIndices);
        
        console.log(`🎨 Linear plot visibility update: ${selectedRatios.length} ratios selected, hiding ${hiddenIndices.length} spaces plot indices:`, hiddenIndices);
        
        window.dispatchEvent(new CustomEvent('spacesPlotVisibilityChanged', {
            detail: {
                selectedRatios: selectedRatios,
                hiddenSpacesIndices: hiddenIndices,
                visibleSpacesIndices: Array.from(Array(this.playback.spacesPlot.length).keys()).filter(i => !hiddenSpacesIndices.has(i))
            }
        }));
    }
}

window.ScaleSelectionUI = ScaleSelectionUI;
