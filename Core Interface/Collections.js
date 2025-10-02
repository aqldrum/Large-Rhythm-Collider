// Collections.js - Community Collections & Voting scaffold for Large Rhythm Collider
// This module wires the UI to a serverless backend (Firebase Firestore) for anonymous rhythm submissions and voting.
// Implementation notes:
//   • The actual Firebase configuration lives in firebase-config.js (gitignored). Use firebase-config.template.js as a guide.
//   • Firebase compat SDKs (app, auth optional, firestore) must be loaded before this script.
//   • All Firestore calls are stubbed; fill in the TODO sections once credentials are available.

(function () {
    class CollectionsManager {
        constructor() {
            this.db = null; // Firestore reference (firebase.firestore()).
            this.auth = null; // Optional anonymous auth reference.

            this.collectionsToggle = document.getElementById('collections-toggle');
            this.collectionsPanel = document.getElementById('collections-panel');
            this.topRhythmsList = document.getElementById('top-rhythms-list');
            this.submitButton = document.getElementById('submit-current-rhythm');
            this.submitStatus = document.getElementById('submit-status');

            // Hard-coded blacklist of meme / hateful digits. Extend to cover permutations.
            this.layerBlacklist = ['69', '420', '80085', '1337', '1488'];

            this.initialized = false;
        }

        async init() {
            if (this.initialized) return;

            try {
                await this.initializeFirebase();
                this.bindUI();
                this.initialized = true;
                console.log('📦 Collections module ready');
            } catch (error) {
                console.error('Collections initialization failed:', error);
                this.showStatus('Unable to initialize Collections service. Please try again later.', 'error');
            }
        }

        async initializeFirebase() {
            if (typeof firebase === 'undefined') {
                throw new Error('Firebase SDK not loaded');
            }

            if (!window.firebaseConfig) {
                throw new Error('firebaseConfig missing. Copy firebase-config.template.js → firebase-config.js');
            }

            if (firebase.apps.length === 0) {
                firebase.initializeApp(window.firebaseConfig);
            }

            // Optional anonymous auth. Helps enforce Firestore security rules without user accounts.
            if (firebase.auth) {
                this.auth = firebase.auth();
                try {
                    await this.auth.signInAnonymously();
                } catch (authErr) {
                    console.warn('Anonymous auth failed; continuing without auth.', authErr);
                }
            }

            if (!firebase.firestore) {
                throw new Error('Firestore SDK missing. Include firebase-firestore-compat.js');
            }

            this.db = firebase.firestore();
        }

        bindUI() {
            if (this.collectionsToggle && this.collectionsPanel) {
                this.collectionsToggle.addEventListener('click', () => {
                    const isVisible = this.collectionsPanel.style.display === 'block';
                    this.collectionsPanel.style.display = isVisible ? 'none' : 'block';

                    if (!isVisible) {
                        this.loadTopRhythms().catch((err) => console.error('Failed to load collections:', err));
                    }
                });
            }

            if (this.submitButton) {
                this.submitButton.addEventListener('click', () => {
                    this.handleSubmission().catch((err) => {
                        console.error('Submission failed:', err);
                        this.showStatus('Unable to submit rhythm right now. Please try again.', 'error');
                    });
                });
            }

            // TODO: Wire vote buttons once Collections UI is fleshed out.
        }

        // --- Submission Flow ----------------------------------------------------

        async handleSubmission() {
            const currentLayersSpan = document.getElementById('current-layers');
            if (!currentLayersSpan) {
                this.showStatus('No active rhythm to submit.', 'warn');
                return;
            }

            const layersText = currentLayersSpan.textContent.trim();
            if (!layersText) {
                this.showStatus('No active rhythm to submit.', 'warn');
                return;
            }

            if (this.containsBlacklistedDigits(layersText)) {
                this.showStatus('Submission rejected (blacklisted pattern).', 'error');
                return;
            }

            const layerArray = layersText.split(':').map((value) => parseInt(value, 10)).filter(Boolean);
            if (layerArray.length === 0) {
                this.showStatus('Invalid rhythm format.', 'error');
                return;
            }

            await this.submitRhythm({
                layers: layerArray,
                submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                pitches: this.extractPitchCount(),
                summary: this.getRhythmSummary()
            });

            this.showStatus('Rhythm submitted to Collections!', 'success');
        }

        containsBlacklistedDigits(text) {
            return this.layerBlacklist.some((pattern) => text.includes(pattern));
        }

        extractPitchCount() {
            const pitchEl = document.getElementById('pitch-count');
            if (!pitchEl) return null;
            const count = parseInt(pitchEl.textContent, 10);
            return Number.isFinite(count) ? count : null;
        }

        getRhythmSummary() {
            const fundEl = document.getElementById('fundamental-display');
            const rangeEl = document.getElementById('range-display');
            return {
                fundamental: fundEl ? fundEl.textContent : null,
                range: rangeEl ? rangeEl.textContent : null
            };
        }

        async submitRhythm(payload) {
            if (!this.db) {
                throw new Error('Firestore not initialized');
            }

            // TODO: Optional duplicate detection before write.

            await this.db.collection('collections_rhythms').add({
                ...payload,
                votes: this.initialVoteSchema(),
                flags: 0
            });
        }

        initialVoteSchema() {
            return {
                melodicBeauty: 0,
                rhythmicComplexity: 0,
                harmonicRichness: 0,
                danceability: 0,
                mathematicalElegance: 0
            };
        }

        // --- Voting Flow --------------------------------------------------------

        async registerVote(docId, category) {
            if (!this.db) {
                throw new Error('Firestore not initialized');
            }

            const allowedCategories = Object.keys(this.initialVoteSchema());
            if (!allowedCategories.includes(category)) {
                console.warn('Attempt to vote in unsupported category:', category);
                return;
            }

            const docRef = this.db.collection('collections_rhythms').doc(docId);

            // TODO: Enforce client-side rate limiting (e.g., localStorage timestamp) before hitting Firestore.

            await docRef.update({
                [`votes.${category}`]: firebase.firestore.FieldValue.increment(1)
            });
        }

        // --- Flagging / Moderation ---------------------------------------------

        async flagRhythm(docId) {
            if (!this.db) {
                throw new Error('Firestore not initialized');
            }

            const docRef = this.db.collection('collections_rhythms').doc(docId);
            await docRef.update({
                flags: firebase.firestore.FieldValue.increment(1)
            });
        }

        // --- Fetch & Render -----------------------------------------------------

        async loadTopRhythms() {
            if (!this.db || !this.topRhythmsList) return;

            this.topRhythmsList.innerHTML = '<div class="loading">Loading Collections...</div>';

            try {
                const snapshot = await this.db.collection('collections_rhythms')
                    .orderBy('votes.rhythmicComplexity', 'desc')
                    .limit(25)
                    .get();

                if (snapshot.empty) {
                    this.topRhythmsList.innerHTML = '<div class="empty">No rhythms submitted yet. Be the first!</div>';
                    return;
                }

                const fragments = document.createDocumentFragment();

                snapshot.forEach((doc) => {
                    const data = doc.data();
                    const listItem = document.createElement('div');
                    listItem.className = 'collection-item';
                    listItem.innerHTML = this.renderCollectionCard(doc.id, data);
                    fragments.appendChild(listItem);
                });

                this.topRhythmsList.innerHTML = '';
                this.topRhythmsList.appendChild(fragments);
            } catch (error) {
                console.error('Failed to load Collections:', error);
                this.topRhythmsList.innerHTML = '<div class="error">Unable to load Collections right now.</div>';
            }
        }

        renderCollectionCard(docId, data) {
            const { layers = [], votes = {}, summary = {} } = data;
            const layerText = Array.isArray(layers) ? layers.join(':') : 'Unknown';
            const voteEntries = Object.entries(votes);

            const votesHtml = voteEntries.map(([category, count]) => {
                return `<button class="vote-btn" data-doc="${docId}" data-category="${category}">${category.replace(/([A-Z])/g, ' $1')}: <strong>${count}</strong></button>`;
            }).join('');

            return `
                <div class="collection-card" data-doc-id="${docId}">
                    <div class="collection-layers">${layerText}</div>
                    <div class="collection-meta">
                        <span>Fundamental: ${summary.fundamental ?? '—'}</span>
                        <span>Range: ${summary.range ?? '—'}</span>
                    </div>
                    <div class="collection-actions">
                        <button class="apply-collection" data-layers="${layers.join(',')}">Apply</button>
                        <button class="flag-collection" data-doc="${docId}">Flag</button>
                    </div>
                    <div class="collection-votes">
                        ${votesHtml}
                    </div>
                </div>
            `;
        }

        // --- Helpers ------------------------------------------------------------

        showStatus(message, type = 'info') {
            if (!this.submitStatus) return;
            this.submitStatus.textContent = message;
            this.submitStatus.className = `status-message ${type}`;
        }
    }

    // Expose singleton to global scope for debugging & manual init.
    window.collectionsManager = new CollectionsManager();
    document.addEventListener('DOMContentLoaded', () => {
        window.collectionsManager.init();
    });
})();

