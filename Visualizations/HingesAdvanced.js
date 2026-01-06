// HingesAdvanced.js - Advanced mappings for LRCHinges
// Implements: Symmetry-Driven (Mirror Sweep) and Nested-Ratio Anchors

(function(){
  class HingesAdvanced {
    constructor(hingesInstance) {
      this.hinges = hingesInstance;
      this.mode = 'off'; // 'off' | 'mirror' | 'anchors'
      this.originalUpdateRhythmicProgression = null;
      this._hookInstalled = false;
      this.originalUpdateHighlight = null;
      this.originalUpdatePhysics = null;
      this.anchorIndices = [];
      this.anchorCount = 6; // default number of anchor cue points
      this.overlays = {
        container: null,
        cycleGroup: null,
        cycleInput: null,
        forcesPanel: null,
        forcesHeader: null,
        layerRows: {},
        rightColumn: null,
        anchorsPanel: null,
        visibilityHandler: null
      };
      this.activeLayerForDirection = null; // which layer is awaiting arrow key direction

      // Anchors state
      this.anchors = {
        expansion: 0.0,
        layerLocks: { A: false, B: false, C: false, D: false },
        nestedOptions: [], // {key, rep, nodes: [nodeIndex]}
        nestedLocked: new Set(),
        pinnedNodes: new Set(),
        expandingActive: false,
        expandStepsRemaining: 0
      };
    }

    // Ensure overlays exist (rebuilt if previously cleaned up)
    ensureOverlaysBuilt() {
      const c = this.overlays?.container;
      if (!c || !c.isConnected) {
        try { buildOverlays(this); } catch (e) { console.warn('Rebuild overlays failed:', e); }
      }
    }

    setMode(mode) {
      if (!['off','mirror','anchors'].includes(mode)) mode = 'off';
      const prev = this.mode;
      // If selecting the same mode again, do not reset any Anchors state
      if (prev === mode) {
        return;
      }
      this.mode = mode;
      // Make sure overlays are present before updating visibility
      this.ensureOverlaysBuilt();
      if (mode === 'anchors') {
        this.refreshAnchors();
        // Apply default locks only once per anchors-entry unless user changed them
        if (!this.anchors.initialized) {
          const vals = window.lrcModule?.currentRhythms || [0,0,0,0];
          const letters = ['A','B','C','D'];
          letters.forEach((L,idx)=>{
            if ((vals[idx]||0)>1) this.anchors.layerLocks[L] = false;
          });
          this.computeNestedOptions();
          this.anchors.initialized = true;
        }
        this.applyPinnedNodes();
      } else {
        // Leaving Anchors: clear pins and mark uninitialized so defaults can apply next time
        if (prev === 'anchors') {
          this.anchors.pinnedNodes.clear();
          this.anchors.initialized = false;
          const h = this.hinges;
          if (h && h.nodes) { h.nodes.forEach(node => node.pinned = false); }
        }
      }
      // Reflect Anchors panel visibility in UI if overlays exist
      try {
        if (this.overlays && typeof this.overlays.updateAnchorsVisibility === 'function') {
          this.overlays.updateAnchorsVisibility();
        }
      } catch(e) { /* noop */ }
      
    }

    ensureHookInstalled() {
      if (this._hookInstalled) return;
      const h = this.hinges;
      if (!this.originalUpdateRhythmicProgression) {
        this.originalUpdateRhythmicProgression = h.updateRhythmicProgression.bind(h);
      }
      const self = this;
      h.updateRhythmicProgression = function() {
        if (this.advanced) {
          this.advanced.updateRhythmicProgressionAdvanced();
        } else {
          self.originalUpdateRhythmicProgression();
        }
      };
      if (!this.originalUpdateHighlight) {
        this.originalUpdateHighlight = h.updateHighlight.bind(h);
      }
      h.updateHighlight = function() {
        if (this.advanced) {
          this.advanced.updateHighlightAdvanced();
        } else {
          self.originalUpdateHighlight();
        }
      };
      // Also hook physics for Anchors expansion
      if (!this.originalUpdatePhysics) {
        this.originalUpdatePhysics = h.updatePhysics.bind(h);
      }
      h.updatePhysics = function() {
        if (this.advanced && this.advanced.shouldRunAnchorsExpansion()) {
          this.advanced.applyAnchorsExpansionStep();
          for (let i = 0; i < 12; i++) this.constrainSegments();
          return;
        }
        return self.originalUpdatePhysics ? self.originalUpdatePhysics() : undefined;
      };

      this._hookInstalled = true;
      
    }

    setAnchorCount(n) {
      const clamped = Math.max(1, Math.min(64, Math.floor(n)));
      this.anchorCount = clamped;
      this.refreshAnchors();
    }

    refreshAnchors() {
      try {
        const mapping = window.lrcModule?.currentSpacesMapping; // Map(fraction -> indices[])
        const ratios = window.lrcModule?.currentRatios; // [{fraction, frequency, ...}]
        if (!mapping || !ratios) {
          this.anchorIndices = [];
          return;
        }
        // Rank ratios by frequency (descending), exclude octave 2/1
        const ranked = [...ratios]
          .filter(r => r && r.fraction && r.fraction !== '2/1')
          .sort((a,b) => (b.frequency||0) - (a.frequency||0));

        const top = ranked.slice(0, this.anchorCount);
        const indices = new Set();
        top.forEach(r => {
          const arr = mapping.get(r.fraction) || [];
          arr.forEach(i => indices.add(i));
        });
        this.anchorIndices = [...indices].sort((a,b)=>a-b);
        
      } catch (e) {
        console.warn('HingesAdvanced.refreshAnchors error:', e);
        this.anchorIndices = [];
      }
    }

    // Replacement for updateRhythmicProgression with mode-specific logic
    updateRhythmicProgressionAdvanced() {
      const h = this.hinges;
      if (h.animationPhase !== 'settling' || !h.spacesPlot || h.spacesPlot.length === 0) {
        return;
      }

      const currentTime = Date.now();
      const elapsed = currentTime - h.rhythmStartTime;
      const cycleProgress = (elapsed % h.cycleDuration) / h.cycleDuration;
      const N = h.spacesPlot.length;
      const exactPosition = cycleProgress * N;
      h.currentRhythmPosition = exactPosition;
      const currentIndex = Math.floor(exactPosition);

      h.activeForceNodes.clear();

      if (this.mode === 'mirror') {
        // Activate symmetric pair around the center
        const center = (N - 1) / 2; // works for even/odd N
        const d = Math.abs(currentIndex - center);
        const i1 = Math.max(0, Math.min(N - 1, Math.round(center - d)));
        const i2 = Math.max(0, Math.min(N - 1, Math.round(center + d)));
        h.activeForceNodes.add(i1);
        h.activeForceNodes.add(i2);
      } else if (this.mode === 'anchors') {
        // Pause progression while holding Expand; otherwise normal progression
        if (!this.anchors.holdExpanding) {
          if (currentIndex < N) h.activeForceNodes.add(currentIndex);
        } else {
          h.activeForceNodes.clear();
        }
      } else {
        // Default behavior: single active index
        if (currentIndex < N) h.activeForceNodes.add(currentIndex);
      }
    }

    updateHighlightAdvanced() {
      const h = this.hinges;
      // Only highlight during settling when animating
      if (!h.isAnimating || h.segments.length === 0 || h.animationPhase !== 'settling') {
        h.currentHighlightPair = null;
        if (this.originalUpdateHighlight) this.originalUpdateHighlight();
        return;
      }

      if (this.mode === 'mirror') {
        const currentTime = Date.now();
        const cycleTime = currentTime - h.rhythmStartTime;
        const progress = (cycleTime % h.cycleDuration) / h.cycleDuration;

        const N = h.segments.length;
        if (N <= 0) return;

        // Triangle bounce from ends -> center -> ends
        // m in [0, N-1], where (0, N-1) are ends and N/2 is center
        const m = Math.floor(Math.abs(2 * progress - 1) * (N - 1));
        const i1 = Math.max(0, Math.min(N - 1, m));
        const i2 = Math.max(0, Math.min(N - 1, (N - 1) - m));

        h.currentHighlight = -1; // disable single index
        if (i1 === i2) {
          h.currentHighlightPair = [i1]; // center case (odd length)
        } else {
          h.currentHighlightPair = [i1, i2];
        }
      } else {
        // Other modes use default highlighting for now
        h.currentHighlightPair = null;
        if (this.originalUpdateHighlight) this.originalUpdateHighlight();
      }
    }

    // ===== Anchors helpers =====
    shouldRunAnchorsExpansion() {
      const h = this.hinges;
      return this.mode === 'anchors' && (this.anchors.expandingActive || this.anchors.holdExpanding) && h.isAnimating;
    }

    // Manual, hold-to-expand behavior
    beginHoldExpansion() {
      const h = this.hinges;
      if (this.anchors.holdExpanding) return;
      this.anchors.holdExpanding = true;
      // Save physics and stiffen slightly for expansion stability
      this._saved = this._saved || { tension: h.tensionStrength, damping: h.damping };
      h.tensionStrength = 0.8;
      h.damping = 0.985;
    }

    endHoldExpansion() {
      const h = this.hinges;
      if (!this.anchors.holdExpanding) return;
      this.anchors.holdExpanding = false;
      // Restore physics
      if (this._saved) {
        h.tensionStrength = this._saved.tension;
        h.damping = this._saved.damping;
        this._saved = null;
      }
      // Resume rhythm progression clock
      h.rhythmStartTime = Date.now();
    }

    applyAnchorsExpansionStep() {
      const h = this.hinges;
      // If running finite pre-expansion, count down; if holding, run indefinitely
      if (!this.anchors.holdExpanding) {
        if (this.anchors.expandStepsRemaining <= 0) {
          this.anchors.expandingActive = false;
          if (this._saved) {
            h.tensionStrength = this._saved.tension;
            h.damping = this._saved.damping;
            this._saved = null;
          }
          this.applyPinnedNodes();
          h.rhythmStartTime = Date.now();
          return;
        }
        this.anchors.expandStepsRemaining--;
      }
      // centroid
      let cx = 0, cy = 0; const n = h.nodes.length;
      for (let i = 0; i < n; i++) { cx += h.nodes[i].x; cy += h.nodes[i].y; }
      cx /= n; cy /= n;
      const push = 0.6;
      for (let i = 0; i < n; i++) {
        const node = h.nodes[i];
        const vx = node.x - cx, vy = node.y - cy;
        const len = Math.hypot(vx, vy) || 1;
        const nx = vx / len, ny = vy / len;
        const tempX = node.x, tempY = node.y;
        let velX = (node.x - node.oldX) * h.damping;
        let velY = (node.y - node.oldY) * h.damping;
        velX += nx * push; velY += ny * push;
        node.x += velX; node.y += velY;
        node.oldX = tempX; node.oldY = tempY;
      }
      // For hold mode, we don't decrement; sustained outward push while held
    }

    applyPinnedNodes() {
      const h = this.hinges;
      const pins = new Set();
      const layerMap = window.lrcModule?.currentLayerMap || [];
      const letters = ['A','B','C','D'];
      // layer locks
      letters.forEach((L, idx) => {
        const val = window.lrcModule?.currentRhythms?.[idx] || 0;
        if (val <= 1) return;
        if (this.anchors.layerLocks[L]) {
          for (let i = 0; i < layerMap.length; i++) {
            const layersAt = layerMap[i] || [];
            if (layersAt.includes(L)) pins.add(i + 1); // node index = comp idx + 1
          }
        }
      });
      // nested locks
      for (const key of this.anchors.nestedLocked) {
        const opt = this.anchors.nestedOptions.find(o => o.key === key);
        if (opt && Array.isArray(opt.nodes)) opt.nodes.forEach(idx => pins.add(idx));
      }
      this.anchors.pinnedNodes = pins;
      for (let i = 0; i < h.nodes.length; i++) {
        h.nodes[i].pinned = pins.has(i);
      }
    }

    computeNestedOptions() {
      const mod = window.lrcModule;
      if (!mod) { this.anchors.nestedOptions = []; return []; }
      const values = mod.currentRhythms || [0,0,0,0];
      const grid = mod.currentGrid || 0;
      const comp = mod.currentCompositeRhythm || [];
      const letters = ['A','B','C','D'];
      const act = letters.map((L,i)=>({L, v: values[i]})).filter(x=>x.v>1);
      const n = act.length;
      const gcd = (a,b)=>{ a=Math.abs(a); b=Math.abs(b); while(b){ [a,b]=[b,a%b]; } return a; };
      const gcdArr = arr => arr.reduce((acc,x)=>gcd(acc,x));
      const uniq = new Map();
      for (let mask=1; mask < (1<<n); mask++) {
        const bits = mask.toString(2).split('').reduce((s,ch)=>s+(ch==='1'),0);
        if (bits < 2) continue;
        const tuple = [];
        const vals = [];
        for (let k=0;k<n;k++) if (mask & (1<<k)) { tuple.push(act[k].L); vals.push(act[k].v); }
        const rep = gcdArr(vals);
        if (rep > 1) {
          const key = tuple.join(':');
          if (!uniq.has(key)) uniq.set(key, {tuple, rep});
        }
      }
      const options = [];
      for (const {tuple, rep} of uniq.values()) {
        const step = grid / rep;
        const nodes = [];
        for (let k=0;k<rep;k++) {
          const pos = k * step;
          const ci = comp.indexOf(pos);
          if (ci >= 0) nodes.push(ci + 1);
        }
        options.push({ key: `${tuple.join(':')}`, rep, nodes });
      }
      this.anchors.nestedOptions = options;
      return options;
    }
  }

  // No-op UI injection; HUD now provides Mode selector
  function injectAdvancedControls() {}

  function integrateHingesAdvanced() {
    const hinges = window.lrcVisuals?.plotTypes?.['hinges'];
    if (!hinges) {
      console.error('HingesAdvanced: Hinges instance not found');
      return;
    }

    // Attach advanced controller
    const advanced = new HingesAdvanced(hinges);
    hinges.advanced = advanced;

    // Override rhythmic progression function
    advanced.ensureHookInstalled();

    // Ensure post-link behaviors after initial end-to-end linkage
    if (!hinges._advancedWrappedComplete) {
      const originalComplete = hinges.completeConnection?.bind(hinges);
      if (originalComplete) {
        hinges.completeConnection = function() {
          originalComplete();
          // If mode is tension, switch to expansion mode after linking
          if (this.advanced && this.advanced.mode === 'tension' && this.expansion) {
            this.expansion.enterExpansionMode();
          }
          // Anchors no longer auto-expands post-link; user holds Expand button
        };
        hinges._advancedWrappedComplete = true;
      }
    }

    // Re-assert hook on startAnimation
    if (!hinges._advancedWrappedStart) {
      const originalStart = hinges.startAnimation.bind(hinges);
      hinges.startAnimation = function() {
        if (this.advanced) this.advanced.ensureHookInstalled();
        return originalStart();
      };
      hinges._advancedWrappedStart = true;
    }

    // No UI injected here; HUD controls handle mode selection

    // Enable local clock; user Cycle (s) controls Hinges independently
    hinges.useLocalClock = true;

    // Build overlays atop the visualization canvas
    try { buildOverlays(advanced); } catch(e) { console.warn('HingesAdvanced overlay error:', e); }
  }

  // Auto-integration when DOM and LRCVisuals are ready
  if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      // Wait for Hinges integration to complete
      const start = Date.now();
      const check = setInterval(() => {
        if (window.lrcVisuals?.plotTypes?.['hinges']) {
          clearInterval(check);
          integrateHingesAdvanced();
        } else if (Date.now() - start > 6000) {
          clearInterval(check);
          console.warn('HingesAdvanced: Hinges not available after timeout');
        }
      }, 100);
    });
  }

  // ============= Overlays (UI over canvas) =============
  function buildOverlays(adv) {
    const h = adv.hinges;
    const canvas = h.parent?.canvas;
    if (!canvas || !canvas.parentElement) return;

    const parent = canvas.parentElement;
    // Ensure parent can anchor overlays
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none'; // allow canvas interactions through by default
    container.style.zIndex = '2';

    // Cycle group (top-left)
    const cycleGroup = document.createElement('div');
    cycleGroup.style.position = 'absolute';
    cycleGroup.style.left = '8px';
    cycleGroup.style.top = '4px';
    cycleGroup.style.background = 'rgba(0,0,0,0.45)';
    cycleGroup.style.border = '1px solid var(--hud-border)';
    cycleGroup.style.borderRadius = '4px';
    cycleGroup.style.padding = '4px 6px';
    cycleGroup.style.color = 'var(--hud-text)';
    cycleGroup.style.fontSize = '11px';
    cycleGroup.style.pointerEvents = 'auto';

    const cycleLabel = document.createElement('label');
    cycleLabel.textContent = 'Cycle (s):';
    cycleLabel.style.marginRight = '6px';

    const cycleInput = document.createElement('input');
    cycleInput.type = 'number';
    cycleInput.min = '0.25';
    cycleInput.step = '0.25';
    cycleInput.value = Math.max(0.25, Math.round((h.cycleDuration/1000) * 100) / 100);
    cycleInput.style.width = '60px';
    cycleInput.style.background = 'rgba(255,255,255,0.1)';
    cycleInput.style.border = '1px solid var(--hud-border)';
    cycleInput.style.color = 'var(--hud-text)';
    cycleInput.style.borderRadius = '3px';
    cycleInput.style.padding = '2px 4px';

    cycleInput.addEventListener('change', () => {
      let s = parseFloat(cycleInput.value);
      if (isNaN(s) || s <= 0) s = 1;
      h.cycleDuration = s * 1000;
      h.useLocalClock = true;
    });

    // Amplitude slider (HTML) for consistent styling
    const ampWrap = document.createElement('div');
    ampWrap.style.display = 'flex';
    ampWrap.style.alignItems = 'center';
    ampWrap.style.gap = '6px';
    ampWrap.style.marginTop = '4px';

    const ampLabel = document.createElement('span');
    ampLabel.textContent = 'Amplitude:';
    ampLabel.style.color = 'var(--hud-text)';

    const ampInput = document.createElement('input');
    ampInput.type = 'range';
    ampInput.min = '0.1';
    ampInput.max = '100';
    ampInput.step = '0.1';
    ampInput.value = String(h.forceAmplitude || 1.0);
    ampInput.style.width = '140px';

    const ampVal = document.createElement('span');
    ampVal.style.minWidth = '42px';
    ampVal.style.textAlign = 'right';
    ampVal.style.color = 'var(--hud-text)';
    const fmtAmp = (v) => `${Number(v).toFixed(2)}x`;
    ampVal.textContent = fmtAmp(ampInput.value);

    ampInput.addEventListener('input', () => {
      const val = parseFloat(ampInput.value);
      if (!isNaN(val)) {
        h.forceAmplitude = val;
        h.calculateLayerForces();
        if (typeof h.applyImmediateForceUpdate === 'function') h.applyImmediateForceUpdate();
      }
      ampVal.textContent = fmtAmp(ampInput.value);
    });

    cycleGroup.appendChild(cycleLabel);
    cycleGroup.appendChild(cycleInput);
    ampWrap.appendChild(ampLabel);
    ampWrap.appendChild(ampInput);
    ampWrap.appendChild(ampVal);
    cycleGroup.appendChild(ampWrap);

    // Right column container (top-right)
    const rightCol = document.createElement('div');
    rightCol.style.position = 'absolute';
    rightCol.style.right = '8px';
    rightCol.style.top = '4px';
    rightCol.style.display = 'flex';
    rightCol.style.flexDirection = 'column';
    rightCol.style.gap = '8px';
    rightCol.style.pointerEvents = 'auto';

    // Layer Forces panel
    const panel = document.createElement('div');
    panel.style.background = 'rgba(0,0,0,0.45)';
    panel.style.border = '1px solid var(--hud-border)';
    panel.style.borderRadius = '4px';
    panel.style.color = 'var(--hud-text)';
    panel.style.minWidth = '160px';
    panel.style.pointerEvents = 'auto';

    const header = document.createElement('div');
    header.textContent = 'Layer Forces';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.fontSize = '12px';
    header.style.padding = '6px 8px';
    header.style.borderBottom = '1px solid var(--hud-border)';

    const minimizeBtn = document.createElement('button');
    minimizeBtn.textContent = '−';
    minimizeBtn.style.background = 'transparent';
    minimizeBtn.style.border = '1px solid var(--hud-border)';
    minimizeBtn.style.color = 'var(--hud-text)';
    minimizeBtn.style.borderRadius = '3px';
    minimizeBtn.style.fontSize = '12px';
    minimizeBtn.style.width = '22px';
    minimizeBtn.style.height = '22px';
    minimizeBtn.style.cursor = 'pointer';

    const body = document.createElement('div');
    body.style.display = 'block';
    body.style.padding = '6px 8px';
    body.style.fontSize = '11px';
    body.style.userSelect = 'none';

    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (body.style.display === 'none') {
        body.style.display = 'block';
        minimizeBtn.textContent = '−';
      } else {
        body.style.display = 'none';
        minimizeBtn.textContent = '+';
      }
    });

    header.appendChild(minimizeBtn);
    panel.appendChild(header);
    panel.appendChild(body);

    // Build rows for active layers (exclude rhythm value = 1)
    function getActiveLayers() {
      const rhythms = window.lrcModule?.currentRhythms || [1,1,1,1];
      const letters = ['A','B','C','D'];
      return letters.filter((L, idx) => (rhythms[idx] || 0) > 1);
    }

    function dirArrowFor(rad) {
      const dirs = [0, Math.PI/2, Math.PI, 3*Math.PI/2];
      const syms = ['→','↓','←','↑']; // Canvas coords: PI/2=down, 3*PI/2=up
      let best = 0, bestDiff = Infinity;
      for (let i=0;i<dirs.length;i++) {
        const d = Math.abs(Math.atan2(Math.sin(rad - dirs[i]), Math.cos(rad - dirs[i])));
        if (d < bestDiff) { bestDiff = d; best = i; }
      }
      return syms[best];
    }

    function rebuildRows() {
      body.innerHTML = '';
      adv.overlays.layerRows = {};
      const active = getActiveLayers();
      active.forEach(L => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.gap = '8px';
        row.style.margin = '4px 0';

        const label = document.createElement('span');
        label.textContent = `Layer ${L}`;
        label.style.color = 'var(--hud-text-muted)';

        const arrowBtn = document.createElement('button');
        arrowBtn.style.background = 'rgba(255,255,255,0.1)';
        arrowBtn.style.border = '1px solid var(--hud-border)';
        arrowBtn.style.color = 'var(--hud-text)';
        arrowBtn.style.borderRadius = '3px';
        arrowBtn.style.fontSize = '13px';
        arrowBtn.style.width = '28px';
        arrowBtn.style.height = '22px';
        arrowBtn.style.cursor = 'pointer';
        arrowBtn.title = 'Click, then press arrow key to set direction';

        // Default directions if not yet set
        const defaults = { A: 0, B: 3*Math.PI/2, C: Math.PI, D: Math.PI/2 };
        const rad = (h.layerDirections && typeof h.layerDirections[L] === 'number') ? h.layerDirections[L] : defaults[L];
        arrowBtn.textContent = dirArrowFor(rad);

        arrowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          adv.activeLayerForDirection = L;
          arrowBtn.focus();
        });

        row.appendChild(label);
        row.appendChild(arrowBtn);
        body.appendChild(row);
        adv.overlays.layerRows[L] = { row, arrowBtn };
      });
    }

    function handleKey(e) {
      if (!adv.activeLayerForDirection) return;
      const L = adv.activeLayerForDirection;
      let set = null;
      if (e.key === 'ArrowRight') set = 0;
      else if (e.key === 'ArrowUp') set = 3*Math.PI/2; // Up = negative Y in canvas coords
      else if (e.key === 'ArrowLeft') set = Math.PI;
      else if (e.key === 'ArrowDown') set = Math.PI/2; // Down = positive Y in canvas coords
      if (set === null) return;
      e.preventDefault();
      if (!h.layerDirections) h.layerDirections = {};
      h.layerDirections[L] = set;
      // Recalculate and apply immediately
      h.calculateLayerForces();
      if (typeof h.applyImmediateForceUpdate === 'function') h.applyImmediateForceUpdate();
      const ui = adv.overlays.layerRows[L];
      if (ui && ui.arrowBtn) ui.arrowBtn.textContent = dirArrowFor(set);
      adv.activeLayerForDirection = null;
    }

    rebuildRows();
    document.addEventListener('keydown', handleKey);

    // Anchors panel (below Layer Forces)
    // Force default lock state on initial build
    const initVals = window.lrcModule?.currentRhythms || [0,0,0,0];
    ['A','B','C','D'].forEach((L, idx) => {
      if ((initVals[idx] || 0) > 1) {
        adv.anchors.layerLocks[L] = true;
      }
    });

    const anchorsPanel = document.createElement('div');
    anchorsPanel.style.background = 'rgba(0,0,0,0.45)';
    anchorsPanel.style.border = '1px solid var(--hud-border)';
    anchorsPanel.style.borderRadius = '4px';
    anchorsPanel.style.color = 'var(--hud-text)';
    anchorsPanel.style.minWidth = '200px';
    anchorsPanel.style.pointerEvents = 'auto';

    const aHeader = document.createElement('div');
    aHeader.textContent = 'Anchors';
    aHeader.style.display = 'flex';
    aHeader.style.justifyContent = 'space-between';
    aHeader.style.alignItems = 'center';
    aHeader.style.fontSize = '12px';
    aHeader.style.padding = '6px 8px';
    aHeader.style.borderBottom = '1px solid var(--hud-border)';

    const aMinimize = document.createElement('button');
    aMinimize.textContent = '−';
    aMinimize.style.background = 'transparent';
    aMinimize.style.border = '1px solid var(--hud-border)';
    aMinimize.style.color = 'var(--hud-text)';
    aMinimize.style.borderRadius = '3px';
    aMinimize.style.fontSize = '12px';
    aMinimize.style.width = '22px';
    aMinimize.style.height = '22px';
    aMinimize.style.cursor = 'pointer';

    const aBody = document.createElement('div');
    aBody.style.display = 'block';
    aBody.style.padding = '6px 8px';
    aBody.style.fontSize = '11px';
    aBody.style.userSelect = 'none';

    aMinimize.addEventListener('click', (e) => {
      e.stopPropagation();
      if (aBody.style.display === 'none') {
        aBody.style.display = 'block';
        aMinimize.textContent = '−';
      } else {
        aBody.style.display = 'none';
        aMinimize.textContent = '+';
      }
    });

    aHeader.appendChild(aMinimize);
    anchorsPanel.appendChild(aHeader);
    anchorsPanel.appendChild(aBody);

    // Anchors content
    // Expand button (hold to expand)
    const expRow = document.createElement('div');
    expRow.style.display = 'flex';
    expRow.style.alignItems = 'center';
    expRow.style.gap = '8px';
    expRow.style.margin = '4px 0 8px 0';
    const expBtn = document.createElement('button');
    expBtn.textContent = 'Expand';
    expBtn.style.background = 'rgba(255,255,255,0.1)';
    expBtn.style.border = '1px solid var(--hud-border)';
    expBtn.style.color = 'var(--hud-text)';
    expBtn.style.borderRadius = '3px';
    expBtn.style.fontSize = '11px';
    expBtn.style.padding = '4px 10px';
    expBtn.style.cursor = 'pointer';

    const updateExpBtnStyle = () => {
      if (adv.anchors.holdExpanding) {
        expBtn.style.background = 'var(--hud-accent)';
        expBtn.style.color = '#000';
      } else {
        expBtn.style.background = 'rgba(255,255,255,0.1)';
        expBtn.style.color = 'var(--hud-text)';
      }
    };
    expBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (adv.anchors.holdExpanding) {
        adv.endHoldExpansion();
      } else {
        adv.beginHoldExpansion();
      }
      updateExpBtnStyle();
    });
    updateExpBtnStyle();

    expRow.appendChild(expBtn);
    aBody.appendChild(expRow);

    // Layer Locks section
    const llHeader = document.createElement('div'); llHeader.textContent = 'Layer Locks'; llHeader.style.marginTop='6px'; llHeader.style.color='var(--hud-text)'; llHeader.style.opacity='0.9';
    aBody.appendChild(llHeader);
    const llWrap = document.createElement('div'); llWrap.style.display='flex'; llWrap.style.flexDirection='column'; llWrap.style.gap='4px'; aBody.appendChild(llWrap);

    function rebuildLayerLocks(){
      llWrap.innerHTML = '';
      const vals = window.lrcModule?.currentRhythms || [0,0,0,0];
      const letters = ['A','B','C','D'];
      letters.forEach((L,idx)=>{
        if ((vals[idx]||0) <= 1) return;
        const row = document.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.justifyContent='space-between';
        const name = document.createElement('span'); name.textContent = `Layer ${L}`; name.style.color='var(--hud-text-muted)';
        const btn = document.createElement('button');
        btn.style.background = 'rgba(255,255,255,0.1)'; btn.style.border='1px solid var(--hud-border)'; btn.style.color='var(--hud-text)'; btn.style.borderRadius='3px'; btn.style.fontSize='11px'; btn.style.padding='2px 8px'; btn.style.cursor='pointer';
        const ensureDefaultLock = () => {
          if (typeof adv.anchors.layerLocks[L] === 'undefined') {
            adv.anchors.layerLocks[L] = false;
          }
        };
        ensureDefaultLock();
        const syncBtnText = ()=> { btn.textContent = adv.anchors.layerLocks[L] ? 'Unlock' : 'Lock'; };
        syncBtnText();
        btn.addEventListener('click', ()=>{ adv.anchors.layerLocks[L] = !adv.anchors.layerLocks[L]; syncBtnText(); adv.applyPinnedNodes(); });
        row.appendChild(name); row.appendChild(btn); llWrap.appendChild(row);
      });
    }
    rebuildLayerLocks();

    // Nested Ratios section
    const nrHeader = document.createElement('div'); nrHeader.textContent = 'Nested Ratios'; nrHeader.style.marginTop='8px'; nrHeader.style.color='var(--hud-text)'; nrHeader.style.opacity='0.9';
    aBody.appendChild(nrHeader);
    const nrWrap = document.createElement('div'); nrWrap.style.display='flex'; nrWrap.style.flexDirection='column'; nrWrap.style.gap='4px'; aBody.appendChild(nrWrap);

    function rebuildNested(){
      nrWrap.innerHTML = '';
      const opts = adv.computeNestedOptions();
      opts.forEach(o => {
        const row = document.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.justifyContent='space-between';
        const label = document.createElement('span'); label.textContent = `${o.key} (${o.rep}x)`; label.style.color='var(--hud-text-muted)';
        const btn = document.createElement('button');
        btn.style.background = 'rgba(255,255,255,0.1)'; btn.style.border='1px solid var(--hud-border)'; btn.style.color='var(--hud-text)'; btn.style.borderRadius='3px'; btn.style.fontSize='11px'; btn.style.padding='2px 8px'; btn.style.cursor='pointer';
        const sync = ()=>{ btn.textContent = adv.anchors.nestedLocked.has(o.key) ? 'Unlock' : 'Lock'; };
        sync();
        btn.addEventListener('click', ()=>{ if (adv.anchors.nestedLocked.has(o.key)) adv.anchors.nestedLocked.delete(o.key); else adv.anchors.nestedLocked.add(o.key); sync(); adv.applyPinnedNodes(); });
        row.appendChild(label); row.appendChild(btn); nrWrap.appendChild(row);
      });
    }
    rebuildNested();

    // Respond to new rhythm generations after UI is fully initialized
    const onRhythmGenerated = () => {
      adv.anchors.layerLocks = { A: false, B: false, C: false, D: false };
      rebuildRows();
      rebuildLayerLocks();
      rebuildNested();
    };
    window.addEventListener('rhythmGenerated', onRhythmGenerated);

    // Assemble and mount overlays
    rightCol.appendChild(panel);
    rightCol.appendChild(anchorsPanel);
    container.appendChild(cycleGroup);
    container.appendChild(rightCol);
    parent.appendChild(container);

    // Nudge the in-canvas amplitude slider down a bit to avoid overlap
    h.overlayTopOffset = 26;
    // Use overlay amplitude control, hide canvas-drawn slider
    h.useOverlayAmplitude = true;

    // Save refs for cleanup
    adv.overlays.container = container;
    adv.overlays.cycleGroup = cycleGroup;
    adv.overlays.cycleInput = cycleInput;
    adv.overlays.forcesPanel = panel;
    adv.overlays.forcesHeader = header;
    adv.overlays.rightColumn = rightCol;
    adv.overlays.anchorsPanel = anchorsPanel;
    // Helper to toggle Anchors panel visibility based on current mode
    adv.overlays.updateAnchorsVisibility = function() {
      try {
        anchorsPanel.style.display = (adv.mode === 'anchors') ? 'block' : 'none';
      } catch(e) {}
      if (adv.mode !== 'anchors') {
        adv.anchors.layerLocks = { A: false, B: false, C: false, D: false };
      }
    };
    // Initialize visibility
    if (typeof adv.overlays.updateAnchorsVisibility === 'function') {
      adv.overlays.updateAnchorsVisibility();
    }

    // Cleanup on deactivate or page teardown
    const cleanup = (preserveListener = false) => {
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('rhythmGenerated', onRhythmGenerated);
      if (!preserveListener && adv.overlays?.visibilityHandler) {
        window.removeEventListener('vizTypeChanged', adv.overlays.visibilityHandler);
      }
      try { container.remove(); } catch {}
      h.overlayTopOffset = 0;
      // Keep overlay amplitude mode enabled so legacy in-canvas slider stays hidden
      h.useOverlayAmplitude = true;
      const handler = preserveListener ? adv.overlays.visibilityHandler : null;
      adv.overlays = { 
        container:null, 
        cycleGroup:null, 
        cycleInput:null, 
        forcesPanel:null, 
        forcesHeader:null, 
        layerRows:{}, 
        rightColumn:null, 
        anchorsPanel:null,
        visibilityHandler: handler
      };
    };
    adv.cleanupOverlays = cleanup;

    // Wrap hinges.deactivate once to clean overlays
    if (!h._advancedWrappedDeactivate) {
      const originalDeactivate = h.deactivate?.bind(h);
      h.deactivate = function() {
        cleanup();
        if (originalDeactivate) originalDeactivate();
      };
      h._advancedWrappedDeactivate = true;
    }

    // Hide/show overlays based on plot type selection
    const plotTypeSelect = document.getElementById('viz-type-selector');
    const updateOverlayVisibility = () => {
      const isHinges = window.lrcVisuals?.currentPlotType === 'hinges';
      // If switching to Hinges and overlays were cleaned up, rebuild them
      if (isHinges && (!adv.overlays.container || !adv.overlays.container.isConnected)) {
        try { buildOverlays(adv); } catch(e) { console.warn('Overlay rebuild on viz change failed:', e); }
        return; // buildOverlays will set up its own listeners/visibility
      }
      if (!isHinges) {
        if (typeof adv.cleanupOverlays === 'function') {
          adv.cleanupOverlays(true);
        } else if (adv.overlays.container) {
          adv.overlays.container.style.display = 'none';
        }
        return;
      }
      const c = adv.overlays.container;
      if (c) c.style.display = 'block';
      // Also refresh Anchors panel visibility when returning to Hinges
      if (typeof adv.overlays.updateAnchorsVisibility === 'function') {
        adv.overlays.updateAnchorsVisibility();
      }
    };
    if (plotTypeSelect) {
      plotTypeSelect.addEventListener('change', updateOverlayVisibility);
    }
    window.addEventListener('vizTypeChanged', updateOverlayVisibility);
    adv.overlays.visibilityHandler = updateOverlayVisibility;
    updateOverlayVisibility();
  }
})();
