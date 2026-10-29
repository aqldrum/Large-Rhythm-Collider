// dom-stub.mjs — a small DOM for Node, enough to run the Composer's views (the lab's, the main page's tab) and the
// classic site scripts they meet: elements with children, attributes, style, classList, events, a few selectors, and
// a recording 2D canvas context. Not a browser: layout is fixed (every box is 100 × 20) and nothing paints.
//
//   const dom = makeDom();   dom.window, dom.document, dom.raf.flush(n), dom.byClass(root, name), dom.textOf(el)

export function recordingContext(canvas) {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const ctx = { canvas, calls, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter', imageSmoothingEnabled: true, imageSmoothingQuality: 'low', font: '10px sans-serif', textAlign: 'start' };
  for (const m of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'rect', 'fill', 'stroke', 'fillRect', 'clearRect', 'strokeRect', 'drawImage', 'setTransform', 'scale', 'translate', 'fillText', 'setLineDash', 'clip', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'roundRect']) ctx[m] = rec(m);
  // gradients (the site's lighting animation glows its dots): recorded, with a stop-taking stand-in
  for (const m of ['createRadialGradient', 'createLinearGradient']) ctx[m] = (...args) => { calls.push([m, ...args]); return { addColorStop() {} }; };
  // property writes that matter for a drawing are recorded too (fillStyle before a fill, etc.)
  return new Proxy(ctx, { set(t, k, v) { if (typeof k === 'string' && !['calls'].includes(k)) calls.push(['set', k, v]); t[k] = v; return true; } });
}

export function makeDom() {
  const listenersOf = new WeakMap();
  const on = (target, type, fn) => { let m = listenersOf.get(target); if (!m) listenersOf.set(target, (m = {})); (m[type] ||= []).push(fn); };
  const off = (target, type, fn) => { const m = listenersOf.get(target); if (m?.[type]) m[type] = m[type].filter((f) => f !== fn); };
  const fire = (target, type, event) => {
    const ev = event || { type };
    ev.type ??= type; ev.target ??= target; ev.preventDefault ??= () => {}; ev.stopPropagation ??= () => {};
    for (const f of [...(listenersOf.get(target)?.[type] || [])]) f(ev);
    if (type === 'click' && target.onclick) target.onclick(ev);
    return ev;
  };
  const ids = new Map();

  class Node {
    constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
    get children() { return this.childNodes.filter((c) => c instanceof Element); }
    get firstChild() { return this.childNodes[0] ?? null; }
    get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return p.childNodes[i + 1] ?? null; }
    get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
    hasChildNodes() { return this.childNodes.length > 0; }
    _adopt(n) { const node = typeof n === 'string' || typeof n === 'number' ? new Text(this.ownerDocument, String(n)) : n; if (node.parentNode) node.remove(); node.parentNode = this; return node; }
    append(...kids) { for (const k of kids) this.childNodes.push(this._adopt(k)); }
    prepend(...kids) { this.childNodes.unshift(...kids.map((k) => this._adopt(k))); }
    appendChild(k) { this.append(k); return k; }
    insertBefore(k, ref) { const n = this._adopt(k); const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); return k; }
    removeChild(k) { const i = this.childNodes.indexOf(k); if (i >= 0) this.childNodes.splice(i, 1); k.parentNode = null; return k; }
    replaceChildren(...kids) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this.append(...kids); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { this.replaceChildren(); if (v !== '' && v != null) this.append(String(v)); }
    addEventListener(t, f) { on(this, t, f); }
    removeEventListener(t, f) { off(this, t, f); }
    dispatchEvent(ev) { fire(this, ev.type, ev); return true; }
  }
  class Text extends Node { constructor(doc, data) { super(doc); this.data = data; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } }
  class ClassList {
    constructor(el) { this.el = el; }
    get list() { return this.el.className.split(/\s+/).filter(Boolean); }
    add(...c) { this.el.className = [...new Set([...this.list, ...c])].join(' '); }
    remove(...c) { this.el.className = this.list.filter((x) => !c.includes(x)).join(' '); }
    toggle(c, force) { const has = this.list.includes(c), want = force === undefined ? !has : !!force; if (want) this.add(c); else this.remove(c); return want; }
    contains(c) { return this.list.includes(c); }
  }
  class Element extends Node {
    constructor(doc, tag) {
      super(doc);
      this.tagName = tag.toUpperCase(); this.className = ''; this.attributes = {}; this.dataset = {};
      this.style = { cssText: '', setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
      this.classList = new ClassList(this); this._value = ''; this.disabled = false; this.title = ''; this.scrollLeft = 0; this.scrollTop = 0;
      if (this.tagName === 'CANVAS') { this.width = 300; this.height = 150; this._ctx = null; }
    }
    get id() { return this.attributes.id ?? ''; }
    set id(v) { this.attributes.id = v; ids.set(v, this); }
    get value() {
      if (this.tagName === 'SELECT') { const opts = this.options; if (this._value !== '' && opts.some((o) => o.value === this._value)) return this._value; const sel = opts.find((o) => o.selected); return sel ? sel.value : opts[0]?.value ?? ''; }
      return this._value;
    }
    set value(v) { this._value = v == null ? '' : String(v); }
    get options() { const out = []; const walk = (n) => { for (const c of n.children) { if (c.tagName === 'OPTION') out.push(c); else walk(c); } }; walk(this); return out; }
    setAttribute(k, v) { if (k === 'id') this.id = v; else if (k === 'class') this.className = v; else this.attributes[k] = String(v); }
    getAttribute(k) { return k === 'class' ? this.className : this.attributes[k] ?? null; }
    removeAttribute(k) { if (k === 'class') this.className = ''; else delete this.attributes[k]; }
    hasAttribute(k) { return k === 'class' ? !!this.className : k in this.attributes; }
    get clientWidth() { return 100; } get clientHeight() { return 20; }
    get scrollWidth() { return 100; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0 }; }
    focus() { this.ownerDocument.activeElement = this; } blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
    click() { fire(this, 'click', { target: this }); }
    getContext() { this._ctx ??= recordingContext(this); return this._ctx; }
    toDataURL() { return 'data:,'; }
    matches(sel) { return sel.split(',').some((one) => matchOne(this, one.trim())); }
    closest(sel) { for (let x = this; x instanceof Element; x = x.parentNode) if (x.matches(sel)) return x; return null; }
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
    set innerHTML(v) { this.replaceChildren(); this._html = v; }
    get innerHTML() { return this._html ?? ''; }
  }
  const matchOne = (el, sel) => {
    const last = sel.split(/\s+/).pop();
    const m = last.match(/^([a-zA-Z]*)((?:[#.][\w-]+)*)((?:\[[\w-]+(?:="[^"]*")?\])*)$/);
    if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    for (const part of m[2].match(/[#.][\w-]+/g) || []) {
      if (part[0] === '#' && el.id !== part.slice(1)) return false;
      if (part[0] === '.' && !el.classList.contains(part.slice(1))) return false;
    }
    // [attr] and [attr="value"] (a data-* attribute is found set by setAttribute or by dataset)
    for (const [, name, value] of (m[3] || '').matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const camel = name.startsWith('data-') ? name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()) : null;
      const v = name in el.attributes ? el.attributes[name] : camel && camel in el.dataset ? String(el.dataset[camel]) : undefined;
      if (v === undefined || (value !== undefined && v !== value)) return false;
    }
    return true;
  };

  const document = {
    activeElement: null,
    createElement: (tag) => new Element(document, tag),
    createTextNode: (t) => new Text(document, t),
    getElementById: (id) => ids.get(id) ?? null,
    querySelectorAll: (sel) => document.body.querySelectorAll(sel).concat(document.body.matches(sel) ? [document.body] : []),
    querySelector: (sel) => document.querySelectorAll(sel)[0] ?? null,
    addEventListener: (t, f) => on(document, t, f), removeEventListener: (t, f) => off(document, t, f),
    dispatchEvent: (ev) => { fire(document, ev.type, ev); return true; },
  };
  document.body = new Element(document, 'body');
  document.documentElement = new Element(document, 'html');

  const frames = [];
  const window = {
    document, devicePixelRatio: 1,
    addEventListener: (t, f) => on(window, t, f), removeEventListener: (t, f) => off(window, t, f),
    dispatchEvent: (ev) => { fire(window, ev.type, ev); return true; },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; },
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
  };
  window.window = window;
  class Event { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
  class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } }
  window.Event = Event; window.CustomEvent = CustomEvent;
  const raf = {
    /** run up to n queued frames (each may queue the next) → how many ran */
    flush(n = 1) { let ran = 0; while (ran < n && frames.length) { const f = frames.shift(); f(ran * 16); ran++; } return ran; },
    get pending() { return frames.length; },
  };
  /** make an element with an id, appended to the body (the lab's page has its ids in its HTML) */
  const withId = (tag, id) => { const e = document.createElement(tag); e.id = id; document.body.append(e); return e; };
  const byClass = (root, name) => root.querySelectorAll(`.${name}`);
  return { window, document, raf, withId, byClass, Element, Event, CustomEvent, fire };
}

/** install a DOM's globals (window, document, Event, requestAnimationFrame) for code that reads them bare → restore() */
export function installGlobals(dom, extra = {}) {
  const keys = ['window', 'document', 'Event', 'CustomEvent', 'requestAnimationFrame', ...Object.keys(extra)];
  const before = Object.fromEntries(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  set('window', dom.window); set('document', dom.document); set('Event', dom.Event); set('CustomEvent', dom.CustomEvent); set('requestAnimationFrame', dom.window.requestAnimationFrame);
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return () => { for (const k of keys) { if (before[k]) Object.defineProperty(globalThis, k, before[k]); else delete globalThis[k]; } };
}
