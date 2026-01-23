// ConsonanceFamiliesUI.js - Consonance families rendering and interactions

class ConsonanceFamiliesUI {
    constructor(playback) {
        this.playback = playback;
    }

    updateInterconsonanceFamilies(containerId = 'consonance-families-container', controlsId = 'families-controls-playback') {
        const container = document.getElementById(containerId);
        const controls = controlsId ? document.getElementById(controlsId) : null;
        if (!container) return;

        if (window.lrcInterconsonance && window.lrcInterconsonance.currentAnalysis) {
            const families = window.lrcInterconsonance.currentAnalysis.families;

            if (families && families.length > 0) {
                if (controls) controls.style.display = 'block';

                this.playback.familyDisplayState.currentPage = 0;
                container.innerHTML = this.generatePlaybackFamiliesPage(families, containerId);

                this.updateSortControls();
                this.updateFamilyHighlight(containerId);

                console.log(`🎵 Updated consonance families display with ${families.length} families`);
            } else {
                if (controls) controls.style.display = 'none';
                container.innerHTML = '<p style="color: #666; font-size: 11px; padding: 8px;">No consonance families detected.</p>';
                this.clearActiveFamilySelection();
            }
        } else {
            if (controls) controls.style.display = 'none';
            container.innerHTML = '<p style="color: #666; font-size: 11px; padding: 8px;">Run Interconsonance analysis first.</p>';
            this.clearActiveFamilySelection();
        }

        if (containerId === 'consonance-families-container') {
            const partitionsContainer = document.getElementById('partitions-families-container');
            if (partitionsContainer) {
                this.updateInterconsonanceFamilies('partitions-families-container', null);
            }
        }
    }

    selectConsonanceFamily(familyIndex) {
        if (!window.lrcInterconsonance || !window.lrcInterconsonance.currentAnalysis) return;
        
        const sortedFamilies = this.getSortedPlaybackFamilies(window.lrcInterconsonance.currentAnalysis.families);
        if (!sortedFamilies || familyIndex >= sortedFamilies.length) return;
        
        const family = sortedFamilies[familyIndex];
        
        this.playback.selectedNotes.clear();
        
        family.ratios.forEach(ratioFraction => {
            this.playback.selectedNotes.add(ratioFraction);
        });
        
        this.playback.updateScaleDisplay();
        this.playback.updateLinearPlotVisibility();
        this.playback.updateSelectedNotesCount();
        this.playback.generateToneRowData();
        this.playback.dispatchSelectedNotesEvent();
        
        console.log(`🎭 Selected consonance family ${familyIndex + 1} with ${family.ratios.length} ratios:`, family.ratios);

        this.setActiveFamilySelection(family, familyIndex);
    }

    setActiveFamilySelection(family, index) {
        if (!family) {
            this.clearActiveFamilySelection();
            return;
        }

        this.playback.activeFamilySelection = {
            key: this.getFamilyKey(family),
            index: index,
            ratios: new Set(family.ratios)
        };

        this.updateFamilyHighlight();
    }

    clearActiveFamilySelection() {
        this.playback.activeFamilySelection = null;
        this.updateFamilyHighlight();
    }

    getFamilyKey(family) {
        if (!family || !Array.isArray(family.ratios)) return null;
        return family.ratios.slice().sort().join('|');
    }

    updateFamilyHighlight(containerId = 'consonance-families-container') {
        const container = document.getElementById(containerId);
        const buttons = container ? container.querySelectorAll('.consonance-family-btn') : [];
        buttons.forEach(btn => btn.classList.remove('active'));

        if (!this.playback.activeFamilySelection || !window.lrcInterconsonance || !window.lrcInterconsonance.currentAnalysis) {
            return;
        }

        const families = window.lrcInterconsonance.currentAnalysis.families;
        if (!families || families.length === 0) {
            this.playback.activeFamilySelection = null;
            return;
        }

        const sortedFamilies = this.getSortedPlaybackFamilies(families);
        const key = this.playback.activeFamilySelection.key;
        const newIndex = sortedFamilies.findIndex(fam => this.getFamilyKey(fam) === key);

        if (newIndex === -1) {
            this.playback.activeFamilySelection = null;
            return;
        }

        this.playback.activeFamilySelection.index = newIndex;
        this.playback.activeFamilySelection.ratios = new Set(sortedFamilies[newIndex].ratios);

        buttons.forEach(btn => {
            const btnIndex = parseInt(btn.getAttribute('data-family-index'), 10);
            if (!Number.isNaN(btnIndex) && btnIndex === newIndex) {
                btn.classList.add('active');
            }
        });

        if (containerId === 'consonance-families-container') {
            const partitionsContainer = document.getElementById('partitions-families-container');
            if (partitionsContainer) {
                const partitionsButtons = partitionsContainer.querySelectorAll('.consonance-family-btn');
                partitionsButtons.forEach(btn => {
                    const btnIndex = parseInt(btn.getAttribute('data-family-index'), 10);
                    btn.classList.toggle('active', !Number.isNaN(btnIndex) && btnIndex === newIndex);
                });
            }
        }
    }

    checkActiveFamilyIntegrity() {
        if (!this.playback.activeFamilySelection) return;

        const requiredRatios = this.playback.activeFamilySelection.ratios;
        const allPresent = Array.from(requiredRatios).every(ratio => this.playback.selectedNotes.has(ratio));

        if (!allPresent) {
            this.clearActiveFamilySelection();
        } else {
            this.updateFamilyHighlight();
        }
    }

    getSortedPlaybackFamilies(families) {
        const sorted = [...families];
        
        sorted.sort((a, b) => {
            let comparison = 0;
            
            if (this.playback.familyDisplayState.sortBy === 'avgDeviation') {
                comparison = a.avgDeviation - b.avgDeviation;
            } else if (this.playback.familyDisplayState.sortBy === 'size') {
                comparison = a.size - b.size;
            }
            
            return this.playback.familyDisplayState.sortOrder === 'desc' ? -comparison : comparison;
        });
        
        return sorted;
    }

    generatePlaybackFamiliesPage(families, containerId = 'consonance-families-container') {
        const sortedFamilies = this.getSortedPlaybackFamilies(families);
        const startIdx = this.playback.familyDisplayState.currentPage * this.playback.familyDisplayState.itemsPerPage;
        const endIdx = startIdx + this.playback.familyDisplayState.itemsPerPage;
        const pageFamily = sortedFamilies.slice(startIdx, endIdx);
        const totalPages = Math.ceil(families.length / this.playback.familyDisplayState.itemsPerPage);

        let html = '';

        if (totalPages > 1) {
            html += `
                <div class="pagination-info">
                    Page ${this.playback.familyDisplayState.currentPage + 1} of ${totalPages} (${families.length} total families)
                </div>
            `;
        }

        html += '<div class="consonance-families-list">';

        pageFamily.forEach((family, pageIndex) => {
            const globalIndex = startIdx + pageIndex;
            html += `
                <button class="consonance-family-btn" data-family-index="${globalIndex}">
                    Family ${globalIndex + 1} (${family.size} notes, ${family.avgDeviation.toFixed(1)}¢)
                </button>
            `;
        });

        html += '</div>';

        if (totalPages > 1) {
            html += `
                <div class="pagination-controls">
                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(0)"
                            ${this.playback.familyDisplayState.currentPage === 0 ? 'disabled' : ''}>&laquo;</button>
                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(${this.playback.familyDisplayState.currentPage - 1})"
                            ${this.playback.familyDisplayState.currentPage === 0 ? 'disabled' : ''}>&lsaquo;</button>

                    <span class="page-info">Page ${this.playback.familyDisplayState.currentPage + 1} of ${totalPages}</span>

                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(${this.playback.familyDisplayState.currentPage + 1})"
                            ${this.playback.familyDisplayState.currentPage >= totalPages - 1 ? 'disabled' : ''}>&rsaquo;</button>
                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(${totalPages - 1})"
                            ${this.playback.familyDisplayState.currentPage >= totalPages - 1 ? 'disabled' : ''}>&raquo;</button>
                </div>
            `;
        }

        setTimeout(() => {
            const container = document.getElementById(containerId);
            if (container) {
                container.querySelectorAll('.consonance-family-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const familyIndex = parseInt(btn.getAttribute('data-family-index'));
                        this.selectConsonanceFamily(familyIndex);
                    });
                });
                this.updateFamilyHighlight(containerId);
            }
        }, 0);

        return html;
    }

    changeFamilySort() {
        const sortBy = document.getElementById('playback-family-sort-by')?.value || 'size';
        const sortOrder = document.getElementById('playback-family-sort-order')?.value || 'desc';
        
        this.playback.familyDisplayState.sortBy = sortBy;
        this.playback.familyDisplayState.sortOrder = sortOrder;
        this.playback.familyDisplayState.currentPage = 0;
        
        this.refreshPlaybackFamiliesDisplay();
    }

    goToFamilyPage(pageNum) {
        if (!window.lrcInterconsonance || !window.lrcInterconsonance.currentAnalysis) return;
        
        const families = window.lrcInterconsonance.currentAnalysis.families;
        const totalPages = Math.ceil(families.length / this.playback.familyDisplayState.itemsPerPage);
        
        if (pageNum >= 0 && pageNum < totalPages) {
            this.playback.familyDisplayState.currentPage = pageNum;
            this.refreshPlaybackFamiliesDisplay();
        }
    }

    refreshPlaybackFamiliesDisplay() {
        if (!window.lrcInterconsonance || !window.lrcInterconsonance.currentAnalysis) return;
        
        const families = window.lrcInterconsonance.currentAnalysis.families;
        const container = document.getElementById('consonance-families-container');
        if (container) {
            container.innerHTML = this.generatePlaybackFamiliesPage(families);
            this.updateFamilyHighlight();
        }

        const partitionsContainer = document.getElementById('partitions-families-container');
        if (partitionsContainer) {
            partitionsContainer.innerHTML = this.generatePlaybackFamiliesPage(families, 'partitions-families-container');
            this.updateFamilyHighlight('partitions-families-container');
        }
    }

    updateSortControls() {
        const sortBySelect = document.getElementById('playback-family-sort-by');
        const sortOrderSelect = document.getElementById('playback-family-sort-order');
        
        if (sortBySelect) sortBySelect.value = this.playback.familyDisplayState.sortBy;
        if (sortOrderSelect) sortOrderSelect.value = this.playback.familyDisplayState.sortOrder;
    }
}

window.ConsonanceFamiliesUI = ConsonanceFamiliesUI;
