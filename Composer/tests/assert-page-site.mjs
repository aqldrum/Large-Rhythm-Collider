// assert-page-site.mjs — the Composer tab's footprint on the main page, in Node:
//   • every script and stylesheet index.html references exists, and the Composer's bridge and CSS are among them
//   • the module graph from the bridge (and from the lab) resolves: every relative import and worker URL is a file,
//     and nothing is a bare specifier
//   • LRCModule.js: no row-sized spread left — a 200k-onset spaces plot gets its fundamental (the version before the
//     fix overflowed the stack)
//   • LRCVisuals.js: with no overlay the Linear Plot draws exactly what it drew before (call for call, against the
//     sprint's base commit); with one, the hook is called once a draw with every dot's position; a 200k-dot plot
//     draws; the Composer's overlay over the real plot lights the real dots
//   • PartitionsUI.js: the tab strip [Partitions | Composer], the Composer's hosts swapped in and out (the mirrored
//     plot stays), the bridge mounted and shown, hidden on leaving the tab or the window, a loading wait
//   • sprint 2, step 1 (the Composition lens): the glyph in index.html's header beside the Cosmos button (hidden,
//     aria-pressed, an inline SVG, no text), its stylesheet, the lens's modules in the bridge's graph; LRCModule's
//     calculateTotalLCM with fewer than four layers (the live-site NaN fixed; four layers exactly as before);
//     ToneRowPlayback's and PartitionsGlobalControls' transport edits marked, and under the row lens unchanged
//   node Composer/tests/assert-page-site.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeDom } from './dom-stub.mjs';
import { loadClass, siteRhythm, ROOT } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { highlightsOf, plotOf } from '../page/plot-highlights.js';
import { createPlotOverlay } from '../page/plot-overlay.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const BASE = 'd9f2f85';   // composer-sprint before Phase C
const atBase = (file) => { try { return execFileSync('git', ['show', `${BASE}:${file}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); } catch { return null; } };

console.log('Composer tab — on the main page');
console.log('\n— index.html');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:)?\/\//.test(u));
const missing = refs.filter((u) => !fs.existsSync(path.join(ROOT, decodeURIComponent(u.split('?')[0]))));
check(`every local script and stylesheet it references exists (${refs.length})`, refs.length > 40 && missing.length === 0, missing.join(', '));
check('the Composer bridge is a module script, after the voice library\'s bridge; its CSS is linked', /<script type="module" src="Composer\/page\/composer-bridge\.js[^"]*"><\/script>/.test(html)
  && html.indexOf('Composer/page/composer-bridge.js') > html.indexOf('Audio/lrc-voices-bridge.js') && /<link rel="stylesheet" href="Composer\/page\/composer-tab\.css[^"]*">/.test(html));
check('the lab is still not linked from the page', !html.includes('composer-lab'));
{
  const controls = html.slice(html.indexOf('<div class="title-bar-controls">'), html.indexOf('</div>', html.indexOf('<div class="title-bar-controls">')));
  const glyph = controls.match(/<button id="composition-glyph"[^>]*>([\s\S]*?)<\/button>/);
  check('(sprint 2) the glyph is in the header\'s controls, before the Cosmos button: hidden until a rhythm, aria-pressed, a tooltip', !!glyph && controls.indexOf('composition-glyph') < controls.indexOf('cosmos-enter-btn')
    && /\shidden[\s>]/.test(glyph[0]) && /aria-pressed="false"/.test(glyph[0]) && /aria-label="Compose"/.test(glyph[0]) && /data-tip="Compose"/.test(glyph[0]) && /type="button"/.test(glyph[0]));
  check('… an inline SVG notation symbol, with no text on the button', !!glyph && /^<svg[\s\S]*<\/svg>$/.test(glyph[1].trim()) && glyph[1].replace(/<[^>]+>/g, '').trim() === '' && (glyph[1].match(/<ellipse/g) || []).length === 2);
  check('… its stylesheet is linked, and the bridge is a fresh version', /<link rel="stylesheet" href="Composer\/page\/composition-lens\.css\?v=\d+">/.test(html) && Number(html.match(/composer-bridge\.js\?v=([\d.]+)"/)?.[1]) >= 20261023);   // STEP 4e bumped it (20261025.1)
}

console.log('\n— the module graph');
function graph(entry) {
  const seen = new Set(), bad = [], stack = [path.join(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!fs.existsSync(file)) { bad.push(`missing ${path.relative(ROOT, file)}`); continue; }
    const src = fs.readFileSync(file, 'utf8');
    const specs = [...src.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s+['"]([^'"]+)['"]/gm), ...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm), ...src.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const s of specs) {
      if (!s.startsWith('./') && !s.startsWith('../')) { bad.push(`${path.relative(ROOT, file)}: bare "${s}"`); continue; }
      stack.push(path.resolve(path.dirname(file), s));
    }
  }
  return { files: [...seen].map((f) => path.relative(ROOT, f)), bad };
}
for (const entry of ['Composer/page/composer-bridge.js', 'Composer/lab/composer-lab.js']) {
  const g = graph(entry);
  check(`${entry}: ${g.files.length} modules, every import relative and found`, g.bad.length === 0 && g.files.length > 10, g.bad.join('; '));
  if (entry.includes('bridge')) check('the bridge reaches the worker, the shared controller and player, and the voice and drum libraries', ['Composer/core/compose-worker.js', 'Composer/perform/composer-controller.js', 'Composer/perform/composer-player.js', 'Audio/voices/voice.js', 'Audio/drums/index.js'].every((f) => g.files.includes(f)));
  if (entry.includes('bridge')) check('(sprint 2) … and the store, the lens, the glyph, the part strips and the panel locks', ['Composer/store/composition-store.js', 'Composer/page/lens.js', 'Composer/page/toolbar-glyph.js', 'Composer/page/part-strips.js', 'Composer/page/panel-locks.js'].every((f) => g.files.includes(f)));
  if (entry.includes('lab')) check('(sprint 2) the lab reaches the store only through the shared controller (its state shape), nothing of the page\'s lens', g.files.includes('Composer/store/composition-store.js') && !g.files.some((f) => /page\/(lens|toolbar-glyph|part-strips|panel-locks)\.js$/.test(f)));
}

console.log('\n— LRCModule.js: the spread');
{
  const ModuleClass = loadClass('Core Interface/LRCModule.js', 'LRCModule', makeDom()), m = new ModuleClass();
  const big = Array.from({ length: 200000 }, (_, i) => 1000 + (i % 977));
  big[123456] = 99999;
  let out = null, err = null;
  try { out = m.generateRatiosWithFrequency(big); } catch (e) { err = e; }
  check('a 200,000-onset spaces plot: the ratios, from the largest space (no stack overflow)', !err && out.ratios.length > 0 && out.ratios.some((r) => r.fraction === '1/1'), String(err));
  let rows = null;
  try { rows = m.generateToneRowData(big); } catch (e) { err = e; }
  check('generateToneRowData too (the same spread, the same fix)', !err && rows.length === big.length && rows[123456].ratio === 1);
  const r = siteRhythm([41, 42, 43, 1]), a = m.generateRatiosWithFrequency(r.spacesPlot);
  const old = atBase('Core Interface/LRCModule.js');
  if (old) {
    const OldClass = loadClass('Core Interface/LRCModule.js', 'LRCModule', makeDom(), { source: old }), o = new OldClass();
    check('on an ordinary row, the same ratios as before', JSON.stringify(a.ratios) === JSON.stringify(o.generateRatiosWithFrequency(r.spacesPlot).ratios));
    let overflow = false;
    try { o.generateRatiosWithFrequency(big); } catch (e) { overflow = e instanceof RangeError || /call stack/i.test(String(e)); }
    check('(the version before the fix overflowed on the same plot)', overflow);
  } else console.log('  (git unavailable: the before/after comparison is skipped)');
}

console.log('\n— LRCModule.js: the grid of fewer than four layers (sprint 2: the live-site NaN)');
{
  const M = loadClass('Core Interface/LRCModule.js', 'LRCModule', makeDom()), m = new M();
  check('768:769 with C and D blank: lcm 590,592 (it was NaN: lcm(x, undefined))', m.calculateTotalLCM(768, 769) === 590592 && m.calculateTotalLCM(41, 42, 43) === 74046 && m.calculateTotalLCM(7) === 7);
  check('missing, zero and non-numbers are skipped; no layer at all is 0', m.calculateTotalLCM(12, undefined, 0, NaN) === 12 && m.calculateTotalLCM() === 0 && m.calculateTotalLCM(0, 0) === 0);
  const old = atBase('Core Interface/LRCModule.js');
  if (old) {
    const O = loadClass('Core Interface/LRCModule.js', 'LRCModule', makeDom(), { source: old }), o = new O();
    let same = 0, n = 0, seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return 1 + (seed % 997); };
    for (let k = 0; k < 400; k++) { const L = [rnd(), rnd(), rnd(), rnd()]; n++; if (Object.is(m.calculateTotalLCM(...L), o.calculateTotalLCM(...L))) same++; }
    check(`four layers: exactly the grid it gave before (${same}/${n} random rhythms, and 8:7:6:5 → 840)`, same === n && m.calculateTotalLCM(8, 7, 6, 5) === 840 && o.calculateTotalLCM(8, 7, 6, 5) === 840);
    check('(the version before the fix gave NaN for two layers)', Number.isNaN(o.calculateTotalLCM(768, 769)));
  } else console.log('  (git unavailable: the before/after comparison is skipped)');
  // the site's own generation with C and D blank, as the page does it (generateRhythm reads the inputs)
  const dom = makeDom(), ids = ['layer-a', 'layer-b', 'layer-c', 'layer-d'], vals = ['768', '769', '', ''];
  ids.forEach((id, i) => { const e = dom.withId('input', id); e.value = vals[i]; });
  const G = loadClass('Core Interface/LRCModule.js', 'LRCModule', dom), g = new G();
  g.generateRhythm();
  check('generateRhythm with C and D blank: a real grid and composite (1,536 onsets), layers [768, 769, 0, 0]', g.currentGrid === 590592 && g.currentCompositeRhythm.length === 1536 && g.currentRhythms.join() === '768,769,0,0' && g.currentSpacesPlot.every((x) => Number.isFinite(x)));
}

console.log('\n— ToneRowPlayback.js / PartitionsGlobalControls.js: the one transport (sprint 2)');
{
  const trp = fs.readFileSync(path.join(ROOT, 'Playback/ToneRowPlayback.js'), 'utf8'), pgcSrc = fs.readFileSync(path.join(ROOT, 'Playback/Partitions/PartitionsGlobalControls.js'), 'utf8');
  check('the edits are marked COMPOSITION LENS (sprint 2)', (trp.match(/COMPOSITION LENS \(sprint 2\)/g) || []).length >= 2 && /COMPOSITION LENS \(sprint 2\)/.test(pgcSrc) && /COMPOSITION LENS \(sprint 2\)/.test(fs.readFileSync(path.join(ROOT, 'Core Interface/LRCModule.js'), 'utf8')));
  const dom = makeDom(), T = loadClass('Playback/ToneRowPlayback.js', 'ToneRowPlayback', dom);
  const log = [], pb = Object.create(T.prototype);
  Object.assign(pb, { isPlaying: false, async startPlayback() { this.isPlaying = true; log.push('start'); }, stopPlayback() { this.isPlaying = false; log.push('stop'); } });
  await pb.togglePlayback(); await pb.togglePlayback();
  check('no Composer on the page: togglePlayback starts and stops the row exactly as before', log.join() === 'start,stop' && pb.transportIsPlaying() === false);
  dom.window.lrcComposer = { transport: { owns: () => false, isPlaying: () => true, toggle: () => log.push('lens') } };
  await pb.togglePlayback();
  check('the row lens (the transport not owned): still the row\'s', log.join() === 'start,stop,start' && pb.transportIsPlaying() === true);
  pb.stopPlayback();
}

console.log('\n— LRCVisuals.js: the hook');
function makeVisuals(source = null) {
  const dom = makeDom(), main = dom.withId('main', 'lrc-main'), canvas = dom.document.createElement('canvas');
  canvas.id = 'visualization-canvas'; main.append(canvas);
  const V = loadClass('Core Interface/LRCVisuals.js', 'LRCVisuals', dom, { source });
  const v = new V();
  return { v, canvas, ctx: canvas.getContext('2d'), dom };
}
const feed = (v, r) => v.updateVisualization(r.spacesPlot, r.layerMap, [41, 42, 43, 1], [[], [], [], []], r.compositeRhythm, [], r.grid);
{
  const r = siteRhythm([41, 42, 43, 1]);
  const now = makeVisuals();
  now.ctx.calls.length = 0; feed(now.v, r);
  const drawn = JSON.stringify(now.ctx.calls);
  check('no overlay by default: composerOverlay is null', now.v.composerOverlay === null && typeof now.v.setComposerOverlay === 'function');
  const old = atBase('Core Interface/LRCVisuals.js');
  if (old) {
    const before = makeVisuals(old);
    before.ctx.calls.length = 0; feed(before.v, r);
    check(`with no overlay the plot draws exactly what it drew before (${now.ctx.calls.length} canvas calls)`, drawn === JSON.stringify(before.ctx.calls) && now.ctx.calls.length > 124 * 3);
  } else console.log('  (git unavailable: the before/after comparison is skipped)');
  const seen = [];
  now.v.setComposerOverlay({ draw: (ctx, view) => seen.push({ ctx, view }) });
  check('setComposerOverlay redraws, and the hook is called once with every dot\'s position', seen.length === 1 && seen[0].ctx === now.ctx && seen[0].view.positions.length === r.compositeRhythm.length && seen[0].view.positions.every((p, i) => p.index === i) && seen[0].view.dotSize === 4);
  now.v.drawPlot();
  check('called again on every Linear Plot draw', seen.length === 2);
  now.v.currentPlotType = 'circular'; now.v.drawPlot(); now.v.currentPlotType = 'linear';
  check('not on another plot type', seen.length === 2);
  now.v.setComposerOverlay({ draw() { throw new Error('boom'); } });
  check('an overlay that throws does not break the plot', now.v.allDotPositions.length === r.compositeRhythm.length);
  now.v.setComposerOverlay(null);
  const calls0 = now.ctx.calls.length; now.v.drawPlot();
  check('cleared: the plot draws exactly as with none', JSON.stringify(now.ctx.calls.slice(calls0)) === drawn);

  // the real overlay on the real plot
  const spec = compose([41, 42, 43, 0], 8, { seed: 1 }), h = highlightsOf({ spec }, plotOf({ compositeRhythm: now.v.compositeRhythm, grid: now.v.grid }));
  const snap = now.dom.document.createElement('canvas');
  const overlay = createPlotOverlay({ getHighlights: () => h, getSelected: () => 'lead', makeCanvas: () => snap });
  const c1 = now.ctx.calls.length;
  now.v.setComposerOverlay(overlay);
  const arcs = now.ctx.calls.slice(c1).filter((c) => c[0] === 'arc');
  const lead = h.parts.lead.indices.map((i) => now.v.allDotPositions[i]);
  check('the Composer overlay over the real plot: the lead\'s lit dots at the plot\'s own dot positions', lead.every((p) => arcs.some((a) => a[1] === p.x && a[2] === p.y)) && overlay.snapshotted);

  // a plot past the old spread limit
  const n = 200000, big = { spacesPlot: Array.from({ length: n }, (_, i) => 1 + (i % 13)), layerMap: Array.from({ length: n }, () => ['A']), compositeRhythm: Array.from({ length: n }, (_, i) => i), grid: n };
  let err = null;
  try { feed(now.v, big); } catch (e) { err = e; }
  check('a 200,000-dot Linear Plot draws (its min and max are loops now)', !err && now.v.allDotPositions.length === n, String(err));
}

console.log('\n— PartitionsUI.js: the tab strip');
{
  const dom = makeDom(), doc = dom.document, win = dom.window;
  const main = dom.withId('main', 'lrc-main'), canvas = doc.createElement('canvas'); canvas.id = 'visualization-canvas'; main.append(canvas);
  const box = doc.createElement('div'); box.id = 'expanded-playback-view'; main.append(box);
  win.lrcModule = { getRhythmInfoData: () => ({ displayLayers: [8, 7, 6, 5], layers: [8, 7, 6, 5], grid: 840, fundamental: 105 }) };
  const P = loadClass('Playback/Partitions/PartitionsUI.js', 'PartitionsUI', dom);
  const ui = new P();
  ui.createExpandedLayout();
  const strip = box.querySelector('.lrc-window-tabs'), buttons = strip ? strip.querySelectorAll('.lrc-window-tab') : [];
  check('the title bar has a tab strip: Partitions | Composer', buttons.length === 2 && buttons.map((b) => b.textContent).join() === 'Partitions,Composer');
  check('the Composer\'s two hosts exist, hidden; the mirrored plot\'s container is shared', ui.composerLeft?.id === 'composer-tab-left' && ui.composerLeft.style.display === 'none' && ui.composerInspector.style.display === 'none' && ui.canvasContainer.id === 'partitions-canvas-container');
  ui.isActive = true;
  // no bridge yet: a loading note, then the bridge's ready event
  buttons[1].click();
  check('Composer picked before the bridge has loaded: "loading", the Partitions halves hidden', ui.composerLeft.textContent.includes('loading') && ui.partitionsLeftOuter.style.display === 'none' && ui.lowerRightContainer.style.display === 'none' && ui.activeTab === 'composer');
  const log = [];
  win.lrcComposer = { mountTab: (h) => log.push(['mount', h.left, h.inspector]), showTab: () => log.push(['show']), hideTab: () => log.push(['hide']) };
  win.dispatchEvent(new win.Event('lrccomposerready'));
  check('the bridge arrives: mounted into the two hosts and shown', log[0]?.[0] === 'mount' && log[0][1] === ui.composerLeft && log[0][2] === ui.composerInspector && log[1]?.[0] === 'show');
  check('the tab is marked active and the title says Composer', buttons[1].classList.contains('active') && !buttons[0].classList.contains('active') && ui.titleElement.textContent.startsWith('Composer - 8:7:6:5') && ui.composerLeft.style.display === '' && ui.composerInspector.style.display === '');
  buttons[0].click();
  check('back to Partitions: the Composer is hidden (its playback stops), Partitions\' halves are back', log.at(-1)[0] === 'hide' && ui.partitionsLeftOuter.style.display === 'flex' && ui.lowerRightContainer.style.display === 'flex' && ui.composerLeft.style.display === 'none' && ui.titleElement.textContent.startsWith('Partitions - 8:7:6:5'));
  buttons[1].click();
  const n = log.length;
  ui.hide();
  check('closing the window on the Composer tab hides the Composer', log.length === n + 1 && log.at(-1)[0] === 'hide' && !ui.isActive);
  check('show() re-applies the tab last used', /this\.setActiveTab\(this\.activeTab\)/.test(fs.readFileSync(path.join(ROOT, 'Playback/Partitions/PartitionsUI.js'), 'utf8')));
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
