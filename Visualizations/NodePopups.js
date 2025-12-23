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

        // Get the space value and calculate fundamental
        const spaceValue = this.getLength(nodeIndex, spacesPlot);
        const fundamental = spacesPlot && spacesPlot.length > 0 ? Math.max(...spacesPlot) : 0;

        const data = {
            ratio: this.getRatio(nodeIndex, spaceValue, fundamental),
            length: spaceValue,
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
     * Get the ratio corresponding to this node with octave information
     * @param {number} nodeIndex - Index in spaces plot
     * @param {number} spaceValue - The spaces plot value at this index
     * @param {number} fundamental - The fundamental (largest space value)
     * @returns {string} - Ratio string like "9/8" or "23/20 (octave 2)"
     */
    getRatio(nodeIndex, spaceValue, fundamental) {
        if (!spaceValue || !fundamental || spaceValue === 0) {
            return '1/1';
        }

        // Calculate the raw ratio (fundamental / space)
        let ratio = fundamental / spaceValue;

        // Count octaves while compressing to single octave
        let octave = 1;
        while (ratio >= 2) {
            ratio /= 2;
            octave++;
        }
        while (ratio < 1) {
            ratio *= 2;
            octave--;
        }

        // Convert to fraction
        const fraction = this.decimalToFraction(ratio);

        // Return with octave info if not octave 1
        if (octave === 1) {
            return fraction;
        } else {
            return `${fraction} (octave ${octave})`;
        }
    }

    /**
     * Convert decimal ratio to fraction string
     * @param {number} ratio - Decimal ratio value
     * @returns {string} - Fraction string
     */
    decimalToFraction(ratio) {
        const tolerance = 1e-6;
        let numerator = 1;
        let denominator = 1;
        let bestError = Math.abs(ratio - 1);

        // Search for best fraction approximation
        for (let d = 1; d <= 10000; d++) {
            const n = Math.round(ratio * d);
            const currentRatio = n / d;
            const error = Math.abs(ratio - currentRatio);

            if (error < bestError) {
                bestError = error;
                numerator = n;
                denominator = d;

                if (error < tolerance) break;
            }
        }

        // Simplify the fraction
        const gcd = this.gcd(numerator, denominator);
        numerator /= gcd;
        denominator /= gcd;

        return `${numerator}/${denominator}`;
    }

    /**
     * Calculate greatest common divisor
     * @param {number} a - First number
     * @param {number} b - Second number
     * @returns {number} - GCD
     */
    gcd(a, b) {
        a = Math.abs(Math.round(a));
        b = Math.abs(Math.round(b));
        while (b !== 0) {
            const temp = b;
            b = a % b;
            a = temp;
        }
        return a;
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
