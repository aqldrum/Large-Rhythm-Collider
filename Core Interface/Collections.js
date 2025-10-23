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
            this.dropdownSections = Array.from(document.querySelectorAll('#collections-panel .dropdown-section'));
            this.aboutDropdownSection = document.querySelector('#collections-panel .dropdown-section[data-section="about"]');
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
                try {
                    const projectId = window.firebaseConfig?.projectId || firebase.app().options?.projectId;
                    console.log('📦 Collections Firebase initialized with project:', projectId || '(unknown)');
                } catch (logErr) {
                    console.warn('📦 Collections Firebase initialization log failed:', logErr);
                }
            }

            // Optional anonymous auth. Helps enforce Firestore security rules without user accounts.
            if (firebase.auth) {
                this.auth = firebase.auth();
                try {
                    const userCredential = await this.auth.signInAnonymously();
                    console.log('✅ Anonymous auth succeeded. User ID:', userCredential.user.uid);
                } catch (authErr) {
                    console.error('❌ Anonymous auth failed:', authErr);
                    throw new Error('Authentication required but failed: ' + authErr.message);
                }
            } else {
                throw new Error('Firebase Auth SDK not loaded');
            }

            if (!firebase.firestore) {
                throw new Error('Firestore SDK missing. Include firebase-firestore-compat.js');
            }

            this.db = firebase.firestore();
        }

        bindUI() {
            if (this.collectionsToggle && this.collectionsPanel) {
                const updateToggleAccessibility = (expanded) => {
                    this.collectionsToggle.setAttribute('aria-controls', 'collections-panel');
                    this.collectionsToggle.setAttribute('aria-expanded', String(expanded));
                    this.collectionsToggle.setAttribute(
                        'aria-label',
                        expanded ? 'Hide About and Collections menu' : 'Show About and Collections menu'
                    );
                    this.collectionsToggle.textContent = expanded ? '▲' : '▼';
                };

                updateToggleAccessibility(false);
                this.collectionsToggle.addEventListener('click', () => {
                    const isVisible = this.collectionsPanel.style.display === 'block';
                    this.collectionsPanel.style.display = isVisible ? 'none' : 'block';
                    updateToggleAccessibility(!isVisible);

                    if (!isVisible) {
                        this.refreshCollectionsLists();
                    }
                });
            }

            this.configureDropdownSections();

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
                    this.refreshCollectionsLists();
                });
            }
        }

        configureDropdownSections() {
            if (!Array.isArray(this.dropdownSections)) {
                return;
            }

            this.dropdownSections.forEach((section) => {
                const header = section.querySelector('.dropdown-section-header');
                if (!header) return;

                const targetId = header.getAttribute('data-target');
                const content = targetId ? document.getElementById(targetId) : null;
                const icon = section.querySelector('.dropdown-section-icon');

                header.setAttribute('aria-controls', targetId || '');
                header.setAttribute('aria-expanded', 'false');

                if (content) {
                    content.hidden = true;
                }
                if (icon) {
                    icon.textContent = '+';
                }

                header.addEventListener('click', () => {
                    const willExpand = content ? content.hidden : false;
                    this.setSectionExpanded(section, content, icon, header, willExpand);
                });
            });

            this.updatePanelLayout();
        }

        setSectionExpanded(section, content, icon, header, expand) {
            if (!section || !content) return;

            if (expand) {
                content.hidden = false;
                section.classList.add('expanded');
                if (icon) icon.textContent = '−';
                if (header) header.setAttribute('aria-expanded', 'true');

                content.dispatchEvent(new CustomEvent('dropdownsectiontoggle', {
                    bubbles: false,
                    detail: { expanded: true }
                }));

                if (section.dataset.section === 'collections') {
                    this.refreshCollectionsLists();
                }
            } else {
                content.hidden = true;
                section.classList.remove('expanded');
                if (icon) icon.textContent = '+';
                if (header) header.setAttribute('aria-expanded', 'false');

                content.dispatchEvent(new CustomEvent('dropdownsectiontoggle', {
                    bubbles: false,
                    detail: { expanded: false }
                }));
            }

            this.updatePanelLayout();
        }

        updatePanelLayout() {
            if (!this.collectionsPanel) return;
            const aboutExpanded = this.aboutDropdownSection && this.aboutDropdownSection.classList.contains('expanded');
            this.collectionsPanel.classList.toggle('collections-panel--wide', Boolean(aboutExpanded));
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

            const result = await this.submitRhythm({
                layers: layerArray,
                pitches: this.extractPitchCount(),
                summary: this.getRhythmSummary(),
                category: this.getSubmitCategory()
            });

            // Only show new submission message if it wasn't a duplicate
            if (result && result.isNew) {
                this.showStatus('Rhythm submitted to Collections!', 'success');
                this.refreshCollectionsLists();
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

            const normalizedCategory = this.normalizeCategory(payload.category) || this.defaultVoteCategory();
            const collectionRef = this.db.collection('collections_rhythms');

            // Basic duplicate detection by layers
            const duplicateSnapshot = await collectionRef
                .where('layers', '==', payload.layers)
                .limit(1)
                .get();

            if (!duplicateSnapshot.empty) {
                const existingDoc = duplicateSnapshot.docs[0];
                const voteCategory = normalizedCategory;
                await this.registerVote(existingDoc.id, voteCategory);
                if (typeof window !== 'undefined' && window.localStorage) {
                    localStorage.setItem(this.voteStorageKey(existingDoc.id, voteCategory), String(Date.now()));
                }
                const categoryLabel = this.formatCategoryLabel(voteCategory);
                this.showStatus(`Rhythm already submitted - vote recorded for ${categoryLabel}!`, 'info');
                this.refreshCollectionsLists();
                return { isNew: false, docId: existingDoc.id };
            }

            // Verify authentication before attempting to create document
            if (!this.auth || !this.auth.currentUser) {
                throw new Error('User must be authenticated to submit rhythms');
            }

            const pitchesValue = Number.isFinite(payload.pitches) ? payload.pitches : (window.lrcModule?.currentRatios?.length || 0);
            const summaryValue = payload.summary || { fundamental: null, range: null };

            const docData = {
                layers: payload.layers,
                submittedAt: firebase.firestore.Timestamp.now(),
                pitches: pitchesValue,
                summary: {
                    fundamental: summaryValue.fundamental ?? null,
                    range: summaryValue.range ?? null
                },
                category: normalizedCategory,
                votes: this.initialVoteSchema({ [normalizedCategory]: 1 }),
                flags: 0
            };


            const docRef = await collectionRef.add(docData);
            return { isNew: true, docId: docRef.id };
        }

        initialVoteSchema(initialVotes = {}) {
            const schema = {};
            this.allowedCategories().forEach((category) => {
                schema[category] = initialVotes[category] || 0;
            });
            return schema;
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

        refreshCollectionsLists() {
            this.loadTopRhythms().catch((err) => console.error('Failed to load Collections:', err));
            if (this.voteRhythmsList) {
                this.loadTopRhythms(this.voteRhythmsList).catch((err) => console.error('Failed to load vote list:', err));
            }
        }

        async loadTopRhythms(listElement = null) {
            if (!this.db) return;

            const targetList = listElement ?? this.topRhythmsList;
            if (!targetList) return;

            const sortCategory = this.getBrowseCategory();
            const categoryLabel = this.formatCategoryLabel(sortCategory);
            targetList.innerHTML = `<div class="loading">Loading ${categoryLabel} Collections...</div>`;

            try {
                let query = this.db.collection('collections_rhythms');

                if (sortCategory) {
                    query = query.where('category', '==', sortCategory);
                }

                let snapshot;
                try {
                    snapshot = await query
                        .orderBy(`votes.${sortCategory}`, 'desc')
                        .limit(25)
                        .get();
                } catch (queryError) {
                    console.warn('Collections query falling back due to:', queryError);
                    snapshot = await this.db.collection('collections_rhythms')
                        .orderBy(`votes.${sortCategory}`, 'desc')
                        .limit(25)
                        .get();
                }

                if (snapshot.empty && sortCategory) {
                    snapshot = await this.db.collection('collections_rhythms')
                        .orderBy(`votes.${sortCategory}`, 'desc')
                        .limit(25)
                        .get();
                }

                if (snapshot.empty) {
                    targetList.innerHTML = `<div class="empty">No ${categoryLabel} rhythms submitted yet. Be the first!</div>`;
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
            const voteCounts = this.allowedCategories().reduce((acc, cat) => {
                acc[cat] = votes && typeof votes === 'object' ? votes[cat] || 0 : 0;
                return acc;
            }, {});
            const totalVotes = Object.values(voteCounts).reduce((sum, value) => sum + value, 0);
            const showVoteButtons = options.showVoteButtons === true;

            const voteBreakdown = this.allowedCategories().map((cat) => {
                return `<span class="vote-count">${this.formatCategoryLabel(cat)}: <strong>${voteCounts[cat]}</strong></span>`;
            }).join('');

            const voteButtonsHtml = showVoteButtons
                ? `<div class="collection-vote-buttons">${
                    this.allowedCategories().map((cat) => (
                        `<button class="vote-btn" data-doc="${docId}" data-category="${cat}">Vote ${this.formatCategoryLabel(cat)}</button>`
                    )).join('')
                }</div>`
                : '';

            const summaryHtml = `
                <div class="collection-meta">
                    <span>Fundamental: ${summary?.fundamental ?? '—'}</span>
                    <span>Range: ${summary?.range ?? '—'}</span>
                </div>
            `;

            return `
                <div class="collection-card" data-doc-id="${docId}">
                    <div class="collection-header">
                        <span class="collection-layers">${layerText}</span>
                        <button class="apply-collection" data-layers="${layers.join(',')}">Apply</button>
                    </div>
                    ${summaryHtml}
                    <div class="collection-votes">
                        <span class="total-votes">Votes: <strong>${totalVotes}</strong></span>
                        <span class="collection-category">${this.formatCategoryLabel(category)}</span>
                    </div>
                    <div class="collection-vote-breakdown">
                        ${voteBreakdown}
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
            const selected = this.categorySelect ? this.normalizeCategory(this.categorySelect.value) : null;
            return selected || this.defaultVoteCategory();
        }

        getBrowseCategory() {
            const selected = this.browseCategorySelect ? this.normalizeCategory(this.browseCategorySelect.value) : null;
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
