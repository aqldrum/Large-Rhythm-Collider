// NodeUI.js - Linear Plot Node Popup UI System
// Handles the visual presentation of node information tooltips

class NodeUI {
    constructor() {
        this.popup = null;
        this.isVisible = false;
        this.currentNode = null;

        this.initializePopup();
        console.log('NodeUI initialized');
    }

    initializePopup() {
        // Create popup element
        this.popup = document.createElement('div');
        this.popup.id = 'node-info-popup';
        this.popup.style.cssText = `
            position: absolute;
            background: rgba(26, 26, 26, 0.95);
            border: 1px solid #444;
            border-radius: 6px;
            padding: 12px;
            color: #ffffff;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            pointer-events: none;
            z-index: 10000;
            display: none;
            min-width: 200px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
            line-height: 1.6;
        `;

        // Add to document body
        document.body.appendChild(this.popup);
    }

    showPopup(x, y, nodeData) {
        this.currentNode = nodeData;
        this.isVisible = true;

        // Update popup content with placeholder data
        this.updatePopupContent(nodeData);

        // Position popup near the node
        // Offset to avoid covering the node and stay within viewport
        const offsetX = 15;
        const offsetY = -15;

        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate initial position
        let popupX = x + offsetX;
        let popupY = y + offsetY;

        // Show popup first to get dimensions
        this.popup.style.display = 'block';
        const popupWidth = this.popup.offsetWidth;
        const popupHeight = this.popup.offsetHeight;

        // Adjust if popup would go off-screen right
        if (popupX + popupWidth > viewportWidth - 10) {
            popupX = x - popupWidth - offsetX;
        }

        // Adjust if popup would go off-screen bottom
        if (popupY + popupHeight > viewportHeight - 10) {
            popupY = y - popupHeight + offsetY;
        }

        // Adjust if popup would go off-screen top
        if (popupY < 10) {
            popupY = 10;
        }

        // Adjust if popup would go off-screen left
        if (popupX < 10) {
            popupX = 10;
        }

        this.popup.style.left = `${popupX}px`;
        this.popup.style.top = `${popupY}px`;
    }

    updatePopupContent(nodeData) {
        // Format source layers as colored labels
        const layerColors = {
            'A': '#ff6b6b',
            'B': '#4ecdc4',
            'C': '#00a638ff',
            'D': '#f9ca24'
        };

        const sourceLayersHTML = nodeData.sourceLayers.map(layer => {
            const color = layerColors[layer] || '#fff';
            return `<span style="color: ${color}; font-weight: bold;">${layer}</span>`;
        }).join(', ');

        // Format layer progressions - one per line
        const layerProgressionsHTML = nodeData.layerProgressions.map(prog => {
            const color = layerColors[prog.layer] || '#fff';
            return `<div style="margin-left: 12px;">
                <span style="color: ${color};">Layer ${prog.layer}</span>
                <span style="color: #fff;">${prog.current}/${prog.total}</span>
            </div>`;
        }).join('');

        const content = `
            <div style="margin-bottom: 4px;">
                <span style="color: #aaa;">Ratio:</span> <span style="color: #fff;">${nodeData.ratio}</span>
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #aaa;">Length:</span> <span style="color: #fff;">${nodeData.length}</span>
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #aaa;">Source Layer(s):</span> ${sourceLayersHTML}
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #aaa;">Layer Progression:</span>
                ${layerProgressionsHTML}
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #aaa;">Node:</span> <span style="color: #fff;">${nodeData.nodePosition.current}/${nodeData.nodePosition.total}</span>
            </div>
            <div style="margin-bottom: 4px;">
                <span style="color: #aaa;">Position:</span> <span style="color: #fff;">${nodeData.position}</span>
            </div>
            <div>
                <span style="color: #aaa;">Cycle %:</span> <span style="color: #fff;">${nodeData.cyclePercent}</span>
            </div>
        `;

        this.popup.innerHTML = content;
    }

    hidePopup() {
        this.isVisible = false;
        this.currentNode = null;
        this.popup.style.display = 'none';
    }

    destroy() {
        if (this.popup && this.popup.parentNode) {
            this.popup.parentNode.removeChild(this.popup);
        }
        this.popup = null;
    }
}

// Make globally accessible
window.NodeUI = NodeUI;
