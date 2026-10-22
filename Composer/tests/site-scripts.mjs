// site-scripts.mjs — the main page's classic <script> files (LRCModule.js, LRCVisuals.js, PartitionsUI.js) loaded into
// a vm sandbox over a dom-stub.mjs DOM, so the Composer tab's tests meet the site's own code, not a copy of it.
//
//   loadClass(file, name, dom, { source, quiet })  → the class the script declares (its DOMContentLoaded boot is not run)
//   siteRhythm(layers)                             → the site's own { compositeRhythm, layerMap, spacesPlot, grid }

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { makeDom } from './dom-stub.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const silent = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

export function loadClass(file, name, dom, { source = null, quiet = true, extra = {} } = {}) {
  const code = source ?? fs.readFileSync(path.join(ROOT, file), 'utf8');
  const win = dom.window;
  const sandbox = { window: win, document: dom.document, console: quiet ? silent : console, setTimeout, clearTimeout, performance: { now: () => 0 },
    requestAnimationFrame: win.requestAnimationFrame, cancelAnimationFrame: () => {}, CustomEvent: dom.CustomEvent, Event: dom.Event, alert() {}, Math, Map, Set, Number, Array, Object, JSON, ...extra };
  vm.createContext(sandbox);
  vm.runInContext(`${code}\n;globalThis.__class = ${name};`, sandbox, { filename: file });
  return sandbox.__class;
}

let ModuleClass = null;
/** the site's composite rhythm for these layers, by LRCModule's own methods */
export function siteRhythm(layers) {
  ModuleClass ??= loadClass('Core Interface/LRCModule.js', 'LRCModule', makeDom());
  const m = new ModuleClass(), active = layers.filter((v) => v > 0);
  m.currentGrid = m.calculateTotalLCM(...active);
  const { rhythm, layerMap } = m.generateCompositeRhythm(layers);
  const { spacesPlot } = m.generateSpacesPlot(rhythm, m.currentGrid, layerMap);
  return { compositeRhythm: rhythm, layerMap, spacesPlot, grid: m.currentGrid, module: m };
}
