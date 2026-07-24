// spatial-audio-frame.js — pure bridge between Flight's camera basis and WebAudio coordinates.
// Flight projects +Z forward. WebAudio's right-handed listener frame is +X right, +Y up, -Z forward.

export const AUDIO_LISTENER_FORWARD = Object.freeze([0, 0, -1]);
export const AUDIO_LISTENER_UP = Object.freeze([0, 1, 0]);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Convert a camera-relative world vector to the fixed WebAudio listener frame. Keeping the listener
// fixed and moving sources through this transform makes rotation explicit, avoids handedness traps,
// and guarantees that canvas-right is audio-right.
export function toAudioListenerPosition(position, basis) {
  return [
    dot(position, basis.r),
    dot(position, basis.u),
    -dot(position, basis.d),
  ];
}
