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
        
        // Set up document
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20;
        const contentWidth = pageWidth - 2 * margin;
        const maxContentHeight = pageHeight - 2 * margin;
        let yPos = margin;

        // Title with light silver background - center aligned with equal margins
        const title = `Rhythm Info - ${rhythmInfo.layers.join(':')}`;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(18);
        const titleTextWidth = doc.getTextWidth(title);
        const titleMargin = 15; // Equal margins on both sides
        const titleBarWidth = titleTextWidth + (titleMargin * 2);
        const titleHeight = 12;
        const titleBarX = (pageWidth - titleBarWidth) / 2; // Center the title bar
        
        // Light silver background for title - centered
        doc.setFillColor(220, 220, 220);
        doc.rect(titleBarX, yPos - 8, titleBarWidth, titleHeight, 'F');
        
        // Title text - centered within the bar
        doc.setTextColor(0, 0, 0);
        doc.text(title, titleBarX + titleMargin, yPos);
        yPos += 18;

        // Capture existing linear plot image - full width, reduce file size
        const linearPlotImage = this.captureExistingLinearPlot(true); // Add compression flag
        const plotWidth = contentWidth;
        const plotHeight = 60;
        
        // Check if we need a new page
        if (yPos + plotHeight > maxContentHeight) {
            doc.addPage();
            yPos = margin;
        }
        
        // Add linear plot image - full width
        doc.addImage(linearPlotImage, 'JPEG', margin, yPos, plotWidth, plotHeight);
        yPos += plotHeight + 15;

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
        const filename = `Rhythm Info - ${rhythmInfo.layers.join(':')}.pdf`;
        doc.save(filename);
    }

    captureExistingLinearPlot(compress = false) {
        // Try to capture the existing visualization canvas
        const canvas = document.getElementById('visualization-canvas');
        if (canvas && canvas.getContext) {
            try {
                // Create a smaller canvas to reduce file size
                const exportCanvas = document.createElement('canvas');
                const exportCtx = exportCanvas.getContext('2d');
                
                // Use smaller dimensions to reduce file size
                const targetWidth = compress ? 400 : (canvas.width || 800);
                const targetHeight = compress ? 120 : (canvas.height || 200);
                
                exportCanvas.width = targetWidth;
                exportCanvas.height = targetHeight;
                
                // Fill with white background
                exportCtx.fillStyle = '#FFFFFF';
                exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
                
                // Draw the existing canvas content scaled down
                exportCtx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
                
                // Use JPEG with higher quality - balance between file size and quality
                return compress ? 
                    exportCanvas.toDataURL('image/jpeg', 0.92) : 
                    exportCanvas.toDataURL('image/png');
            } catch (error) {
                console.warn('📤 Could not capture existing canvas, creating fallback:', error);
                return this.createFallbackLinearPlot();
            }
        } else {
            console.warn('📤 Visualization canvas not found, creating fallback');
            return this.createFallbackLinearPlot();
        }
    }

    createFallbackLinearPlot() {
        // Simple fallback that doesn't interfere with main system
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = 400;
        canvas.height = 100;
        
        // White background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Simple placeholder text
        ctx.fillStyle = '#000000';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Linear Plot (Visualization not available)', canvas.width / 2, canvas.height / 2);
        
        return canvas.toDataURL('image/png');
    }

    addSectionTitleBar(doc, title, x, y, width) {
        // Light silver background
        doc.setFillColor(220, 220, 220);
        doc.rect(x, y - 8, width, 12, 'F');
        
        // Title text
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text(title, x + 10, y);
        
        return y + 15;
    }

    addCompactScaleTable(doc, ratios, rhythmInfo, x, y, width, pageHeight, maxContentHeight) {
        // Check if we need a new page
        if (y + 40 > maxContentHeight) {
            doc.addPage();
            y = 20;
        }

        // Scale title bar
        y = this.addSectionTitleBar(doc, 'Scale', x, y, width);

        // Calculate optimal cell width based on content - much more compact
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9); // Smaller font for spreadsheet style
        
        let maxRatioWidth = 0;
        let maxCentsWidth = 0;
        
        ratios.forEach(ratio => {
            const ratioWidth = doc.getTextWidth(ratio.fraction);
            const cents = ratio.cents ? ratio.cents.toFixed(1) : '0.0';
            const centsWidth = doc.getTextWidth(cents);
            
            maxRatioWidth = Math.max(maxRatioWidth, ratioWidth);
            maxCentsWidth = Math.max(maxCentsWidth, centsWidth);
        });
        
        // Minimal padding for compact spreadsheet style
        const cellWidth = Math.max(maxRatioWidth, maxCentsWidth) + 4;
        const ratiosPerRow = Math.floor(width / cellWidth);
        const numRows = Math.ceil(ratios.length / ratiosPerRow);
        const cellHeight = 8; // Very compact row height
        
        // Create compact table structure
        for (let row = 0; row < numRows; row++) {
            const startIndex = row * ratiosPerRow;
            const endIndex = Math.min(startIndex + ratiosPerRow, ratios.length);
            const currentRatios = ratios.slice(startIndex, endIndex);
            
            // Check if we need a new page for this row set
            if (y + (cellHeight * 2) > maxContentHeight) {
                doc.addPage();
                y = 20;
                y = this.addSectionTitleBar(doc, 'Scale (continued)', x, y, width);
            }
            
            // Draw ratios row with minimal styling
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(0, 0, 0);
            
            currentRatios.forEach((ratio, index) => {
                const cellX = x + (index * cellWidth);
                
                // Minimal border
                doc.setLineWidth(0.1);
                doc.setDrawColor(180, 180, 180);
                doc.rect(cellX, y, cellWidth, cellHeight);
                
                // Ratio text - compact positioning
                doc.text(ratio.fraction, cellX + 2, y + 6);
            });
            
            y += cellHeight;
            
            // Draw cents row
            currentRatios.forEach((ratio, index) => {
                const cellX = x + (index * cellWidth);
                const cents = ratio.cents ? ratio.cents.toFixed(1) : '0.0';
                
                // Minimal border
                doc.setLineWidth(0.1);
                doc.setDrawColor(180, 180, 180);
                doc.rect(cellX, y, cellWidth, cellHeight);
                
                // Cents text - compact positioning
                doc.text(cents, cellX + 2, y + 6);
            });
            
            y += cellHeight + 3; // Minimal space between row sets
        }

        return y + 5;
    }

    addMetricsToPDF(doc, rhythmInfo, x, y, pageHeight, maxContentHeight, contentWidth) {
        // Check if we need a new page
        if (y + 80 > maxContentHeight) {
            doc.addPage();
            y = 20;
        }

        // Metrics title bar
        y = this.addSectionTitleBar(doc, 'Metrics', x, y, contentWidth);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        
        // Simple, safe metrics - exactly like before, no complex logic that could interfere
        const groupings = rhythmInfo.layers.map(layer => Math.round(rhythmInfo.grid / layer));
        
        // Metrics data - simple fixed layout
        const metrics = [
            [`Layers: ${rhythmInfo.layers.join(':')}`, `Grid: ${rhythmInfo.grid}`, `Groupings: ${groupings.join(', ')}`],
            [`Fundamental: ${Math.round(rhythmInfo.fundamental)}`, `Avg Dev: ${rhythmInfo.avgDeviation?.toFixed(3) || 'N/A'}`, `Range: ${rhythmInfo.range.toFixed(2)}`],
            [`Density: ${rhythmInfo.density.toFixed(1)}%`, `Composite Length: ${rhythmInfo.compositeLength}`, `Layer Sum: ${rhythmInfo.layerSum}`]
        ];

        // Simple display without complex logic
        metrics.forEach(row => {
            row.forEach((metric, index) => {
                doc.text(metric, x + index * 65, y);
            });
            y += 12;
        });

        return y + 10;
    }

    addNestedRatiosToPDF(doc, nestedRatios, x, y, pageHeight, maxContentHeight, contentWidth) {
        // Nested Ratios title bar
        y = this.addSectionTitleBar(doc, 'Nested Ratios', x, y, contentWidth);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        
        let currentRepetitions = -1;
        nestedRatios.forEach(ratio => {
            // Check if we need a new page
            if (y + 25 > maxContentHeight) {
                doc.addPage();
                y = 20;
                y = this.addSectionTitleBar(doc, 'Nested Ratios (continued)', x, y, contentWidth);
            }

            if (ratio.repetitions !== currentRepetitions) {
                currentRepetitions = ratio.repetitions;
                doc.setFontSize(12);
                doc.text(`${currentRepetitions}x`, x, y);
                y += 10;
                doc.setFontSize(10);
            }

            const layerStr = ratio.layers.join(':');
            const originalStr = ratio.originalValues.join(':');
            const simplifiedStr = ratio.simplified.join(':');
            
            // Use equals sign for all nested ratios (consistent with EIV)
            const text = `${layerStr} ${originalStr} = ${simplifiedStr}`;
            
            doc.text(text, x + 10, y);
            y += 8;
        });

        return y + 10;
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