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
            this.voteRhythmsList = document.getElementById('vote-rhythms-list');
            this.submitButton = document.getElementById('submit-current-rhythm');
            this.submitStatus = document.getElementById('submit-status');
            this.categorySelect = document.getElementById('collection-category');
            this.browseCategorySelect = document.getElementById('browse-category');

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
                        this.loadTopRhythms(this.voteRhythmsList).catch((err) => console.error('Failed to load vote list:', err));
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

            if (this.browseCategorySelect) {
                this.browseCategorySelect.addEventListener('change', () => {
                    this.loadTopRhythms().catch((err) => console.error('Failed to load collections:', err));
                    this.loadTopRhythms(this.voteRhythmsList).catch((err) => console.error('Failed to load vote list:', err));
                });
            }
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

            const category = this.getSubmitCategory();

            const submissionResult = await this.submitRhythm({
                layers: layerArray,
                submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                pitches: this.extractPitchCount(),
                summary: this.getRhythmSummary(),
                category
            });

            if (submissionResult.status === 'duplicate') {
                const usedCategory = submissionResult.category || category;
                this.showStatus(`Already in Collections—counted as a fresh ${this.formatCategoryLabel(usedCategory)} vote. Thanks!`, 'info');
            } else {
                this.showStatus(`Thanks for submitting! Your rhythm is now in Collections (${this.formatCategoryLabel(category)}).`, 'success');
            }

            // Refresh the leaderboard if the panel is open so the user sees their contribution instantly.
            if (this.collectionsPanel && this.collectionsPanel.style.display === 'block') {
                this.loadTopRhythms().catch((err) => console.error('Post-submit refresh failed:', err));
                this.loadTopRhythms(this.voteRhythmsList).catch((err) => console.error('Post-submit vote refresh failed:', err));
            }
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

            const collectionRef = this.db.collection('collections_rhythms');
            const duplicateSnapshot = await collectionRef
                .where('layers', '==', payload.layers)
                .limit(1)
                .get();

            if (!duplicateSnapshot.empty) {
                const existingDoc = duplicateSnapshot.docs[0];
                try {
                    const voteCategory = this.normalizeCategory(payload.category) || this.defaultVoteCategory();
                    await this.registerVote(existingDoc.id, voteCategory);
                    if (typeof window !== 'undefined' && window.localStorage) {
                        localStorage.setItem(this.voteStorageKey(existingDoc.id, voteCategory), String(Date.now()));
                    }
                    return { status: 'duplicate', docId: existingDoc.id, category: voteCategory };
                } catch (voteErr) {
                    console.error('Duplicate submission vote failed:', voteErr);
                    this.showStatus('That rhythm already exists, and we could not record your vote. Please try again shortly.', 'error');
                    throw voteErr;
                }
            }

            const normalizedCategory = this.normalizeCategory(payload.category) || this.defaultVoteCategory();
            const initialVotes = this.initialVoteSchema();
            initialVotes[normalizedCategory] = 1; // auto-award first vote
            const newDocRef = await collectionRef.add({
                ...payload,
                votes: initialVotes,
                flags: 0,
                category: normalizedCategory
            });

            return { status: 'created', docId: newDocRef.id, category: normalizedCategory };
        }

        initialVoteSchema() {
            return {
                playback: 0,
                visuals: 0
            };
        }

        // --- Voting Flow --------------------------------------------------------

        async registerVote(docId, category) {
            if (!this.db) {
                throw new Error('Firestore not initialized');
            }

            const allowedCategories = this.allowedCategories();
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

        defaultVoteCategory() {
            return this.allowedCategories()[0];
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

        async loadTopRhythms(listElement = null) {
            if (!this.db) return;

            const targetList = listElement ?? this.topRhythmsList;
            if (!targetList) return;

            const activeCategoryLabel = this.formatCategoryLabel(this.getBrowseCategory());
            targetList.innerHTML = `<div class="loading">Loading ${activeCategoryLabel} Collections...</div>`;

            try {
            const sortCategory = this.getBrowseCategory();
            let query = this.db.collection('collections_rhythms')
                .where('category', '==', sortCategory)
                .orderBy(`votes.${sortCategory}`, 'desc')
                .limit(25);

            let snapshot;
            try {
                snapshot = await query.get();
            } catch (queryError) {
                // If index missing, fall back to unfiltered orderBy
                console.warn('Collections query falling back due to:', queryError);
                snapshot = await this.db.collection('collections_rhythms')
                    .orderBy(`votes.${sortCategory}`, 'desc')
                    .limit(25)
                    .get();
            }

                if (snapshot.empty) {
                    targetList.innerHTML = `<div class="empty">No ${activeCategoryLabel} rhythms submitted yet. Be the first!</div>`;
                    return;
                }

                const fragments = document.createDocumentFragment();

                snapshot.forEach((doc) => {
                    const data = doc.data();
                    const listItem = document.createElement('div');
                    listItem.className = 'collection-item';
                    listItem.innerHTML = this.renderCollectionCard(doc.id, data, {
                        showVoteButtons: targetList === this.voteRhythmsList
                    });
                    fragments.appendChild(listItem);
                });

                targetList.innerHTML = '';
                targetList.appendChild(fragments);
                this.markVotedButtons(targetList);
            } catch (error) {
                console.error('Failed to load Collections:', error);
                targetList.innerHTML = '<div class="error">Unable to load Collections right now.</div>';
            }
        }

        renderCollectionCard(docId, data, options = {}) {
            const { layers = [], votes = {}, summary = {}, category } = data;
            const layerText = Array.isArray(layers) ? layers.join(':') : 'Unknown';
            const categoryLabel = this.formatCategoryLabel(category);
            const voteCounts = this.allowedCategories().reduce((acc, cat) => {
                acc[cat] = votes && typeof votes === 'object' ? votes[cat] || 0 : 0;
                return acc;
            }, {});
            const totalVotes = Object.values(voteCounts).reduce((sum, value) => sum + value, 0);
            const showVoteButtons = options.showVoteButtons === true;

            const voteButtonsHtml = showVoteButtons
                ? `<div class="collection-vote-buttons">${this.allowedCategories().map((cat) => {
                        return `<button class="vote-btn" data-doc="${docId}" data-category="${cat}">Vote ${this.formatCategoryLabel(cat)}</button>`;
                    }).join('')}</div>`
                : '';

            return `
                <div class="collection-card" data-doc-id="${docId}">
                    <div class="collection-header">
                        <span class="collection-layers">${layerText}</span>
                        <button class="apply-collection" data-layers="${layers.join(',')}">Apply</button>
                    </div>
                    <div class="collection-votes">
                        <span class="total-votes">Votes: <strong>${totalVotes}</strong></span>
                        <span class="category-label">${categoryLabel}</span>
                    </div>
                    ${voteButtonsHtml}
                </div>
            `;
        }

        voteStorageKey(docId, category) {
            return `collections-vote-${docId}-${category}`;
        }

        markVotedButtons(listElement) {
            if (!listElement || typeof window === 'undefined' || !window.localStorage) return;
            const buttons = listElement.querySelectorAll('.vote-btn');
            buttons.forEach((button) => {
                const docId = button.getAttribute('data-doc');
                const category = button.getAttribute('data-category');
                const key = this.voteStorageKey(docId, category);
                if (localStorage.getItem(key)) {
                    button.disabled = true;
                    button.classList.add('voted');
                }
            });
        }

        // --- Helpers ------------------------------------------------------------

        allowedCategories() {
            return ['playback', 'visuals'];
        }

        normalizeCategory(category) {
            if (typeof category !== 'string') {
                return null;
            }
            const lowered = category.trim().toLowerCase();
            return this.allowedCategories().includes(lowered) ? lowered : null;
        }

        formatCategoryLabel(category) {
            const normalized = this.normalizeCategory(category) || this.defaultVoteCategory();
            return normalized.charAt(0).toUpperCase() + normalized.slice(1);
        }

        getSubmitCategory() {
            if (!this.categorySelect) {
                return this.defaultVoteCategory();
            }
            const selected = this.normalizeCategory(this.categorySelect.value);
            return selected || this.defaultVoteCategory();
        }

        getBrowseCategory() {
            if (!this.browseCategorySelect) {
                return this.defaultVoteCategory();
            }
            const selected = this.normalizeCategory(this.browseCategorySelect.value);
            return selected || this.defaultVoteCategory();
        }

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
