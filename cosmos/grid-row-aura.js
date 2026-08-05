// grid-row-aura.js — Canvas-only visualization for live culled-grid row voices.
// Audio state arrives as a tiny read-only projection; this module never imports playback, workers,
// Cosmos runtime state, or camera controls.

const AURA_MIN_PX = 10;       // even a distant sounding star remains visually legible
const AURA_MAX_PX = 52;       // defensive ceiling near/inside a large star
const AURA_STAR_SCALE = 4.6;  // base sphere radius relative to the rendered star
const AURA_PULSE_PX = 11;     // extra expanding shell radius at a fresh tone attack

// Pitch → colour (synesthesia). The hue is the note's pitch CLASS: log2(freq) mod 1 maps one octave onto the
// full colour wheel, so octaves share a colour and equal intervals sit at equal hue angles — the wheel is the
// tuning circle. AURA_ROOT_HZ anchors the row fundamental (1/1) to hue 0 (red); it mirrors the audio module's
// CULLED_ROW_FUNDAMENTAL_HZ but is only a cosmetic anchor — changing it just rotates every hue together.
const AURA_ROOT_HZ = 220;
const AURA_HUE_OFFSET = 12;   // rotate the wheel off pure red so the tonic reads amber, not alarm-red
const AURA_FALLBACK_HUE = 205; // legacy blue when a voice arrives without a pitch (defensive; shouldn't happen)

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// Pitch class 0..1 of a sounding frequency: birth hz glided by the shared detune bus (cents), folded to one
// octave. detuneCents shifts every orb together, so the field's hue drifts as the root modulates.
function pitchHue(hz, detuneCents) {
  if (!(hz > 0)) return AURA_FALLBACK_HUE;
  const octaves = Math.log2(hz / AURA_ROOT_HZ) + (detuneCents || 0) / 1200;
  const pc = ((octaves % 1) + 1) % 1;   // wrap to [0,1)
  return (pc * 360 + AURA_HUE_OFFSET) % 360;
}

// A translucent audio sphere behind a plain star. The filled orb reports sustained canonical voices; the
// bright outer shell expands and fades on each actual row attack. Hue is the sounding pitch; the caller owns
// bloom suppression and passes the live detune-bus cents so hue tracks retuning/modulation, not birth pitch.
export function drawGridRowAura(ctx, screenPosition, starRadius, fog, activity, detuneCents = 0) {
  const voiceStrength = clamp(activity.voices / 4, 0.25, 1);
  const pulse = clamp(activity.pulse || 0, 0, 1);
  const baseR = clamp(starRadius * AURA_STAR_SCALE + 5, AURA_MIN_PX, AURA_MAX_PX);
  const orbR = baseR + AURA_PULSE_PX * pulse;
  const alpha = fog * (0.14 + 0.11 * voiceStrength);
  const h = pitchHue(activity.hz, detuneCents);
  const { x, y } = screenPosition;
  const orb = ctx.createRadialGradient(
    x - orbR * 0.22, y - orbR * 0.24, orbR * 0.05,
    x, y, orbR,
  );
  // Hot tinted core → saturated pitch body → bright rim → transparent edge. Lightness carries the glow; the
  // single hue keeps the note legible across the whole orb, so two different pitches never read as one colour.
  orb.addColorStop(0, `hsla(${h},92%,90%,${alpha * 0.78})`);
  orb.addColorStop(0.28, `hsla(${h},95%,68%,${alpha * 0.52})`);
  orb.addColorStop(0.72, `hsla(${h},90%,56%,${alpha * 0.34})`);
  orb.addColorStop(0.9, `hsla(${h},95%,72%,${alpha * 0.58})`);
  orb.addColorStop(1, `hsla(${h},90%,62%,0)`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = orb;
  ctx.beginPath(); ctx.arc(x, y, orbR, 0, 7); ctx.fill();

  ctx.globalAlpha = fog * (0.16 + 0.28 * pulse);
  ctx.strokeStyle = `hsla(${h},95%,80%,${0.46 + 0.38 * pulse})`;
  ctx.lineWidth = 0.8 + pulse * 1.1;
  ctx.beginPath(); ctx.arc(x, y, orbR * (0.96 + 0.08 * pulse), 0, 7); ctx.stroke();
}
