// Consumer-side proof of the export conventions: loads the test models with three.js' own
// loader and checks that the game will see forward = +Z, up = +Y, left = +X, named nodes
// with pivots, flat normals, vertex colors, and the pose signs documented in the README.
//
//   node tools/art/tests/three_check.mjs
//
// Needs the three package (it resolves from the repo's node_modules once the client has
// it installed) and the test models written by test_conventions.py and test_rig.py.
// tools/art/tests/run_all.sh runs it automatically when three is available.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';

function load(path) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}
const wp = (o) => o.getWorldPosition(new THREE.Vector3());
const r = (v) => [v.x, v.y, v.z].map((n) => +n.toFixed(3));
let ok = true;
const check = (label, cond, detail = '') => { ok &&= !!cond; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`); };

// 1. the lopsided arrow
{
  const g = await load('/tmp/mb-scratch/art-tests/test_arrow.glb');
  g.scene.updateMatrixWorld(true);
  const tip = g.scene.getObjectByName('tip'), fin = g.scene.getObjectByName('fin'), knob = g.scene.getObjectByName('knob_L');
  const box = (o) => new THREE.Box3().setFromObject(o);
  check('three.js: arrow tip anchor is at +Z', wp(tip).z > 1.9, r(wp(tip)).join(', '));
  check('three.js: fin is the highest part (+Y) and toward the tail (-Z)', box(fin).max.y > 0.99 && box(fin).max.z < 0, r(box(fin).max).join(', '));
  check('three.js: knob_L is on +X', box(knob).min.x > 0.19, r(box(knob).min).join(', '));
  // a default three.js camera looks down -Z with +X to its right: put it in front of the model
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100); cam.position.set(0, 1, 8); cam.lookAt(0, 0.3, 0); cam.updateMatrixWorld(true);
  const ndc = box(knob).getCenter(new THREE.Vector3()).project(cam);
  check('three.js: seen from the front, the knob is on the right of the screen', ndc.x > 0.02, 'ndc x = ' + ndc.x.toFixed(3));
  const mesh = g.scene.getObjectByName('arrow');
  const m = mesh.isMesh ? mesh : mesh.children.find((c) => c.isMesh);
  const col = m.geometry.getAttribute('color');
  check('three.js: vertex colors arrive as a color attribute', !!col && col.itemSize >= 3, col ? `itemSize ${col.itemSize}, normalized ${col.normalized}` : 'none');
  check('three.js: material names survive', ['vcol', 'glow'].every((n) => { let f = false; g.scene.traverse((o) => { if (o.material && o.material.name === n) f = true; }); return f; }));
  // yaw as DESIGN.md defines it: rotation.y = yaw, forward = (sin yaw, 0, cos yaw)
  g.scene.rotation.y = Math.PI / 2; g.scene.updateMatrixWorld(true);
  check('three.js: rotation.y = +90 degrees turns the nose to +X (forward = (sin yaw, 0, cos yaw))', wp(tip).x > 1.9 && Math.abs(wp(tip).z) < 1e-6, r(wp(tip)).join(', '));
}
// 2. the box lizard rig
{
  const g = await load('/tmp/mb-scratch/art-tests/kaiju_lizard_s1.glb');
  g.scene.updateMatrixWorld(true);
  const n = (name) => g.scene.getObjectByName(name);
  const names = ['root', 'hips', 'torso', 'neck', 'head', 'jaw', 'cam_fp', 'mouth', 'arm_L', 'forearm_L', 'hand_L', 'arm_R', 'forearm_R', 'hand_R', 'hold', 'weak_point', 'leg_L', 'shin_L', 'foot_L', 'leg_R', 'shin_R', 'foot_R', 'tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5'];
  check('three.js: every lizard node is found by name', names.every((x) => !!n(x)), names.filter((x) => !n(x)).join(', '));
  check('three.js: mouth is in front (+Z), tail_5 behind (-Z)', wp(n('mouth')).z > 2 && wp(n('tail_5')).z < -2, `${r(wp(n('mouth')))} / ${r(wp(n('tail_5')))}`);
  check('three.js: arm_L pivot is on +X, arm_R on -X', wp(n('arm_L')).x > 0.5 && wp(n('arm_R')).x < -0.5);
  check('three.js: nodes carry no rotation or scale', names.every((x) => n(x).quaternion.angleTo(new THREE.Quaternion()) < 1e-6 && n(x).scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6));
  // the documented pose convention: jaw.rotation.x > 0 opens the jaw (its tip goes down)
  const jaw = n('jaw');
  const tipBefore = new THREE.Box3().setFromObject(jaw).min.y;
  jaw.rotation.x = THREE.MathUtils.degToRad(25); g.scene.updateMatrixWorld(true);
  const tipAfter = new THREE.Box3().setFromObject(jaw).min.y;
  check('three.js: jaw.rotation.x = +25 degrees swings the jaw down (opens it)', tipAfter < tipBefore - 0.2, `${tipBefore.toFixed(2)} -> ${tipAfter.toFixed(2)}`);
  jaw.rotation.x = 0;
  const t1 = n('tail_1'); const before = wp(n('tail_5')).x;
  t1.rotation.y = THREE.MathUtils.degToRad(20); g.scene.updateMatrixWorld(true);
  check('three.js: tail_1.rotation.y = +20 degrees swings the tail tip toward -X (the nose end turns left)', wp(n('tail_5')).x < before - 0.5, `${before.toFixed(2)} -> ${wp(n('tail_5')).x.toFixed(2)}`);
  // flat shading: every triangle's three normals are identical
  let tris = 0, smooth = 0;
  g.scene.traverse((o) => { if (!o.isMesh) return; const nrm = o.geometry.getAttribute('normal'); const idx = o.geometry.index;
    for (let i = 0; i < idx.count; i += 3) { tris++; const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      const va = new THREE.Vector3().fromBufferAttribute(nrm, a), vb = new THREE.Vector3().fromBufferAttribute(nrm, b), vc = new THREE.Vector3().fromBufferAttribute(nrm, c);
      if (va.distanceTo(vb) > 1e-3 || va.distanceTo(vc) > 1e-3) smooth++; } });
  check('three.js: all triangles are flat shaded', smooth === 0 && tris === 394, `${tris} triangles, ${smooth} smooth`);
}
console.log(ok ? 'THREE.JS CHECKS PASSED' : 'THREE.JS CHECKS FAILED');
process.exit(ok ? 0 : 1);
