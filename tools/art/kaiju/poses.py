"""Pose targets that ship with the lizard rig, and the checks that keep them honest.

The game animates the rig in code. Generic joint angles do not work on this character: its
head hangs low and forward of the shoulders and its elbows rest bent, so "raise the arm 90
degrees" puts the hands on the skull and nothing in the player's first-person view. So the
asset carries the angles that do work, per stage, in the manifest (docs/ASSETS.md section 7):

    "poses": { "<name>": { "<node>": [x, y, z] } }      degrees, relative to the rest pose,
                                                        three.js Euler order XYZ, game axes

and the animator blends toward them. The values live in lizard.POSE_TARGETS (found with
solve() below, then tuned by eye). check() proves, on the exported file, what every target
promises, through the game's own first-person lens (kaijuController.ts: the camera sits on
cam_fp, looks level along the body's heading, vertical field of view 72 degrees, 16:9, near
plane 0.02 body heights):

    - the acting hand(s) are inside the frame, in its lower third, beyond the near plane;
    - no arm touches the head or the jaw, and the forearms and hands touch nothing else
      (neck, torso, spines, each other).

Everything here works on the exported .glb with numpy, in the game's axes (x left, y up,
z forward), so it can run without Blender's scene; the overlap test uses mathutils.
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import glb as glbfile  # noqa: E402

VFOV = 72.0                 # the game's first-person lens (client/src/game/controllers/kaijuController.ts)
ASPECT = 16.0 / 9.0
NEAR = 0.02                 # near plane, in body heights
TAN_V = math.tan(math.radians(VFOV) / 2)
TAN_H = TAN_V * ASPECT
HFOV = 2 * math.degrees(math.atan(TAN_H))      # 104.5 degrees: what mb.View calls fov

RIGHT_ARM = ("arm_R", "forearm_R", "hand_R")
LEFT_ARM = ("arm_L", "forearm_L", "hand_L")
# which hands a target must show in the lower third of the first-person frame
SHOWS = {"fp_claws": "LR", "grab": "R", "hold": "R", "eat": "LR", "brace": "LR", "throw_windup": "R",
         "throw_release": "R", "stagger": ""}


def euler(x: float, y: float, z: float) -> np.ndarray:
    """three.js Euler XYZ (degrees) as a 3x3 matrix: what node.rotation.set(x, y, z) does."""
    x, y, z = math.radians(x), math.radians(y), math.radians(z)
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    rx = np.array(((1, 0, 0), (0, cx, -sx), (0, sx, cx)))
    ry = np.array(((cy, 0, sy), (0, 1, 0), (-sy, 0, cy)))
    rz = np.array(((cz, -sz, 0), (sz, cz, 0), (0, 0, 1)))
    return rx @ ry @ rz


def mirrored(pose: dict) -> dict:
    """Add the left arm to a pose that gives the right one (y and z change sign)."""
    out = dict(pose)
    for name, (x, y, z) in pose.items():
        if name.endswith("_R") and name[:-2] + "_L" not in pose:
            out[name[:-2] + "_L"] = (x, -y, -z)
    return out


class Body:
    """The rig of one exported stage: node tree, pivots and mesh points, posable."""

    def __init__(self, asset_or_path: str):
        path = asset_or_path
        if not os.path.exists(path):
            import contract
            path = contract.model_path(asset_or_path)
        g = glbfile.load(path)
        self.parent = {n.name: (g.nodes[n.parent].name if n.parent is not None else None) for n in g.nodes}
        self.names: list[str] = []                  # parents before children
        todo = [n.name for n in g.nodes]
        while todo:
            ready = [n for n in todo if self.parent[n] is None or self.parent[n] in self.names]
            self.names += ready
            todo = [n for n in todo if n not in ready]
        self.offset = {n.name: np.array(n.local[:3, 3], dtype=float) for n in g.nodes}
        self.pts: dict[str, np.ndarray] = {}
        self.tris: dict[str, np.ndarray] = {}
        for n in g.nodes:
            if n.mesh is None:
                continue
            prims = g.meshes[n.mesh]
            self.pts[n.name] = np.vstack([p.positions for p in prims]).astype(float)
            self.tris[n.name] = np.vstack([p.positions[p.indices] for p in prims]).astype(float)
        rest = self.world({})
        self.height = float(max((self.at(rest, n)[:, 1].max() for n in self.pts), default=1.0))

    # ---- kinematics
    def world(self, pose: dict) -> dict:
        """name -> (3x3 rotation, position) of every node under a pose {node: (x, y, z) degrees}."""
        out: dict[str, tuple] = {}
        for name in self.names:
            r = euler(*pose[name]) if name in pose else np.eye(3)
            par = self.parent[name]
            if par is None:
                out[name] = (r, self.offset[name].copy())
            else:
                pr, pp = out[par]
                out[name] = (pr @ r, pp + pr @ self.offset[name])
        return out

    def at(self, world: dict, name: str, pts: np.ndarray | None = None) -> np.ndarray:
        """Mesh points of a node (or the given node-local points) in model space."""
        r, p = world[name]
        q = self.pts[name] if pts is None else pts
        return q @ r.T + p

    def triangles(self, world: dict, names) -> np.ndarray:
        chunks = []
        for name in names:
            r, p = world[name]
            chunks.append(self.tris[name] @ r.T + p)
        return np.vstack(chunks)

    # ---- the game's first-person lens
    def lens(self, world: dict, yaw: float = 0.0, pitch: float = 0.0):
        """(eye, right, up, forward) of the game's first-person camera: on cam_fp, aimed by the
        body's heading plus the look angles (degrees: yaw + = left, pitch + = up), never rolled."""
        eye = world["cam_fp"][1]
        a, e = math.radians(yaw), math.radians(pitch)
        f = np.array((math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)))
        r = np.cross(f, (0.0, 1.0, 0.0))
        r /= np.linalg.norm(r)
        return eye, r, np.cross(r, f), f

    def project(self, world: dict, pts: np.ndarray, yaw: float = 0.0, pitch: float = 0.0):
        """Frame coordinates of model-space points: x and y run -1..1 across the 16:9 frame
        (x + = right, y + = up); also the depth along the view axis in body heights."""
        eye, r, u, f = self.lens(world, yaw, pitch)
        rel = pts - eye
        depth = rel @ f
        safe = np.where(np.abs(depth) < 1e-9, 1e-9, depth)
        return (rel @ r) / (safe * TAN_H), (rel @ u) / (safe * TAN_V), depth / self.height


# =========================================================================================
# checking
# =========================================================================================
def _overlaps(a: np.ndarray, b: np.ndarray) -> int:
    """Number of triangle pairs of two triangle soups that cut each other."""
    import bpy  # noqa: F401  (mathutils comes with it)
    from mathutils.bvhtree import BVHTree

    def tree(t):
        v = [tuple(p) for p in t.reshape(-1, 3)]
        return BVHTree.FromPolygons(v, [(3 * i, 3 * i + 1, 3 * i + 2) for i in range(len(t))])
    return len(tree(a).overlap(tree(b)))


def hand_in_frame(body: Body, pose: dict, side: str, yaw: float = 0.0, pitch: float = 0.0) -> dict:
    """Where a hand lands in the first-person frame: its middle (x, y), how much of it is inside
    the frame, how much of it is in the lower third, and its nearest depth in body heights."""
    world = body.world(pose)
    x, y, d = body.project(world, body.at(world, f"hand_{side}"), yaw, pitch)
    inside = (np.abs(x) <= 1) & (np.abs(y) <= 1) & (d > NEAR)
    low = inside & (y <= -1.0 / 3.0)
    return dict(x=float(np.median(x)), y=float(np.median(y)), inside=float(inside.mean()), low=float(low.mean()),
                depth=float(d.min()))


def check(asset: str, targets: dict, quiet: bool = False) -> list[str]:
    """Problems with the pose targets of one exported stage (an empty list is a pass)."""
    body = Body(asset)
    problems = []
    for name, pose in targets.items():
        world = body.world(pose)
        notes = []
        for side in SHOWS.get(name, ""):
            h = hand_in_frame(body, pose, side)
            notes.append(f"hand_{side} at ({h['x']:+.2f}, {h['y']:+.2f}) {h['inside'] * 100:.0f}% in frame, "
                         f"{h['low'] * 100:.0f}% in the lower third, nearest {h['depth']:.3f} h")
            if h["y"] > -1.0 / 3.0 or h["low"] < 0.5:
                problems.append(f"{asset} {name}: hand_{side} is not in the lower third of the first-person frame "
                                f"(middle at y = {h['y']:+.2f}, {h['low'] * 100:.0f}% of it there)")
            if h["inside"] < 0.6:
                problems.append(f"{asset} {name}: only {h['inside'] * 100:.0f}% of hand_{side} is inside the frame")
        head = body.triangles(world, ("head", "jaw"))
        rest = body.triangles(world, ("neck", "torso", "spines"))
        for arm in (RIGHT_ARM, LEFT_ARM):
            n = _overlaps(body.triangles(world, arm), head)
            if n:
                problems.append(f"{asset} {name}: {arm[0][-1]} arm cuts into the head or jaw ({n} triangle pairs)")
            n = _overlaps(body.triangles(world, arm[1:]), rest)
            if n:
                problems.append(f"{asset} {name}: {arm[1]} or {arm[2]} cuts into the neck, torso or spines "
                                f"({n} triangle pairs)")
        n = _overlaps(body.triangles(world, RIGHT_ARM), body.triangles(world, LEFT_ARM))
        if n:
            problems.append(f"{asset} {name}: the arms cut into each other ({n} triangle pairs)")
        if not quiet:
            print(f"  {asset} {name:<14} " + ("; ".join(notes) if notes else "(no hand must show)"))
    return problems


# =========================================================================================
# solving (a tool for the artist: run this file, look, paste, tune)
# =========================================================================================
def solve(body: Body, base: dict, goal: dict, seed: int = 1, starts: int = 10, both: bool = True) -> tuple[dict, float]:
    """Find right-arm angles (arm, forearm, hand) that put the right hand where `goal` says in
    the first-person frame, clear of the head, on top of the `base` pose (torso, neck, head).

    goal: x, y (frame coordinates of the middle of the hand), depth (lo, hi) in body heights,
          fingers = direction the fingers point and back = direction the back of the hand
          faces, both as (right, up, forward) seen by the camera, optional;
          low=True keeps the whole arm out of the upper two thirds of the frame.
    both: the left arm mirrors the right (two-handed poses); else it hangs at rest.
    Returns (pose, cost)."""
    from scipy.optimize import minimize
    from scipy.spatial import ConvexHull

    h = body.height
    rest = body.world({})
    hand = body.pts["hand_R"]
    far = np.linalg.norm(hand, axis=1)
    tips = hand[far > np.quantile(far, 0.8)].mean(axis=0)            # the claws, hand-local
    fingers0 = tips / np.linalg.norm(tips)
    # the back of the hand faces away from the palm: at rest that is up and outward (see lizard._hand)
    back0 = np.cross(fingers0, np.cross((0.0, 1.0, 0.0), fingers0))
    back0 /= np.linalg.norm(back0)
    arm_pts = {n: body.pts[n][:: max(1, len(body.pts[n]) // 60)] for n in RIGHT_ARM}
    wbase = body.world(base)
    # the head as a convex lump (skull, snout, jaw, tusks; not the crown spikes that sweep back)
    hp = np.vstack([body.at(wbase, "head", body.pts["head"][body.pts["head"][:, 2] > -0.02 * h]), body.at(wbase, "jaw")])
    if both:                          # the left arm mirrors the right: it must clear the mirrored head too
        hp = np.vstack([hp, hp * (-1.0, 1.0, 1.0)])
    hull = ConvexHull(hp)
    hn, hd = hull.equations[:, :3], hull.equations[:, 3]
    tp = np.vstack([body.at(wbase, "torso"), body.at(wbase, "neck")])
    thull = ConvexHull(tp)
    tn, td = thull.equations[:, :3], thull.equations[:, 3]
    eye, r, u, f = body.lens(wbase)

    def cam(v):                       # (right, up, forward) seen by the camera -> model space
        v = np.asarray(v, dtype=float)
        v = r * v[0] + u * v[1] + f * v[2]
        return v / np.linalg.norm(v)

    want_f = cam(goal["fingers"]) if "fingers" in goal else None
    want_b = cam(goal["back"]) if "back" in goal else None
    dlo, dhi = goal.get("depth", (0.12, 0.40))

    def pose_of(q):
        p = dict(base)
        p["arm_R"], p["forearm_R"], p["hand_R"] = tuple(q[0:3]), tuple(q[3:6]), tuple(q[6:9])
        return mirrored(p) if both else p

    def cost(q, parts_out=None):
        w = body.world(pose_of(q))
        t = {}
        hw = body.at(w, "hand_R")
        x, y, d = body.project(w, hw)
        mx, my, md = np.median(x), np.median(y), np.median(d)
        t["place"] = ((mx - goal["x"]) / 0.05) ** 2 + ((my - goal["y"]) / 0.05) ** 2
        t["depth"] = (max(0.0, dlo - md) / 0.02) ** 2 + (max(0.0, md - dhi) / 0.02) ** 2
        t["frame"] = float((np.maximum(0, np.abs(x) - 0.96) ** 2).mean() + (np.maximum(0, -0.96 - y) ** 2).mean()) * 400
        t["third"] = float((np.maximum(0, y + 0.30) ** 2).mean()) * 200       # the hand stays in the lower third
        rot = w["hand_R"][0]
        if want_f is not None:
            t["fingers"] = (1 - float((rot @ fingers0) @ want_f)) / 0.06
        if want_b is not None:
            t["back"] = (1 - float((rot @ back0) @ want_b)) / 0.20
        t["head"] = t["torso"] = t["high"] = t["mid"] = 0.0
        for n in RIGHT_ARM:
            pw = body.at(w, n, arm_pts[n])
            sd = (pw @ hn.T + hd).max(axis=1)                          # > 0 outside the head lump
            t["head"] += float((np.maximum(0, 0.012 * h - sd) ** 2).mean()) / (0.0008 * h) ** 2
            if n != "arm_R":
                sd = (pw @ tn.T + td).max(axis=1)
                t["torso"] += float((np.maximum(0, 0.006 * h - sd) ** 2).mean()) / (0.001 * h) ** 2
                if goal.get("low"):
                    px, py, pd = body.project(w, pw)
                    t["high"] += float((np.maximum(0, py[pd > 0] + 0.25) ** 2).sum() / len(pw)) * 100
                if both:                                               # mirrored arms must not meet
                    t["mid"] += float((np.maximum(0, 0.012 * h + pw[:, 0]) ** 2).mean()) / (0.001 * h) ** 2
        # joints: the elbow neither locks out nor folds flat, the wrist does not snap
        sh, el, wr = w["arm_R"][1], w["forearm_R"][1], w["hand_R"][1]
        a, b = el - sh, wr - el
        bend = math.degrees(math.acos(np.clip(a @ b / np.linalg.norm(a) / np.linalg.norm(b), -1, 1)))
        fw = rot @ fingers0
        wrist = math.degrees(math.acos(np.clip(fw @ b / np.linalg.norm(b), -1, 1)))
        t["joints"] = (max(0.0, 8 - bend) / 6) ** 2 + (max(0.0, bend - 135) / 6) ** 2 + (max(0.0, wrist - 55) / 8) ** 2
        t["small"] = float((np.asarray(q) ** 2).sum()) / 200.0 ** 2     # prefer the smaller turn
        if parts_out is not None:
            parts_out.update({k: round(v, 2) for k, v in t.items()}, bend=round(bend), wrist=round(wrist))
        return float(sum(t.values()))

    lo = np.array([-150, -90, -90, -110, -70, -70, -70, -70, -70], dtype=float)
    hi = np.array([70, 90, 90, 110, 70, 70, 70, 70, 70], dtype=float)
    rng = np.random.default_rng(seed)
    best, best_c = None, 1e18
    for k in range(starts):
        q0 = lo + (hi - lo) * rng.uniform(0.2, 0.8, 9)
        res = minimize(cost, q0, method="Powell", bounds=list(zip(lo, hi)),
                       options={"maxiter": 6000, "xtol": 1e-2, "ftol": 1e-5})
        if res.fun < best_c:
            best, best_c = res.x, res.fun
    q = [float(round(v)) for v in best]
    info: dict = {}
    c = cost(q, info)
    return pose_of(q), c, info
