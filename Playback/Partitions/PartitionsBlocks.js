// PartitionsBlocks.js - Generate and render partition blocks with zoom support

class PartitionsBlocks {
    static calculatePartitionSizes(total, partitions) {
        const T = Math.max(1, Math.floor(Number(total) || 1));
        const P = Math.max(1, Math.floor(Number(partitions) || 1));

        if (P === 1) {
            return { sizes: [T], baseSize: T };
        }

        const baseSize = Math.round(T / P);
        const rawTotal = baseSize * P;
        const remainder = Math.abs(rawTotal - T);
        const delta = rawTotal > T ? -1 : 1;

        if (remainder === 0) {
            return { sizes: new Array(P).fill(baseSize), baseSize };
        }

        const pattern = PartitionsDistribution.generateEuclideanPattern(P, remainder);
        const sizes = pattern.map((flag) => baseSize + (flag ? delta : 0));

        return { sizes, baseSize };
    }

    static computeL2Coverages(l1Sizes, l1Order, p1Count, p2Count) {
        if (!p2Count || p2Count <= 0 || !l1Sizes || l1Sizes.length === 0) {
            return null;
        }
        const orderedSizes = Array.isArray(l1Order) && l1Order.length === l1Sizes.length
            ? l1Order.map((origIdx) => l1Sizes[origIdx] || 0)
            : l1Sizes.slice();
        const { sizes: groupSizes } = PartitionsBlocks.calculatePartitionSizes(p1Count, p2Count);
        const coverages = [];
        let cursor = 0;
        for (let g = 0; g < groupSizes.length; g++) {
            let sum = 0;
            for (let i = 0; i < groupSizes[g]; i++) {
                if (cursor + i < orderedSizes.length) {
                    sum += orderedSizes[cursor + i];
                }
            }
            coverages.push(sum);
            cursor += groupSizes[g];
        }
        return coverages;
    }

    static computeL2BlockColors(coverages, layerColor) {
        const freq = new Map();
        coverages.forEach((cov) => {
            freq.set(cov, (freq.get(cov) || 0) + 1);
        });
        const sorted = [...new Set(coverages)]
            .map((val) => ({ val, count: freq.get(val) }))
            .sort((a, b) => b.count - a.count);
        const rankMap = new Map();
        let rank = 0;
        for (let i = 0; i < sorted.length; i++) {
            if (i > 0 && sorted[i].count < sorted[i - 1].count) {
                rank++;
            }
            rankMap.set(sorted[i].val, rank);
        }
        const maxRank = rank;
        const parseHex = (hex) => {
            const h = hex.replace('#', '');
            const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
            return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
        };
        const white = [0xe6, 0xe6, 0xe6];
        let target = white;
        try { target = parseHex(layerColor); } catch (_) { /* fallback */ }
        return coverages.map((cov) => {
            const r = rankMap.get(cov) || 0;
            if (maxRank === 0) return '#e6e6e6';
            const t = r / maxRank;
            const blend = (w, c) => Math.round(w + (c - w) * t);
            return `rgb(${blend(white[0], target[0])}, ${blend(white[1], target[1])}, ${blend(white[2], target[2])})`;
        });
    }

    static renderBlocks(container, sizes, baseSize, color, totalUnits, mutedSet = new Set(), onToggle, order = null, onReorder, options = {}) {
        if (!container) return;

        const previousScroll = container.querySelector('.partition-blocks-scroll')?.scrollLeft || 0;
        const { visibleDisplayIndices = null, allowDrag = true, blockColors = null } = options;

        const gap = 4;
        const containerWidth = container.clientWidth || 0;
        const blockCount = sizes.length;
        const orderedIndices = Array.isArray(order) && order.length === sizes.length
            ? order
            : sizes.map((_, index) => index);
        const displayIndices = Array.isArray(visibleDisplayIndices) && visibleDisplayIndices.length > 0
            ? visibleDisplayIndices
            : orderedIndices.map((_, index) => index);
        const visibleCount = displayIndices.length;
        const visibleUnits = displayIndices.reduce((sum, displayIndex) => {
            const originalIndex = orderedIndices[displayIndex];
            const size = sizes[originalIndex] || 0;
            return sum + size;
        }, 0);
        const unitCount = Math.max(1, visibleUnits || Number(totalUnits) || 1);

        // Max 32 blocks visible at once; beyond that, enable horizontal scrolling
        const maxBlocksVisible = 32;
        const needsScroll = visibleCount > maxBlocksVisible;

        let unitWidth = 12; // default fallback
        let trackWidthStyle = '';

        if (needsScroll) {
            // For scrolling: calculate unitWidth so 32 blocks fit in viewport
            const blocksInView = maxBlocksVisible;
            const totalGapsInView = Math.max(0, blocksInView - 1) * gap;
            const availableWidth = containerWidth ? (containerWidth - totalGapsInView - 12) : 0;
            const unitsInView = unitCount * (blocksInView / Math.max(1, visibleCount));
            unitWidth = availableWidth && unitsInView ? (availableWidth / unitsInView) : 12;
            const totalGaps = Math.max(0, visibleCount - 1) * gap;
            const totalTrackWidth = unitCount * unitWidth + totalGaps;
            trackWidthStyle = `width: ${totalTrackWidth}px;`;
        }

        container.innerHTML = `
            <div class="partition-blocks-scroll" style="overflow-x: ${needsScroll ? 'auto' : 'hidden'}; overflow-y: hidden;">
                <div class="partition-blocks-track" style="display: flex; gap: ${gap}px; align-items: center; padding: 6px; min-height: 34px; ${trackWidthStyle}"></div>
            </div>
        `;

        const track = container.querySelector('.partition-blocks-track');
        if (!container.dataset.shiftToggleBound) {
            container.dataset.shiftToggleBound = 'true';
            container.addEventListener('mouseup', () => {
                container._shiftToggleSet = null;
            });
            container.addEventListener('mouseleave', () => {
                container._shiftToggleSet = null;
            });
            document.addEventListener('keyup', (event) => {
                if (event.key === 'Shift') {
                    container._shiftToggleSet = null;
                }
            });
        }
        displayIndices.forEach((displayIndex) => {
            const originalIndex = orderedIndices[displayIndex];
            const size = sizes[originalIndex];
            const block = document.createElement('div');
            block.className = 'partition-block';
            const isAltered = size !== baseSize;
            const isMuted = mutedSet.has(originalIndex);
            const hasCustomColor = Array.isArray(blockColors) && typeof blockColors[originalIndex] === 'string';
            const unmutedColor = hasCustomColor ? blockColors[originalIndex] : (isAltered ? color : '#e6e6e6');
            if (needsScroll) {
                block.style.width = `${size * unitWidth}px`;
                block.style.flexShrink = '0';
            } else {
                block.style.flex = `${size} 0 0px`;
            }
            block.style.height = '16px';
            block.style.borderRadius = '3px';
            block.style.background = isMuted ? '#3a3a3a' : unmutedColor;
            block.style.opacity = isMuted ? '0.5' : '0.9';
            block.title = `${size}`;
            block.draggable = allowDrag;
            block.dataset.displayIndex = String(displayIndex);
            block.dataset.originalIndex = String(originalIndex);
            block.dataset.muted = isMuted ? 'true' : 'false';
            block.dataset.glowColor = unmutedColor;
            block.dataset.baseBackground = block.style.background;
            block.addEventListener('dblclick', () => {
                if (typeof onToggle === 'function') {
                    onToggle(originalIndex);
                }
            });
            const maybeToggle = (event) => {
                if (!event.shiftKey) return;
                const toggled = container._shiftToggleSet || (container._shiftToggleSet = new Set());
                if (toggled.has(originalIndex)) return;
                toggled.add(originalIndex);
                if (typeof onToggle === 'function') {
                    onToggle(originalIndex);
                }
            };
            block.addEventListener('mousedown', (event) => {
                if (!event.shiftKey) return;
                event.preventDefault();
                maybeToggle(event);
            });
            block.addEventListener('mouseenter', (event) => {
                if (!event.shiftKey || !event.buttons) return;
                maybeToggle(event);
            });
            if (allowDrag) {
                block.addEventListener('dragstart', (event) => {
                    event.dataTransfer.setData('text/plain', String(displayIndex));
                });
                block.addEventListener('dragover', (event) => {
                    event.preventDefault();
                });
                block.addEventListener('drop', (event) => {
                    event.preventDefault();
                    const fromIndex = Number(event.dataTransfer.getData('text/plain'));
                    const toIndex = displayIndex;
                    if (Number.isNaN(fromIndex) || typeof onReorder !== 'function') return;
                    onReorder(fromIndex, toIndex);
                });
            }
            track.appendChild(block);
        });

        const scrollContainer = container.querySelector('.partition-blocks-scroll');
        if (scrollContainer) {
            requestAnimationFrame(() => {
                scrollContainer.scrollLeft = previousScroll;
            });
        }
    }
}

window.PartitionsBlocks = PartitionsBlocks;
