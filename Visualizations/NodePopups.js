// NodePopups.js - Data handling for Linear Plot node popups
// Calculates and provides all information needed for node tooltips

class NodePopups {
    constructor() {
        console.log('NodePopups initialized');
    }

    /**
     * Calculate all data for a given node
     * @param {number} nodeIndex - Index of the node in the composite rhythm
     * @param {object} rhythmData - Full rhythm data from LRCModule
     * @returns {object} - Complete node information
     */
    getNodeData(nodeIndex, rhythmData) {
        const { spacesPlot, layerMap, rhythms, compositeRhythm, ratios, grid } = rhythmData;

        const data = {
            ratio: this.getRatio(nodeIndex, ratios),
            length: this.getLength(nodeIndex, spacesPlot),
            sourceLayers: this.getSourceLayers(nodeIndex, layerMap),
            layerProgressions: this.getLayerProgressions(nodeIndex, layerMap, rhythms),
            nodePosition: {
                current: nodeIndex + 1,
                total: this.getCompositeLength(spacesPlot, layerMap)
            },
            position: this.getPosition(nodeIndex, compositeRhythm, spacesPlot),
            cyclePercent: this.getCyclePercent(
                this.getPosition(nodeIndex, compositeRhythm, spacesPlot),
                grid
            )
        };

        return data;
    }

    /**
     * Calculate which layers contribute to this node
     * @param {number} nodeIndex - Index in composite rhythm
     * @param {array} layerMap - Layer map from LRCVisuals
     * @returns {array} - Array of layer names ['A', 'B', etc.]
     */
    getSourceLayers(nodeIndex, layerMap) {
        if (!layerMap || nodeIndex >= layerMap.length) {
            return [];
        }
        return layerMap[nodeIndex] || [];
    }

    /**
     * Calculate layer progression fractions for each contributing layer
     * @param {number} nodeIndex - Index in composite rhythm
     * @param {array} layerMap - Layer map from LRCVisuals
     * @param {array} rhythms - Rhythm values [A, B, C, D]
     * @returns {array} - Array of {layer, current, total} objects
     */
    getLayerProgressions(nodeIndex, layerMap, rhythms) {
        const sourceLayers = this.getSourceLayers(nodeIndex, layerMap);
        const progressions = [];

        // For each source layer, count how many times it has appeared up to this point
        sourceLayers.forEach(layer => {
            const layerIndex = ['A', 'B', 'C', 'D'].indexOf(layer);
            if (layerIndex >= 0) {
                // Count how many times this layer has appeared up to and including this node
                let count = 0;
                for (let i = 0; i <= nodeIndex && i < layerMap.length; i++) {
                    const contributingLayers = layerMap[i] || [];
                    if (contributingLayers.includes(layer)) {
                        count++;
                    }
                }

                progressions.push({
                    layer: layer,
                    current: count,
                    total: rhythms[layerIndex]
                });
            }
        });

        return progressions;
    }

    /**
     * Get the ratio corresponding to this node
     * @param {number} nodeIndex - Index in spaces plot
     * @param {array} ratios - Ratios array from rhythm data
     * @returns {string} - Ratio string like "9/8"
     */
    getRatio(nodeIndex, ratios) {
        if (!ratios || nodeIndex >= ratios.length) {
            return '1/1';
        }
        return ratios[nodeIndex] || '1/1';
    }

    /**
     * Get the length (spaces plot value) for this node
     * @param {number} nodeIndex - Index in spaces plot
     * @param {array} spacesPlot - Spaces plot array
     * @returns {number} - Spaces value
     */
    getLength(nodeIndex, spacesPlot) {
        if (!spacesPlot || nodeIndex >= spacesPlot.length) {
            return 0;
        }
        return spacesPlot[nodeIndex] || 0;
    }

    /**
     * Calculate the composite rhythm position value
     * @param {number} nodeIndex - Index in composite rhythm
     * @param {array} compositeRhythm - Composite rhythm array
     * @param {array} spacesPlot - Spaces plot array (can calculate from this)
     * @returns {number} - Position value
     */
    getPosition(nodeIndex, compositeRhythm, spacesPlot) {
        // If we have composite rhythm, use it
        if (compositeRhythm && nodeIndex < compositeRhythm.length) {
            return compositeRhythm[nodeIndex];
        }

        // Otherwise calculate from spaces plot
        if (spacesPlot && nodeIndex < spacesPlot.length) {
            let position = 0;
            for (let i = 0; i < nodeIndex; i++) {
                position += spacesPlot[i];
            }
            return position;
        }

        return 0;
    }

    /**
     * Calculate cycle percentage
     * @param {number} position - Position value
     * @param {number} grid - Grid size (LCM)
     * @returns {string} - Percentage string like "22.9%"
     */
    getCyclePercent(position, grid) {
        if (!grid || grid === 0) {
            return '0%';
        }

        const percent = (position / grid) * 100;
        return `${percent.toFixed(1)}%`;
    }

    /**
     * Get total number of composite nodes
     * @param {array} spacesPlot - Spaces plot array
     * @param {array} layerMap - Layer map array
     * @returns {number} - Total composite nodes
     */
    getCompositeLength(spacesPlot, layerMap) {
        // Composite length is the number of unique nodes (not layer sum)
        // This should be the length of the spaces plot or layer map
        return layerMap ? layerMap.length : (spacesPlot ? spacesPlot.length : 0);
    }
}

// Make globally accessible
window.NodePopups = NodePopups;
