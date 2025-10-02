// LRC WORLD MAPS

let currentGrid = 0;

// Core LRC arithmetic ported from original script
        class PolyrhythmCalculator {
            constructor() {
                this.ratioFrequencies = new Map();
            }
            
            // Calculate LCM of multiple numbers
            lcm(...args) {
                const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
                const lcm2 = (a, b) => (a * b) / gcd(a, b);
                return args.reduce(lcm2);
            }
            
            // Generate composite rhythm from layers with complete layer tracking
            generateCompositeRhythm(layers) {
                const filteredLayers = layers.filter(layer => layer > 0);
                if (filteredLayers.length === 0) return [];
                
                const totalLCM = this.lcm(...filteredLayers);
                const compositeMap = new Map(); // Track ALL layers for each position
                const layerNames = ['A', 'B', 'C', 'D'];
                
                // Add all multiples for each layer, accumulating layer IDs for each position
                layers.forEach((layer, layerIndex) => {
                    if (layer > 0) {
                        const groupingSize = totalLCM / layer;
                        for (let i = 0; i < layer; i++) {
                            const position = i * groupingSize;
                            
                            if (compositeMap.has(position)) {
                                // Add this layer to existing position
                                compositeMap.get(position).layers.push(layerNames[layerIndex]);
                            } else {
                                // Create new position with this layer
                                compositeMap.set(position, {
                                    position: position,
                                    layers: [layerNames[layerIndex]]
                                });
                            }
                        }
                    }
                });
                
                // Sort by position and store complete layer tracking info
                const sortedEntries = Array.from(compositeMap.values()).sort((a, b) => a.position - b.position);
                this.currentCompositeLayerMap = sortedEntries;
                
                return sortedEntries.map(entry => entry.position);
            }

            // Generate spaces plot with deterministic layer inheritance
            generateSpacesPlot(compositeRhythm, totalLCM, layers = []) {
                if (compositeRhythm.length === 0) return [];
                
                const spacesPlot = [];
                const spacesLayerMap = [];
                
                // Use the complete layer mapping from composite rhythm generation
                const compositeLayerMap = this.currentCompositeLayerMap || [];
                
                // Calculate spaces between consecutive values
                for (let i = 0; i < compositeRhythm.length - 1; i++) {
                    const currentValue = compositeRhythm[i];
                    const nextValue = compositeRhythm[i + 1];
                    const spaceValue = nextValue - currentValue;
                    
                    spacesPlot.push(spaceValue);
                    
                    // The space/duration is owned by whichever layer(s) generate the CURRENT attack point
                    // (the attack that STARTS this duration)
                    const currentEntry = compositeLayerMap[i];
                    const spaceLayers = currentEntry ? currentEntry.layers : ['Composite'];
                    
                    spacesLayerMap.push(spaceLayers);
                }

                // Add wraparound space
                const lastValue = compositeRhythm[compositeRhythm.length - 1];
                const firstValue = compositeRhythm[0];
                const wraparoundSpace = totalLCM - lastValue + firstValue;
                spacesPlot.push(wraparoundSpace);

                // Wraparound space is owned by the last attack (which starts the wraparound duration)
                const lastEntry = compositeLayerMap[compositeLayerMap.length - 1];
                const wraparoundLayers = lastEntry ? lastEntry.layers : ['Composite'];
                spacesLayerMap.push(wraparoundLayers);
                
                // Store the layer mapping globally for landmark generation
                this.currentSpacesLayerMap = spacesLayerMap;

                return spacesPlot;
            }
            
            // Convert spaces plot to ratios with frequency tracking (clean counting)
            generateRatiosWithFrequency(spacesPlot) {
                if (spacesPlot.length === 0) return { ratios: [], frequencies: new Map() };
                
                // Reset frequency tracking
                this.ratioFrequencies.clear();
                
                const fundamental = Math.max(...spacesPlot);
                const ratioMap = new Map();
                
                // Single pass through spaces plot - count frequency AND sum grid occupation
                spacesPlot.forEach(space => {
                    if (space > 0) {
                        // Convert space to ratio and compress to single octave
                        let ratio = fundamental / space;
                        while (ratio >= 2) ratio /= 2;
                        while (ratio < 1) ratio *= 2;
                        
                        const fraction = this.decimalToFraction(ratio);
                        
                        // Track both frequency count and grid occupation sum
                        if (ratioMap.has(fraction)) {
                            const existing = ratioMap.get(fraction);
                            existing.frequency++;
                            existing.gridOccupation += space; // Add the space value
                        } else {
                            ratioMap.set(fraction, {
                                ratio: ratio,
                                fraction: fraction,
                                cents: this.ratioToCents(ratio),
                                frequency: 1,
                                gridOccupation: space // Initialize with first space value
                            });
                        }
                    }
                });
                
                // Store final frequencies
                ratioMap.forEach((ratioData, fraction) => {
                    this.ratioFrequencies.set(fraction, ratioData.frequency);
                });
                
                return {
                    ratios: Array.from(ratioMap.values()).sort((a, b) => a.ratio - b.ratio),
                    frequencies: this.ratioFrequencies
                };
            }
            
            // Count how many times a ratio appears (including octave equivalents)
            countRatioFrequency(spacesPlot, targetSpace, fundamental) {
                let count = 0;
                const targetRatio = fundamental / targetSpace;
                
                spacesPlot.forEach(space => {
                    if (space > 0) {
                        let ratio = fundamental / space;
                        
                        // Check if this ratio is an octave equivalent of our target
                        let testRatio = ratio;
                        while (testRatio >= 2) testRatio /= 2;
                        while (testRatio < 1) testRatio *= 2;
                        
                        let targetTestRatio = targetRatio;
                        while (targetTestRatio >= 2) targetTestRatio /= 2;
                        while (targetTestRatio < 1) targetTestRatio *= 2;
                        
                        if (Math.abs(testRatio - targetTestRatio) < 0.0001) {
                            count++;
                        }
                    }
                });
                
                return count;
            }
            
            // Convert decimal to fraction
            decimalToFraction(decimal) {
                const tolerance = 1e-6;
                let numerator = 1;
                let denominator = 1;
                let minError = Math.abs(decimal - 1);
                
                for (let d = 1; d <= 1000; d++) {
                    const n = Math.round(decimal * d);
                    const error = Math.abs(decimal - n/d);
                    
                    if (error < minError) {
                        minError = error;
                        numerator = n;
                        denominator = d;
                        
                        if (error < tolerance) break;
                    }
                }
                
                // Simplify fraction
                const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
                const commonDivisor = gcd(numerator, denominator);
                
                return `${numerator / commonDivisor}/${denominator / commonDivisor}`;
            }
            
            // Convert ratio to cents
            ratioToCents(ratio) {
                return Math.log2(ratio) * 1200;
            }
        }
        
        // Global calculator instance
        const calculator = new PolyrhythmCalculator();
        let currentSpacesPlot = [];
        let currentRatios = [];
        
        // Main generation function
        function generateMapping() {
            const layerA = parseInt(document.getElementById('layerA').value) || 0;
            const layerB = parseInt(document.getElementById('layerB').value) || 0;
            const layerC = parseInt(document.getElementById('layerC').value) || 0;
            const layerD = parseInt(document.getElementById('layerD').value) || 0;
            
            const layers = [layerA, layerB, layerC, layerD].filter(l => l > 0);
            
            if (layers.length === 0) {
                alert('Please enter at least one valid layer value');
                return;
            }
            
            // Calculate totalLCM first, before using it
            const totalLCM = calculator.lcm(...layers);
            
            // Generate composite rhythm and spaces plot
            const compositeRhythm = calculator.generateCompositeRhythm(layers);
            currentSpacesPlot = calculator.generateSpacesPlot(compositeRhythm, totalLCM, [layerA, layerB, layerC, layerD]);
            
            // Store current grid
            currentGrid = totalLCM;

            // Expose calculator and layer data globally for audio system
            window.calculator = calculator;
            window.currentGrid = currentGrid;

            // Reset AroundTheWorld system when generating new map
            if (window.aroundTheWorld) {
                window.aroundTheWorld.reset();
            }
            
            // Generate ratios with frequency analysis
            const ratioAnalysis = calculator.generateRatiosWithFrequency(currentSpacesPlot);
            currentRatios = ratioAnalysis.ratios;
            
            // Update display
            updateSpacesPlotDisplay();
            updateRatioTable();
            updateSphereMap();
        }
                
        // Update spaces plot display (respects minimized state)
        function updateSpacesPlotDisplay() {
            const display = document.getElementById('spacesPlotDisplay');
            const stats = document.getElementById('plotStats');
            const isMinimized = display.dataset.minimized === 'true';
            
            if (currentSpacesPlot.length === 0) {
                display.textContent = 'No valid spaces plot generated';
                stats.textContent = '';
                return;
            }
            
            // Always update statistics
            const uniqueValues = new Set(currentSpacesPlot).size;
            const totalValues = currentSpacesPlot.length;
            const halfLength = Math.ceil(totalValues / 2);
            
            stats.innerHTML = `
                Total plot length: ${totalValues}<br>
                Unique values: ${uniqueValues}<br>
                Palindrome structure: ${halfLength} + ${totalValues - halfLength}
            `;
            
            // Only show full plot if not minimized
            if (!isMinimized) {
                const firstHalf = currentSpacesPlot.slice(0, halfLength);
                const secondHalf = currentSpacesPlot.slice(halfLength);
                
                display.innerHTML = `
                    <strong>First Half:</strong><br>
                    ${firstHalf.join(', ')}<br><br>
                    <strong>Retrograde:</strong><br>
                    ${secondHalf.join(', ')}<br><br>
                    <strong>Complete Plot:</strong><br>
                    ${currentSpacesPlot.join(', ')}
                `;
            } else {
                display.innerHTML = '<em>Spaces plot minimized - summary below</em>';
            }
        }

        // Add grid occupation tracking to ratio analysis
            function analyzeRatios(spacesPlot) {
                const ratioMap = new Map();
                const fundamental = Math.max(...spacesPlot);
                
                spacesPlot.forEach(spaceValue => {
                    let ratio = fundamental / spaceValue;
                    while (ratio >= 2) ratio /= 2;
                    while (ratio < 1) ratio *= 2;
                    
                    const fraction = decimalToFraction(ratio);
                    
                    if (ratioMap.has(fraction)) {
                        const existing = ratioMap.get(fraction);
                        existing.frequency += 1;
                        existing.gridOccupation += spaceValue; // Add space value to grid occupation
                    } else {
                        ratioMap.set(fraction, {
                            ratio: ratio,
                            fraction: fraction,
                            frequency: 1,
                            gridOccupation: spaceValue // Track actual grid occupation
                        });
                    }
                });
                
                return Array.from(ratioMap.values()).sort((a, b) => b.gridOccupation - a.gridOccupation);
            }
        
        // Update ratio frequency table with color-coded percentages
        function updateRatioTable() {
            const tbody = document.getElementById('ratioTableBody');
            
            if (currentRatios.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4">No ratios to display</td></tr>';
                return;
            }
            
            const totalValues = currentSpacesPlot.length;
            
            // Find min and max percentages for color scaling
            const percentages = currentRatios.map(ratio => (ratio.frequency / totalValues) * 100);
            const minPercent = Math.min(...percentages);
            const maxPercent = Math.max(...percentages);
            
            tbody.innerHTML = currentRatios.map(ratio => {
                const totalGrid = currentSpacesPlot.reduce((sum, space) => sum + space, 0);
                const percentage = ((ratio.gridOccupation / totalGrid) * 100).toFixed(1);
                const normalizedPercent = (parseFloat(percentage) - minPercent) / (maxPercent - minPercent);
                
                // Create color from red (0) to green (1) based on local abundance
                const red = Math.round(255 * (1 - normalizedPercent));
                const green = Math.round(255 * normalizedPercent);
                const color = `rgb(${red}, ${green}, 0)`;
                
                return `
                    <tr>
                        <td>${ratio.fraction}</td>
                        <td>${ratio.cents.toFixed(1)}</td>
                        <td>${ratio.frequency}</td>
                        <td style="background-color: ${color}; color: ${normalizedPercent > 0.5 ? 'black' : 'white'}; font-weight: bold;">${percentage}%</td>
                    </tr>
                `;
            }).join('');
        }
        
        // Toggle spaces plot details while keeping summary
        function toggleSpacesPlotDetails() {
            const display = document.getElementById('spacesPlotDisplay');
            const button = document.getElementById('minimizeSpacesPlot');
            const isMinimized = display.dataset.minimized === 'true';
            
            if (isMinimized) {
                // Show full details
                updateSpacesPlotDisplay();
                button.textContent = '−';
                display.dataset.minimized = 'false';
            } else {
                // Show only summary
                const stats = document.getElementById('plotStats');
                display.innerHTML = '<em>Spaces plot minimized - summary below</em>';
                button.textContent = '+';
                display.dataset.minimized = 'true';
            }
        }
        
        // Clear all inputs
        function clearInputs() {
            document.getElementById('layerA').value = '';
            document.getElementById('layerB').value = '';
            document.getElementById('layerC').value = '';
            document.getElementById('layerD').value = '';
            
            currentSpacesPlot = [];
            currentRatios = [];
            
            updateSpacesPlotDisplay();
            updateRatioTable();
        }
        
        // 3D Sphere Mapping Implementation - Fixed with Display Controls
        class SphereMapper {
            constructor() {
                this.scene = null;
                this.camera = null;
                this.renderer = null;
                this.sphere = null;
                this.landmarks = [];
                this.isFullscreen = false;
                this.keys = {};
                this.cameraSpeed = 0.01;
                this.targetFPS = 60; 
                this.lastRenderTime = 0;
                this.renderDirty = true; // Flag to track if render is needed
                this.raycaster = new THREE.Raycaster();
                this.mouse = new THREE.Vector2();
                this.pointInfoDiv = null;
                this.selectedLandmark = null;
                this.landmarkData = []; // Store landmark data for info display
                this.continents = [];
                this.lastGeneratedSeeds = [];

                // Display toggles
                this.showLandmarks = true;
                this.geodesicDome = null;    
                this.showContinents = true;
                this.ratioEpicenters = [];
            }
            
            init() {
                const container = document.getElementById('sphereContainer');
                const canvas = document.getElementById('sphereCanvas');
                
                // Set canvas size
                canvas.width = container.offsetWidth;
                canvas.height = container.offsetHeight;
                
                // Initialize Three.js scene
                this.scene = new THREE.Scene();
                this.scene.background = new THREE.Color(0x000011);
                
                // Setup camera for free flight
                this.camera = new THREE.PerspectiveCamera(
                    75, 
                    canvas.width / canvas.height, 
                    0.1, 
                    1000
                );
                this.camera.position.set(0, 0, 3);
                
                // Setup renderer
                this.renderer = new THREE.WebGLRenderer({ 
                    canvas: canvas,
                    antialias: true 
                });
                this.renderer.setSize(canvas.width, canvas.height);
                
                // Add lighting
                const ambientLight = new THREE.AmbientLight(0x404040, 2.6);
                this.scene.add(ambientLight);
                
                const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
                directionalLight.position.set(10, 10, 5);
                this.scene.add(directionalLight);
                
                // Create base sphere
                this.createBaseSphere();
                
                // Add controls
                this.addFlightControls();

                // Initialize landmark lighting system
                const landmarkLights = new LandmarkLights();

                // Connect to sphere mapper when landmarks are created
                if (window.sphereMapper && window.sphereMapper.landmarkData) {
                    landmarkLights.setupLandmarks(window.sphereMapper.landmarkData);
                }
                
                // Start render loop
                this.animate();
            }
            
            createBaseSphere() {
                const geometry = new THREE.SphereGeometry(1, 64, 64);
                const material = new THREE.MeshLambertMaterial({ 
                    color: 0x6fa8dc,
                    transparent: true,
                    opacity: 0.8,
                    wireframe: false,
                    side: THREE.DoubleSide  // Renders both inside and outside faces
                });
                
                this.planetSphere = new THREE.Mesh(geometry, material);
                this.scene.add(this.planetSphere);
            }
            
            addFlightControls() {
                const canvas = this.renderer.domElement;
                
                // Keyboard controls
                document.addEventListener('keydown', (event) => {
                    this.keys[event.key.toLowerCase()] = true;
                    
                    // Handle special keys
                    if (event.key === 'f' || event.key === 'F') {
                        this.toggleFullscreen();
                        event.preventDefault();
                    }
                    if (event.key === 'Shift') {
                        this.reorientToOrigin();
                    }
                });
                
                document.addEventListener('keyup', (event) => {
                    if (this.keys[event.key.toLowerCase()]) {
                        this.keys[event.key.toLowerCase()] = false;
                        this.renderDirty = true; // Flag for render
                    }
                });

                // Add mouse click handling
                canvas.addEventListener('click', (event) => {
                    this.handleLandmarkClick(event);
                });
                
                // Mouse scroll for zoom
                canvas.addEventListener('wheel', (event) => {
                    const direction = new THREE.Vector3();
                    this.camera.getWorldDirection(direction);
                    const zoomSpeed = event.deltaY > 0 ? 0.01 : -0.01;
                    this.camera.position.add(direction.multiplyScalar(zoomSpeed));
                    event.preventDefault();
                });
                
                // Prevent context menu
                canvas.addEventListener('contextmenu', (e) => e.preventDefault());
            }

            handleLandmarkClick(event) {
                const rect = this.renderer.domElement.getBoundingClientRect();
                
                // Calculate mouse position in normalized device coordinates
                this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
                
                // Update raycaster
                this.raycaster.setFromCamera(this.mouse, this.camera);
                
                // Check for intersections with instanced landmarks first
                if (this.instancedLandmarks) {
                    const intersects = this.raycaster.intersectObject(this.instancedLandmarks);
                    
                    if (intersects.length > 0) {
                        const intersection = intersects[0];
                        const instanceId = intersection.instanceId;
                        
                        if (instanceId !== undefined && this.landmarkData[instanceId]) {
                            this.showPointInfo(this.landmarkData[instanceId], event.clientX, event.clientY);
                            return; // Exit early if we hit a landmark
                        }
                    }
                }
                
                // If no landmark hit, check for planet surface intersection
                if (this.planetSphere) {
                    const planetIntersects = this.raycaster.intersectObject(this.planetSphere);
                    
                    if (planetIntersects.length > 0) {
                        const intersection = planetIntersects[0];
                        this.showTerritoryInfo(intersection, event.clientX, event.clientY);
                    }
                }
            }

            showTerritoryInfo(intersection, mouseX, mouseY) {
                // Get UV coordinates from the intersection
                const uv = intersection.uv;
                if (!uv) return;
                
                // Convert UV to texture coordinates
                const textureSize = 1024; // Same as generation
                const textureX = Math.floor(uv.x * textureSize);
                const textureY = Math.floor((1 - uv.y) * textureSize); // Flip Y for texture space
                
                // Find which territory this point belongs to by finding closest seed
                if (!this.lastGeneratedSeeds) return; // Need seeds from last generation
                
                let closestSeed = null;
                let minDistance = Infinity;
                
                this.lastGeneratedSeeds.forEach(seed => {
                    const distance = Math.sqrt((textureX - seed.x)**2 + (textureY - seed.y)**2);
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestSeed = seed;
                    }
                });
                
                if (closestSeed) {
                    this.showTerritoryPopup(closestSeed, mouseX, mouseY);
                }
            }

            showTerritoryPopup(seedInfo, mouseX, mouseY) {
                // Remove existing popup
                this.hidePointInfo();
                
                const territoryType = seedInfo.isWater ? 'Ocean' : 'Continent';
                const ratio = seedInfo.ratio;
                const localPercent = seedInfo.localPercent;
                
                // Create info div
                this.pointInfoDiv = document.createElement('div');
                this.pointInfoDiv.style.cssText = `
                    position: fixed;
                    left: ${mouseX + 10}px;
                    top: ${mouseY + 10}px;
                    background: rgba(42, 42, 42, 0.95);
                    color: #00ff00;
                    padding: 15px;
                    border-radius: 8px;
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    border: 1px solid #555;
                    z-index: 10000;
                    min-width: 200px;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                `;
                
                this.pointInfoDiv.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 8px; color: #fff;">${territoryType} Info</div>
                    <div><strong>Type:</strong> ${territoryType}</div>
                    <div><strong>Ratio:</strong> ${ratio.fraction}</div>
                    <div><strong>Local %:</strong> ${localPercent.toFixed(1)}%</div>
                    <div><strong>Cents:</strong> ${ratio.cents.toFixed(1)}</div>
                    <div><strong>Grid Occupation:</strong> ${ratio.gridOccupation}</div>
                    <div style="margin-top: 5px; text-align: center;">
                        <button onclick="sphereMapper.hidePointInfo()" style="background: #555; border: 1px solid #777; color: #00ff00; padding: 4px 8px; cursor: pointer;">Close</button>
                    </div>
                `;
                
                document.body.appendChild(this.pointInfoDiv);
            }
            
            toggleFullscreen() {
                const container = document.getElementById('sphereContainer');
                
                if (!this.isFullscreen) {
                    // Enter fullscreen
                    container.style.position = 'fixed';
                    container.style.top = '0';
                    container.style.left = '0';
                    container.style.width = '100vw';
                    container.style.height = '100vh';
                    container.style.zIndex = '9999';
                    container.style.backgroundColor = '#000';
                    
                    this.isFullscreen = true;
                    
                    // Resize renderer
                    this.renderer.setSize(window.innerWidth, window.innerHeight);
                    this.camera.aspect = window.innerWidth / window.innerHeight;
                    this.camera.updateProjectionMatrix();
                } else {
                    // Exit fullscreen
                    container.style.position = 'relative';
                    container.style.top = 'auto';
                    container.style.left = 'auto';
                    container.style.width = '100%';
                    container.style.height = '600px';
                    container.style.zIndex = 'auto';
                    container.style.backgroundColor = '#000';
                    
                    this.isFullscreen = false;
                    
                    // Resize renderer back
                    const originalWidth = container.offsetWidth;
                    const originalHeight = 600;
                    this.renderer.setSize(originalWidth, originalHeight);
                    this.camera.aspect = originalWidth / originalHeight;
                    this.camera.updateProjectionMatrix();
                }
            }
            
            reorientToOrigin() {
                // Smoothly reorient camera to look at origin
                this.camera.position.set(0, 0, 3);
                this.camera.lookAt(0, 0, 0);
            }
            
            updateFlightControls() {
                // Check if any movement keys are pressed first
                const hasMovement = this.keys['w'] || this.keys['s'] || this.keys['a'] || this.keys['d'];
                const hasRotation = this.keys['arrowup'] || this.keys['arrowdown'] || 
                                   this.keys['arrowleft'] || this.keys['arrowright'];
                
                if (!hasMovement && !hasRotation) return; // Early exit if no input
                
                const moveSpeed = this.cameraSpeed;
                
                if (hasMovement) {
                    // Reuse vectors instead of creating new ones
                    if (!this.tempVectors) {
                        this.tempVectors = {
                            forward: new THREE.Vector3(),
                            right: new THREE.Vector3(),
                            up: new THREE.Vector3(0, 1, 0)
                        };
                    }
                    
                    this.camera.getWorldDirection(this.tempVectors.forward);
                    this.tempVectors.right.crossVectors(this.tempVectors.forward, this.tempVectors.up).normalize();
                    
                    if (this.keys['w']) {
                        this.camera.position.add(this.tempVectors.forward.clone().multiplyScalar(moveSpeed));
                    }
                    if (this.keys['s']) {
                        this.camera.position.add(this.tempVectors.forward.clone().multiplyScalar(-moveSpeed));
                    }
                    if (this.keys['a']) {
                        this.camera.position.add(this.tempVectors.right.clone().multiplyScalar(-moveSpeed));
                    }
                    if (this.keys['d']) {
                        this.camera.position.add(this.tempVectors.right.clone().multiplyScalar(moveSpeed));
                    }
                }
                
                if (hasRotation) {
                    const rotationSpeed = 0.02;
                    
                    if (this.keys['arrowup']) this.camera.rotateX(rotationSpeed);
                    if (this.keys['arrowdown']) this.camera.rotateX(-rotationSpeed);
                    if (this.keys['arrowleft']) this.camera.rotateY(rotationSpeed);
                    if (this.keys['arrowright']) this.camera.rotateY(-rotationSpeed);
                }
            }
                        
            updateMapping(spacesPlot, ratios) {
                // Clear existing elements
                this.clearMapping();
                
                if (spacesPlot.length === 0 || ratios.length === 0) return;
                
                // Create geodesic spiral mapping (replaces old X-axis mapping)
                this.createGeodomeSpiral(spacesPlot, ratios);

                // Surface geographies - ONLY the texture system
                this.applyPlanetaryTexture(ratios);
                
                // Apply current display toggles
                this.updateDisplayVisibility();
            }
            
            createSpacesPlotMapping(spacesPlot, ratios) {
                // Create X-axis divisions based on spaces plot palindromic structure
                const halfLength = Math.ceil(spacesPlot.length / 2);
                const firstHalf = spacesPlot.slice(0, halfLength);
                const secondHalf = spacesPlot.slice(halfLength);
                
                this.spacesPlotDivisions = [];
                
                // First half: map from left edge (-1) moving inward toward center (0)
                if (firstHalf.length > 0) {
                    const firstHalfTotal = firstHalf.reduce((sum, val) => sum + val, 0);
                    let currentPosition = -1;
                    
                    firstHalf.forEach((spaceValue, index) => {
                        const normalizedStep = spaceValue / firstHalfTotal; // Normalize to total
                        const position = currentPosition + normalizedStep; // Move toward center
                        
                        this.spacesPlotDivisions.push({
                            x: position,
                            index: index,
                            value: spaceValue,
                            isRetrograde: false,
                            halfIndex: index
                        });
                        
                        currentPosition = position;
                    });
                }
                
                // Second half (retrograde): map from center (0) moving outward to right edge (+1)
                if (secondHalf.length > 0) {
                    const secondHalfTotal = secondHalf.reduce((sum, val) => sum + val, 0);
                    let currentPosition = 0; // Start from center
                    
                    secondHalf.forEach((spaceValue, index) => {
                        const normalizedStep = spaceValue / secondHalfTotal; // Normalize to total
                        const position = currentPosition + normalizedStep; // Move toward right edge
                        
                        this.spacesPlotDivisions.push({
                            x: position,
                            index: halfLength + index,
                            value: spaceValue,
                            isRetrograde: true,
                            halfIndex: index
                        });
                        
                        currentPosition = position;
                    });
                }
                
                // Create X-axis dots, rays, and landmarks
                let cumulativePosition = 0;
                const totalSpacesSum = spacesPlot.reduce((sum, val) => sum + val, 0);

                this.spacesPlotDivisions.forEach((division, divIndex) => {
                    // Create X-axis dot
                    const xAxisDot = this.createXAxisDot(division);
                    this.scene.add(xAxisDot);
                    this.xAxisDots.push(xAxisDot);
                    
                    // Calculate progression percentage through total cycle
                    const progressionPercent = cumulativePosition / totalSpacesSum;
                    cumulativePosition += spacesPlot[divIndex];
                    
                    // Find corresponding ratio for this spaces plot value
                    const correspondingRatio = this.findCorrespondingRatio(division.value, ratios);
                    if (correspondingRatio) {
                        const petal = this.petals.find(p => p.ratio.fraction === correspondingRatio.fraction);
                        
                        if (petal) {
                            // Calculate position along meridian based on progression percentage
                            const meridianPoint = this.getPointOnMeridianByPercent(petal, progressionPercent);
                            if (meridianPoint) {
                                // Create landmark on sphere surface
                                const landmark = this.createLandmark(meridianPoint, correspondingRatio, division);
                                this.scene.add(landmark);
                                this.landmarks.push(landmark);
                                
                                // Create ray connecting X-axis dot to landmark
                                const ray = this.createRay(division, meridianPoint);
                                this.scene.add(ray);
                                this.rays.push(ray);
                            }
                        }
                    }
                });
            }
            
            findCorrespondingRatio(spaceValue, ratios) {
                // Find the ratio that corresponds to this space value
                const fundamental = Math.max(...currentSpacesPlot);
                let targetRatio = fundamental / spaceValue;
                
                // Compress to single octave
                while (targetRatio >= 2) targetRatio /= 2;
                while (targetRatio < 1) targetRatio *= 2;
                
                // Find closest matching ratio
                let closestRatio = null;
                let minDiff = Infinity;
                
                ratios.forEach(ratio => {
                    const diff = Math.abs(ratio.ratio - targetRatio);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestRatio = ratio;
                    }
                });
                
                return closestRatio;
            }
            
            findClosestPointOnPetal(division, petal) {
                // Find the point on the petal meridian closest to the X-axis division
                const divisionPoint = new THREE.Vector3(division.x, 0, 0);
                const angle = petal.angle;
                
                let minDistance = Infinity;
                let closestPoint = null;
                
                // Sample points along the meridian
                const samples = 100;
                for (let i = 0; i <= samples; i++) {
                    const phi = (i / samples) * Math.PI; // 0 to π
                    const x = Math.sin(phi) * Math.cos(angle);
                    const y = Math.cos(phi);
                    const z = Math.sin(phi) * Math.sin(angle);
                    
                    const petalPoint = new THREE.Vector3(x, y, z);
                    const distance = divisionPoint.distanceTo(petalPoint);
                    
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestPoint = petalPoint.clone();
                    }
                }
                
                return closestPoint;
            }
            
            createLandmark(position, ratioData, division) {
                const size = this.getLandmarkSize(ratioData.frequency);
                const color = this.getRarityColor(ratioData.frequency);
                
                const geometry = new THREE.SphereGeometry(size, 12, 12);
                const material = new THREE.MeshLambertMaterial({ 
                    color: color,
                    emissive: color,
                    emissiveIntensity: 0.4
                });
                
                const landmark = new THREE.Mesh(geometry, material);
                landmark.position.copy(position);
                landmark.position.normalize().multiplyScalar(1.02); // Ensure on surface
                
                // Store data for interactions
                landmark.userData = { 
                    type: 'landmark',
                    ratio: ratioData, 
                    division: division
                };
                
                return landmark;
            }

            generateContinentsAndOceans(ratios) {
                // Clear any existing terrain
                this.clearTerrain();
                
                ratios.forEach(ratioData => {
                    const isWater = (ratioData.frequency / currentSpacesPlot.length) > 0.1; // >10% = water
                    const centerPoint = this.calculateRatioCenterPoint(ratioData);
                    
                    if (centerPoint) {
                        const terrain = this.createTerrainFeature(centerPoint, ratioData, isWater);
                        this.scene.add(terrain);
                        this.terrainFeatures.push(terrain);
                    }
                });
            }

            calculateRatioCenterPoint(ratioData) {
                // Find all landmark positions for this ratio
                const ratioPositions = [];
                
                this.landmarks.forEach(landmark => {
                    if (landmark.userData.ratio && 
                        landmark.userData.ratio.fraction === ratioData.fraction) {
                        ratioPositions.push(landmark.position.clone());
                    }
                });
                
                if (ratioPositions.length === 0) return null;
                
                // Calculate centroid of all positions for this ratio
                const centroid = new THREE.Vector3();
                ratioPositions.forEach(pos => {
                    centroid.add(pos);
                });
                centroid.divideScalar(ratioPositions.length);
                
                // Project back onto sphere surface
                return centroid.normalize();
            }

            createTerrainFeature(centerPoint, ratioData, isWater) {
                const size = Math.sqrt(ratioData.frequency) * 0.3; // Size based on frequency
                const segments = Math.max(8, ratioData.frequency); // Detail based on frequency
                
                const geometry = new THREE.SphereGeometry(size, segments, segments);
                const material = new THREE.MeshLambertMaterial({
                    color: isWater ? 0x0066cc : 0x228B22, // Blue for water, green for land
                    transparent: true,
                    opacity: 0.7
                });
                
                const terrain = new THREE.Mesh(geometry, material);
                terrain.position.copy(centerPoint);
                terrain.position.multiplyScalar(1.01); // Just above base sphere
                
                terrain.userData = {
                    type: isWater ? 'ocean' : 'continent',
                    ratio: ratioData,
                    isWater: isWater
                };
                
                return terrain;
            }
            
            // Display toggle methods
    
            toggleLandmarks(show) {
                console.log('=== LANDMARK TOGGLE DEBUG ===');
                console.log('Show landmarks:', show);
                console.log('instancedLandmarks exists:', !!this.instancedLandmarks);
                console.log('landmarks array length:', this.landmarks ? this.landmarks.length : 'undefined');
                
                this.showLandmarks = show;
                
                if (this.instancedLandmarks) {
                    this.instancedLandmarks.visible = show;
                    console.log(`Instanced landmarks visibility set to: ${show}`);
                    console.log('instancedLandmarks object:', this.instancedLandmarks);
                } else {
                    console.warn('No instanced landmarks to toggle');
                }
                
                // Also try toggling individual landmarks if they exist
                if (this.landmarks && this.landmarks.length > 0) {
                    console.log('Also toggling individual landmarks:', this.landmarks.length);
                    this.landmarks.forEach((landmark, index) => {
                        landmark.visible = show;
                        if (index < 3) console.log(`Landmark ${index} visibility:`, landmark.visible);
                    });
                }
                
                // Force a render
                this.renderDirty = true;
                console.log('=== LANDMARK TOGGLE COMPLETE ===');
            }

            createGeodomeSpiral(spacesPlot, ratios) {
                const grid = calculator.lcm(...[parseInt(document.getElementById('layerA').value) || 0,
                                               parseInt(document.getElementById('layerB').value) || 0,
                                               parseInt(document.getElementById('layerC').value) || 0,
                                               parseInt(document.getElementById('layerD').value) || 0].filter(l => l > 0));
                
                // Mathematical precision for landmark positioning (no visual grid)
                console.log(`Calculating landmarks for Grid: ${grid}`);
                
                // Create landmarks at precise mathematical positions
                this.createInstancedLandmarks(spacesPlot, ratios, grid);
            }

            createInstancedLandmarks(spacesPlot, ratios, exactGrid) {
                const layers = [parseInt(document.getElementById('layerA').value) || 0,
                               parseInt(document.getElementById('layerB').value) || 0,
                               parseInt(document.getElementById('layerC').value) || 0,
                               parseInt(document.getElementById('layerD').value) || 0].filter(l => l > 0);

                const compositeRhythm = calculator.generateCompositeRhythm(layers);
                const exactSpiralTurns = Math.sqrt(exactGrid) / 2;
                const totalSpacesSum = spacesPlot.reduce((sum, val) => sum + val, 0);
                
                // Reset landmark data storage
                this.landmarkData = [];
                const landmarkData = [];
                let cumulativePosition = 0;
                
                console.log(`Starting landmark creation: ${compositeRhythm.length} composite rhythm points`);
                
                compositeRhythm.forEach((rhythmValue, index) => {
                    const spaceIndex = index < spacesPlot.length ? index : index % spacesPlot.length;
                    const spaceValue = spacesPlot[spaceIndex];
                    
                    const fundamental = Math.max(...spacesPlot);
                    let ratio = fundamental / spaceValue;
                    const originalRatio = ratio;
                    
                    while (ratio >= 2) ratio /= 2;
                    while (ratio < 1) ratio *= 2;
                    
                    const correspondingRatio = ratios.find(r => Math.abs(r.ratio - ratio) < 0.0001);
                    
                    if (correspondingRatio) {
                        const exactT = rhythmValue / exactGrid;
                        const exactTheta = exactT * exactSpiralTurns * 2 * Math.PI;
                        const exactPhi = exactT * Math.PI;
                        
                        const x = Math.sin(exactPhi) * Math.cos(exactTheta) * 1.02;
                        const y = Math.cos(exactPhi) * 1.02;
                        const z = Math.sin(exactPhi) * Math.sin(exactTheta) * 1.02;
                        
                        // Calculate octave
                        let octave = 1;
                        let testRatio = ratio;
                        while (testRatio < originalRatio - 0.0001) {
                            testRatio *= 2;
                            octave++;
                        }
                        
                        // Calculate percentage progress
                        const progressPercent = ((cumulativePosition + spaceValue) / totalSpacesSum) * 100;
                        
                        const landmarkInfo = {
                            position: new THREE.Vector3(x, y, z),
                            ratio: correspondingRatio,
                            size: this.getLandmarkSize(correspondingRatio.frequency),
                            color: this.getRarityColor(correspondingRatio.frequency),
                            spaceValue: spaceValue,
                            octave: octave,
                            progressPercent: progressPercent,
                            rhythmValue: rhythmValue,
                            index: index,
                            contributingLayers: calculator.currentSpacesLayerMap[spaceIndex] || ['Unknown'] // Add layer info
                        };
                        
                        landmarkData.push(landmarkInfo);
                        this.landmarkData.push(landmarkInfo);
                    }
                    
                    cumulativePosition += spaceValue;
                });
                
                console.log(`Created ${landmarkData.length} landmark data entries`);
                
                if (landmarkData.length === 0) {
                    console.warn('No landmarks created!');
                    return;
                }
                
                // Create instanced mesh
                const landmarkGeometry = new THREE.SphereGeometry(1, 8, 8);
                const landmarkMaterial = new THREE.MeshLambertMaterial({ 
                    transparent: true,
                    opacity: 0.9
                });
                
                this.instancedLandmarks = new THREE.InstancedMesh(
                    landmarkGeometry, 
                    landmarkMaterial, 
                    landmarkData.length
                );
                
                // Set up instances
                const matrix = new THREE.Matrix4();
                const color = new THREE.Color();
                
                landmarkData.forEach((landmark, i) => {
                    // Set position and scale
                    matrix.makeScale(landmark.size, landmark.size, landmark.size);
                    matrix.setPosition(landmark.position);
                    this.instancedLandmarks.setMatrixAt(i, matrix);
                    
                    // Set color
                    color.setHex(landmark.color);
                    this.instancedLandmarks.setColorAt(i, color);
                });
                
                this.instancedLandmarks.instanceMatrix.needsUpdate = true;
                this.instancedLandmarks.instanceColor.needsUpdate = true;
                
                this.scene.add(this.instancedLandmarks);
                this.landmarks = [this.instancedLandmarks];

                // Initialize landmark lighting system
                if (!window.landmarkLights) {
                    window.landmarkLights = new LandmarkLights();
                }
                
                // Setup lighting with the newly created landmarks
                if (window.landmarkLights && this.landmarkData) {
                    window.landmarkLights.setupLandmarks(this.landmarkData, this);
                    console.log('🌟 Landmark lighting system connected to sphere mapper');
                }

                console.log(`Added instanced mesh with ${landmarkData.length} instances to scene`);
            }

            showPointInfo(landmarkInfo, mouseX, mouseY) {
                // Remove existing info div
                this.hidePointInfo();
                
                // Calculate local rarity percentage
                const totalValues = currentSpacesPlot.length;
                const percentages = currentRatios.map(ratio => (ratio.frequency / totalValues) * 100);
                const minPercent = Math.min(...percentages);
                const maxPercent = Math.max(...percentages);
                
                const percentage = (landmarkInfo.ratio.frequency / totalValues) * 100;
                const normalizedPercent = (percentage - minPercent) / (maxPercent - minPercent);
                const rarityLevel = normalizedPercent < 0.33 ? 'High' : 
                                   normalizedPercent < 0.66 ? 'Medium' : 'Low';
                
                // Create info div
                this.pointInfoDiv = document.createElement('div');
                this.pointInfoDiv.style.cssText = `
                    position: fixed;
                    left: ${mouseX + 10}px;
                    top: ${mouseY + 10}px;
                    background: rgba(42, 42, 42, 0.95);
                    color: #00ff00;
                    padding: 15px;
                    border-radius: 8px;
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    border: 1px solid #555;
                    z-index: 10000;
                    min-width: 200px;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                `;
                
                this.pointInfoDiv.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 8px; color: #fff;">Landmark Info</div>
                    <div><strong>Contributing Layer(s):</strong> ${landmarkInfo.contributingLayers.join(', ')}</div>
                    <div><strong>Spaces Plot Value:</strong> ${landmarkInfo.spaceValue}</div>
                    <div><strong>Ratio:</strong> ${landmarkInfo.ratio.fraction}</div>
                    <div><strong>Cents:</strong> ${landmarkInfo.ratio.cents.toFixed(1)}</div>
                    <div><strong>Relative Octave:</strong> ${landmarkInfo.octave}</div>
                    <div><strong>Cycle Progress:</strong> ${landmarkInfo.progressPercent.toFixed(2)}%</div>
                    <div><strong>Local Frequency:</strong> ${landmarkInfo.ratio.frequency}/${totalValues} (${percentage.toFixed(1)}%)</div>
                    <div><strong>Local Rarity:</strong> <span style="color: ${this.getRarityColorCSS(normalizedPercent)}">${rarityLevel}</span></div>
                    <div style="margin-top: 8px; font-size: 10px; color: #888;">
                        Grid Position: ${landmarkInfo.rhythmValue}/${calculator.lcm(...[parseInt(document.getElementById('layerA').value) || 0,
                                                                                       parseInt(document.getElementById('layerB').value) || 0,
                                                                                       parseInt(document.getElementById('layerC').value) || 0,
                                                                                       parseInt(document.getElementById('layerD').value) || 0].filter(l => l > 0))}
                    </div>
                    <div style="margin-top: 5px; text-align: center;">
                        <button onclick="sphereMapper.hidePointInfo()" style="background: #555; border: 1px solid #777; color: #00ff00; padding: 4px 8px; cursor: pointer;">Close</button>
                    </div>
                `;
                
                document.body.appendChild(this.pointInfoDiv);
                this.selectedLandmark = landmarkInfo;
            }

            hidePointInfo() {
                if (this.pointInfoDiv) {
                    document.body.removeChild(this.pointInfoDiv);
                    this.pointInfoDiv = null;
                    this.selectedLandmark = null;
                }
            }

            getRarityColorCSS(normalizedPercent) {
                if (normalizedPercent < 0.33) return '#ff6b6b'; // High rarity - red
                if (normalizedPercent < 0.66) return '#ffa500'; // Medium rarity - orange
                return '#4ecdc4'; // Low rarity - cyan
            }

            calculateSpiralPosition(index, totalItems, spiralTurns) {
                // Map index to spiral position (0 to 1)
                const t = index / totalItems;
                
                // Spiral parameters: theta increases, phi decreases (top to bottom)
                const theta = t * spiralTurns * 2 * Math.PI; // Horizontal rotation
                const phi = t * Math.PI; // Vertical progression (0 = north pole, π = south pole)
                
                // Convert to Cartesian coordinates
                const x = Math.sin(phi) * Math.cos(theta);
                const y = Math.cos(phi);
                const z = Math.sin(phi) * Math.sin(theta);
                
                return new THREE.Vector3(x, y, z);
            }
            
            updateDisplayVisibility() {
                this.toggleLandmarks(this.showLandmarks);
            this.toggleLandmarks(this.showLandmarks);
            }
            
            getRatioColor(frequency) {
                const hue = Math.min(frequency / 10, 1) * 0.7; // 0 to 0.7 (red to blue)
                return new THREE.Color().setHSL(hue, 0.8, 0.6);
            }
            
            getRarityColor(frequency) {
                const totalValues = currentSpacesPlot.length;
                const percentages = currentRatios.map(ratio => (ratio.frequency / totalValues) * 100);
                const minPercent = Math.min(...percentages);
                const maxPercent = Math.max(...percentages);
                
                const percentage = (frequency / totalValues) * 100;
                const normalizedPercent = (percentage - minPercent) / (maxPercent - minPercent);
                
                // Create color from red (0) to green (1) - same as table
                const red = Math.round(255 * (1 - normalizedPercent));
                const green = Math.round(255 * normalizedPercent);
                
                return (red << 16) | (green << 8) | 0; // Convert RGB to hex
            }
            
            getLandmarkSize(frequency) {
                if (frequency === 1) return 0.06; // Largest for rarest
                if (frequency <= 3) return 0.04; // Large for rare
                if (frequency <= 6) return 0.03; // Medium for uncommon
                return 0.02; // Small for common
            }

            calculateRatioPixelCounts(spacesPlot, ratios) {
                const ratioPixelMap = new Map();
                const totalGridOccupation = ratios.reduce((sum, ratio) => sum + ratio.gridOccupation, 0);
                
                ratios.forEach(ratio => {
                    // Use actual grid occupation instead of frequency count
                    ratioPixelMap.set(ratio.fraction, ratio.gridOccupation);
                });
                
                return ratioPixelMap;
            }

            // Add this method to the SphereMapper class
            decimalToFraction(decimal) {
                const tolerance = 1e-6;
                let numerator = 1;
                let denominator = 1;
                let minError = Math.abs(decimal - 1);
                
                for (let d = 1; d <= 1000; d++) {
                    const n = Math.round(decimal * d);
                    const error = Math.abs(decimal - n/d);
                    
                    if (error < minError) {
                        minError = error;
                        numerator = n;
                        denominator = d;
                        
                        if (error < tolerance) break;
                    }
                }
                
                // Simplify fraction
                const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
                const commonDivisor = gcd(numerator, denominator);
                
                return `${numerator / commonDivisor}/${denominator / commonDivisor}`;
            }

            generateTerritoryTexture(ratios, pixelCounts) {
                const textureSize = 512;
                const canvas = document.createElement('canvas');
                canvas.width = textureSize;
                canvas.height = textureSize;
                const ctx = canvas.getContext('2d').getImageData(0, 0, textureSize, textureSize);
                
                // Create seed points for each ratio based on their pixel counts
                const seeds = [];
                ratios.forEach(ratio => {
                    const pixelCount = pixelCounts.get(ratio.fraction) || 0;
                    const totalPixels = Array.from(pixelCounts.values()).reduce((a,b) => a+b, 0);
                    const seedCount = Math.max(1, Math.floor((pixelCount / totalPixels) * 50));
                    
                    // Generate multiple seeds for larger territories
                    for (let i = 0; i < seedCount; i++) {
                        seeds.push({
                            x: Math.random() * textureSize,
                            y: Math.random() * textureSize,
                            ratio: ratio,
                            isWater: (ratio.frequency / currentSpacesPlot.length) > 0.1
                        });
                    }
                });
                
                // Voronoi algorithm - assign each pixel to nearest seed
                for (let x = 0; x < textureSize; x++) {
                    for (let y = 0; y < textureSize; y++) {
                        let closestSeed = seeds[0];
                        let minDistance = Infinity;
                        
                        seeds.forEach(seed => {
                            const distance = Math.sqrt((x - seed.x)**2 + (y - seed.y)**2);
                            if (distance < minDistance) {
                                minDistance = distance;
                                closestSeed = seed;
                            }
                        });
                        
                        const pixelIndex = (y * textureSize + x) * 4;
                        const color = closestSeed.isWater ? [0, 102, 204] : [34, 139, 34]; // Blue/Green
                        
                        ctx.data[pixelIndex] = color[0];     // R
                        ctx.data[pixelIndex + 1] = color[1]; // G
                        ctx.data[pixelIndex + 2] = color[2]; // B
                        ctx.data[pixelIndex + 3] = 255;      // A
                    }
                }
                
                const canvas2 = document.createElement('canvas');
                canvas2.width = textureSize;
                canvas2.height = textureSize;
                canvas2.getContext('2d').putImageData(ctx, 0, 0);
                
                return new THREE.CanvasTexture(canvas2);
            }

            applyPlanetaryTexture(ratios) {
                const layers = [parseInt(document.getElementById('layerA').value) || 0,
                               parseInt(document.getElementById('layerB').value) || 0,
                               parseInt(document.getElementById('layerC').value) || 0,
                               parseInt(document.getElementById('layerD').value) || 0].filter(l => l > 0);

                const compositeRhythm = calculator.generateCompositeRhythm(layers);
                const maxComposite = Math.max(...compositeRhythm);
                const maxSpaces = Math.max(...currentSpacesPlot);
                
                const normalizedComposite = compositeRhythm.map(val => val / maxComposite);
                const normalizedSpaces = currentSpacesPlot.map(val => val / maxSpaces);
                
                // Use epicenter-based generation instead of random
                const texture = this.generateEpicenterTerritoryTexture(ratios, normalizedComposite, normalizedSpaces);
                
                if (this.planetSphere) {
                    this.planetSphere.material.map = texture;
                    this.planetSphere.material.needsUpdate = true;
                }
            }
            
            generateWavyCoastlines(ratios) {
                const layers = [parseInt(document.getElementById('layerA').value) || 0,
                               parseInt(document.getElementById('layerB').value) || 0,
                               parseInt(document.getElementById('layerC').value) || 0,
                               parseInt(document.getElementById('layerD').value) || 0].filter(l => l > 0);
                
                const compositeRhythm = calculator.generateCompositeRhythm(layers);
                const maxComposite = Math.max(...compositeRhythm);
                const maxSpaces = Math.max(...currentSpacesPlot);
                
                const normalizedComposite = compositeRhythm.map(val => val / maxComposite);
                const normalizedSpaces = currentSpacesPlot.map(val => val / maxSpaces);
                
                return this.generateTerritoryWithBorders(ratios, normalizedComposite, normalizedSpaces);
            }

            generateWavyTerritoryTexture(ratios, compositeWaves, spacesWaves) {
                const textureSize = 1024; // Higher resolution for coastline detail
                const canvas = document.createElement('canvas');
                canvas.width = textureSize;
                canvas.height = textureSize;
                const ctx = canvas.getContext('2d');
                
                // Create base Voronoi territories first
                const imageData = ctx.createImageData(textureSize, textureSize);
                const pixelCounts = this.calculateRatioPixelCounts(currentSpacesPlot, ratios);
                
                // Generate seeds with wavy positioning
                const seeds = [];
                ratios.forEach(ratio => {
                    const pixelCount = pixelCounts.get(ratio.fraction) || 0;
                    const totalPixels = Array.from(pixelCounts.values()).reduce((a,b) => a+b, 0);
                    const seedCount = Math.max(1, Math.floor((pixelCount / totalPixels) * 30));
                    
                    for (let i = 0; i < seedCount; i++) {
                        seeds.push({
                            x: Math.random() * textureSize,
                            y: Math.random() * textureSize,
                            ratio: ratio,
                            isWater: (ratio.frequency / currentSpacesPlot.length) > 0.1
                        });
                    }
                });
                
                // Apply wavy coastlines during pixel assignment
                for (let x = 0; x < textureSize; x++) {
                    for (let y = 0; y < textureSize; y++) {
                        let closestSeed = seeds[0];
                        let minDistance = Infinity;
                        
                        // Find base closest seed
                        seeds.forEach(seed => {
                            const distance = Math.sqrt((x - seed.x)**2 + (y - seed.y)**2);
                            if (distance < minDistance) {
                                minDistance = distance;
                                closestSeed = seed;
                            }
                        });
                        
                        // Apply rhythmic wave distortion near territory boundaries
                        const distortedColor = this.applyCoastlineWaves(
                            x, y, textureSize, closestSeed, seeds, compositeWaves, spacesWaves
                        );
                        
                        const pixelIndex = (y * textureSize + x) * 4;
                        imageData.data[pixelIndex] = distortedColor[0];     // R
                        imageData.data[pixelIndex + 1] = distortedColor[1]; // G
                        imageData.data[pixelIndex + 2] = distortedColor[2]; // B
                        imageData.data[pixelIndex + 3] = 255;               // A
                    }
                }
                
                ctx.putImageData(imageData, 0, 0);
                return new THREE.CanvasTexture(canvas);
            }

            // Generate equidistant nodal points based on number of ratios
            generateNodalEpicenters(ratioCount) {
                const nodes = [];
                
                if (ratioCount <= 12) {
                    // Use icosahedron vertices for up to 12 points
                    const phi = (1 + Math.sqrt(5)) / 2; // Golden ratio
                    const icosahedronVertices = [
                        [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
                        [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
                        [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]
                    ];
                    
                    // Take first N vertices and normalize to unit sphere
                    for (let i = 0; i < Math.min(ratioCount, 12); i++) {
                        const vertex = icosahedronVertices[i];
                        const normalized = new THREE.Vector3(vertex[0], vertex[1], vertex[2]).normalize();
                        nodes.push(normalized);
                    }
                } else {
                    // For more than 12 ratios, use fibonacci spiral distribution
                    for (let i = 0; i < ratioCount; i++) {
                        const y = 1 - (i / (ratioCount - 1)) * 2;  // y goes from 1 to -1
                        const radius = Math.sqrt(1 - y * y);
                        const theta = i * Math.PI * (3 - Math.sqrt(5));  // Golden angle increment
                        
                        const x = Math.cos(theta) * radius;
                        const z = Math.sin(theta) * radius;
                        
                        nodes.push(new THREE.Vector3(x, y, z));
                    }
                }
                
                return nodes;
            }

            // Generate territory texture with epicenter-based distribution
            generateEpicenterTerritoryTexture(ratios, compositeWaves, spacesWaves) {
                const textureSize = 1024;
                const canvas = document.createElement('canvas');
                canvas.width = textureSize;
                canvas.height = textureSize;
                const ctx = canvas.getContext('2d');
                
                const imageData = ctx.createImageData(textureSize, textureSize);
                const pixelCounts = this.calculateRatioPixelCounts(currentSpacesPlot, ratios);
                
                // Generate nodal epicenters
                const epicenters = this.generateNodalEpicenters(ratios.length);
                const seeds = [];
                
                // Order of distribution to epicenters
                // OPTION 2: Alternating Size Distribution (prevents clustering)
                const sortedRatios = [...ratios]
                    .sort((a, b) => b.gridOccupation - a.gridOccupation) // Largest first
                    .reduce((result, ratio, index) => {
                        // Alternate between beginning and end of array
                        if (index % 2 === 0) {
                            result.push(ratio); // Even indices go to end
                        } else {
                            result.unshift(ratio); // Odd indices go to beginning
                        }
                        return result;
                    }, []);

                
                // Assign each ratio to an epicenter and generate seeds around it
                const totalGridOccupation = sortedRatios.reduce((sum, ratio) => sum + ratio.gridOccupation, 0);
                const totalSeedBudget = 300; // Increase total seeds for better distribution

                console.log('=== SEED DISTRIBUTION DEBUG ===');
                console.log('Total grid occupation:', totalGridOccupation);

                sortedRatios.forEach((ratio, index) => {
                    const epicenter = epicenters[index % epicenters.length];
                    
                    // Calculate actual percentage of total grid
                    const localPercent = (ratio.gridOccupation / totalGridOccupation) * 100;
                    const isWater = localPercent > 10;
                    
                    // Seed count should be proportional to area percentage
                    const targetAreaPercent = localPercent / 100;
                    const seedCount = Math.max(3, Math.floor(targetAreaPercent * totalSeedBudget));
                    
                    console.log(`Ratio ${ratio.fraction}: ${localPercent.toFixed(1)}% (${isWater ? 'OCEAN' : 'CONTINENT'}) - ${seedCount} seeds`);
                    
                    // Convert epicenter to texture coordinates
                    const epicenterU = (Math.atan2(epicenter.z, epicenter.x) + Math.PI) / (2 * Math.PI);
                    const epicenterV = (Math.acos(epicenter.y) / Math.PI);
                    const epicenterX = epicenterU * textureSize;
                    const epicenterY = epicenterV * textureSize;
                    
                    // Calculate cluster radius - larger percentage = larger spread
                    const baseRadius = Math.sqrt(targetAreaPercent) * textureSize * 0.4;
                    const clusterRadius = Math.max(20, baseRadius); // Minimum radius
                    
                    console.log(`  Epicenter: (${epicenterX.toFixed(0)}, ${epicenterY.toFixed(0)}), Radius: ${clusterRadius.toFixed(0)}`);
                    
                    for (let i = 0; i < seedCount; i++) {
                        // Use normal distribution for more realistic clustering
                        const angle = Math.random() * 2 * Math.PI;
                        const distance = Math.random() * clusterRadius;
                        
                        const seedX = Math.max(0, Math.min(textureSize - 1, 
                            epicenterX + Math.cos(angle) * distance));
                        const seedY = Math.max(0, Math.min(textureSize - 1, 
                            epicenterY + Math.sin(angle) * distance));
                        
                        seeds.push({
                            x: seedX,
                            y: seedY,
                            ratio: ratio,
                            ratioIndex: index,
                            epicenterIndex: index,
                            localPercent: localPercent,
                            isWater: isWater
                        });
                    }
                });

                console.log(`Total seeds created: ${seeds.length}`);
                console.log('=== END SEED DEBUG ===');

                // Store seeds for click detection
                this.lastGeneratedSeeds = [...seeds];
                
                // Store territory assignments for border detection
                const territoryMap = new Array(textureSize * textureSize);
                
                // Assign territories with wave distortion (existing logic from generateWavyTerritoryTexture)
                for (let x = 0; x < textureSize; x++) {
                    for (let y = 0; y < textureSize; y++) {
                        const territoryAssignment = this.applyCoastlineWaves(
                            x, y, textureSize, null, seeds, compositeWaves, spacesWaves
                        );
                        
                        const pixelIndex = y * textureSize + x;
                        territoryMap[pixelIndex] = territoryAssignment.closestSeed;
                        
                        const arrayIndex = pixelIndex * 4;
                        imageData.data[arrayIndex] = territoryAssignment.color[0];     // R
                        imageData.data[arrayIndex + 1] = territoryAssignment.color[1]; // G  
                        imageData.data[arrayIndex + 2] = territoryAssignment.color[2]; // B
                        imageData.data[arrayIndex + 3] = 255;                          // A
                    }
                }
                
                // Draw borders between different ratio territories (existing logic)
                ctx.putImageData(imageData, 0, 0);
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.8;
                
                for (let x = 1; x < textureSize - 1; x++) {
                    for (let y = 1; y < textureSize - 1; y++) {
                        const currentIndex = y * textureSize + x;
                        const current = territoryMap[currentIndex];
                        
                        // Check neighbors for territory changes
                        const neighbors = [
                            territoryMap[(y-1) * textureSize + x], // top
                            territoryMap[(y+1) * textureSize + x], // bottom  
                            territoryMap[y * textureSize + (x-1)], // left
                            territoryMap[y * textureSize + (x+1)]  // right
                        ];
                        
                        // Draw border if any neighbor belongs to different ratio
                        if (neighbors.some(neighbor => 
                            neighbor && current && 
                            neighbor.ratio.fraction !== current.ratio.fraction)) {
                            ctx.fillStyle = '#FFFFFF';
                            ctx.fillRect(x, y, 1, 1);
                        }
                    }
                }

                return new THREE.CanvasTexture(canvas);
            }

            applyCoastlineWaves(x, y, textureSize, closestSeed, allSeeds, compositeWaves, spacesWaves) {
                // Safety check for empty seeds array
                if (!allSeeds || allSeeds.length === 0) {
                    return {
                        color: [100, 100, 100], // Gray fallback color
                        closestSeed: null
                    };
                }
                
                // Find closest seed with wave distortion
                let wavedClosest = allSeeds[0]; // Initialize with first seed
                let wavedMinDistance = Infinity;
                
                // Calculate wave position
                const boundaryProgress = (x + y) / (textureSize * 2);
                const waveIndex = Math.floor(boundaryProgress * Math.min(compositeWaves.length, spacesWaves.length));
                const safeIndex = Math.max(0, Math.min(waveIndex, compositeWaves.length - 1));
                
                const compositeWave = compositeWaves[safeIndex] || 0;
                const spacesWave = spacesWaves[safeIndex] || 0;
                
                const waveAmplitude = 8;
                const waveX = compositeWave * waveAmplitude * Math.sin(boundaryProgress * Math.PI * 8);
                const waveY = spacesWave * waveAmplitude * Math.cos(boundaryProgress * Math.PI * 6);
                
                const wavedX = x + waveX;
                const wavedY = y + waveY;
                
                // Find closest territory
                allSeeds.forEach(seed => {
                    const distance = Math.sqrt((wavedX - seed.x)**2 + (wavedY - seed.y)**2);
                    if (distance < wavedMinDistance) {
                        wavedMinDistance = distance;
                        wavedClosest = seed;
                    }
                });
                
                // Safety check for valid closest seed
                if (!wavedClosest) {
                    return {
                        color: [100, 100, 100], // Gray fallback color
                        closestSeed: null
                    };
                }
                
                // Generate unique colors for each ratio region
                const baseColor = wavedClosest.isWater ? 
                    [0, 102, 204] : [34, 139, 34]; // Blue/Green base
                
                // Add ratio-specific color variation
                const hueShift = (wavedClosest.ratioIndex * 30) % 360;
                const adjustedColor = this.adjustColorHue(baseColor, hueShift);
                
                return {
                    color: adjustedColor,
                    closestSeed: wavedClosest
                };
            }

            adjustColorHue(baseColor, hueShift) {
                // Simple hue adjustment for ratio differentiation
                const [r, g, b] = baseColor;
                const factor = 1 + (hueShift / 360) * 0.3; // Subtle variation
                
                return [
                    Math.min(255, Math.floor(r * factor)),
                    Math.min(255, Math.floor(g * factor)), 
                    Math.min(255, Math.floor(b * factor))
                ];
            }

            generateTerritoryWithBorders(ratios, compositeWaves, spacesWaves) {
                const textureSize = 1024;
                const canvas = document.createElement('canvas');
                canvas.width = textureSize;
                canvas.height = textureSize;
                const ctx = canvas.getContext('2d');
                
                const imageData = ctx.createImageData(textureSize, textureSize);
                const pixelCounts = this.calculateRatioPixelCounts(currentSpacesPlot, ratios);
                
                // Generate seeds with ratio identification
                const seeds = [];
                ratios.forEach((ratio, ratioIndex) => {
                    const pixelCount = pixelCounts.get(ratio.fraction) || 0;
                    const totalPixels = Array.from(pixelCounts.values()).reduce((a,b) => a+b, 0);
                    const seedCount = Math.max(1, Math.floor((pixelCount / totalPixels) * 30));
                    
                    for (let i = 0; i < seedCount; i++) {
                        seeds.push({
                            x: Math.random() * textureSize,
                            y: Math.random() * textureSize,
                            ratio: ratio,
                            ratioIndex: ratioIndex, // For unique colors
                            isWater: (ratio.frequency / currentSpacesPlot.length) > 0.1
                        });
                    }
                });
                
                // Store territory assignments for border detection
                const territoryMap = new Array(textureSize * textureSize);
                
                // Assign territories with wave distortion
                for (let x = 0; x < textureSize; x++) {
                    for (let y = 0; y < textureSize; y++) {
                        const territoryAssignment = this.applyCoastlineWaves(
                            x, y, textureSize, null, seeds, compositeWaves, spacesWaves
                        );
                        
                        const pixelIndex = y * textureSize + x;
                        territoryMap[pixelIndex] = territoryAssignment.closestSeed;
                        
                        const arrayIndex = pixelIndex * 4;
                        imageData.data[arrayIndex] = territoryAssignment.color[0];     // R
                        imageData.data[arrayIndex + 1] = territoryAssignment.color[1]; // G  
                        imageData.data[arrayIndex + 2] = territoryAssignment.color[2]; // B
                        imageData.data[arrayIndex + 3] = 255;                          // A
                    }
                }
                
                // Draw borders between different ratio territories
                ctx.putImageData(imageData, 0, 0);
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 1;
                ctx.globalAlpha = 0.8;
                
                for (let x = 1; x < textureSize - 1; x++) {
                    for (let y = 1; y < textureSize - 1; y++) {
                        const currentIndex = y * textureSize + x;
                        const current = territoryMap[currentIndex];
                        
                        // Check neighbors for territory changes
                        const neighbors = [
                            territoryMap[(y-1) * textureSize + x], // top
                            territoryMap[(y+1) * textureSize + x], // bottom  
                            territoryMap[y * textureSize + (x-1)], // left
                            territoryMap[y * textureSize + (x+1)]  // right
                        ];
                        
                        // Draw border if any neighbor belongs to different ratio
                        if (neighbors.some(neighbor => 
                            neighbor && current && 
                            neighbor.ratio.fraction !== current.ratio.fraction)) {
                            ctx.fillStyle = '#FFFFFF';
                            ctx.fillRect(x, y, 1, 1);
                        }
                    }
                }
                
                return new THREE.CanvasTexture(canvas);
            }   

            clearMapping() {
                this.hidePointInfo();
                
                // Initialize arrays if they don't exist
                if (!this.petals) this.petals = [];
                if (!this.landmarkData) this.landmarkData = [];
                
                // Remove petals
                this.petals.forEach(petal => {
                    this.scene.remove(petal.mesh);
                    petal.mesh.geometry.dispose();
                    petal.mesh.material.dispose();
                });
                this.petals = [];
                
                // Remove instanced landmarks
                if (this.instancedLandmarks) {
                    this.scene.remove(this.instancedLandmarks);
                    this.instancedLandmarks.geometry.dispose();
                    this.instancedLandmarks.material.dispose();
                    this.instancedLandmarks = null;
                }
                
                this.landmarks = [];
                this.landmarkData = [];
                this.ratioEpicenters = [];
                this.lastGeneratedSeeds = []; // Clear stored seeds
            }

            clearTerrain() {
                this.terrainFeatures.forEach(feature => {
                    this.scene.remove(feature);
                    feature.geometry.dispose();
                    feature.material.dispose();
                });
                this.terrainFeatures = [];
            }

            toggleTerrain(show) {
                this.showTerrain = show;
                this.terrainFeatures.forEach(feature => {
                    feature.visible = show;
                });
            }
            
            animate() {
                requestAnimationFrame(() => this.animate());
                
                const now = performance.now();
                const deltaTime = now - this.lastRenderTime;
                const targetInterval = 1000 / this.targetFPS;
                
                // Skip frame if we're rendering too frequently
                if (deltaTime < targetInterval) return;
                
                // Only render if something changed
                let needsRender = false;
                
                // Check for input
                const hasInput = Object.values(this.keys).some(pressed => pressed);
                if (hasInput) {
                    this.updateFlightControls();
                    needsRender = true;
                }
                
                // Only render when needed
                if (needsRender || this.renderDirty) {
                    this.renderer.render(this.scene, this.camera);
                    this.lastRenderTime = now;
                    this.renderDirty = false;
                }
            }
        }
        
        const sphereMapper = new SphereMapper();
        window.sphereMapper = sphereMapper;
        
        // Update sphere map function
        function updateSphereMap() {
            sphereMapper.updateMapping(currentSpacesPlot, currentRatios);
        }
        
        // Toggle display panel (like visualization.js)
        function toggleDisplayPanel() {
            const controls = document.getElementById('displayControls');
            const button = document.getElementById('minimizeDisplayPanel');
            const isMinimized = controls.style.display === 'none';
            
            if (isMinimized) {
                controls.style.display = 'block';
                button.textContent = '−';
            } else {
                controls.style.display = 'none';
                button.textContent = '+';
            }
        }
        
        // Initialize with default values
        document.addEventListener('DOMContentLoaded', function() {
            // Initialize sphere mapper
            sphereMapper.init();
            
            // Generate initial mapping
            generateMapping();
        });