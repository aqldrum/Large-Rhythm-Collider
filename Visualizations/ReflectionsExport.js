// ReflectionsExport.js - Export functionality for Reflections visualization
// Handles PNG and MOV export with high-resolution rendering

class ReflectionsExporter {
    constructor(reflectionsInstance) {
        this.reflections = reflectionsInstance;
        this.isExporting = false;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        
        console.log('🎬 ReflectionsExporter initialized');
    }

    // ====================================
    // MODAL MANAGEMENT
    // ====================================

    showExportModal() {
        const doc = this.reflections.popupWindow.document;
        const modal = doc.getElementById('export-modal');
        if (modal) {
            modal.classList.add('show');
        }
    }

    hideExportModal() {
        const doc = this.reflections.popupWindow.document;
        const modal = doc.getElementById('export-modal');
        if (modal) {
            modal.classList.remove('show');
        }
        this.hideProgress();
    }

    showProgress() {
        const doc = this.reflections.popupWindow.document;
        const progress = doc.getElementById('export-progress');
        const buttons = doc.querySelector('.export-buttons');
        if (progress && buttons) {
            progress.style.display = 'block';
            buttons.style.display = 'none';
        }
    }

    hideProgress() {
        const doc = this.reflections.popupWindow.document;
        const progress = doc.getElementById('export-progress');
        const buttons = doc.querySelector('.export-buttons');
        if (progress && buttons) {
            progress.style.display = 'none';
            buttons.style.display = 'flex';
        }
    }

    updateProgress(percent, text) {
        const doc = this.reflections.popupWindow.document;
        const progressBar = doc.getElementById('export-progress-bar');
        const progressText = doc.getElementById('export-progress-text');
        
        if (progressBar) {
            progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        }
        if (progressText && text) {
            progressText.textContent = text;
        }
    }

    setupExportControls() {
        const doc = this.reflections.popupWindow.document;

        // Export button
        const exportButton = doc.getElementById('export-button');
        if (exportButton) {
            exportButton.addEventListener('click', () => {
                this.showExportModal();
            });
        }

        // Format selection
        const formatOptions = doc.querySelectorAll('.format-option');
        formatOptions.forEach(option => {
            option.addEventListener('click', () => {
                // Remove selected class from all options
                formatOptions.forEach(opt => opt.classList.remove('selected'));
                // Add selected class to clicked option
                option.classList.add('selected');
                
                const format = option.dataset.format;
                const mp4Settings = doc.getElementById('mp4-settings');
                
                // Show/hide MP4 settings based on format
                if (format === 'mp4') {
                    mp4Settings.classList.add('show');
                } else {
                    mp4Settings.classList.remove('show');
                }
            });
        });

        // Export modal controls
        const exportModal = doc.getElementById('export-modal');
        const exportCancel = doc.getElementById('export-cancel');
        const exportConfirm = doc.getElementById('export-confirm');

        if (exportCancel) {
            exportCancel.addEventListener('click', () => {
                this.hideExportModal();
            });
        }

        if (exportConfirm) {
            exportConfirm.addEventListener('click', () => {
                this.executeExport();
            });
        }

        // Don't close modal when clicking outside - only on Cancel/Export buttons

        // Animation control event listeners
        this.setupAnimationExportControls();
    }

    setupAnimationExportControls() {
        const doc = this.reflections.popupWindow.document;

        // Export rotation toggle
        const exportRotationToggle = doc.getElementById('export-rotation-toggle');
        if (exportRotationToggle) {
            exportRotationToggle.addEventListener('click', () => {
                const isActive = exportRotationToggle.classList.contains('active');
                exportRotationToggle.classList.toggle('active', !isActive);
                exportRotationToggle.textContent = isActive ? 'Enable Rotation' : 'Disable Rotation';
            });
        }

        // Export translation toggle
        const exportTranslationToggle = doc.getElementById('export-translation-toggle');
        if (exportTranslationToggle) {
            exportTranslationToggle.addEventListener('click', () => {
                const isActive = exportTranslationToggle.classList.contains('active');
                exportTranslationToggle.classList.toggle('active', !isActive);
                exportTranslationToggle.textContent = isActive ? 'Enable Translation' : 'Disable Translation';
            });
        }
    }

    // ====================================
    // EXPORT EXECUTION
    // ====================================

    async executeExport() {
        if (this.isExporting) {
            console.log('🎬 Export already in progress');
            return;
        }

        const doc = this.reflections.popupWindow.document;
        
        // Get export settings
        const selectedFormat = doc.querySelector('.format-option.selected');
        const format = selectedFormat ? selectedFormat.dataset.format : 'png';
        const title = doc.getElementById('export-title').value.trim() || 'reflections';
        const dimensions = parseInt(doc.getElementById('export-dimensions').value) || 1024;
        const fps = parseInt(doc.getElementById('export-fps').value) || 30;

        console.log(`🎬 Starting ${format.toUpperCase()} export:`, { title, dimensions, fps });

        try {
            this.isExporting = true;
            
            // Validate export settings before starting
            this.validateExportSettings(format, dimensions, fps);
            
            // Show progress for MP4 exports
            if (format === 'mp4') {
                this.showProgress();
                this.updateProgress(0, 'Preparing export...');
            }
            
            switch (format) {
                case 'png':
                    await this.exportPNG(title, dimensions);
                    break;
                case 'mp4':
                    await this.exportMP4(title, dimensions, fps);
                    break;
            }
        } catch (error) {
            console.error('Export failed:', error);
            this.showPopupAlert('Export failed: ' + error.message);
        } finally {
            this.isExporting = false;
        }

        this.hideExportModal();
    }

    validateExportSettings(format, dimensions, fps) {
        // Basic parameter validation
        if (dimensions < 256 || dimensions > 4096) {
            throw new Error('Export dimensions must be between 256 and 4096 pixels');
        }
        
        if (format === 'mp4' && (fps < 10 || fps > 60)) {
            throw new Error('Frame rate must be between 10 and 60 FPS');
        }
        
        // Check if we have valid data to export
        if (!this.reflections.normalizedDots || this.reflections.normalizedDots.length === 0) {
            throw new Error('No visualization data available. Generate a rhythm first.');
        }
        
        // Memory estimation for high-resolution exports
        const pixelCount = dimensions * dimensions;
        const estimatedMemoryMB = (pixelCount * 4) / (1024 * 1024); // 4 bytes per pixel
        
        if (estimatedMemoryMB > 100) { // More than 100MB per frame
            const message = `High-resolution export will use approximately ${Math.round(estimatedMemoryMB)}MB per frame.\n` +
                          `This may cause memory issues. Continue?`;
            if (!this.showPopupConfirm(message)) {
                throw new Error('Export cancelled due to high memory requirements');
            }
        }
        
        console.log(`🎬 Export settings validated - ${Math.round(estimatedMemoryMB)}MB per frame`);
    }

    // ====================================
    // PNG EXPORT
    // ====================================

    async exportPNG(title, dimensions) {
        console.log('🎬 PNG export starting...');

        // Create a temporary high-resolution canvas
        const tempCanvas = this.reflections.popupWindow.document.createElement('canvas');
        tempCanvas.width = dimensions;
        tempCanvas.height = dimensions;
        const tempCtx = tempCanvas.getContext('2d');

        // Store original canvas properties
        const originalCanvas = this.reflections.canvas;
        const originalCtx = this.reflections.ctx;
        const originalSize = this.reflections.canvasSize;

        // Temporarily switch to high-res canvas
        this.reflections.canvas = tempCanvas;
        this.reflections.ctx = tempCtx;
        this.reflections.canvasSize = dimensions;

        // Render current visualization at high resolution
        this.reflections.updateVisualization();

        // Restore original canvas properties
        this.reflections.canvas = originalCanvas;
        this.reflections.ctx = originalCtx;
        this.reflections.canvasSize = originalSize;

        // Download the PNG
        tempCanvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = this.reflections.popupWindow.document.createElement('a');
            a.href = url;
            a.download = `${title}-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            console.log('🎬 PNG export completed');
        }, 'image/png');
    }

    // ====================================
    // VIDEO EXPORT - PATH C APPROACH
    // ====================================

    async exportMP4(title, dimensions, fps) {
        console.log('🎬 Video export starting with Path C approach...');

        const doc = this.reflections.popupWindow.document;

        // Get animation settings from export modal
        const exportCycleTime = parseFloat(doc.getElementById('export-cycle-time').value) || 10.0;
        const exportRotationEnabled = doc.getElementById('export-rotation-toggle').classList.contains('active');
        const exportTranslationEnabled = doc.getElementById('export-translation-toggle').classList.contains('active');
        const exportTranslationDirection = doc.getElementById('export-translation-direction').value || 'up';

        console.log('🎬 Video export settings:', {
            cycleTime: exportCycleTime,
            rotation: exportRotationEnabled,
            translation: exportTranslationEnabled,
            direction: exportTranslationDirection
        });

        // Calculate smart frame optimization for rotation-only exports
        const frameOptimization = this.calculateSmartFrameOptimization(
            exportRotationEnabled, exportTranslationEnabled, exportCycleTime, fps
        );
        
        console.log('🎬 Smart frame optimization:', frameOptimization);

        this.updateProgress(5, 'Setting up high-resolution canvas...');

        // Create a temporary high-resolution canvas for frame rendering
        const tempCanvas = this.reflections.popupWindow.document.createElement('canvas');
        tempCanvas.width = dimensions;
        tempCanvas.height = dimensions;
        const tempCtx = tempCanvas.getContext('2d');

        // Store original settings
        const originalCanvas = this.reflections.canvas;
        const originalCtx = this.reflections.ctx;
        const originalSize = this.reflections.canvasSize;
        const originalMasterTime = this.reflections.masterTime;
        const originalRotationEnabled = this.reflections.rotationEnabled;
        const originalTranslationEnabled = this.reflections.translationEnabled;
        const originalTranslationDirection = this.reflections.translationDirection;

        try {
            // Apply export settings temporarily
            this.reflections.canvas = tempCanvas;
            this.reflections.ctx = tempCtx;
            this.reflections.canvasSize = dimensions;
            this.reflections.masterTime = frameOptimization.actualCycleTime;
            this.reflections.rotationEnabled = exportRotationEnabled;
            this.reflections.translationEnabled = exportTranslationEnabled;
            this.reflections.translationDirection = exportTranslationDirection;

            this.updateProgress(10, `Preparing to render ${frameOptimization.displayText}...`);

            // Pre-render all frames to image buffers
            const frameBuffers = await this.renderFramesToBuffers(
                frameOptimization.actualCycleTime, 
                fps, 
                frameOptimization.actualFrames,
                frameOptimization
            );

            this.updateProgress(70, 'Frames rendered. Processing duplication...');

            // Apply smart duplication for rotation-only exports
            const finalFrameBuffers = this.applySmartFrameDuplication(frameBuffers, frameOptimization);

            this.updateProgress(80, 'Encoding video...');

            // Encode frames to video using best available method
            await this.encodeFramesToVideo(finalFrameBuffers, fps, title, dimensions);

            this.updateProgress(100, 'Export complete!');

        } finally {
            // Restore original settings
            this.reflections.canvas = originalCanvas;
            this.reflections.ctx = originalCtx;
            this.reflections.canvasSize = originalSize;
            this.reflections.masterTime = originalMasterTime;
            this.reflections.rotationEnabled = originalRotationEnabled;
            this.reflections.translationEnabled = originalTranslationEnabled;
            this.reflections.translationDirection = originalTranslationDirection;
        }
    }

    // ====================================
    // SMART FRAME OPTIMIZATION SYSTEM
    // ====================================

    calculateSmartFrameOptimization(rotationEnabled, translationEnabled, cycleTime, fps) {
        const totalFrames = Math.ceil(cycleTime * fps);
        const tessellationLevel = this.reflections.tessellationLevel;
        const reflectionLevel = this.reflections.reflectionLevel;
        
        // Determine optimization based on animation type and tessellation
        let duplicationFactor = 1;
        let cycleFraction = 1;
        let canOptimize = false;
        let optimizationType = 'none';
        
        if (rotationEnabled && translationEnabled) {
            // Rotation + Translation: No optimization possible
            canOptimize = false;
            optimizationType = 'rotation+translation-no-optimization';
        } else if (rotationEnabled && !translationEnabled) {
            // Rotation only
            if (tessellationLevel === 1) {
                // No tessellation: Use reflection level optimization (ALREADY WORKING)
                canOptimize = true;
                optimizationType = 'rotation-reflection-based';
                switch (reflectionLevel) {
                    case 1:
                        duplicationFactor = 1; // 360° rotation needed
                        cycleFraction = 1;
                        break;
                    case 2:
                        duplicationFactor = 2; // 180° rotation, duplicate 2x
                        cycleFraction = 0.5;
                        break;
                    case 3:
                        duplicationFactor = 4; // 90° rotation, duplicate 4x
                        cycleFraction = 0.25;
                        break;
                    case 4:
                        duplicationFactor = 4; // 90 rotation, duplicate 4x (safeguard against inconsistencies with border plot duplication)
                        cycleFraction = 0.25;
                        break;
                }
            } else {
                // Tessellation 2x2, 3x3, or 4x4: Always 1/4 cycle (90 degrees)
                canOptimize = true;
                optimizationType = 'rotation-tessellation-based';
                duplicationFactor = 4; // Always 90° rotation, duplicate 4x
                cycleFraction = 0.25; // Always 1/4 cycle
            }
        } else if (!rotationEnabled && translationEnabled) {
            // Translation only
            if (tessellationLevel === 1) {
                // No tessellation: No optimization possible
                canOptimize = false;
                optimizationType = 'translation-no-tessellation-no-optimization';
            } else {
                // Tessellation: Optimization based on tessellation level
                canOptimize = true;
                optimizationType = 'translation-tessellation-based';
                switch (tessellationLevel) {
                    case 2:
                        duplicationFactor = 2; // 1/2 cycle
                        cycleFraction = 0.5;
                        break;
                    case 3:
                        duplicationFactor = 3; // 1/3 cycle
                        cycleFraction = 1/3;
                        break;
                    case 4:
                        duplicationFactor = 4; // 1/4 cycle
                        cycleFraction = 0.25;
                        break;
                }
            }
        } else {
            // No animation enabled
            canOptimize = false;
            optimizationType = 'no-animation';
        }
        
        const actualCycleTime = canOptimize ? cycleTime * cycleFraction : cycleTime;
        
        // Calculate frames to ensure exact duplication without overage
        let actualFrames;
        if (canOptimize) {
            // For optimized exports, calculate frames so that duplication results in exact total
            actualFrames = Math.floor(totalFrames / duplicationFactor);
        } else {
            actualFrames = totalFrames;
        }
        
        // Generate detailed display text
        let displayText;
        if (canOptimize) {
            const finalFrameCount = actualFrames * duplicationFactor;
            const actualCycleTimeUsed = actualFrames / fps;
            displayText = `${actualFrames} frames (${actualCycleTimeUsed.toFixed(2)}s cycle, duplicating ${duplicationFactor}x to ${finalFrameCount} total frames) - ${optimizationType}`;
        } else {
            displayText = `${totalFrames} frames (${cycleTime}s full cycle) - ${optimizationType}`;
        }
        
        return {
            canOptimize,
            actualCycleTime,
            actualFrames,
            duplicationFactor,
            cycleFraction,
            optimizationType,
            tessellationLevel,
            reflectionLevel,
            rotationEnabled,
            translationEnabled,
            displayText
        };
    }

    async renderFramesToBuffers(cycleTime, fps, frameCount, frameOptimization = null) {
        console.log(`🎬 Rendering ${frameCount} frames to buffers...`);
        
        const frameBuffers = [];
        const startTime = Date.now();
        
        // Memory management with chunked processing
        const maxChunkSize = 50; // Process frames in chunks of 50
        const maxMemoryPerChunk = 500; // 500MB per chunk limit
        let currentChunkMemory = 0;
        
        // Performance tracking
        let lastGCTime = startTime;
        let frameErrors = 0;
        const maxFrameErrors = Math.max(3, Math.floor(frameCount * 0.02)); // Allow 2% frame errors
        
        // Simplified timing for stability
        const yieldInterval = 10;
        const gcInterval = 3000; // More frequent GC
        
        for (let frame = 0; frame < frameCount; frame++) {
            const progress = frame / frameCount; // 0 to 1
            
            // Update progress (10% to 70% of total export progress)
            const renderProgress = 10 + (progress * 60);
            const eta = this.calculateETA(startTime, frame, frameCount);
            
            this.updateProgress(renderProgress, `Rendering frame ${frame + 1}/${frameCount} (${eta})`);
            
            try {
                // Update reflection snapshot for current state
                this.reflections.updateAnimationSnapshot();
                
                // Render frame based on animation type
                if (this.reflections.rotationEnabled || this.reflections.translationEnabled) {
                    // Apply frame optimization to limit rotation angle if needed
                    let adjustedProgress = progress;
                    if (frameOptimization && frameOptimization.canOptimize && this.reflections.rotationEnabled && !this.reflections.translationEnabled) {
                        // For rotation-only optimization, limit the progress to the cycleFraction
                        const cycleFraction = 1 / frameOptimization.duplicationFactor;
                        adjustedProgress = progress * cycleFraction;
                    }
                    this.reflections.drawAnimatedFrame(adjustedProgress);
                } else {
                    this.reflections.updateVisualization();
                }
                
                // Capture frame as ImageData buffer
                const imageData = this.reflections.ctx.getImageData(
                    0, 0, this.reflections.canvasSize, this.reflections.canvasSize
                );
                
                // Store frame buffer
                frameBuffers.push({
                    data: imageData,
                    frameNumber: frame,
                    timestamp: frame / fps
                });
                
                // Memory management - track current chunk memory
                const frameSizeMB = (imageData.data.length) / (1024 * 1024); // Remove *4, data.length already includes RGBA
                currentChunkMemory += frameSizeMB;
                
                // Check if we need to force garbage collection due to memory pressure
                if (currentChunkMemory > maxMemoryPerChunk || frameBuffers.length % maxChunkSize === 0) {
                    await this.performMemoryCleanup();
                    currentChunkMemory = 0; // Reset chunk memory counter
                    console.log(`🎬 Memory cleanup at frame ${frame}, chunk processed`);
                }
                
                // Periodic garbage collection for complex renders
                if (Date.now() - lastGCTime > gcInterval) {
                    await this.performMemoryCleanup();
                    lastGCTime = Date.now();
                }
                
                // Yield to browser every N frames to prevent freezing
                if (frame % yieldInterval === 0) {
                    await this.yieldToUI();
                }
                
                // Adaptive memory-based delay
                await this.adaptiveMemoryDelay(frame);
                
            } catch (error) {
                frameErrors++;
                console.error(`🎬 Error rendering frame ${frame}:`, error);
                
                if (frameErrors > maxFrameErrors) {
                    throw new Error(`Too many frame rendering errors (${frameErrors}/${maxFrameErrors}). Export aborted.`);
                }
                
                // Create a black frame as fallback
                const fallbackImageData = this.reflections.ctx.createImageData(
                    this.reflections.canvasSize, this.reflections.canvasSize
                );
                frameBuffers.push({
                    data: fallbackImageData,
                    frameNumber: frame,
                    timestamp: frame / fps,
                    isErrorFrame: true
                });
            }
        }
        
        console.log(`🎬 Frame rendering completed in ${Date.now() - startTime}ms, ${frameBuffers.length} frames, ${frameErrors} errors`);
        
        // Final cleanup before returning
        await this.performMemoryCleanup();
        return frameBuffers;
    }

    applySmartFrameDuplication(originalFrames, optimization) {
        if (!optimization.canOptimize || optimization.duplicationFactor === 1) {
            return originalFrames;
        }
        
        console.log(`🎬 Applying smart duplication (${optimization.duplicationFactor}x)`);
        
        const duplicatedFrames = [];
        
        // Duplicate the frame sequence the required number of times
        // Key fix: maintain correct frame numbering for proper timing
        for (let cycle = 0; cycle < optimization.duplicationFactor; cycle++) {
            originalFrames.forEach((frameBuffer, index) => {
                duplicatedFrames.push({
                    ...frameBuffer,
                    frameNumber: (cycle * originalFrames.length) + index,
                    // Fix: Use correct timestamp calculation based on actual export FPS
                    timestamp: ((cycle * originalFrames.length) + index) * (1/30), // Will be corrected in playback
                    duplicatedFromFrame: frameBuffer.frameNumber,
                    duplicateCycle: cycle
                });
            });
        }
        
        console.log(`🎬 Frame duplication complete: ${originalFrames.length} → ${duplicatedFrames.length} frames`);
        console.log(`🎬 Duplication creates ${optimization.duplicationFactor} cycles of ${originalFrames.length} frames each`);
        return duplicatedFrames;
    }

    async encodeFramesToVideo(frameBuffers, fps, title, dimensions) {
        console.log(`🎬 Encoding ${frameBuffers.length} frames to video...`);
        
        // Try VideoEncoder API first (newer, better), fallback to MediaRecorder
        if (this.supportsVideoEncoder()) {
            return await this.encodeWithVideoEncoder(frameBuffers, fps, title, dimensions);
        } else {
            return await this.encodeWithMediaRecorder(frameBuffers, fps, title, dimensions);
        }
    }

    supportsVideoEncoder() {
        return typeof VideoEncoder !== 'undefined' && VideoEncoder.isConfigSupported;
    }

    async encodeWithVideoEncoder(frameBuffers, fps, title, dimensions) {
        console.log('🎬 Using VideoEncoder API for encoding...');
        
        // VideoEncoder implementation would go here
        // For now, fallback to MediaRecorder as VideoEncoder has limited browser support
        return await this.encodeWithMediaRecorder(frameBuffers, fps, title, dimensions);
    }

    async encodeWithMediaRecorder(frameBuffers, fps, title, dimensions) {
        console.log('🎬 Using MediaRecorder fallback for encoding...');
        
        // Create a new canvas for playback
        const playbackCanvas = this.reflections.popupWindow.document.createElement('canvas');
        playbackCanvas.width = dimensions;
        playbackCanvas.height = dimensions;
        const playbackCtx = playbackCanvas.getContext('2d');
        
        // Set up MediaRecorder with better codec selection
        // Use standard frame rates for better compatibility (24, 25, 30, 60)
        const standardFrameRates = [24, 25, 30, 60];
        const compatibleFps = standardFrameRates.reduce((prev, curr) => 
            Math.abs(curr - fps) < Math.abs(prev - fps) ? curr : prev
        );
        
        const stream = playbackCanvas.captureStream(compatibleFps);
        this.recordedChunks = [];
        
        if (compatibleFps !== fps) {
            console.log(`🎬 Adjusted frame rate from ${fps} to ${compatibleFps} for better compatibility`);
        }
        
        // Enhanced codec selection for QuickTime compatibility
        const codecInfo = this.selectBestMimeType();
        const mimeType = codecInfo.mimeType;
        
        // Configure MediaRecorder with QuickTime-compatible settings
        const mediaRecorderOptions = {
            mimeType,
            videoBitsPerSecond: Math.min(8000000, dimensions * dimensions * 2) // Higher bitrate for quality
        };
        
        // Add additional configuration for MP4 compatibility
        if (codecInfo.isRealMp4) {
            // Use higher bitrate and quality settings for real MP4
            mediaRecorderOptions.videoBitsPerSecond = Math.min(10000000, dimensions * dimensions * 2.5);
            // Add audio track even if silent to improve compatibility
            mediaRecorderOptions.audioTrack = false; // Explicit no audio for video-only exports
            console.log('🎬 Using high-quality MP4 settings for QuickTime compatibility');
        }
        
        this.mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions);

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        // Start recording
        this.mediaRecorder.start(100); // Collect data every 100ms

        // Play back frames at correct timing
        await this.playbackFramesToStream(frameBuffers, fps, playbackCtx);

        // Stop recording and finalize
        this.mediaRecorder.stop();
        
        return new Promise((resolve, reject) => {
            this.mediaRecorder.onstop = () => {
                this.finalizeVideoFile(title, codecInfo, resolve, reject);
            };
            
            this.mediaRecorder.onerror = (event) => {
                reject(new Error(`MediaRecorder error: ${event.error}`));
            };
        });
    }

    selectBestMimeType() {
        // Test for true MP4/H.264 support that QuickTime can handle
        const mp4Types = [
            'video/mp4;codecs="avc1.42E01E"',  // H.264 Baseline Profile
            'video/mp4;codecs="avc1.4D401E"',  // H.264 Main Profile
            'video/mp4;codecs=avc1.42E01E',     // H.264 without quotes
            'video/mp4;codecs=h264',
            'video/mp4'
        ];
        
        // Test MP4 types first for QuickTime compatibility
        for (const type of mp4Types) {
            if (MediaRecorder.isTypeSupported(type)) {
                console.log(`🎬 Selected MP4 type for QuickTime compatibility: ${type}`);
                return { mimeType: type, isRealMp4: true };
            }
        }
        
        // Fallback to WebM types
        const webmTypes = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        
        for (const type of webmTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                console.log(`🎬 Selected WebM fallback (not QuickTime compatible): ${type}`);
                return { mimeType: type, isRealMp4: false };
            }
        }
        
        console.warn('🎬 No supported types found, using default WebM');
        return { mimeType: 'video/webm', isRealMp4: false };
    }

    async playbackFramesToStream(frameBuffers, fps, ctx) {
        const frameDuration = 1000 / fps;
        console.log(`🎬 Playing back ${frameBuffers.length} frames at ${fps}fps (${frameDuration}ms per frame)`);
        
        const startTime = Date.now();
        
        for (let i = 0; i < frameBuffers.length; i++) {
            const frameBuffer = frameBuffers[i];
            
            // Draw frame to playback canvas
            ctx.putImageData(frameBuffer.data, 0, 0);
            
            // Calculate precise timing for this frame
            const targetTime = startTime + (i * frameDuration);
            const currentTime = Date.now();
            const waitTime = Math.max(0, targetTime - currentTime);
            
            // Wait for precise frame timing
            if (waitTime > 0) {
                await this.sleep(waitTime);
            }
            
            // Update progress during playback
            const playbackProgress = 80 + ((i / frameBuffers.length) * 15);
            this.updateProgress(playbackProgress, `Encoding frame ${i + 1}/${frameBuffers.length}...`);
        }
        
        console.log(`🎬 Playback completed in ${Date.now() - startTime}ms`);
    }

    finalizeVideoFile(title, codecInfo, resolve, reject) {
        if (this.recordedChunks.length === 0) {
            reject(new Error('No video data recorded'));
            return;
        }
        
        const mimeType = codecInfo.mimeType;
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        
        if (blob.size < 1000) {
            reject(new Error('Video file too small - recording may have failed'));
            return;
        }
        
        // Determine file extension based on actual codec compatibility
        const extension = codecInfo.isRealMp4 ? 'mp4' : 'webm';
        
        // Log compatibility information
        if (extension === 'mp4') {
            console.log('🎬 Exporting as true MP4 - should be QuickTime compatible');
        } else {
            console.log('🎬 Exporting as WebM - may not be QuickTime compatible');
        }
        
        const url = URL.createObjectURL(blob);
        const a = this.reflections.popupWindow.document.createElement('a');
        a.href = url;
        a.download = `${title}-${Date.now()}.${extension}`;
        a.click();
        URL.revokeObjectURL(url);
        
        console.log(`🎬 Video export completed - ${blob.size} bytes, format: ${extension}`);
        resolve();
    }

    async performMemoryCleanup() {
        // Force garbage collection if available
        if (window.gc) {
            window.gc();
        }
        
        // More aggressive memory cleanup for large exports
        if (typeof window.performance !== 'undefined' && window.performance.memory) {
            const memInfo = window.performance.memory;
            const usedMB = memInfo.usedJSHeapSize / (1024 * 1024);
            const limitMB = memInfo.jsHeapSizeLimit / (1024 * 1024);
            
            // If we're using more than 70% of available memory, wait longer for cleanup
            if (usedMB / limitMB > 0.7) {
                console.log(`🎬 High memory usage detected (${Math.round(usedMB)}MB/${Math.round(limitMB)}MB), extended cleanup`);
                await this.sleep(200);
            } else {
                await this.sleep(50);
            }
        } else {
            await this.sleep(50);
        }
    }

    async adaptiveMemoryDelay(frameNumber) {
        // Only apply memory-based delays, not complexity-based
        if (typeof window.performance !== 'undefined' && window.performance.memory) {
            const memInfo = window.performance.memory;
            const usedMB = memInfo.usedJSHeapSize / (1024 * 1024);
            const limitMB = memInfo.jsHeapSizeLimit / (1024 * 1024);
            const memoryRatio = usedMB / limitMB;
            
            // Apply increasing delays based on memory pressure
            if (memoryRatio > 0.8) {
                // Very high memory usage - significant delay
                await this.sleep(100);
                console.log(`🎬 Frame ${frameNumber}: High memory pressure (${Math.round(memoryRatio * 100)}%), applying 100ms delay`);
            } else if (memoryRatio > 0.6) {
                // Moderate memory usage - small delay
                await this.sleep(25);
            }
            // Below 60% memory usage - no delay needed
        }
    }

    analyzeRenderingComplexity() {
        const dots = this.reflections.normalizedDots || [];
        const baseDots = dots.length;
        
        // Calculate dot multiplication factors
        const reflectionMultiplier = Math.pow(2, this.reflections.reflectionLevel - 1);
        const tessellationMultiplier = Math.pow(this.reflections.tessellationLevel, 2);
        const totalDots = baseDots * reflectionMultiplier * tessellationMultiplier;
        
        // Animation complexity factors
        const hasAnimation = this.reflections.rotationEnabled || this.reflections.translationEnabled;
        const hasBlending = this.reflections.blendMode === 'difference'; // Difference is more expensive
        
        // Canvas size factor
        const canvasComplexity = Math.pow(this.reflections.canvasSize / 800, 2);
        
        // Calculate total complexity score
        let complexityScore = totalDots * canvasComplexity;
        if (hasAnimation) complexityScore *= 1.8;
        if (hasBlending) complexityScore *= 1.5;
        if (this.reflections.dotSize > 6) complexityScore *= 1.3; // Large dots are more expensive
        
        let risk = 'LOW';
        if (complexityScore > 100000) {
            risk = 'EXTREME';
        } else if (complexityScore > 50000) {
            risk = 'HIGH';
        } else if (complexityScore > 15000) {
            risk = 'MEDIUM';
        }
        
        return {
            baseDots,
            reflectionLevel: this.reflections.reflectionLevel,
            tessellationLevel: this.reflections.tessellationLevel,
            reflectionMultiplier,
            tessellationMultiplier,
            totalDots,
            hasAnimation,
            hasBlending,
            canvasSize: this.reflections.canvasSize,
            dotSize: this.reflections.dotSize,
            complexityScore: Math.round(complexityScore),
            risk
        };
    }

    calculateAdaptiveTimingStrategy(complexity, frameCount) {
        // Base timing values for simple renders
        let frameDelay = 16; // 60fps equivalent (16ms per frame)
        let yieldInterval = 20; // Yield every 20 frames
        let gcInterval = 5000; // GC every 5 seconds
        let stabilizationDelay = 0; // Extra delay after each frame for complex renders
        
        // Adjust timing based on complexity risk
        switch (complexity.risk) {
            case 'EXTREME':
                frameDelay = 200; // 5fps equivalent - very slow but stable
                yieldInterval = 1; // Yield after every frame
                gcInterval = 2000; // GC every 2 seconds
                stabilizationDelay = 100; // 100ms stabilization delay
                break;
                
            case 'HIGH':
                frameDelay = 100; // 10fps equivalent
                yieldInterval = 3; // Yield every 3 frames
                gcInterval = 3000; // GC every 3 seconds
                stabilizationDelay = 50; // 50ms stabilization delay
                break;
                
            case 'MEDIUM':
                frameDelay = 50; // 20fps equivalent
                yieldInterval = 5; // Yield every 5 frames
                gcInterval = 4000; // GC every 4 seconds
                stabilizationDelay = 25; // 25ms stabilization delay
                break;
                
            case 'LOW':
            default:
                // Use default values
                break;
        }
        
        // Additional adjustments for very long animations
        if (frameCount > 900) { // More than 30 seconds at 30fps
            frameDelay = Math.max(frameDelay, 33); // At least 30fps limit
            yieldInterval = Math.max(1, Math.floor(yieldInterval / 2));
            gcInterval = Math.max(1000, gcInterval - 1000);
        }
        
        console.log(`🎬 Adaptive timing strategy for ${complexity.risk} complexity:`, {
            frameDelay: `${frameDelay}ms`,
            stabilizationDelay: `${stabilizationDelay}ms`,
            yieldInterval,
            gcInterval: `${gcInterval}ms`,
            complexityScore: complexity.complexityScore
        });
        
        return {
            frameDelay,
            yieldInterval,
            gcInterval,
            stabilizationDelay,
            complexityRisk: complexity.risk
        };
    }

    async adaptiveFrameDelay(timingStrategy, complexity, frameNumber) {
        // Base frame delay
        await this.sleep(timingStrategy.frameDelay);
        
        // Additional stabilization delay for complex renders
        if (timingStrategy.stabilizationDelay > 0) {
            await this.sleep(timingStrategy.stabilizationDelay);
        }
        
        // Progressive delay for extremely complex renders to prevent memory buildup
        if (complexity.risk === 'EXTREME' && frameNumber > 100) {
            const progressiveDelay = Math.min(50, frameNumber * 0.2);
            await this.sleep(progressiveDelay);
        }
        
        // Additional delay for high dot counts to prevent rendering artifacts
        if (complexity.totalDots > 10000) {
            const dotComplexityDelay = Math.min(30, complexity.totalDots / 1000);
            await this.sleep(dotComplexityDelay);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    calculateETA(startTime, currentFrame, totalFrames) {
        if (currentFrame === 0) return 'Calculating...';
        
        const elapsed = Date.now() - startTime;
        const avgTimePerFrame = elapsed / currentFrame;
        const remainingFrames = totalFrames - currentFrame;
        const etaMs = remainingFrames * avgTimePerFrame;
        
        if (etaMs < 60000) {
            return `${Math.round(etaMs / 1000)}s remaining`;
        } else {
            const minutes = Math.floor(etaMs / 60000);
            const seconds = Math.round((etaMs % 60000) / 1000);
            return `${minutes}m ${seconds}s remaining`;
        }
    }

    async yieldToUI() {
        // Yield control to browser for UI updates and event processing
        return new Promise(resolve => {
            setTimeout(resolve, 0);
        });
    }

    // ====================================
    // POPUP WINDOW UTILITIES
    // ====================================

    showPopupConfirm(message) {
        // Use the popup window's confirm dialog instead of main window
        if (this.reflections.popupWindow && !this.reflections.popupWindow.closed) {
            return this.reflections.popupWindow.confirm(message);
        } else {
            // Fallback to main window if popup not available
            console.warn('🎬 Popup window not available, using main window confirm');
            return confirm(message);
        }
    }

    showPopupAlert(message) {
        // Use the popup window's alert dialog instead of main window
        if (this.reflections.popupWindow && !this.reflections.popupWindow.closed) {
            this.reflections.popupWindow.alert(message);
        } else {
            // Fallback to main window if popup not available
            console.warn('🎬 Popup window not available, using main window alert');
            alert(message);
        }
    }
}

// Export the class for use by Reflections.js
if (typeof window !== 'undefined') {
    window.ReflectionsExporter = ReflectionsExporter;
}