# Large Rhythm Collider

![Large Rhythm Collider interface](assets/images/mainpage1.png)

The Large Rhythm Collider (LRC) is a browser-based engine for exploring polyrhythms as audiovisual systems. It analyzes up to four rhythmic layers, derives composite patterns, and serializes the resulting interference into playable just-intonation tuning systems. Every panel on the interface is draggable, expandable, and designed for live experimentation.

For an in-depth walkthrough of the concepts, features, and rich media gallery, read the standalone [About page](about.html) (also accessible within the app).

## Live Experience

- Public build: **https://www.largerhythmcollider.com**
- Local preview: open `index.html` in any modern browser (see Quickstart for details)

## Quickstart

### Requirements

- Modern browser with Web Audio API & ES6 support (Chrome 66+, Firefox 60+, Safari 14.1+, Edge 79+)
- Hardware acceleration recommended for smooth visualizations
- Minimum 4 GB RAM and multi-core CPU for heavy polyrhythm processing
- Stereo audio output; dedicated audio interface recommended for low latency

### Launching Locally

1. Clone or download this repository.
2. Open `index.html` directly in your preferred browser.
3. Allow audio permissions when prompted.
4. Click anywhere if the browser suspends audio on first load, then start generating rhythms.

### First-Run Checklist

- [ ] Audio context activates (browser may require a click).
- [ ] Web Audio API available (check console for errors if silent).
- [ ] Try sample inputs such as `3:2` or `7:5:3:2`.
- [ ] Confirm playback and visualization updates.
- [ ] Test an export path (e.g., MIDI download) if needed.

## Technical Architecture

- **Core Interface (`Core Interface/`)**  
  DOM controllers and panel logic for Rhythm Input, Info, Visualizations, Search, Partitions UI, and inline About content. Handles drag/drop layout, panel state, and data binding.

- **Analysis Engine (`Core Interface` & shared modules)**  
  Computes least common multiples, composite rhythm sequences, palindromic spaces plots, nested ratio detection, and tuning serialization (ratios → frequencies → cents).

- **Playback System (`Playback/`, Web Audio)**  
  Orchestrated by `Playback/ToneRowPlayback.js` with focused modules for UI (`PlaybackMainUI`, `LayerControlsUI`, `ScaleSelectionUI`, `ConsonanceFamiliesUI`) and engine logic (`AudioEngine`, `Scheduler`). Handles envelopes, filters, scale selection, and tick-based scheduling. Partitions engine offers sequenced drum accompaniment.

- **Visualization Layer (`Visualizations/`)**  
  Individual renderers (Linear Plot, Centrifuge, Hinges, Collider, etc.) subscribe to rhythm state updates and translate structural data into canvases/SVG animations.

- **Collections & Search (`Core Interface/Collections.js`, `Core Interface/LRCSearch.js`)**  
  Client-side services for browsing community submissions, submitting current rhythms, and running layered/grid/fundamental/Inverse PG searches.

- **Standalone Docs (`about.html`)**  
  Narrative overview of concepts, history, and imagery. The main app lazy-loads and sanitizes this file for the inline About panel while stripping media for a lightweight in-app view.

## Accessibility

The interface is built with semantic landmarks, keyboard-accessible controls, screen-reader labelling, and high-contrast defaults. Users can still generate dense visuals or rapid animations by pushing the engine with extreme values; if you run into accessibility barriers or need alternative representations, please reach out at [aqldrum@gmail.com](mailto:aqldrum@gmail.com) so improvements can be prioritised.

## Contributing

This repository is published for reference and learning. Please do not submit pull requests. If you discover a critical issue, feel free to open an issue so it can be reviewed when time allows.

## License

© Avery Logan. All rights reserved. Source code is published for reference; no redistribution or derivative use is permitted without written permission.

If you would like to discuss collaboration, or licensing, please reach out to aqldrum@gmail.com.
