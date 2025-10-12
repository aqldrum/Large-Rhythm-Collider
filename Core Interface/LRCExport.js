// LRCExport.js - Export functionality for Large Rhythm Collider
// Handles PDF, MIDI, and tuning file exports for rhythm analysis data

class LRCExport {
    constructor() {
        this.midiLibraryLoaded = false;
        this.jsPDFLoaded = false;
        this.loadExternalLibraries();
        console.log('📤 LRCExport initialized');
    }

    // ====================================
    // LIBRARY LOADING
    // ====================================

    loadExternalLibraries() {
        // Load Tone.js MIDI library (matching reference implementation)
        if (!window.Midi) {
            const midiScript = document.createElement('script');
            midiScript.src = 'https://cdn.jsdelivr.net/npm/@tonejs/midi@2.0.27/build/Midi.min.js';
            midiScript.onload = () => {
                this.midiLibraryLoaded = true;
                console.log('📤 Tone.js MIDI library loaded');
            };
            midiScript.onerror = () => {
                console.error('📤 Failed to load Tone.js MIDI library');
            };
            document.head.appendChild(midiScript);
        } else {
            this.midiLibraryLoaded = true;
        }

        // Load jsPDF for PDF generation
        if (!window.jsPDF) {
            const pdfScript = document.createElement('script');
            pdfScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            pdfScript.onload = () => {
                this.jsPDFLoaded = true;
                console.log('📤 jsPDF library loaded');
            };
            pdfScript.onerror = () => {
                console.error('📤 Failed to load jsPDF library');
            };
            document.head.appendChild(pdfScript);
        } else {
            this.jsPDFLoaded = true;
        }
    }

    // ====================================
    // PDF EXPORT
    // ====================================

    async exportPDF() {
        if (!this.jsPDFLoaded) {
            console.error('📤 jsPDF library not loaded');
            return;
        }

        if (!window.lrcModule) {
            console.error('📤 LRCModule not available');
            return;
        }

        const rhythmInfo = window.lrcModule.getRhythmInfoData();
        const ratios = window.lrcModule.currentRatios;
        
        if (!rhythmInfo || !ratios) {
            console.error('📤 Rhythm data not available for PDF export');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Palette for PDF styling
        const colors = {
            accent: { r: 0, g: 197, b: 168 },
            header: { r: 22, g: 27, b: 35 },
            headerGlow: { r: 33, g: 39, b: 51 },
            cardBackground: { r: 246, g: 247, b: 251 },
            cardBorder: { r: 214, g: 219, b: 227 },
            textPrimary: { r: 39, g: 45, b: 56 },
            textMuted: { r: 111, g: 120, b: 135 }
        };

        // Set up document
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20;
        const contentWidth = pageWidth - 2 * margin;
        const maxContentHeight = pageHeight - 2 * margin;

        // Header banner
        const headerHeight = 26;
        doc.setFillColor(colors.header.r, colors.header.g, colors.header.b);
        doc.rect(0, 0, pageWidth, headerHeight, 'F');
        doc.setFillColor(colors.headerGlow.r, colors.headerGlow.g, colors.headerGlow.b);
        doc.rect(0, headerHeight - 2.5, pageWidth, 2.5, 'F');
        doc.setFillColor(colors.accent.r, colors.accent.g, colors.accent.b);
        doc.rect(0, headerHeight, pageWidth, 2, 'F');

        const displayLayers = (rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0)
            ? rhythmInfo.displayLayers
            : rhythmInfo.layers;
        const titleLayersText = displayLayers.length > 0 ? displayLayers.join(':') : '—';
        const title = `Rhythm Info · ${titleLayersText}`;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(255, 255, 255);
        doc.text(title, margin, headerHeight - 9);

        let yPos = headerHeight + 12;

        // Capture existing linear plot image at a higher resolution
        const plotCapture = this.captureExistingLinearPlot({
            targetWidth: 1400,
            backgroundColor: '#050607',
            format: 'image/png',
            quality: 0.96
        });

        if (plotCapture?.dataUrl) {
            const intrinsicWidth = plotCapture.width || 1400;
            const intrinsicHeight = plotCapture.height || 400;
            const plotAspect = intrinsicHeight / intrinsicWidth || 0.3;
            const plotWidth = contentWidth - 24;
            const plotHeight = plotWidth * plotAspect;
            const cardHeight = plotHeight + 28;

            if (yPos + cardHeight > maxContentHeight) {
                doc.addPage();
                yPos = margin;
            }

            // Plot card container
            doc.setFillColor(colors.cardBackground.r, colors.cardBackground.g, colors.cardBackground.b);
            doc.roundedRect(margin, yPos, contentWidth, cardHeight, 4, 4, 'F');
            doc.setDrawColor(colors.cardBorder.r, colors.cardBorder.g, colors.cardBorder.b);
            doc.setLineWidth(0.4);
            doc.roundedRect(margin, yPos, contentWidth, cardHeight, 4, 4);

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(colors.textPrimary.r, colors.textPrimary.g, colors.textPrimary.b);
            doc.text('Linear Plot', margin + 12, yPos + 12);
            doc.setDrawColor(colors.accent.r, colors.accent.g, colors.accent.b);
            doc.setLineWidth(0.8);
            doc.line(margin + 12, yPos + 13.5, margin + 48, yPos + 13.5);

            const imageFormat = (plotCapture.format || 'image/png').split('/')[1].toUpperCase();
            doc.addImage(
                plotCapture.dataUrl,
                imageFormat,
                margin + 12,
                yPos + 16,
                plotWidth,
                plotHeight,
                undefined,
                'FAST'
            );

            yPos += cardHeight + 14;
        }

        // Check if we need a new page for metrics
        if (yPos + 60 > maxContentHeight) {
            doc.addPage();
            yPos = margin;
        }

        // Metrics section
        yPos = this.addMetricsToPDF(doc, rhythmInfo, margin, yPos, pageHeight, maxContentHeight, contentWidth);

        // Nested ratios (if they exist)
        if (window.expandedInfoView) {
            const nestedRatios = window.expandedInfoView.calculateNestedRatios(rhythmInfo.layers, rhythmInfo.grid);
            if (nestedRatios.length > 0) {
                // Check if we need a new page for nested ratios
                if (yPos + 40 > maxContentHeight) {
                    doc.addPage();
                    yPos = margin;
                }
                yPos = this.addNestedRatiosToPDF(doc, nestedRatios, margin, yPos, pageHeight, maxContentHeight, contentWidth);
            }
        }

        // Add compact scale table at the bottom
        yPos = this.addCompactScaleTable(doc, ratios, rhythmInfo, margin, yPos, contentWidth, pageHeight, maxContentHeight);

        // Save the PDF
        const filenameLayers = displayLayers.length > 0 ? displayLayers.join(':') : rhythmInfo.layers.join(':');
        const filename = `Rhythm Info - ${filenameLayers || '1'}.pdf`;
        doc.save(filename);
    }

    captureExistingLinearPlot(options = {}) {
        // Try to capture the existing visualization canvas with upgraded fidelity
        const {
            targetWidth = 1400,
            targetHeight = null,
            backgroundColor = '#050607',
            format = 'image/png',
            quality = 0.96
        } = options;

        const canvas = document.getElementById('visualization-canvas');
        if (canvas && canvas.getContext) {
            try {
                const sourceWidth = canvas.width || canvas.getBoundingClientRect().width || 800;
                const sourceHeight = canvas.height || canvas.getBoundingClientRect().height || 200;
                const aspectRatio = sourceWidth > 0 ? sourceHeight / sourceWidth : 0.25;

                const exportWidth = targetWidth;
                const exportHeight = targetHeight || Math.round(exportWidth * aspectRatio);

                const exportCanvas = document.createElement('canvas');
                exportCanvas.width = exportWidth;
                exportCanvas.height = exportHeight;

                const exportCtx = exportCanvas.getContext('2d');
                exportCtx.imageSmoothingEnabled = true;
                exportCtx.imageSmoothingQuality = 'high';
                exportCtx.fillStyle = backgroundColor;
                exportCtx.fillRect(0, 0, exportWidth, exportHeight);
                exportCtx.drawImage(canvas, 0, 0, exportWidth, exportHeight);

                const dataUrl = format === 'image/jpeg'
                    ? exportCanvas.toDataURL(format, quality)
                    : exportCanvas.toDataURL(format);

                return { dataUrl, width: exportWidth, height: exportHeight, format };
            } catch (error) {
                console.warn('📤 Could not capture existing canvas, creating fallback:', error);
                return this.createFallbackLinearPlot(targetWidth, targetHeight, backgroundColor, format, quality);
            }
        } else {
            console.warn('📤 Visualization canvas not found, creating fallback');
            return this.createFallbackLinearPlot(targetWidth, targetHeight, backgroundColor, format, quality);
        }
    }

    createFallbackLinearPlot(targetWidth = 1400, targetHeight = null, backgroundColor = '#0B0E13', format = 'image/png', quality = 0.96) {
        // Stylish fallback in case the live visualization is not available
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const width = targetWidth;
        const height = targetHeight || Math.round(width * 0.28);

        canvas.width = width;
        canvas.height = height;

        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);

        // Subtle gradient accent
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(0, 197, 168, 0.12)');
        gradient.addColorStop(1, 'rgba(0, 197, 168, 0.02)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        const gridLines = 12;
        for (let i = 0; i <= gridLines; i++) {
            const x = 40 + (i / gridLines) * (width - 80);
            ctx.beginPath();
            ctx.moveTo(x, 32);
            ctx.lineTo(x, height - 32);
            ctx.stroke();
        }

        // Stylized pulse points
        ctx.fillStyle = 'rgba(0, 197, 168, 0.8)';
        const pointCount = 18;
        for (let i = 0; i < pointCount; i++) {
            const x = 40 + (i / (pointCount - 1)) * (width - 80);
            const yOffset = Math.sin(i * 0.45) * (height * 0.22);
            const baseLine = height / 2;
            const radius = 6 + Math.cos(i * 0.3) * 2;

            ctx.beginPath();
            ctx.arc(x, baseLine + yOffset, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = '#ffffff';
        ctx.font = '22px Helvetica';
        ctx.textBaseline = 'middle';
        ctx.fillText('Linear Plot Preview', 40, height / 2);

        const dataUrl = format === 'image/jpeg'
            ? canvas.toDataURL(format, quality)
            : canvas.toDataURL(format);

        return { dataUrl, width, height, format };
    }

    addSectionTitleBar(doc, title, x, y, width) {
        const barHeight = 12;
        doc.setFillColor(233, 236, 244);
        doc.roundedRect(x, y, width, barHeight, 3, 3, 'F');
        doc.setDrawColor(214, 219, 227);
        doc.setLineWidth(0.3);
        doc.roundedRect(x, y, width, barHeight, 3, 3);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(53, 60, 73);
        doc.text(title.toUpperCase(), x + 7, y + 8.5);

        return y + barHeight + 6;
    }

    addCompactScaleTable(doc, ratios, rhythmInfo, x, y, width, pageHeight, maxContentHeight) {
        const colors = {
            cardBackground: { r: 247, g: 248, b: 252 },
            cardBorder: { r: 214, g: 219, b: 227 },
            textPrimary: { r: 39, g: 45, b: 56 },
            textMuted: { r: 111, g: 120, b: 135 }
        };

        if (ratios.length === 0) {
            return y;
        }

        const cardPadding = 12;
        const availableWidth = width - cardPadding * 2;
        const ratioColumnWidth = Math.round(availableWidth * 0.48);
        const centsColumnWidth = Math.round(availableWidth * 0.30);
        const countColumnWidth = availableWidth - ratioColumnWidth - centsColumnWidth;
        const rowHeight = 8.5;
        const headerHeight = 8;
        let remainingRatios = [...ratios];
        let sectionTitle = 'Scale';

        while (remainingRatios.length > 0) {
            if (y + 60 > maxContentHeight) {
                doc.addPage();
                y = 20;
            }

            y = this.addSectionTitleBar(doc, sectionTitle, x, y, width);
            sectionTitle = 'Scale (continued)';

            // Determine how many rows fit on this page
            const availableHeight = maxContentHeight - y;
            const usableHeight = availableHeight - cardPadding * 2 - headerHeight;
            const rowsFit = Math.floor(usableHeight / rowHeight);

            if (rowsFit <= 0) {
                doc.addPage();
                y = 20;
                continue;
            }

            const rowsForPage = remainingRatios.slice(0, rowsFit);
            remainingRatios = remainingRatios.slice(rowsFit);

            const cardHeight = cardPadding * 2 + headerHeight + rowsForPage.length * rowHeight;

            doc.setFillColor(colors.cardBackground.r, colors.cardBackground.g, colors.cardBackground.b);
            doc.roundedRect(x, y, width, cardHeight, 4, 4, 'F');
            doc.setDrawColor(colors.cardBorder.r, colors.cardBorder.g, colors.cardBorder.b);
            doc.setLineWidth(0.4);
            doc.roundedRect(x, y, width, cardHeight, 4, 4);

            const headerY = y + cardPadding;
            doc.setFillColor(233, 236, 244);
            doc.roundedRect(x + cardPadding - 1, headerY - 2.5, width - cardPadding * 2 + 2, headerHeight + 2.5, 2, 2, 'F');
            doc.setDrawColor(214, 219, 227);
            doc.setLineWidth(0.2);
            doc.roundedRect(x + cardPadding - 1, headerY - 2.5, width - cardPadding * 2 + 2, headerHeight + 2.5, 2, 2);

            const ratioColumnStart = x + cardPadding;
            const centsColumnStart = ratioColumnStart + ratioColumnWidth;
            const countColumnStart = centsColumnStart + centsColumnWidth;

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(6.8);
            doc.setTextColor(colors.textMuted.r, colors.textMuted.g, colors.textMuted.b);
            doc.text('RATIO', ratioColumnStart + 2, headerY + 4.5);
            doc.text('CENTS', centsColumnStart + 2, headerY + 4.5);
            doc.text('COUNT', countColumnStart + 2, headerY + 4.5);

            let rowY = headerY + headerHeight;
            rowsForPage.forEach(ratio => {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.setTextColor(colors.textPrimary.r, colors.textPrimary.g, colors.textPrimary.b);
                doc.text(ratio.fraction || '', ratioColumnStart + 2, rowY + 6);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(colors.textPrimary.r, colors.textPrimary.g, colors.textPrimary.b);
                const centsValue = ratio.cents != null ? `${ratio.cents.toFixed(2)} ¢` : '0.00 ¢';
                doc.text(centsValue, centsColumnStart + 2, rowY + 6);

                const countValue = ratio.frequency != null ? String(ratio.frequency) : '0';
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.5);
                doc.text(countValue, countColumnStart + 2, rowY + 6);

                doc.setDrawColor(225, 229, 236);
                doc.setLineWidth(0.1);
                doc.line(x + cardPadding, rowY + rowHeight, x + width - cardPadding, rowY + rowHeight);

                rowY += rowHeight;
            });

            y += cardHeight + 18;
        }

        return y;
    }

    addMetricsToPDF(doc, rhythmInfo, x, y, pageHeight, maxContentHeight, contentWidth) {
        const colors = {
            cardBackground: { r: 246, g: 247, b: 251 },
            cardBorder: { r: 214, g: 219, b: 227 },
            textPrimary: { r: 39, g: 45, b: 56 },
            textMuted: { r: 111, g: 120, b: 135 }
        };

        const displayLayers = (rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0)
            ? rhythmInfo.displayLayers
            : rhythmInfo.layers;
        const displayGroupings = (rhythmInfo.displayGroupings && rhythmInfo.displayGroupings.length > 0)
            ? rhythmInfo.displayGroupings
            : displayLayers.map(layer => Math.round(rhythmInfo.grid / layer));

        const layersValue = displayLayers.length > 0 ? displayLayers.join(':') : '—';
        const groupingsValue = displayGroupings.length > 0 ? displayGroupings.join(', ') : '—';

        const metrics = [
            { label: 'Layers', value: layersValue },
            { label: 'Grid', value: String(rhythmInfo.grid) },
            { label: 'Groupings', value: groupingsValue },
            { label: 'Fundamental', value: String(Math.round(rhythmInfo.fundamental)) },
            { label: 'Average Deviation', value: rhythmInfo.avgDeviation != null ? rhythmInfo.avgDeviation.toFixed(3) : 'N/A' },
            { label: 'Range', value: rhythmInfo.range.toFixed(2) },
            { label: 'Density', value: `${rhythmInfo.density.toFixed(1)}%` },
            { label: 'P/G Ratio', value: rhythmInfo.pulseToGrouping.toFixed(2) },
            { label: 'Composite Nodes', value: String(rhythmInfo.compositeLength) }
        ];

        y = this.addSectionTitleBar(doc, 'Metrics', x, y, contentWidth);

        const cardPadding = 12;
        const columnCount = 3;
        const columnGap = 14;
        const columnWidth = (contentWidth - cardPadding * 2 - columnGap * (columnCount - 1)) / columnCount;

        const rows = Math.ceil(metrics.length / columnCount);
        const rowHeights = new Array(rows).fill(0);

        const preparedMetrics = metrics.map((metric, index) => {
            const lines = doc.splitTextToSize(String(metric.value), columnWidth);
            const blockHeight = 18 + Math.max(0, lines.length - 1) * 5;
            const rowIndex = Math.floor(index / columnCount);
            rowHeights[rowIndex] = Math.max(rowHeights[rowIndex], blockHeight);
            return { ...metric, lines, blockHeight };
        });

        const cardHeight = cardPadding * 2 + rowHeights.reduce((sum, h) => sum + h, 0);

        if (y + cardHeight > maxContentHeight) {
            doc.addPage();
            y = 20;
            y = this.addSectionTitleBar(doc, 'Metrics', x, y, contentWidth);
        }

        doc.setFillColor(colors.cardBackground.r, colors.cardBackground.g, colors.cardBackground.b);
        doc.roundedRect(x, y, contentWidth, cardHeight, 4, 4, 'F');
        doc.setDrawColor(colors.cardBorder.r, colors.cardBorder.g, colors.cardBorder.b);
        doc.setLineWidth(0.4);
        doc.roundedRect(x, y, contentWidth, cardHeight, 4, 4);

        let rowBaseline = y + cardPadding;
        for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
            for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
                const metricIndex = rowIndex * columnCount + columnIndex;
                if (metricIndex >= preparedMetrics.length) {
                    continue;
                }

                const metric = preparedMetrics[metricIndex];
                const cellX = x + cardPadding + columnIndex * (columnWidth + columnGap);
                const cellY = rowBaseline;

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7);
                doc.setTextColor(colors.textMuted.r, colors.textMuted.g, colors.textMuted.b);
                doc.text(metric.label.toUpperCase(), cellX, cellY + 3.5);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9.5);
                doc.setTextColor(colors.textPrimary.r, colors.textPrimary.g, colors.textPrimary.b);
                doc.text(metric.lines, cellX, cellY + 11);
            }
            rowBaseline += rowHeights[rowIndex];
        }

        return y + cardHeight + 18;
    }

    addNestedRatiosToPDF(doc, nestedRatios, x, y, pageHeight, maxContentHeight, contentWidth) {
        const colors = {
            cardBackground: { r: 246, g: 247, b: 251 },
            cardBorder: { r: 214, g: 219, b: 227 },
            textPrimary: { r: 39, g: 45, b: 56 },
            textMuted: { r: 111, g: 120, b: 135 },
            accent: { r: 0, g: 197, b: 168 }
        };

        y = this.addSectionTitleBar(doc, 'Nested Ratios', x, y, contentWidth);

        const cardPadding = 12;
        const lines = [];
        let currentRepetitions = null;

        nestedRatios.forEach(ratio => {
            if (ratio.repetitions !== currentRepetitions) {
                currentRepetitions = ratio.repetitions;
                lines.push({ type: 'header', text: `${currentRepetitions}x` });
            }
            const layerStr = ratio.layers.join(':');
            const originalStr = ratio.originalValues.join(':');
            const simplifiedStr = ratio.simplified.join(':');
            const text = `${layerStr}  ${originalStr} = ${simplifiedStr}`;
            lines.push({ type: 'entry', text });
        });

        const cardHeight = cardPadding * 2 + lines.reduce((total, line) => {
            return total + (line.type === 'header' ? 14 : 10);
        }, 0);

        if (y + cardHeight > maxContentHeight) {
            doc.addPage();
            y = 20;
            y = this.addSectionTitleBar(doc, 'Nested Ratios (continued)', x, y, contentWidth);
        }

        doc.setFillColor(colors.cardBackground.r, colors.cardBackground.g, colors.cardBackground.b);
        doc.roundedRect(x, y, contentWidth, cardHeight, 4, 4, 'F');
        doc.setDrawColor(colors.cardBorder.r, colors.cardBorder.g, colors.cardBorder.b);
        doc.setLineWidth(0.4);
        doc.roundedRect(x, y, contentWidth, cardHeight, 4, 4);

        let cursorY = y + cardPadding;
        lines.forEach(line => {
            if (line.type === 'header') {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.setTextColor(colors.accent.r, colors.accent.g, colors.accent.b);
                doc.text(line.text, x + cardPadding, cursorY + 5.5);
                cursorY += 14;
            } else {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8.5);
                doc.setTextColor(colors.textPrimary.r, colors.textPrimary.g, colors.textPrimary.b);
                doc.text(line.text, x + cardPadding + 4, cursorY + 4.5);
                doc.setDrawColor(colors.cardBorder.r, colors.cardBorder.g, colors.cardBorder.b);
                doc.setLineWidth(0.1);
                doc.line(x + cardPadding + 4, cursorY + 6.5, x + contentWidth - cardPadding - 4, cursorY + 6.5);
                cursorY += 10;
            }
        });

        return y + cardHeight + 18;
    }

    // ====================================
    // MIDI EXPORT
    // ====================================

    async exportMIDI(rootNote = 'A') {
        if (!this.midiLibraryLoaded) {
            console.error('📤 MIDI library not loaded');
            return;
        }

        if (!window.lrcModule) {
            console.error('📤 LRCModule not available');
            return;
        }

        const rhythmInfo = window.lrcModule.getRhythmInfoData();
        if (!rhythmInfo) {
            console.error('📤 Rhythm data not available for MIDI export');
            return;
        }

        // Use EXISTING spacesPlotByLayer from LRCModule - no recalculation!
        const spacesPlotByLayer = rhythmInfo.spacesPlotByLayer;
        if (!spacesPlotByLayer || !Array.isArray(spacesPlotByLayer)) {
            console.error('📤 Spaces plot by layer not available from LRCModule');
            return;
        }


        // Calculate actual scale length from the rhythm data
        const ratios = window.lrcModule.currentRatios;
        const uniqueTones = new Set(ratios.map(r => r.fraction));
        uniqueTones.delete("2/1"); // Exclude octave
        const scaleLength = uniqueTones.size;
        

        // Convert to MIDI notes (using reference logic)
        const midiNotesByLayer = this.convertSpacesPlotToMidiNotes(spacesPlotByLayer, scaleLength, rootNote);
        
        // Export each active layer as separate MIDI file
        const layerNames = ['A', 'B', 'C', 'D'];
        const ticksPerQuarterNote = 960; // High precision

        rhythmInfo.layers.forEach((layerValue, index) => {
            const layerMidi = midiNotesByLayer[index];
            
            // Export if layer value > 1 and has MIDI data (skip inactive layers)
            if (layerValue > 1 && layerMidi && layerMidi.length > 0) {
                // Use only active layers for filename
                const activeLayers = rhythmInfo.layers.filter(layer => layer > 1);
                this.exportLayerAsMidi(
                    layerMidi, 
                    layerNames[index], 
                    activeLayers.join(':'),
                    ticksPerQuarterNote
                );
            }
        });
    }

    // Note: We use existing spacesPlotByLayer from LRCModule instead of recalculating

    // CORRECTED - Ported from REFERENCE SCRIPT.js
    convertSpacesPlotToMidiNotes(spacesPlotByLayer, scaleLength, rootNote = 'A') {
        // Flatten the spacesPlotByLayer to get the entire spaces plot
        const entireSpacesPlot = spacesPlotByLayer.flat();

        // Sort the entire spaces plot in descending order
        const sortedSpacesPlot = entireSpacesPlot.sort((a, b) => b - a);

        const fundamental = Math.max(...sortedSpacesPlot);
        const halfFundamental = fundamental / 2;

        // Create the compressed list and map original values to their compressed counterparts
        const compressedList = [];
        const originalToCompressedMap = new Map();
        
        sortedSpacesPlot.forEach(value => {
            if (value === 0) {
                throw new Error('Zero value encountered in spaces plot, which can cause infinite loop');
            }
            let compressedValue = value;
            let octaveShift = 0;

            // CORRECTED LOGIC: Values SMALLER than half fundamental get octaviated UP
            while (compressedValue <= halfFundamental && compressedValue !== 0) {
                compressedValue *= 2;    // MULTIPLY by 2 (raises octave)
                octaveShift += 1;        // Higher octave
            }

            compressedList.push(compressedValue);
            originalToCompressedMap.set(value, { compressedValue, octaveShift });
        });

        // Remove duplicates and sort the compressed list in descending order
        const uniqueCompressedList = Array.from(new Set(compressedList)).sort((a, b) => b - a);

        // Assign MIDI notes to the unique compressed list 
        // Starting from 9 (A-1) for root A, or 0 (C-1) for root C
        const startingMidiNote = rootNote === 'C' ? 0 : 9;
        const compressedToMidiMap = new Map();
        uniqueCompressedList.forEach((value, index) => {
            compressedToMidiMap.set(value, startingMidiNote + index);
        });

        // Calculate maximum MIDI note to check 128 limit
        let maxMidiNote = 0;
        const allMidiNotes = [];

        // Map the original spaces plot values to their corresponding MIDI notes
        const midiNotesByLayer = spacesPlotByLayer.map((spacesPlot, layerIndex) => {
            const layerMidi = spacesPlot.map(value => {
                const { compressedValue, octaveShift } = originalToCompressedMap.get(value);
                const baseMidiNote = compressedToMidiMap.get(compressedValue);
                const finalMidiNote = baseMidiNote + (scaleLength * octaveShift);
                
                maxMidiNote = Math.max(maxMidiNote, finalMidiNote);
                allMidiNotes.push(finalMidiNote);
                
                return finalMidiNote;
            });
            return layerMidi;
        });

        // Check MIDI range limit (128 notes max)
        if (maxMidiNote > 127) {
            alert(`MIDI Export Error: This rhythm requires MIDI note ${maxMidiNote}, but MIDI only supports notes 0-127. Scale is too complex for MIDI export.`);
            throw new Error(`MIDI range exceeded: requires note ${maxMidiNote}, maximum is 127`);
        }
        return midiNotesByLayer;
    }

    // Ported from REFERENCE SCRIPT.js
    exportLayerAsMidi(midis, layerName, rhythmLayers, ticksPerQuarterNote) {

        // Create a new MIDI file
        const midi = new window.Midi();

        // Set the tempo
        const tempoBPM = 120;
        midi.header.setTempo(tempoBPM);

        // Create a track
        const track = midi.addTrack();
        track.name = `Layer ${layerName}`;

        // Add notes to track
        let time = 0;
        const noteDuration = 0.5; // Half second per note
        
        midis.forEach(midiNote => {
            track.addNote({
                midi: midiNote,
                time: time,
                duration: noteDuration
            });
            time += noteDuration;
        });

        // Download the MIDI file
        const filename = `Layer_${layerName}_${rhythmLayers}.mid`;
        const blob = new Blob([midi.toArray()], { type: 'audio/midi' });
        this.downloadBlob(blob, filename);
    }

    // ====================================
    // TUNING FILE EXPORT
    // ====================================

    async exportTuningFile(format) {
        if (!window.lrcModule) {
            console.error('📤 LRCModule not available');
            return;
        }

        const rhythmInfo = window.lrcModule.getRhythmInfoData();
        const ratios = window.lrcModule.currentRatios;
        
        if (!rhythmInfo || !ratios) {
            console.error('📤 Rhythm data not available for tuning file export');
            return;
        }

        if (format === 'scl') {
            this.exportScalaFile(rhythmInfo, ratios);
        } else if (format === 'tun') {
            this.exportAnaMardkTunFile(rhythmInfo, ratios);
        } else {
            console.error('📤 Unknown tuning file format:', format);
        }
    }

    exportScalaFile(rhythmInfo, ratios) {
        // Filter out layer values of 1 (inactive layers)
        const activeLayers = rhythmInfo.layers.filter(layer => layer > 1);
        const layers = activeLayers.join('-');
        const fundamental = Math.round(rhythmInfo.fundamental);
        const filename = `${layers} (${fundamental}).scl`;
        
        // Create description with specified format (use active layers only)
        const description = `${layers}`;
        
        // Skip 1/1 unison and filter out 2/1 (we'll add 2/1 at the end)
        const scaleRatios = ratios.filter(ratio => ratio.fraction !== '1/1' && ratio.fraction !== '2/1');
        
        let content = `! ${filename}\n`;
        content += `! Created by Large Rhythm Collider\n`;
        content += `!\n`;
        content += `${description}\n`;
        content += ` ${scaleRatios.length + 1}\n`; // +1 for the 2/1 we'll add at the end
        content += `!\n`;

        // Add each ratio - prefer fraction format over cents for exact representation
        scaleRatios.forEach(ratio => {
            if (ratio.fraction) {
                content += ` ${ratio.fraction}\n`;
            } else {
                // Fallback to cents if fraction not available
                const cents = ratio.cents ? ratio.cents.toFixed(2) : '0.0';
                content += ` ${cents}\n`;
            }
        });
        
        // Always end with 2/1 octave regardless of scale content
        content += ` 2/1\n`;

        const blob = new Blob([content], { type: 'text/plain' });
        this.downloadBlob(blob, filename);
        
        console.log(`📤 Scala file exported: ${filename}`);
    }

    exportAnaMardkTunFile(rhythmInfo, ratios) {
        // Filter out 2/1 octave ratio and layer values of 1 (inactive layers)
        const filteredRatios = ratios.filter(ratio => ratio.fraction !== '2/1');
        const activeLayers = rhythmInfo.layers.filter(layer => layer > 1);
        const layers = activeLayers.join('-');
        const fundamental = Math.round(rhythmInfo.fundamental);
        const filename = `${layers} (${fundamental}).tun`;
        
        // Use exact format structure as working files
        let content = `; VAZ Plus/AnaMark softsynth tuning file\n`;
        content += `; ${layers}\n`;
        content += `;\n`;
        content += `; Generated by Large Rhythm Collider\n`;
        content += `;\n`;
        content += `; VAZ Plus section\n`;
        content += `[Tuning]\n`;

        // Constants for A-anchored tuning using LRC scale period
        const FIRST_A_NOTE = 9; // MIDI note 9 is the first A
        const A_TARGET_CENTS = 900; // A should be at 900 cents
        
        // VAZ Plus section - Use LRC scale length for natural period, anchored to A=900
        
        for (let midiNote = 0; midiNote < 128; midiNote++) {
            let cents;
            
            if (filteredRatios.length > 0) {
                // Calculate position relative to first A note (MIDI 9)
                const notesFromFirstA = midiNote - FIRST_A_NOTE;
                
                // Map to scale using LRC scale length as period (not 12)
                let scaleOctave = Math.floor(notesFromFirstA / filteredRatios.length);
                let scaleDegree = notesFromFirstA % filteredRatios.length;
                
                // Handle negative modulo properly
                if (scaleDegree < 0) {
                    scaleDegree += filteredRatios.length;
                    scaleOctave--;
                }
                
                // Get scale interval in cents
                const ratio = filteredRatios[scaleDegree];
                const ratioCents = ratio.cents || 0;
                
                // Calculate cents: A target (900) + scale octaves + scale interval
                cents = A_TARGET_CENTS + (scaleOctave * 1200) + ratioCents;
            } else {
                // 12-TET fallback: A=900 + chromatic intervals
                const notesFromFirstA = midiNote - FIRST_A_NOTE;
                cents = 900 + (notesFromFirstA * 100);
            }
            
            content += `note ${midiNote}=${Math.round(cents)}\n`;
        }
        
        // Add AnaMark section to match working file structure exactly
        content += `\n; AnaMark section\n`;
        content += `[Scale Begin]\n`;
        content += `Format= "AnaMark-TUN"\n`;
        content += `FormatVersion= 100\n`;
        content += `FormatSpecs= "http://www.mark-henning.de/eternity/tuningspecs.html"\n`;
        content += `\n[Info]\n`;
        content += `Name= "${filename}"\n`;
        content += `ID= "${filename}"\n`;
        content += `Filename= "${filename}"\n`;
        content += `Description= "${layers}"\n`;
        content += `Date= "${new Date().toISOString().split('T')[0]}"\n`;
        content += `Editor= "Large Rhythm Collider"\n`;
        content += `\n[Exact Tuning]\n`;

        // Exact tuning section - Must match VAZ Plus logic exactly
        for (let midiNote = 0; midiNote < 128; midiNote++) {
            let cents;
            
            if (filteredRatios.length > 0) {
                // Use identical logic to VAZ Plus section
                const notesFromFirstA = midiNote - FIRST_A_NOTE;
                
                // Map to scale using LRC scale length as period (not 12)
                let scaleOctave = Math.floor(notesFromFirstA / filteredRatios.length);
                let scaleDegree = notesFromFirstA % filteredRatios.length;
                
                // Handle negative modulo properly
                if (scaleDegree < 0) {
                    scaleDegree += filteredRatios.length;
                    scaleOctave--;
                }
                
                // Get scale interval in cents
                const ratio = filteredRatios[scaleDegree];
                const ratioCents = ratio.cents || 0;
                
                // Calculate cents: A target (900) + scale octaves + scale interval
                cents = A_TARGET_CENTS + (scaleOctave * 1200) + ratioCents;
            } else {
                // 12-TET fallback: A=900 + chromatic intervals
                const notesFromFirstA = midiNote - FIRST_A_NOTE;
                cents = 900 + (notesFromFirstA * 100);
            }
            
            content += `note ${midiNote}= ${cents.toFixed(6)}\n`;
        }
        
        content += `\n[Scale End]\n`;

        const blob = new Blob([content], { type: 'text/plain' });
        this.downloadBlob(blob, filename);
        
        console.log(`📤 AnaMark TUN file exported: ${filename}`);
    }

    // ====================================
    // UTILITY METHODS
    // ====================================

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ====================================
    // PUBLIC API
    // ====================================

    async export(type, format = null, rootNote = 'A') {
        switch (type) {
            case 'pdf':
                await this.exportPDF();
                break;
            case 'midi':
                await this.exportMIDI(rootNote);
                break;
            case 'tuning':
                if (!format) {
                    console.error('📤 Tuning file format required (scl or tun)');
                    return;
                }
                await this.exportTuningFile(format);
                break;
            default:
                console.error('📤 Unknown export type:', type);
        }
    }
}

// Initialize LRCExport when DOM is loaded
let lrcExport;

document.addEventListener('DOMContentLoaded', () => {
    lrcExport = new LRCExport();
    window.lrcExport = lrcExport; // Make globally accessible
    console.log('📤 LRCExport module loaded and ready');
});
