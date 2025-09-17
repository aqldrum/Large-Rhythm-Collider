# Large Rhythm Collider

## Overview
You've found the Large Rhythm Collider! This website houses a complex apparatus designed for the analysis of Polyrhythms. 

![](2025-08-07-01-14-20.png)

The Large Rhythm Collider offers a suite of analytical and creative tools which parse the fine details of polyrhythmic structures, utilizing this information as the generative source code for a range of audiovisual applications. Art and mathematics intersect and unlock a universe of esoteric beauty!

If you've never encountered polyrhythms before, there are lots of great resources online which explain the basics. From rather simple principles cascades an arcane, opaque trove of patterned syncopation and structure. I always wondered what sort of things would be unveiled by peering deeper into this mathematical space. Ideas that began as thought experiments and practice routines led me down the rabbithole to the architecture of this program. I hope you'll enjoy this journey as much as I have!

The LRC is designed to analyze polyrhythms of up to 4 layers. These layer combinations a:b:c:d encode a sophisticated logic which generates the DNA of the engine. The limitation to 4 layers is both a drummer's analogy and a combinatorial consideration. 

## Key Features
### Core Functionality
- Polyrhythm input and processing (up to 4 layers)

  In the main Rhythm Input section, the user can enter up to 4 layers of frequency and use Generate to process them through the core analytical engine.

- [ ] Composite rhythm generation
- [ ] Spaces plot calculation
- [ ] Automatic scale/tuning system derivation
- [ ] Real-time audio playback with wavetable synthesis

### Audio & Export
- [ ] Real-time tempo adjustment
- [ ] Individual layer soloing
- [ ] ADSR envelope control
- [ ] MIDI export by layer
- [ ] .tun tuning file export [planned]

### Visualization
- [ ] Rhythm pattern visualization
- [ ] Symmetrical structure display
- [ ] [Describe WorldMaps features if included]

### Search & Analysis
- [ ] Rhythm-scale search algorithms
- [ ] 12-tone Codex results
- [ ] [Other search criteria]

## Quick Start

### Technical Requirements

#### Browser Compatibility
- **Required**: Modern browser with Web Audio API support
  - Chrome 66+ (recommended for best performance)
  - Firefox 60+
  - Safari 14.1+
  - Edge 79+
- **Required**: JavaScript ES6+ support
- **Recommended**: Hardware acceleration enabled for smooth visualizations

#### System Requirements
- **RAM**: Minimum 4GB recommended for complex polyrhythm calculations
- **CPU**: Multi-core processor recommended for real-time audio processing
- **Audio**: Dedicated audio hardware preferred for low-latency playback
- **Display**: Minimum 1024x768 for full interface visibility

#### Audio System Requirements
- **Sample Rate**: 44.1kHz or 48kHz (automatically detected)
- **Buffer Size**: Adjustable via Web Audio API (128-1024 samples)
- **Latency**: <50ms for real-time parameter adjustment
- **Channels**: Stereo output supported

### Installation & Launch
1. Download or clone the repository
2. **Simply double-click `index.html`** to open in your default browser
   - Or right-click → "Open with" → choose your preferred browser
3. Allow audio permissions when prompted
4. Start exploring polyrhythms!

### First Run Checklist
- [ ] Audio context activated (click anywhere if needed)
- [ ] Web Audio API detected (check browser console for errors)
- [ ] Test basic rhythm input (try 3:4 polyrhythm)
- [ ] Verify playback functionality
- [ ] Check export functionality (MIDI download)

### Usage
1. [Basic steps to get started]
2. [How to input rhythms]
3. [How to use playback]
4. [How to export results]

## Technical Architecture
### Core Modules
- **LRCModule**: [brief description]
- **LRCVisuals**: [brief description]  
- **ToneRowPlayback**: [brief description]
- **LRCSearch**: [brief description]
- **LRCHudController**: [brief description]

### Physics/Collision System
- **Centrifuge**: [brief description]
- **Hinges**: [brief description]
- **Collider**: [brief description]
- **ColliderUI**: [brief description]
- **ColliderPlayer**: [brief description]
- **CollisionDetector**: [brief description]
- **BattleController**: [brief description]

## Mathematical Foundation
Up to 4 frequency layers are defined a:b:c:d.

The least common multiple of these numbers is the Grid, which is the length of the total cycle for this polyrhythm. When we divide the Grid by each of the layers, we get the grid duration or grouping size of each of those layers' pulses.

When we construct a list of all multiples of those pulse durations up to the Grid value, we get the attack positions of every note in the Composite Rhythm. 

By analyzing the pulse layers as one whole, we extract their synergy. If we take the difference between every position in the Composite Rhythm, we get the Spaces Plot - the unique series of durations encoded specifically by the layer inputs. We also track which layers generate which values in the spaces plot. This sequence is always a palindrome, as a consequence of its cyclic, multiplicative construction.

From here, we move to the core innovation of the Collider concept: serialization of the spaces plot into pitch information.

Just as the generating layer values represent ratios of frequencies, the unique durations of time generated by their interference patterns can also be assessed by their relative size. If we think of each of these values as the length of a period of a sound wave relative to all others in the set, we extract a tuning system!

The largest value in the spaces plot set is always the first, and last. It's the grouping size of the fastest layer: because this layer is the fastest, it is always the first to occur after the downbeat, and because it continues repeating with the same duration, no value in the plot can possibly be larger. This value is our Fundamental - it becomes the numerator against which all other ratios are compared as an undertone. 

Here's an example. 





## Known Limitations
- [ ] [Current bugs or incomplete features]
- [ ] [Performance considerations]

## Development Roadmap
### Version 1.1 Planned Features
- [ ] .tun tuning file export
- [ ] Individual layer volume controls
- [ ] Hi/lo pass filtration
- [ ] Generative percussion samples
- [ ] Enhanced search criteria beyond 12-tone

### Long-term Goals
- [ ] [Broader vision items]

## Contributing
[Guidelines for development setup, coding standards, etc.]

## License
[Your chosen license]

## Credits
[Any acknowledgments, mathematical references, etc.]
=======
# Large-Rhythm-Collider
>>>>>>> 8a737eb6c2f50e2dfbb24a27cafa3ff22083eb07
