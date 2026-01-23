const HEADING_LEVELS = {
    H2: 2,
    H3: 3,
    H4: 4,
    H5: 5,
    H6: 6
};

class AboutPanel {
    constructor() {
        this.aboutSection = document.getElementById('about-panel');
        this.aboutContentContainer = document.getElementById('about-panel-content');
        this.isAboutLoaded = false;

        if (!this.aboutSection || !this.aboutContentContainer) {
            return;
        }

        this.observeSectionToggle();
        this.lazyLoadAboutContent();
    }

    observeSectionToggle() {
        this.aboutSection.addEventListener('dropdownsectiontoggle', (event) => {
            if (event && event.detail && event.detail.expanded && !this.isAboutLoaded) {
                this.loadAboutContent();
            }
        });
    }

    lazyLoadAboutContent() {
        const load = () => this.loadAboutContent();
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(load);
        } else {
            setTimeout(load, 400);
        }
    }

    async loadAboutContent() {
        if (this.isAboutLoaded || !this.aboutContentContainer) {
            return;
        }

        try {
            const response = await fetch('about.html', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const main = doc.querySelector('main');

            if (!main) {
                throw new Error('No <main> element found in about.html');
            }

            const fragment = document.createDocumentFragment();
            const headings = Array.from(main.querySelectorAll('h2'));

            if (headings.length === 0) {
                const mainClone = main.cloneNode(true);
                this.stripMedia(mainClone);
                fragment.appendChild(mainClone);
            } else {
                headings.forEach((heading, index) => {
                    const topDetail = this.createDetailElement(heading, HEADING_LEVELS.H2, index === 0);
                    fragment.appendChild(topDetail);

                    const sectionStack = [];
                    let pointer = heading.nextSibling;

                    while (pointer) {
                        if (pointer.nodeType === Node.TEXT_NODE) {
                            const text = pointer.textContent.trim();
                            if (text) {
                                const autoParagraph = document.createElement('p');
                                autoParagraph.textContent = text;
                                this.appendToCurrentSection(topDetail, sectionStack, autoParagraph);
                            }
                            pointer = pointer.nextSibling;
                            continue;
                        }

                        if (pointer.nodeType !== Node.ELEMENT_NODE) {
                            pointer = pointer.nextSibling;
                            continue;
                        }

                        const tagName = pointer.tagName.toUpperCase();
                        if (tagName === 'H2') {
                            break;
                        }

                        const level = HEADING_LEVELS[tagName];
                        if (level) {
                            while (sectionStack.length && sectionStack[sectionStack.length - 1].level >= level) {
                                sectionStack.pop();
                            }

                            const parentDetail = sectionStack.length
                                ? sectionStack[sectionStack.length - 1].element
                                : topDetail;

                            const subDetail = this.createDetailElement(pointer, level, false);
                            parentDetail.appendChild(subDetail);
                            sectionStack.push({ level, element: subDetail });

                            pointer = pointer.nextSibling;
                            continue;
                        }

                        if (tagName === 'TABLE') {
                            const tableBlock = this.createTableBlock(pointer);
                            if (tableBlock) {
                                this.appendToCurrentSection(topDetail, sectionStack, tableBlock);
                            }
                            pointer = pointer.nextSibling;
                            continue;
                        }

                        const clone = pointer.cloneNode(true);
                        this.stripMedia(clone);
                        if (
                            clone.nodeType === Node.ELEMENT_NODE &&
                            !clone.childElementCount &&
                            !clone.textContent.trim() &&
                            !['BR', 'HR'].includes(clone.tagName.toUpperCase())
                        ) {
                            pointer = pointer.nextSibling;
                            continue;
                        }

                        this.appendToCurrentSection(topDetail, sectionStack, clone);

                        pointer = pointer.nextSibling;
                    }
                });
            }

            this.aboutContentContainer.innerHTML = '';
            this.aboutContentContainer.appendChild(fragment);
            this.isAboutLoaded = true;
        } catch (error) {
            console.error('Failed to load About content:', error);
            this.aboutContentContainer.innerHTML = `
                <div class="about-error">
                    <p>Unable to load About content right now.</p>
                    <a href="about.html" target="_blank" rel="noopener">Open About page in a new tab ↗</a>
                </div>
            `;
        }
    }

    createDetailElement(headingNode, level, shouldOpen = false) {
        const detail = document.createElement('details');

        if (level === HEADING_LEVELS.H2) {
            detail.className = 'about-detail';
            detail.open = shouldOpen;
        } else {
            detail.className = 'about-subdetail';
            detail.classList.add(`about-level-${level}`);
        }

        const summary = document.createElement('summary');
        summary.innerHTML = headingNode.innerHTML.trim();
        detail.appendChild(summary);

        return detail;
    }

    appendToCurrentSection(rootDetail, stack, node) {
        const targetDetail = stack.length ? stack[stack.length - 1].element : rootDetail;
        targetDetail.appendChild(node);
    }

    stripMedia(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        this.removeIds(element);

        element.querySelectorAll('figure').forEach((figure) => {
            if (figure.querySelector('img, picture')) {
                this.removeAdjacentBreaks(figure);
                figure.remove();
            }
        });

        element.querySelectorAll('img, picture').forEach((node) => {
            if (node.parentNode) {
                this.removeAdjacentBreaks(node);
            }
            node.remove();
        });

    }

    removeAdjacentBreaks(node) {
        if (!node || !node.parentNode) {
            return;
        }

        const isBreak = (sibling) =>
            sibling &&
            sibling.nodeType === Node.ELEMENT_NODE &&
            sibling.tagName.toUpperCase() === 'BR';
        const isWhitespace = (sibling) =>
            sibling &&
            sibling.nodeType === Node.TEXT_NODE &&
            !sibling.textContent.trim();

        let prev = node.previousSibling;
        while (prev && (isWhitespace(prev) || isBreak(prev))) {
            const nextPrev = prev.previousSibling;
            prev.remove();
            prev = nextPrev;
        }

        let next = node.nextSibling;
        while (next && (isWhitespace(next) || isBreak(next))) {
            const nextNext = next.nextSibling;
            next.remove();
            next = nextNext;
        }
    }

    removeIds(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        if (node.hasAttribute('id')) {
            node.removeAttribute('id');
        }

        node.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
    }

    nodeHasContent(node) {
        if (!node) {
            return false;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent.trim().length > 0;
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'BR' || node.tagName === 'HR') {
                return true;
            }
            return node.textContent.trim().length > 0;
        }

        return false;
    }

    createTableBlock(tableNode) {
        if (!tableNode) {
            return null;
        }

        const doc = tableNode.ownerDocument || document;
        const wrapper = doc.createElement('div');
        wrapper.className = 'about-table-block';

        const appendNode = (node) => {
            if (!node) return;

            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                if (!text) return;
                const paragraph = doc.createElement('p');
                paragraph.textContent = text;
                wrapper.appendChild(paragraph);
                return;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toUpperCase();
                if (tag === 'IMG' || tag === 'PICTURE' || tag === 'FIGURE') {
                    return;
                }

                if (tag === 'TABLE') {
                    const nestedBlock = this.createTableBlock(node);
                    if (nestedBlock) {
                        wrapper.appendChild(nestedBlock);
                    }
                    return;
                }

                const clone = node.cloneNode(true);
                this.stripMedia(clone);
                this.removeIds(clone);
                if (this.nodeHasContent(clone)) {
                    wrapper.appendChild(clone);
                }
            }
        };

        if (tableNode.rows && tableNode.rows.length) {
            Array.from(tableNode.rows).forEach((row) => {
                Array.from(row.cells).forEach((cell) => {
                    Array.from(cell.childNodes).forEach((child) => appendNode(child));
                });
            });
        } else {
            Array.from(tableNode.childNodes).forEach((child) => appendNode(child));
        }

        if (!wrapper.childNodes.length) {
            return null;
        }

        this.removeIds(wrapper);
        return wrapper;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('about-panel')) {
        window.aboutPanel = new AboutPanel();
    }
});
