// cosmos/rail-params.js — Phase 1: the single owner of the knob rail's parameter state.
//
// Deliberately boring and ENGINE-AGNOSTIC: defaults, clamps, curve mappings (normalized knob position ↔
// engine value), a change-listener API, and a localStorage round-trip on the PERSISTED subset (decision 8).
// Every Phase-2 knob and the engine binding are thin subscribers — no param carries its own state machine.
// This module imports nothing from cosmos-audio so it stays pure and headless-testable; flight-view (Phase 2)
// forwards changes to the engine setters via subscribe(), and reads values back for each knob's readout.

export const RAIL_SCHEMA_VERSION = 1;              // bump to discard incompatible stored state
export const RAIL_STORAGE_KEY = 'lrc.cosmos.rail.v1';

// curve: how a normalized knob position [0,1] maps to the engine VALUE this module stores.
//   linear — even in value. (Cents are already log-of-frequency, so FUNDAMENTAL is linear-in-cents, which
//            IS the plan's "log for FUNDAMENTAL": the knob travels evenly in pitch.)
//   log    — even in ratio; min and max must both be > 0. SPEED's perceived tempo travels evenly.
//   detent — a small set of integer stops (DENSITY 1/2/3).
//   bool   — a toggle (modulation; the transient mute / MIDI-out).
// group/label/unit are UI hints the rail (Phase 2) reads; this module never touches the DOM.
export const RAIL_PARAMS = Object.freeze({
  // ── persisted musical knobs (decision 8) — the shipped rail, grouped pitch / time / harmony / texture ──
  volume:      { default: 0.85, min: 0,     max: 1,    curve: 'linear', persist: true,  unit: '',         group: 'texture',   label: 'VOLUME' },
  fundamental: { default: 0,    min: -1200, max: 1200, curve: 'linear', persist: true,  unit: '¢',        group: 'pitch',     label: 'FUNDAMENTAL' },
  density:     { default: 1,    min: 1,     max: 3,    curve: 'detent', persist: true,  unit: '',         group: 'harmony',   label: 'DENSITY' },
  speed:       { default: 2.5,  min: 0.5,   max: 16,   curve: 'log',    persist: true,  unit: ' notes/s', group: 'time',      label: 'SPEED' },
  dwell:       { default: 0,    min: 0,     max: 1,    curve: 'linear', persist: true,  unit: '×cyc',     group: 'time',      label: 'DWELL' },
  richness:    { default: 0.05, min: 0,     max: 0.18, curve: 'linear', persist: true,  unit: '',         group: 'harmony',   label: 'RICHNESS' },
  mix:         { default: 0,    min: 0,     max: 1,    curve: 'linear', persist: true,  unit: '',         group: 'texture',   label: 'BED/ROWS' },
  space:       { default: 0.5,  min: 0,     max: 1,    curve: 'linear', persist: true,  unit: '',         group: 'texture',   label: 'SPACE' },
  modulation:  { default: false,                       curve: 'bool',   persist: true,                    group: 'advanced',  label: 'MODULATION' },
  // ── transient (decision 8: MIDI-enabled and mute do NOT persist) ──
  mute:        { default: false,                       curve: 'bool',   persist: false,                   group: 'transport', label: 'MUTE' },
  midiOut:     { default: false,                       curve: 'bool',   persist: false,                   group: 'advanced',  label: 'MIDI OUT' },
});

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Coerce/clamp a raw value into a spec's legal domain — the STORAGE form the module keeps.
export function clampParam(spec, raw) {
  if (spec.curve === 'bool') return !!raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return spec.default;
  if (spec.curve === 'detent') return clampNum(Math.round(n), spec.min, spec.max);   // integer stops
  return clampNum(n, spec.min, spec.max);
}

// Normalized knob position [0,1] → engine value.
export function normToValue(spec, pos) {
  const p = clampNum(Number.isFinite(+pos) ? +pos : 0, 0, 1);
  if (spec.curve === 'bool') return p >= 0.5;
  if (spec.curve === 'log') return spec.min * (spec.max / spec.min) ** p;
  if (spec.curve === 'detent') return spec.min + Math.round(p * (spec.max - spec.min));
  return spec.min + p * (spec.max - spec.min);
}

// Engine value → normalized knob position [0,1] (inverse of normToValue, within the same domain).
export function valueToNorm(spec, value) {
  if (spec.curve === 'bool') return value ? 1 : 0;
  const v = clampParam(spec, value);
  if (spec.curve === 'log') return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
  return (v - spec.min) / (spec.max - spec.min);   // linear and detent share the affine inverse
}

// Pure: parse a stored blob, discarding anything from an incompatible schema (or corrupt JSON) so a stale
// layout can never inject bad values. Returns only the raw persisted params; the caller re-clamps each.
export function deserializeRail(raw) {
  if (typeof raw !== 'string' || !raw) return { params: {}, discarded: false, reason: 'empty' };
  let blob;
  try { blob = JSON.parse(raw); } catch { return { params: {}, discarded: true, reason: 'corrupt' }; }
  if (!blob || blob.v !== RAIL_SCHEMA_VERSION || typeof blob.params !== 'object' || !blob.params) {
    return { params: {}, discarded: true, reason: 'schema' };
  }
  return { params: blob.params, discarded: false, reason: 'ok' };
}

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export class RailParams {
  // storage: a Web-Storage-like { getItem, setItem } (injectable for tests); null disables persistence.
  constructor({ storage, key = RAIL_STORAGE_KEY } = {}) {
    this.specs = RAIL_PARAMS;
    this.key = key;
    this.storage = storage !== undefined ? storage : defaultStorage();
    this.listeners = new Set();
    this.state = {};
    for (const [name, spec] of Object.entries(this.specs)) this.state[name] = spec.default;
    this._loadPersisted();
  }

  has(name) { return name in this.specs; }
  spec(name) { return this.specs[name]; }
  get(name) { return this.state[name]; }
  getAll() { return { ...this.state }; }
  norm(name) { const spec = this.specs[name]; return spec ? valueToNorm(spec, this.state[name]) : 0; }

  // Set an engine value (clamped to the spec). No-ops — including a set to the current value — never notify
  // or persist, so an engine subscriber isn't re-driven every frame. Returns the clamped value.
  set(name, value, { silent = false } = {}) {
    const spec = this.specs[name];
    if (!spec) return undefined;
    const clamped = clampParam(spec, value);
    if (this.state[name] === clamped) return clamped;
    this.state[name] = clamped;
    if (spec.persist) this._persist();
    if (!silent) this._notify(name, clamped, spec);
    return clamped;
  }

  // Set from a normalized knob position [0,1] through the param's curve.
  setNorm(name, pos, opts) {
    const spec = this.specs[name];
    return spec ? this.set(name, normToValue(spec, pos), opts) : undefined;
  }

  reset(name) {
    if (name) return this.set(name, this.specs[name].default);
    for (const n of Object.keys(this.specs)) this.set(n, this.specs[n].default);
    return undefined;
  }

  // Subscribe to changes: fn(name, value, spec). emitNow replays every current value once, so an engine
  // binding subscribing at startup pushes the persisted state straight through to the setters. Returns an
  // unsubscribe function.
  subscribe(fn, { emitNow = false } = {}) {
    this.listeners.add(fn);
    if (emitNow) for (const [name, spec] of Object.entries(this.specs)) fn(name, this.state[name], spec);
    return () => this.listeners.delete(fn);
  }

  // The persisted subset (decision 8) as a versioned JSON string — transient params are excluded.
  serialize() {
    const params = {};
    for (const [name, spec] of Object.entries(this.specs)) if (spec.persist) params[name] = this.state[name];
    return JSON.stringify({ v: RAIL_SCHEMA_VERSION, params });
  }

  _notify(name, value, spec) { for (const fn of this.listeners) { try { fn(name, value, spec); } catch {} } }

  _persist() {
    if (!this.storage) return;
    try { this.storage.setItem(this.key, this.serialize()); } catch { /* private-mode / quota — never break audio */ }
  }

  _loadPersisted() {
    if (!this.storage) return;
    let raw;
    try { raw = this.storage.getItem(this.key); } catch { return; }
    const { params } = deserializeRail(raw);
    for (const [name, value] of Object.entries(params)) {
      const spec = this.specs[name];
      if (spec && spec.persist) this.state[name] = clampParam(spec, value);   // never load transient state
    }
  }
}

// The shared rail owned by the running instrument; flight-view wires it to the engine in Phase 2.
export const railParams = new RailParams();
