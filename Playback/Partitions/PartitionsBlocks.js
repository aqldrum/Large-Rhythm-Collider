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

    static renderBlocks(container, sizes, baseSize, color, totalUnits, mutedSet = new Set(), onToggle, order = null, onReorder) {
        if (!container) return;

        const previousScroll = container.querySelector('.partition-blocks-scroll')?.scrollLeft || 0;

        const gap = 4;
        const containerWidth = container.clientWidth || 0;
        const blockCount = sizes.length;
        const unitCount = Math.max(1, Number(totalUnits) || 1);

        // Max 32 blocks visible at once; if fewer, they all fit in viewport
        const maxBlocksVisible = 32;
        const blocksInView = Math.min(maxBlocksVisible, blockCount);

        // Calculate block widths based on visible portion
        const totalGapsInView = Math.max(0, blocksInView - 1) * gap;
        const availableWidth = containerWidth ? (containerWidth - totalGapsInView - 12) : 0;
        const unitsInView = unitCount * (blocksInView / blockCount);
        const unitWidth = availableWidth && unitsInView ? (availableWidth / unitsInView) : 12;

        // Total track width for scrolling
        const totalGaps = Math.max(0, blockCount - 1) * gap;
        const totalTrackWidth = unitCount * unitWidth + totalGaps + 12;

        container.innerHTML = `
            <div class="partition-blocks-scroll" style="overflow-x: auto; overflow-y: hidden;">
                <div class="partition-blocks-track" style="display: flex; gap: ${gap}px; align-items: center; padding: 6px; min-height: 34px; width: ${totalTrackWidth}px;"></div>
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
        const orderedIndices = Array.isArray(order) && order.length === sizes.length
            ? order
            : sizes.map((_, index) => index);
        orderedIndices.forEach((originalIndex, displayIndex) => {
            const size = sizes[originalIndex];
            const block = document.createElement('div');
            const isAltered = size !== baseSize;
            const isMuted = mutedSet.has(originalIndex);
            block.style.width = `${size * unitWidth}px`;
            block.style.height = '16px';
            block.style.borderRadius = '3px';
            block.style.background = isMuted ? '#3a3a3a' : (isAltered ? color : '#e6e6e6');
            block.style.opacity = isMuted ? '0.5' : '0.9';
            block.title = `${size}`;
            block.draggable = true;
            block.dataset.displayIndex = String(displayIndex);
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
