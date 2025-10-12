// Core Interface/CollectionsUI.js – Handles Collections panel interactions
(function () {
    var panel = document.getElementById('collections-panel');
    if (!panel) {
        return;
    }

    var submitStatus = document.getElementById('submit-status');
    var currentLayersEl = document.getElementById('current-layers');
    var voteRhythmsList = document.getElementById('vote-rhythms-list');
    var voteSubmitSection = document.querySelector('#vote-tab .vote-submit');
    var voteResultsSection = document.querySelector('#vote-tab .vote-results');

    // ---------------------------------------------------------------
    // Tab navigation
    // ---------------------------------------------------------------
    var manager = window.collectionsManager;
    var tabButtons = Array.prototype.slice.call(panel.querySelectorAll('.tab-button'));
    var tabContentMap = {};
    var initialTab = null;

    function activateTab(tabName) {
        if (!tabName || !tabContentMap[tabName]) {
            return;
        }

        tabButtons.forEach(function (button) {
            var buttonTab = button.getAttribute('data-tab');
            if (buttonTab === tabName) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });

        Object.keys(tabContentMap).forEach(function (key) {
            if (key === tabName) {
                tabContentMap[key].classList.add('active');
            } else {
                tabContentMap[key].classList.remove('active');
            }
        });

        if (tabName !== 'vote' && submitStatus) {
            submitStatus.textContent = '';
            submitStatus.className = 'status-message';
        }

        var showVote = tabName === 'vote';
        if (voteRhythmsList) {
            voteRhythmsList.style.display = showVote ? '' : 'none';
        }
        if (voteSubmitSection) {
            voteSubmitSection.style.display = showVote ? '' : 'none';
        }
        if (voteResultsSection) {
            voteResultsSection.style.display = showVote ? '' : 'none';
        }
    }

    tabButtons.forEach(function (button) {
        var tabName = button.getAttribute('data-tab');
        if (!tabName) {
            return;
        }

        var content = panel.querySelector('#' + tabName + '-tab');
        if (content) {
            tabContentMap[tabName] = content;
            if (button.classList.contains('active')) {
                initialTab = tabName;
            }
        }

        button.addEventListener('click', function () {
            activateTab(tabName);

            if (!manager || typeof manager.init !== 'function') {
                return;
            }

        var ensureLists = function () {
            if (tabName === 'browse' || tabName === 'vote') {
                manager.loadTopRhythms().catch(function (err) {
                    console.error('Failed to load Collections:', err);
                });
                manager.loadTopRhythms(manager.voteRhythmsList).catch(function (err) {
                    console.error('Failed to load vote list:', err);
                });
            }
        };

            if (manager.initialized) {
                ensureLists();
            } else {
                manager.init().then(function () {
                    ensureLists();
                }).catch(function (err) {
                    console.error('Collections manager init failed:', err);
                });
            }
        });
    });

    if (initialTab) {
        activateTab(initialTab);
    } else if (tabButtons.length > 0) {
        activateTab(tabButtons[0].getAttribute('data-tab'));
    }

    // ---------------------------------------------------------------
    // Current rhythm display helpers
    // ---------------------------------------------------------------
    function formatLayers(layers) {
        if (!Array.isArray(layers)) {
            return '—';
        }

        var cleaned = [];
        for (var i = 0; i < layers.length; i += 1) {
            var value = parseInt(layers[i], 10);
            if (!isNaN(value) && value > 0) {
                cleaned.push(value);
            }
        }

        return cleaned.length ? cleaned.join(':') : '—';
    }

    function updateCurrentLayersDisplay(layers) {
        if (!currentLayersEl) {
            return;
        }
        currentLayersEl.textContent = formatLayers(layers);
    }

    if (window.lrcModule && Array.isArray(window.lrcModule.currentRhythms)) {
        updateCurrentLayersDisplay(window.lrcModule.currentRhythms);
    }

    window.addEventListener('rhythmGenerated', function (event) {
        if (event && event.detail && Array.isArray(event.detail.rhythms)) {
            updateCurrentLayersDisplay(event.detail.rhythms);
        } else if (window.lrcModule && Array.isArray(window.lrcModule.currentRhythms)) {
            updateCurrentLayersDisplay(window.lrcModule.currentRhythms);
        }
    });

    var rhythmForm = document.getElementById('rhythm-form');
    if (rhythmForm && currentLayersEl) {
        var layerInputs = rhythmForm.querySelectorAll('input[type="number"]');
        Array.prototype.forEach.call(layerInputs, function (input) {
            input.addEventListener('input', function () {
                var values = [];
                Array.prototype.forEach.call(layerInputs, function (field) {
                    var val = parseInt(field.value, 10);
                    if (!isNaN(val) && val > 0) {
                        values.push(val);
                    }
                });

                if (values.length > 0) {
                    updateCurrentLayersDisplay(values);
                }
            });
        });
    }

    // ---------------------------------------------------------------
    // Action handlers (apply buttons)
    // ---------------------------------------------------------------
    panel.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || target.nodeType !== 1) {
            return;
        }

        if (target.classList.contains('apply-collection')) {
            var layerDataset = target.getAttribute('data-layers');
            if (layerDataset) {
                var layers = layerDataset.split(',').map(function (item) {
                    var value = parseInt(item, 10);
                    return !isNaN(value) && value > 0 ? value : null;
                }).filter(function (value) {
                    return value !== null;
                });

                if (layers.length && window.lrcSearch && typeof window.lrcSearch.applyResult === 'function') {
                    window.lrcSearch.applyResult(layers);
                }
            }
        }

        if (target.classList.contains('vote-btn')) {
            var docId = target.getAttribute('data-doc');
            var category = target.getAttribute('data-category');
            var manager = window.collectionsManager;
            if (!manager || typeof manager.voteStorageKey !== 'function') {
                return;
            }

            if (docId && category && typeof manager.registerVote === 'function') {
                var voteKey = manager.voteStorageKey(docId, category);
                if (window.localStorage && localStorage.getItem(voteKey)) {
                    target.disabled = true;
                    target.classList.add('voted');
                    return;
                }

                target.disabled = true;
                manager.registerVote(docId, category)
                    .then(function () {
                        target.classList.add('voted');
                        if (window.localStorage) {
                            localStorage.setItem(voteKey, String(Date.now()));
                        }
                        manager.loadTopRhythms().catch(function (err) {
                            console.error('Failed to refresh Collections after vote:', err);
                        });
                        manager.loadTopRhythms(manager.voteRhythmsList).catch(function (err) {
                            console.error('Failed to refresh vote list after vote:', err);
                        });
                    })
                    .catch(function (error) {
                        console.error('Vote failed:', error);
                        target.disabled = false;
                        target.classList.remove('voted');
                        if (window.localStorage) {
                            localStorage.removeItem(voteKey);
                        }
                    });
            }
        }

    });
})();
