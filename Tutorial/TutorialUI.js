// TUTORIAL (sprint 2, step 3): the guided tour (Tutorial/tour-boot.js, the header's "Take the tour") replaced this
// slide tutorial's flow. The slides stay as "the guide": the menu's "Read the guide" (#tutorial-slides-btn) and the
// tour's own "Read the guide" open them (window.LRCTutorialSlidesUI.show). They no longer open by themselves on load,
// and their "Do not show again" box is gone (the tour keeps its own first-visit flag, `lrc.tour.seen`).
(() => {
    const overlay = document.getElementById('tutorial-overlay');
    const closeFooterButton = document.querySelector('.tutorial-close-btn');
    const showButton = document.getElementById('tutorial-slides-btn');
    const slideContainer = document.getElementById('tutorial-slide-content');
    const prevButton = document.getElementById('tutorial-prev');
    const nextButton = document.getElementById('tutorial-next');
    const navStatus = document.getElementById('tutorial-nav-status');

    if (!overlay || !closeFooterButton || !slideContainer || !prevButton || !nextButton || !navStatus) {
        return;
    }

    const slides = Array.isArray(window.LRCTutorialSlides) ? window.LRCTutorialSlides : [];
    let currentIndex = 0;

    const renderSlide = (slide) => {
        slideContainer.innerHTML = '';

        if (!slide) {
            return;
        }
        const table = document.createElement('table');
        table.className = 'tutorial-slide-table';

        const row = document.createElement('tr');
        const textCell = document.createElement('td');
        textCell.className = 'tutorial-slide-text';

        const title = document.createElement('h3');
        title.id = 'tutorial-title';
        title.textContent = slide.title || 'Tutorial';
        textCell.appendChild(title);

        if (Array.isArray(slide.body)) {
            slide.body.forEach((paragraph) => {
                const p = document.createElement('p');
                p.textContent = paragraph;
                textCell.appendChild(p);
            });
        }

        row.appendChild(textCell);

        const imageData = typeof slide.image === 'string' ? { src: slide.image } : slide.image;
        if (imageData && imageData.src) {
            const mediaCell = document.createElement('td');
            mediaCell.className = 'tutorial-slide-media';

            const img = document.createElement('img');
            img.src = imageData.src;
            img.alt = imageData.alt || slide.imageAlt || '';
            mediaCell.appendChild(img);

            const caption = imageData.caption || slide.imageCaption;
            if (caption) {
                const captionEl = document.createElement('div');
                captionEl.className = 'tutorial-slide-caption';
                captionEl.textContent = caption;
                mediaCell.appendChild(captionEl);
            }

            row.appendChild(mediaCell);
        }

        table.appendChild(row);
        slideContainer.appendChild(table);
    };

    const updateNav = () => {
        const total = slides.length || 1;
        navStatus.textContent = `${currentIndex + 1} / ${total}`;
        prevButton.disabled = currentIndex <= 0;
        nextButton.disabled = currentIndex >= total - 1;
    };

    const goToSlide = (index) => {
        if (!slides.length) {
            renderSlide(null);
            currentIndex = 0;
            updateNav();
            return;
        }

        const clampedIndex = Math.max(0, Math.min(index, slides.length - 1));
        currentIndex = clampedIndex;
        renderSlide(slides[currentIndex]);
        updateNav();
    };

    const showTutorial = () => {
        overlay.style.display = 'flex';
        overlay.setAttribute('aria-hidden', 'false');
    };

    const hideTutorial = () => {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
    };

    const handleDismiss = () => {
        hideTutorial();
    };

    closeFooterButton.addEventListener('click', handleDismiss);

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            handleDismiss();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && overlay.style.display !== 'none') {
            handleDismiss();
        }
    });

    const openGuide = () => {
        if (window.lrcTour && window.lrcTour.active) window.lrcTour.end('guide');
        goToSlide(0);
        showTutorial();
    };

    if (showButton) {
        showButton.addEventListener('click', openGuide);
    }

    prevButton.addEventListener('click', () => {
        goToSlide(currentIndex - 1);
    });

    nextButton.addEventListener('click', () => {
        goToSlide(currentIndex + 1);
    });

    goToSlide(0);

    window.LRCTutorialSlidesUI = { show: openGuide, hide: hideTutorial, isOpen: () => overlay.style.display !== 'none' };
})();
