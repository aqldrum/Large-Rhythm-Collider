// tour-flag.js — the guided tour is behind a flag while it is refined: off, the main page gets only the old slide
// tutorial (TutorialUI.js: opens on load until "Do not show again", the menu's "Show Tutorial"); on, the tour
// (tour-boot.js) and "Read the guide" for the slides.
//
//   ?tour=1   turns the tour on, and remembers it in this browser (localStorage `lrc.tour.enabled`)
//   ?tour=0   turns it off again and forgets
//   window.LRC_TOUR_ENABLED   the answer (a boolean), set before TutorialUI.js and tour-boot.js read it
//
// A classic script, loaded before them. Storage that throws counts as "not remembered": off, unless the URL says on.
(() => {
    const KEY = 'lrc.tour.enabled';
    let enabled = false;
    try {
        const q = new URLSearchParams(window.location.search).get('tour');
        let store = null;
        try { store = window.localStorage; } catch { /* blocked: the URL alone decides */ }
        if (q === '1') {
            enabled = true;
            try { store?.setItem(KEY, '1'); } catch { /* unremembered */ }
        } else if (q === '0') {
            try { store?.removeItem(KEY); } catch { /* unforgotten */ }
        } else {
            try { enabled = store?.getItem(KEY) === '1'; } catch { /* off */ }
        }
    } catch { /* off */ }
    window.LRC_TOUR_ENABLED = enabled;
})();
