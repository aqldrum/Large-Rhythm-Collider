// view-frame.js — the ONE perspective projection Cosmos draws with (third-person work order,
// Cosmos/docs/COSMOS_THIRD_PERSON_WORK_ORDER_2026-09-23.md). Until this module there were three copies of the
// same maths — flight-view's toScreen, the constellation's toView and the Web worker's toView/projectView — and a
// chase camera would have had to be taught to each of them. Now each of them asks a frame.
//
// A frame answers one question: where does a point land on screen when seen from THIS eye, looking along THIS
// basis? Points arrive SHIP-relative (`rp = world − ship`, the camera-relative positions every Cosmos layer already
// carries), and the eye is a ship-relative point too. In first person the eye is the ship itself (eye = origin),
// and the frame is today's projection bit for bit — same operations in the same order — which is what lets the
// seam land with no visible change.
//
// FOG gets its own depth, `f`, next to the eye depth `z`. `z` still drives perspective size and painter's order.
// `f` is what the fog law reads: view depth in first person (f === z, today's law), true distance from the SHIP in
// chase view (so the radius of action reads as a sphere of light around the player, reaching zero at the evict
// shell in every direction), and a straight blend of the two while V eases between them.
//
// Pure: no canvas, no DOM, no camera state, no audio. Importable by the Web module worker.

// `fog` is the weight of ship-distance fog: 0 = view depth (first person), 1 = |rp| (chase), between = blend.
export function createViewFrame({ basis, eye = null, focal, cx, cy, near, fog = 0 }) {
  const r0 = basis.r[0], r1 = basis.r[1], r2 = basis.r[2];
  const u0 = basis.u[0], u1 = basis.u[1], u2 = basis.u[2];
  const d0 = basis.d[0], d1 = basis.d[1], d2 = basis.d[2];
  // Subtracting a zero eye is exact in IEEE arithmetic (x − 0 === x, including −0), so the first-person frame
  // needs no separate code path to stay bit-identical to the legacy projection.
  const e0 = eye ? eye[0] : 0, e1 = eye ? eye[1] : 0, e2 = eye ? eye[2] : 0;
  const w = fog > 0 ? (fog < 1 ? fog : 1) : 0;

  // camera(ship)-relative world → VIEW space (+x right, +y up, +z forward) as seen from the eye
  const toView = rp => {
    const px = rp[0] - e0, py = rp[1] - e1, pz = rp[2] - e2;
    return {
      x: px * r0 + py * r1 + pz * r2,
      y: px * u0 + py * u1 + pz * u2,
      z: px * d0 + py * d1 + pz * d2,
    };
  };

  // Fog depth for a ship-relative point whose view-space image is `view`. When a caller has CLIPPED a segment at
  // the near plane it passes the clipped view point and the UNCLIPPED rp: first person then reads the clipped
  // depth exactly as before, chase view reads how far the real endpoint is from the ship.
  const fogDepth = w === 0 ? (rp, view) => view.z
    : w === 1 ? rp => Math.sqrt(rp[0] * rp[0] + rp[1] * rp[1] + rp[2] * rp[2])
    : (rp, view) => (1 - w) * view.z + w * Math.sqrt(rp[0] * rp[0] + rp[1] * rp[1] + rp[2] * rp[2]);

  // Perspective divide of an already-clipped view point (no near cull — the caller clipped it).
  const toScreen = view => ({ x: cx + view.x * focal / view.z, y: cy - view.y * focal / view.z });

  // The workhorse: → { x, y, z, f } or null behind the near plane. `z` = eye depth (size, painter's order,
  // blot depth); `f` = fog depth. The x/y/z expressions are the legacy toScreen's, operand for operand.
  const project = w === 0
    ? rp => {
      const px = rp[0] - e0, py = rp[1] - e1, pz = rp[2] - e2;
      const vx = px * r0 + py * r1 + pz * r2, vy = px * u0 + py * u1 + pz * u2, vz = px * d0 + py * d1 + pz * d2;
      if (vz <= near) return null;
      return { x: cx + vx * focal / vz, y: cy - vy * focal / vz, z: vz, f: vz };
    }
    : rp => {
      const px = rp[0] - e0, py = rp[1] - e1, pz = rp[2] - e2;
      const vx = px * r0 + py * r1 + pz * r2, vy = px * u0 + py * u1 + pz * u2, vz = px * d0 + py * d1 + pz * d2;
      if (vz <= near) return null;
      const ship = Math.sqrt(rp[0] * rp[0] + rp[1] * rp[1] + rp[2] * rp[2]);
      return { x: cx + vx * focal / vz, y: cy - vy * focal / vz, z: vz, f: w === 1 ? ship : (1 - w) * vz + w * ship };
    };

  return {
    basis, eye: [e0, e1, e2], focal, cx, cy, near, fog: w,
    toView, toScreen, project, fogDepth,
  };
}

// The per-frame pair flight-view draws and hears with (work order §1, "one projection, two frames"):
//   shipView    eye at the ship, the ship's basis, fog = view depth — today's first-person projection exactly.
//               The only audio path that ever read the screen (the lead voice) projects through THIS frame, and
//               shipView.basis is the ship's own basis object — what hearing is handed at every blend.
//   renderView  the chase pose (chase-camera.js) with fog blended by `fog` (= the eased V blend t). With no
//               pose, or t = 0, it IS shipView — the same object — so first person is untouched by construction.
export function composeViewFrames({ shipBasis, pose = null, fog = 0, focal, cx, cy, near }) {
  const shipView = createViewFrame({ basis: shipBasis, focal, cx, cy, near });
  const renderView = pose && fog > 0
    ? createViewFrame({ basis: pose.basis, eye: pose.eye, focal, cx, cy, near, fog })
    : shipView;
  return { shipView, renderView };
}
