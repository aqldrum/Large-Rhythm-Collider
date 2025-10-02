// ColliderAudio.js - Battle Audio System for Segment Destruction
// Transforms Collider structures into live "instruments" triggered by combat

class ColliderAudio {
    constructor() {
        // Independent Web Audio API setup
        this.audioContext = null;
        this.masterGain = null;
        this.limiter = null;
        
        // Audio parameters (matching your specifications)
        this.fundamentalFreq = 110; // Fixed at 110Hz (no longer controllable)
        this.maxFrequencyHz = 3520; // Hard cap shared with ToneRowPlayback
        this.masterVolumeDb = -24; // Default -24dB like ToneRowPlayback
        
        // Note management for polyphony (up to 4 players can trigger simultaneously)
        this.activeNotes = new Map(); // Track playing notes by unique ID
        this.noteId = 0; // Unique ID counter for each note
        
        // ADSR envelope settings (your exact specification)
        this.envelope = {
            attack: 0.001,   // 1ms
            decay: 0.350,    // 350ms
            sustain: 0.0,    // 0% (no sustain)
            release: 0.001   // 1ms
        };
        
        // Spatial audio settings
        this.battleCenter = { x: 400, y: 300 }; // Will be updated by battle controller
        this.panningRange = 0.8; // Maximum left/right pan (-0.8 to +0.8)
        
        console.log('🎵 ColliderAudio initialized - segments ready to sing!');
    }

    // ====================================
    // INITIALIZATION & SETUP
    // ====================================

    async initAudioContext() {
        if (this.audioContext) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create master gain for volume control (using dB conversion)
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.dbToLinear(this.masterVolumeDb);
            
            // Create limiter (same as ToneRowPlayback to prevent clipping)
            this.limiter = this.audioContext.createDynamicsCompressor();
            this.limiter.threshold.value = -1;
            this.limiter.knee.value = 0;
            this.limiter.ratio.value = 20;
            this.limiter.attack.value = 0.003;
            this.limiter.release.value = 0.01;
            
            // Connect audio chain: master gain -> limiter -> destination
            this.masterGain.connect(this.limiter);
            this.limiter.connect(this.audioContext.destination);
            
            console.log('🎵 ColliderAudio context initialized with limiter');
            
        } catch (error) {
            console.error('❌ Failed to initialize ColliderAudio context:', error);
            throw error;
        }
    }

    setBattleCenter(x, y) {
        this.battleCenter = { x, y };
        console.log(`🎵 ColliderAudio battle center set to (${x}, ${y})`);
    }

    setMasterVolumeDb(dbValue) {
        // Clamp to reasonable range (-60dB to 0dB, with -60dB being effectively muted)
        this.masterVolumeDb = Math.max(-60, Math.min(0, dbValue));
        
        if (this.masterGain) {
            const linearValue = this.dbToLinear(this.masterVolumeDb);
            this.masterGain.gain.setTargetAtTime(
                linearValue,
                this.audioContext.currentTime,
                0.05
            );
        }
        console.log(`🎵 ColliderAudio volume set to ${this.masterVolumeDb}dB`);
    }

    // ====================================
    // FREQUENCY CALCULATION (Same as ToneRowPlayback)
    // ====================================

    calculateNoteFrequency(spaceValue, player) {
        // Use the same formula as ToneRowPlayback to maintain system integrity
        const globalFundamental = Math.max(...player.spacesPlot);
        const frequency = this.fundamentalFreq * (globalFundamental / spaceValue);
        
        // Check frequency limits (same as ToneRowPlayback)
        const maxFrequency = this.maxFrequencyHz;
        const isMuted = frequency > maxFrequency;
        
        return {
            frequency: frequency,
            isMuted: isMuted,
            ratio: globalFundamental / spaceValue,
            spaceValue: spaceValue
        };
    }

    // ====================================
    // SPATIAL AUDIO CALCULATION
    // ====================================

    calculateSpatialPanning(player) {
        // Simple left/right panning based on player position relative to battle center
        const playerCenter = player.getCenterOfMass();
        const deltaX = playerCenter.x - this.battleCenter.x;
        
        // Normalize to panning range (-panningRange to +panningRange)
        // Assume reasonable battle field width of ~800 pixels
        const battleFieldWidth = 800;
        const normalizedPan = (deltaX / (battleFieldWidth / 2)) * this.panningRange;
        
        // Clamp to valid panning range
        return Math.max(-1, Math.min(1, normalizedPan));
    }

    // ====================================
    // MAIN AUDIO TRIGGER METHOD
    // ====================================

    playSegmentNote(player, destroyedSegment) {
        // Skip if no space value (healing/reconnection segments)
        if (destroyedSegment.spaceIndex === -1 || !destroyedSegment.originalSpaceValue) {
            console.log(`🎵 Skipping audio for healing segment (spaceIndex: ${destroyedSegment.spaceIndex})`);
            return;
        }

        // Calculate the note frequency
        const noteData = this.calculateNoteFrequency(destroyedSegment.originalSpaceValue, player);
        
        // Skip muted notes (above frequency limit)
        if (noteData.isMuted) {
            console.log(`🔇 Note muted - frequency ${noteData.frequency.toFixed(1)}Hz exceeds limit`);
            return;
        }

        // Calculate spatial panning
        const panning = this.calculateSpatialPanning(player);

        console.log(`🎵 Playing segment note: Player ${player.playerId}, frequency ${noteData.frequency.toFixed(1)}Hz, ratio ${noteData.ratio.toFixed(2)}, pan ${panning.toFixed(2)}`);

        // Create and play the note
        this.createAndPlayNote(noteData.frequency, player.playerId, panning);
    }

    // ====================================
    // WEB AUDIO NOTE CREATION
    // ====================================

    async createAndPlayNote(frequency, playerId, panning = 0) {
        try {
            // Ensure audio context is initialized
            await this.initAudioContext();
            
            const now = this.audioContext.currentTime;
            const noteId = this.noteId++;
            
            // Create triangle wave oscillator
            const oscillator = this.audioContext.createOscillator();
            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(frequency, now);
            
            // Create ADSR envelope
            const envelope = this.audioContext.createGain();
            envelope.gain.setValueAtTime(0, now);
            
            // Create stereo panner for spatial audio
            const panner = this.audioContext.createStereoPanner();
            panner.pan.setValueAtTime(panning, now);
            
            // Connect audio chain: oscillator -> envelope -> panner -> master gain
            oscillator.connect(envelope);
            envelope.connect(panner);
            panner.connect(this.masterGain);
            
            // Apply ADSR envelope (your exact specification)
            const { attack, decay, sustain, release } = this.envelope;
            const totalDuration = attack + decay + release;
            
            // Attack phase (0 to 1)
            envelope.gain.linearRampToValueAtTime(1, now + attack);
            
            // Decay phase (1 to sustain level = 0)
            envelope.gain.linearRampToValueAtTime(sustain, now + attack + decay);
            
            // Release phase (sustain to 0) - since sustain is 0, this is immediate
            envelope.gain.linearRampToValueAtTime(0, now + totalDuration);
            
            // Start and schedule stop
            oscillator.start(now);
            oscillator.stop(now + totalDuration);
            
            // Track active note
            this.activeNotes.set(noteId, {
                oscillator,
                envelope,
                panner,
                playerId,
                frequency,
                startTime: now,
                endTime: now + totalDuration
            });
            
            // Clean up when note ends
            oscillator.onended = () => {
                this.activeNotes.delete(noteId);
            };
            
            console.log(`🎵 Note playing: ${frequency.toFixed(1)}Hz, Player ${playerId}, pan ${panning.toFixed(2)}, duration ${(totalDuration * 1000).toFixed(0)}ms`);
            
        } catch (error) {
            console.error('❌ Failed to create and play note:', error);
        }
    }

    // ====================================
    // UTILITY METHODS
    // ====================================

    stopAllNotes() {
        console.log(`🔇 Stopping ${this.activeNotes.size} active notes`);
        
        for (const [noteId, noteData] of this.activeNotes) {
            try {
                noteData.oscillator.stop();
            } catch (e) {
                // Note may already be stopped
            }
        }
        
        this.activeNotes.clear();
    }

    getActiveNoteCount() {
        return this.activeNotes.size;
    }

    getAudioStatus() {
        return {
            contextState: this.audioContext?.state || 'not initialized',
            activeNotes: this.activeNotes.size,
            fundamentalFreq: this.fundamentalFreq,
            maxFrequency: this.maxFrequencyHz,
            masterVolumeDb: this.masterVolumeDb
        };
    }

    // ====================================
    // UTILITY FUNCTIONS (Same as ToneRowPlayback)
    // ====================================

    dbToLinear(db) {
        return Math.pow(10, db / 20);
    }

    // ====================================
    // CLEANUP
    // ====================================

    destroy() {
        this.stopAllNotes();
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        console.log('🎵 ColliderAudio destroyed');
    }
}

// Export for integration
if (typeof window !== 'undefined') {
    window.ColliderAudio = ColliderAudio;
}
