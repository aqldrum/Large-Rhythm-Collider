// grid-row-aura.js — Canvas-only visualization for live culled-grid row voices.
// Audio state arrives as a tiny read-only projection; this module never imports playback, workers,
// Cosmos runtime state, or camera controls.

const AURA_MIN_PX = 10;       // even a distant sounding star remains visually legible
const AURA_MAX_PX = 52;       // defensive ceiling near/inside a large star
const AURA_STAR_SCALE = 4.6;  // base sphere radius relative to the rendered star
const AURA_PULSE_PX = 11;     // extra expanding shell radius at a fresh tone attack

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// A translucent audio sphere behind a plain star. The filled orb reports sustained canonical voices;
// the bright outer shell expands and fades on each actual row attack. The caller owns bloom suppression.
export function drawGridRowAura(ctx, screenPosition, starRadius, fog, activity) {
  const voiceStrength = clamp(activity.voices / 4, 0.25, 1);
  const pulse = clamp(activity.pulse || 0, 0, 1);
  const baseR = clamp(starRadius * AURA_STAR_SCALE + 5, AURA_MIN_PX, AURA_MAX_PX);
  const orbR = baseR + AURA_PULSE_PX * pulse;
  const alpha = fog * (0.14 + 0.11 * voiceStrength);
  const { x, y } = screenPosition;
  const orb = ctx.createRadialGradient(
    x - orbR * 0.22, y - orbR * 0.24, orbR * 0.05,
    x, y, orbR,
  );
  orb.addColorStop(0, `rgba(222,248,255,${alpha * 0.78})`);
  orb.addColorStop(0.28, `rgba(117,220,255,${alpha * 0.52})`);
  orb.addColorStop(0.72, `rgba(72,163,255,${alpha * 0.34})`);
  orb.addColorStop(0.9, `rgba(115,225,255,${alpha * 0.58})`);
  orb.addColorStop(1, 'rgba(80,190,255,0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = orb;
  ctx.beginPath(); ctx.arc(x, y, orbR, 0, 7); ctx.fill();

  ctx.globalAlpha = fog * (0.16 + 0.28 * pulse);
  ctx.strokeStyle = `rgba(170,235,255,${0.46 + 0.38 * pulse})`;
  ctx.lineWidth = 0.8 + pulse * 1.1;
  ctx.beginPath(); ctx.arc(x, y, orbR * (0.96 + 0.08 * pulse), 0, 7); ctx.stroke();
}
