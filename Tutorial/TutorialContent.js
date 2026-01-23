window.LRCTutorialSlides = [
    {
        title: 'Welcome to the Large Rhythm Collider!',
        body: [
            'This app explores creative applications of polyrhythms.',
            'Use rhythms to generate music and visualizations!',
            'This guide will cover the core concepts and basic features.',
            'Explore the deep structure of musical rhythm, or just have fun seeing what you can create with 4 numbers!',
            'Click the dropdown arrow to visit the About page for more details.'
        ],
    },
    {
        title: 'Rhythm Input',
        body: [
            'The LRC accepts a polyrhythm with up to 4 frequency layers through Rhythm Input.',
            'All rhythm layers run on the same cycle. Their value determines the number of equal pulse divisions per layer.',
            'Values can be input in any order, but will automatically sort greatest to least.',
            'The engine analyzes the polyrhythm and prepares it to generate audiovisual ouput.'
        ],
        image: 'assets/images/rhythminput.png',
        imageAlt: 'Rhythm input panel'
    },
    {
        title: 'Tuning Systems',
        body: [
            'Each rhythm "tunes" itself based on its own unique inner structure.',
            'Intervals of time are converted into intervals of pitch.',
            'Each layer becomes a melody based on its contributions to the scale.',
            'Because these intervals are based on ratios, they produce pitches outside of our common modern tuning system (12-tone equal temperament).',
            'The Scale charts display conversions of these ratios to cents. There are 1200 cents in an octave, 100 for each half step in 12TET.',
            'Check out the Mathematical Foundation section of the About page for a step-by-step description of the serialization method.'
        ],
        image: 'assets/images/rhythminfo2.png',
        imageAlt: 'Scale chart'
    },
    {
        title: 'Rhythm Info',
        body: [
            'Once a rhythm is generated, Rhythm Info displays its core metrics and tuning system.',
            'The Spaces Plot and Composite Rhythm are two ways of encoding the full rhythm sequence.',
            'Spaces Plot is used for the main visualization and the creation of the tuning system.',
            'Double-click the title bar to open Expanded Info View with extra information.',
            'Use the Interconsonance analyzer to reveal familiar-sounding intervals within the scale.',
            'Alongside general info, Export also allows you to download MIDI clips from each layer, along with tuning files for software synthesizers.',
            'Details on metrics, analysis and export can be found in Key Features.'
        ],
        image: 'assets/images/rhythminfo.png',
        imageAlt: 'Rhythm Info div'
    },
    {
        title: 'Playback',
        body: [
            'Every node in the rhythm has a note in the scale.',
            'The Playback system offers DAW-like control over individual layers, with global rhythm settings in Main Controls.',
            'Cycle time determines the length of one full loop of the rhythm. A safe minimum is calculated to avoid dangerous audio. You can adjust the Cycle length in real time.',
            'The Fundamental frequency determines the tuning of the lowest pitch, 1/1. Other notes are tuned relative to this frequency, which defaults to A110.',
            'Master Volume has a final limiter and safe default, but be cautious when playing multiple layers at full volume.',
            'Use the simple global filters to carve out the sound as desired.'
        ],
        image: 'assets/images/maincontrols2.png',
        imageAlt: 'Main Controls section'
    },
    {
        title: 'Layer Controls',
        body: [
            'Toggle A B C D to edit individual layer controls.',
            'Select sine, triangle, saw, or square wave for each layer oscillator.',
            'Mix layer volumes individually, or solo / mute them to hear their unique identities.',
            'Layers have individual ADSR amplitude envelopes for sound design.',
            'The Legato button acts like a sustain pedal.',
            'Layers also have individual filters independent of the global filter.'
        ],
        image: 'assets/images/layercontrols.png',
        imageAlt: 'Layer Controls panel'
    },
    {
        title: 'Scale Selection',
        body: [
            'The Scale Selection panel lets you toggle individual notes on and off.',
            'The chart displays the appearance count for each ratio in the overall rhythm.',
            'Disabling a note in Scale Selection will also switch off its lights in the main Linear Plot.',
            'Combine minimal Scale Selection with Legato mode to hear more minimal sustained harmonies.',
            'After running Interconsonance Analysis in Rhythm Info, you can select Families of notes instantly.',
            'Using Scale Selection disables the minimum cycle time restrictions.'
        ],
        image: 'assets/images/scaleselection.png',
        imageAlt: 'Scale selection panel'
    },
    {
        title: 'Visualizations',
        body: [
            'Experiment with 5 different visualization modes!',
            'Linear Plot, Centrifuge and Hinges work on the main browser canvas.',
            'Reflections and Collider are popouts.',
            'The main canvas modes are controlled by the Visualizations module.',
            'Visit the Visualizations in Key Features to explore the specifics of each mode.',
        ],
        image: 'assets/images/linearplot3.png',
        imageAlt: 'Linear plot display'
    },
    {
        title: 'Search Algorithms',
        body: [
            'Search Algorithms allow you to define parameters for specific rhythm results.',
            'Define a set number of pitches per scale and run one of the four search algorithms for a set max time.',
            'Rhythms can be found according to Layer values, Grid length, Fundamental ratio generator or by a special "Inverse PG" property.',
            'Use Apply to send any rhythm result to the main Rhythm Input.',
            'Check the Search & Analysis section for an in-depth explanation of the search methods.',
        ],
        image: 'assets/images/layersearch.png',
        imageAlt: 'Layer value search input'
    },
    {
        title: 'Collections',
        body: [
            'With Collections, you can add your personal favorites to a shared database and explore rhythms submitted by others.',
            'Open Collections in the dropdown menu, under the About section.',
            'Instantly apply any rhythm in Collections to the main Rhythm Input.',
            'Submit a rhythm with a vote endorsing its Playback or Visualizations. You can also vote on already-submitted rhythms.',
            'Have fun exploring the strange and beautiful universe of polyrhythms!'
        ],
        image: 'assets/images/collectionsbrowse.png',
        imageAlt: 'Collections browse tab'
    },
];
