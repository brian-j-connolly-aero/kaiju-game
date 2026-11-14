"""Pose targets that ship with the lizard rig, and the checks that keep them honest.

The game animates the rig in code. Generic joint angles do not work on this character: its
head hangs low and forward of the shoulders and its elbows rest bent, so "raise the arm 90
degrees" puts the hands on the skull and nothing in the player's first-person view. So the
asset carries the angles that do work, per stage, in the manifest (docs/ASSETS.md section 7):

    "poses": { "<name>": { "<node>": [x, y, z] } }      degrees, relative to the rest pose,
                                                        three.js Euler order XYZ, game axes

and the animator blends toward them. The values live in lizard.POSE_TARGETS (found with
solve() below, then tuned by eye).

What the player sees in first person is a rigid assembly: the camera sits on cam_fp, the
head is locked to the aim, and both arms ride on the head (docs/ASSETS.md section 7 and
docs/art/client-notes-kaiju-lizard.md say how the game does that). So the picture of snout
and claws depends only on the arm and jaw angles, not on where the player looks or on what
the body does underneath. That is the frame the targets are built and checked in:
first_person(pose) keeps the arms and the jaw of a target and leaves torso, neck and head
at rest, and the lens is the game's (kaijuController.ts: vertical field of view 72 degrees,
16:9, near plane 0.02 body heights). Arms that stayed on the torso would only be right
while the player looks dead level: 25 degrees down and the claws are at the top of the frame.

check() proves, on the exported file, what every target promises:

    - first person: the acting hand(s) are inside the frame, in its lower third, beyond the
      near plane; no arm comes near the crosshair; no arm touches the head or the jaw;
    - from outside (the whole target, arms on the torso, as every other player sees it): no
      arm touches the head or the jaw, and the forearms and hands touch nothing else (neck,
      torso, spines, each other).

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
         "throw_release": "R", "swipe_hit": "R", "stagger": ""}
# poses of the body only: nothing of them is built for the first-person frame
BODY_ONLY = ("stagger",)
FP_NODES = RIGHT_ARM + LEFT_ARM + ("jaw",)
CROSSHAIR = 0.14            # no arm may come closer than this to the middle of the frame (frame units)


def first_person(pose: dict) -> dict:
    """What a pose is in the player's own view: the arms and the jaw. In first person the head
    is locked to the aim and the arms ride on it, so torso, neck and head angles change
    nothing in the picture (they only move the camera with the body)."""
    return {name: v for name, v in pose.items() if name in FP_NODES}


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

    def triangles(self, world: dict, names, beyond_ball: bool = False) -> np.ndarray:
        """Triangles of some nodes in model space. beyond_ball leaves out the ball of an upper
        arm around its shoulder: that ball only turns in place, so what it touches at rest
        (the hatchling's jaw sits on its shoulders) it touches in every pose."""
        chunks = []
        for name in names:
            r, p = world[name]
            t = self.tris[name]
            if beyond_ball and name.startswith("arm_"):
                ball = 0.62 * float(np.linalg.norm(self.offset["forearm_" + name[-1]]))
                t = t[np.linalg.norm(t, axis=2).min(axis=1) > ball]
            chunks.append(t @ r.T + p)
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
    """Where a hand lands in the first-person frame (pose as given: pass first_person(target)):
    its middle (x, y), how much of it is inside the frame, how much of it is in the lower
    third, and its nearest depth in body heights."""
    world = body.world(pose)
    x, y, d = body.project(world, body.at(world, f"hand_{side}"), yaw, pitch)
    inside = (np.abs(x) <= 1) & (np.abs(y) <= 1) & (d > NEAR)
    low = inside & (y <= -1.0 / 3.0)
    return dict(x=float(np.median(x)), y=float(np.median(y)), inside=float(inside.mean()), low=float(low.mean()),
                depth=float(d.min()))


def arm_to_crosshair(body: Body, pose: dict) -> float:
    """How close any part of either arm comes to the middle of the first-person frame (frame
    units: 1 is half the frame's width or height). Edges are sampled, so a big facet counts."""
    world = body.world(pose)
    best = 9.0
    for name in RIGHT_ARM + LEFT_ARM:
        t = body.triangles(world, (name,))
        pts = np.vstack([t.reshape(-1, 3), t.mean(axis=1), (t[:, 0] + t[:, 1]) / 2, (t[:, 1] + t[:, 2]) / 2,
                         (t[:, 2] + t[:, 0]) / 2])
        x, y, d = body.project(world, pts)
        ok = d > NEAR
        if ok.any():
            best = min(best, float(np.hypot(x[ok], y[ok]).min()))
    return best


def check(asset: str, targets: dict, quiet: bool = False) -> list[str]:
    """Problems with the pose targets of one exported stage (an empty list is a pass)."""
    body = Body(asset)
    problems = []
    for name, pose in targets.items():
        notes = []
        if name not in BODY_ONLY:
            # ---- the player's own view: arms and jaw on the head, camera level
            fp = first_person(pose)
            world = body.world(fp)
            for side in SHOWS.get(name, ""):
                h = hand_in_frame(body, fp, side)
                notes.append(f"hand_{side} at ({h['x']:+.2f}, {h['y']:+.2f}) {h['inside'] * 100:.0f}% in frame, "
                             f"{h['low'] * 100:.0f}% in the lower third, nearest {h['depth']:.3f} h")
                if h["y"] > -1.0 / 3.0 or h["low"] < 0.5:
                    problems.append(f"{asset} {name}: hand_{side} is not in the lower third of the first-person frame "
                                    f"(middle at y = {h['y']:+.2f}, {h['low'] * 100:.0f}% of it there)")
                if h["inside"] < 0.6:
                    problems.append(f"{asset} {name}: only {h['inside'] * 100:.0f}% of hand_{side} is inside the frame")
            near = arm_to_crosshair(body, fp)
            notes.append(f"arms stay {near:.2f} from the crosshair")
            if near < CROSSHAIR:
                problems.append(f"{asset} {name}: an arm comes within {near:.2f} of the crosshair in first person "
                                f"(at least {CROSSHAIR} is wanted)")
            head = body.triangles(world, ("head", "jaw"))
            for arm in (RIGHT_ARM, LEFT_ARM):
                n = _overlaps(body.triangles(world, arm, beyond_ball=True), head)
                if n:
                    problems.append(f"{asset} {name}: in first person the {arm[0][-1]} arm cuts into the head or jaw "
                                    f"({n} triangle pairs)")
        # ---- from outside: the whole target, arms on the torso
        world = body.world(pose)
        head = body.triangles(world, ("head", "jaw"))
        rest = body.triangles(world, ("neck", "torso", "spines"))
        for arm in (RIGHT_ARM, LEFT_ARM):
            n = _overlaps(body.triangles(world, arm, beyond_ball=True), head)
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
            print(f"  {asset} {name:<14} " + ("; ".join(notes) if notes else "(body pose: no hand must show)"))
    return problems


# =========================================================================================
# solving (a tool for the artist: run this file, look, paste, tune)
# =========================================================================================
def solve(body: Body, base: dict, goal: dict, seed: int = 1, starts: int = 10, both: bool = True, init=()):
    """Find right-arm angles (arm, forearm, hand) that put the right hand where `goal` says in
    the first-person frame, clear of the head, on top of the `base` pose (torso, neck, head,
    jaw). The frame is the first-person assembly (see first_person()): of the base only the
    jaw counts there; the rest of it is how the body looks from outside, where the arms must
    clear the head as well.

    goal: x, y (frame coordinates of the middle of the hand), depth (lo, hi) in body heights,
          fingers = direction the fingers point and back = direction the back of the hand
          faces, both as (right, up, forward) seen by the camera, optional;
          low=True keeps the whole arm out of the upper two thirds of the frame.
    both: the left arm mirrors the right (two-handed poses); else it hangs at rest.
    starts: size of the search (a population of 9 x starts poses evolves, then is polished).
    init: poses to seed the search with (another stage's answer, say).
    Returns (pose, cost, what the cost is made of)."""
    from scipy.optimize import differential_evolution, minimize
    from scipy.spatial import ConvexHull

    h = body.height
    hand = body.pts["hand_R"]
    far = np.linalg.norm(hand, axis=1)
    tips = hand[far > np.quantile(far, 0.8)].mean(axis=0)            # the claws, hand-local
    fingers0 = tips / np.linalg.norm(tips)
    # the back of the hand faces away from the palm: at rest that is up and outward (see lizard._hand)
    back0 = np.cross(fingers0, np.cross((0.0, 1.0, 0.0), fingers0))
    back0 /= np.linalg.norm(back0)
    # sample points on the arm; every point of the hand (claw tips are what crosses a line first)
    arm_pts = {n: body.pts[n] if n == "hand_R" else body.pts[n][:: max(1, len(body.pts[n]) // 140)] for n in RIGHT_ARM}
    ball = 0.62 * float(np.linalg.norm(body.offset["forearm_R"]))       # the shoulder ball only turns in place
    arm_pts["arm_R"] = arm_pts["arm_R"][np.linalg.norm(arm_pts["arm_R"], axis=1) > ball]
    wbase = body.world(first_person(base))
    # the head as a convex lump (skull, snout, jaw, tusks; not the crown spikes that sweep back):
    # as the player's own view has it (head at rest, jaw as posed), and as it sits on the body
    # seen from outside (neck and head as posed; the torso carries arms and head alike)
    hulls = []
    for wh in (wbase, body.world({k: v for k, v in base.items() if k != "torso"})):
        hp = np.vstack([body.at(wh, "head", body.pts["head"][body.pts["head"][:, 2] > -0.02 * h]), body.at(wh, "jaw")])
        if both:                      # the left arm mirrors the right: it must clear the mirrored head too
            hp = np.vstack([hp, hp * (-1.0, 1.0, 1.0)])
        hull = ConvexHull(hp)
        hulls.append((hull.equations[:, :3], hull.equations[:, 3]))
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
    ray = f + r * (goal["x"] * TAN_H) + u * (goal["y"] * TAN_V)
    cosr = 1.0 / float(np.linalg.norm(ray))           # depth along the view axis per unit along the ray
    ray = ray * cosr

    def pose_of(q):
        p = dict(base)
        p["arm_R"], p["forearm_R"], p["hand_R"] = tuple(q[0:3]), tuple(q[3:6]), tuple(q[6:9])
        return mirrored(p) if both else p

    def cost(q, parts_out=None):
        w = body.world(first_person(pose_of(q)))
        t = {}
        hw = body.at(w, "hand_R")
        x, y, d = body.project(w, hw)
        # the middle of the hand should sit on the ray through the wanted spot of the frame,
        # at a distance inside the wanted range (a 3D error: it also pulls a hand that is still
        # behind the camera the right way, which frame coordinates cannot)
        e = np.median(hw, axis=0) - eye
        along = float(e @ ray)
        t["place"] = float(((e - ray * along) ** 2).sum()) / (0.012 * h) ** 2
        t["depth"] = (max(0.0, dlo * h - along * cosr) / (0.02 * h)) ** 2 + (max(0.0, along * cosr - dhi * h) / (0.02 * h)) ** 2
        ok = d > 0.02
        t["frame"] = float((np.maximum(0, np.abs(x[ok]) - 0.96) ** 2).sum() + (np.maximum(0, -0.96 - y[ok]) ** 2).sum()) / len(x) * 400
        t["third"] = float((np.maximum(0, y[ok] + 0.30) ** 2).sum()) / len(x) * 200   # the hand stays in the lower third
        rot = w["hand_R"][0]
        if want_f is not None:
            t["fingers"] = (1 - float((rot @ fingers0) @ want_f)) / 0.06
        if want_b is not None:
            t["back"] = (1 - float((rot @ back0) @ want_b)) / 0.20
        t["head"] = t["torso"] = t["high"] = t["mid"] = t["cross"] = 0.0
        for n in RIGHT_ARM:
            pw = body.at(w, n, arm_pts[n])
            px, py, pd = body.project(w, pw)
            seen = pd > NEAR                                           # nothing of the arm near the crosshair
            if seen.any():
                t["cross"] += float((np.maximum(0, CROSSHAIR + 0.08 - np.hypot(px[seen], py[seen])) ** 2).sum()
                                    / len(pw)) * 3000
            for hn, hd in hulls:
                sd = (pw @ hn.T + hd).max(axis=1)                      # > 0 outside the head lump
                t["head"] += float((np.maximum(0, 0.020 * h - sd) ** 2).mean()) / (0.0008 * h) ** 2
            if n != "arm_R":
                sd = (pw @ tn.T + td).max(axis=1)
                t["torso"] += float((np.maximum(0, 0.006 * h - sd) ** 2).mean()) / (0.001 * h) ** 2
                if goal.get("low"):
                    t["high"] += float((np.maximum(0, py[pd > 0.05] + 0.25) ** 2).sum() / len(pw)) * 100
                if both:                                               # mirrored arms must not meet
                    t["mid"] += float((np.maximum(0, 0.030 * h + pw[:, 0]) ** 2).mean()) / (0.0005 * h) ** 2
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
    pop = lo + (hi - lo) * rng.uniform(0.0, 1.0, (max(starts, 12) * 9, 9))
    first = [np.array(p["arm_R"] + p["forearm_R"] + p["hand_R"], dtype=float) for p in init if "arm_R" in p]
    for k, q0 in enumerate(first[: len(pop)]):
        pop[k] = np.clip(q0, lo, hi)
    if os.environ.get("MB_POSE_DEBUG"):
        for q0 in first:
            info0: dict = {}
            print("    start", [round(v) for v in q0], round(cost(q0, info0), 1), info0)
    res = differential_evolution(cost, list(zip(lo, hi)), init=pop, maxiter=220, tol=1e-7, mutation=(0.4, 0.9),
                                 recombination=0.8, polish=False, seed=seed)
    if os.environ.get("MB_POSE_DEBUG"):
        print("    evolved to", [round(v) for v in res.x], round(res.fun, 1), res.message)
    fine = minimize(cost, res.x, method="Powell", bounds=list(zip(lo, hi)),
                    options={"maxiter": 6000, "xtol": 1e-2, "ftol": 1e-6})
    q = min(([float(round(v)) for v in x] for x in (res.x, fine.x)), key=cost)     # whole degrees are plenty
    info: dict = {}
    c = cost(q, info)
    return pose_of(q), c, info


def goals(stage: int) -> dict:
    """What each first-person pose target should look like: name -> (body angles, goal for the
    right hand as solve() takes it, both arms?). The goal is in the first-person assembly's
    frame; the body angles only shape what other players see. Depths are body heights from
    the camera; the hatchling's big head keeps its hands a little farther out. (The shipped
    eat targets were then turned palm-in by hand: the solver's answer showed two forearms
    and no claws.)"""
    near = {1: 0.19, 2: 0.16, 3: 0.16}[stage]
    return {
        # the carry: claws up either side of the snout, palms in, claws hooking toward the middle
        "fp_claws": ({}, dict(x=0.70, y=-0.64, depth=(near + 0.02, near + 0.12), fingers=(-0.25, 0.55, 0.80),
                              back=(0.8, 0.5, -0.2), low=True), True),
        # reach forward, fingers a little up so the claws show against the street
        "grab": ({"torso": (18, 10, 0)}, dict(x=0.30, y=-0.50, depth=(0.28, 0.48), fingers=(-0.40, 0.20, 0.90),
                                              back=(0.3, 0.9, -0.1), low=True), False),
        # carry: the hand low on the right, palm up and in, so the thing it holds sits toward the middle
        "hold": ({}, dict(x=0.56, y=-0.64, depth=(near, near + 0.12), fingers=(-0.3, 0.35, 0.88),
                          back=(0.6, -0.7, -0.2), low=True), False),
        # both hands bring the meal to the mouth, either side of the snout tip
        "eat": ({"torso": (10, 0, 0), "head": (8, 0, 0), "jaw": (22, 0, 0)},
                dict(x=0.42, y=-0.72, depth=(near - 0.04, near + 0.06), fingers=(-0.75, 0.35, 0.55),
                     back=(0.6, -0.2, 0.75), low=True), True),
        # guard: claws crossed low in front of the face, palms toward the body
        "brace": ({"torso": (16, 0, 0), "neck": (4, 0, 0), "head": (4, 0, 0)},
                  dict(x=0.40, y=-0.66, depth=(near - 0.01, near + 0.11), fingers=(-0.75, 0.40, 0.55),
                       back=(0.35, 0.3, 0.88), low=True), True),
        # cocked: the hand drawn back to the edge of the view, palm forward, the body twisted away
        "throw_windup": ({"torso": (-12, -28, 0)}, dict(x=0.80, y=-0.68, depth=(near - 0.04, near + 0.06),
                                                        fingers=(0.1, 0.8, 0.6), back=(0.2, 0.0, -1.0)), False),
        # flung: the arm out toward the target, fingers open
        "throw_release": ({"torso": (16, 22, 0)}, dict(x=0.32, y=-0.50, depth=(0.30, 0.55), fingers=(-0.25, 0.40, 0.88),
                                                       back=(0.3, 0.8, -0.4), low=True), False),
        # the end of the rake: the right claw across in front of the nose, under the crosshair
        "swipe_hit": ({"torso": (14, 43, 0), "head": (0, 11, 0)},
                      dict(x=0.20, y=-0.66, depth=(0.24, 0.40), fingers=(-0.9, 0.1, 0.4), back=(0.1, 0.6, 0.8),
                           low=True), False),
    }


def main(argv=None) -> int:
    """Re-solve pose targets after the proportions changed:

        /opt/mbtools/venv/bin/python tools/art/kaiju/poses.py [stage ...] [--only grab,eat]

    Prints lines to paste into lizard.POSE_TARGETS and what check() says about them. The
    current targets seed the search, so an answer that still works is kept or improved.
    Then rebuild (tools/art/kaiju_lizard.py) and look at the FIRST PERSON cells and at the
    poses from outside: the solver only knows where the hand should be, not what reads well.
    About 30 seconds per pose."""
    import argparse

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import lizard
    ap = argparse.ArgumentParser(description="Solve the lizard's first-person pose targets.")
    ap.add_argument("stages", nargs="*", type=int, default=[1, 2, 3])
    ap.add_argument("--only", default="", help="comma-separated pose names")
    args = ap.parse_args(argv)
    only = {s for s in args.only.split(",") if s}
    code = 0
    for stage in args.stages:
        asset = f"kaiju_lizard_s{stage}"
        body = Body(asset)
        found = {}
        print(f"    {stage}: {{")
        for name, (base, goal, both) in goals(stage).items():
            if only and name not in only:
                continue
            seeds = [t[name] for t in (lizard.POSE_TARGETS.get(stage, {}), *lizard.POSE_TARGETS.values()) if name in t]
            pose, cost, _ = solve(body, base, goal, both=both, starts=14, init=seeds)
            found[name] = pose
            a, f, h = (tuple(int(v) for v in pose[k]) for k in RIGHT_ARM)
            print(f'        "{name}": {"_both" if both else "_right"}({base}, {a}, {f}, {h}),    # cost {cost:.1f}')
        print("    },")
        for line in check(asset, found):
            print("  PROBLEM", line)
            code = 1
    return code


if __name__ == "__main__":
    raise SystemExit(main())
