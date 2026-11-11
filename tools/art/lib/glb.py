"""Minimal reader for binary glTF (.glb) files. Pure Python + numpy, no Blender needed.

Used by the validator and the manifest writer so that everything they report is measured
from the exported file itself, never from the scene that produced it.

Coordinates returned here are glTF space: +Y up, +Z forward, +X the model's left.
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field

import numpy as np

_COMPONENT = {
    5120: (np.int8, 1), 5121: (np.uint8, 1), 5122: (np.int16, 2), 5123: (np.uint16, 2),
    5125: (np.uint32, 4), 5126: (np.float32, 4),
}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
_NORMALIZED_MAX = {np.int8: 127.0, np.uint8: 255.0, np.int16: 32767.0, np.uint16: 65535.0}


class GlbError(Exception):
    pass


@dataclass
class Primitive:
    material: str | None          # material name, None if the primitive has no material
    mode: int                     # 4 = triangles
    positions: np.ndarray         # (n, 3) float, mesh-local
    normals: np.ndarray | None    # (n, 3) or None
    colors: np.ndarray | None     # (n, 3 or 4) float 0..1, linear, or None (COLOR_0)
    uvs: np.ndarray | None        # (n, 2) or None (TEXCOORD_0, v runs down the image)
    indices: np.ndarray           # (t, 3) int
    attributes: list[str] = field(default_factory=list)

    @property
    def tris(self) -> int:
        return int(len(self.indices)) if self.mode == 4 else 0


@dataclass
class Node:
    index: int
    name: str
    parent: int | None
    children: list[int]
    mesh: int | None
    local: np.ndarray             # 4x4 local matrix
    world: np.ndarray             # 4x4 world matrix (rest pose)
    has_rotation: bool
    has_scale: bool
    has_matrix: bool

    @property
    def position(self) -> np.ndarray:
        """World-space position of the node origin (its pivot)."""
        return self.world[:3, 3].copy()


def _quat_to_mat(q) -> np.ndarray:
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


class Glb:
    """A parsed .glb file. See `load()`."""

    def __init__(self, path: str):
        self.path = str(path)
        with open(path, "rb") as f:
            data = f.read()
        self.byte_size = len(data)
        if len(data) < 20 or data[:4] != b"glTF":
            raise GlbError("not a binary glTF file (missing 'glTF' magic)")
        version, length = struct.unpack_from("<II", data, 4)
        if version != 2:
            raise GlbError(f"glTF container version {version}, expected 2")
        self.json: dict = {}
        self.bin = b""
        off = 12
        while off + 8 <= min(length, len(data)):
            clen, ctype = struct.unpack_from("<II", data, off)
            chunk = data[off + 8: off + 8 + clen]
            if ctype == 0x4E4F534A:      # JSON
                self.json = json.loads(chunk.decode("utf-8"))
            elif ctype == 0x004E4942:    # BIN
                self.bin = chunk
            off += 8 + clen
        if not self.json:
            raise GlbError("no JSON chunk")
        self._accessor_cache: dict[int, np.ndarray] = {}
        self.materials: list[str] = [m.get("name", "") for m in self.json.get("materials", [])]
        self.nodes: list[Node] = []
        self.meshes: list[list[Primitive]] = []
        self._read_meshes()
        self._read_nodes()

    # ---- raw access -------------------------------------------------------------------
    def accessor(self, idx: int) -> np.ndarray:
        if idx in self._accessor_cache:
            return self._accessor_cache[idx]
        acc = self.json["accessors"][idx]
        dtype, size = _COMPONENT[acc["componentType"]]
        ncomp = _NCOMP[acc["type"]]
        count = acc["count"]
        if "bufferView" not in acc:
            arr = np.zeros((count, ncomp), dtype=np.float64)
        else:
            bv = self.json["bufferViews"][acc["bufferView"]]
            if bv.get("buffer", 0) != 0 or "uri" in self.json["buffers"][0]:
                raise GlbError("external buffers are not allowed; everything must be in the .glb")
            start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            stride = bv.get("byteStride") or size * ncomp
            if stride == size * ncomp:
                arr = np.frombuffer(self.bin, dtype=dtype, count=count * ncomp, offset=start)
                arr = arr.reshape(count, ncomp)
            else:
                rows = [np.frombuffer(self.bin, dtype=dtype, count=ncomp, offset=start + i * stride)
                        for i in range(count)]
                arr = np.array(rows).reshape(count, ncomp)
            if acc.get("normalized") and dtype in _NORMALIZED_MAX:
                arr = np.maximum(arr.astype(np.float64) / _NORMALIZED_MAX[dtype], -1.0)
            elif dtype == np.float32:
                arr = arr.astype(np.float64)
        self._accessor_cache[idx] = arr
        return arr

    # ---- meshes -----------------------------------------------------------------------
    def _read_meshes(self) -> None:
        for mesh in self.json.get("meshes", []):
            prims = []
            for p in mesh.get("primitives", []):
                attrs = p.get("attributes", {})
                pos = self.accessor(attrs["POSITION"]) if "POSITION" in attrs else np.zeros((0, 3))
                nor = self.accessor(attrs["NORMAL"]) if "NORMAL" in attrs else None
                col = self.accessor(attrs["COLOR_0"]) if "COLOR_0" in attrs else None
                uv = self.accessor(attrs["TEXCOORD_0"]) if "TEXCOORD_0" in attrs else None
                if "indices" in p:
                    idx = self.accessor(p["indices"]).reshape(-1).astype(np.int64)
                else:
                    idx = np.arange(len(pos), dtype=np.int64)
                mode = p.get("mode", 4)
                if mode == 4:
                    idx = idx[: len(idx) // 3 * 3].reshape(-1, 3)
                mat = p.get("material")
                prims.append(Primitive(
                    material=self.materials[mat] if mat is not None else None,
                    mode=mode, positions=pos, normals=nor, colors=col, uvs=uv, indices=idx,
                    attributes=sorted(attrs.keys())))
            self.meshes.append(prims)

    # ---- nodes ------------------------------------------------------------------------
    def _read_nodes(self) -> None:
        jn = self.json.get("nodes", [])
        parents: dict[int, int] = {}
        for i, n in enumerate(jn):
            for c in n.get("children", []):
                parents[c] = i
        for i, n in enumerate(jn):
            m = np.eye(4)
            has_matrix = "matrix" in n
            if has_matrix:
                m = np.array(n["matrix"], dtype=np.float64).reshape(4, 4).T
            else:
                t = n.get("translation", [0, 0, 0])
                r = n.get("rotation", [0, 0, 0, 1])
                s = n.get("scale", [1, 1, 1])
                m[:3, :3] = _quat_to_mat(r) @ np.diag(s)
                m[:3, 3] = t
            rot = n.get("rotation", [0, 0, 0, 1])
            scl = n.get("scale", [1, 1, 1])
            has_rot = bool(np.abs(np.abs(rot[3]) - 1.0) > 1e-5 or np.abs(np.array(rot[:3])).max() > 1e-4)
            has_scl = bool(np.abs(np.array(scl) - 1.0).max() > 1e-5)
            if has_matrix:
                has_rot = has_rot or bool(np.abs(m[:3, :3] - np.eye(3)).max() > 1e-5)
            self.nodes.append(Node(index=i, name=n.get("name", ""), parent=parents.get(i),
                                   children=list(n.get("children", [])), mesh=n.get("mesh"),
                                   local=m, world=np.eye(4), has_rotation=has_rot,
                                   has_scale=has_scl, has_matrix=has_matrix))
        scenes = self.json.get("scenes", [])
        scene = scenes[self.json.get("scene", 0)] if scenes else {"nodes": []}
        self.roots: list[int] = list(scene.get("nodes", []))

        def walk(i: int, parent_world: np.ndarray) -> None:
            node = self.nodes[i]
            node.world = parent_world @ node.local
            for c in node.children:
                walk(c, node.world)

        for r in self.roots:
            walk(r, np.eye(4))

    # ---- queries ----------------------------------------------------------------------
    def node(self, name: str) -> Node | None:
        for n in self.nodes:
            if n.name == name:
                return n
        return None

    def node_names(self) -> list[str]:
        """All node names, depth-first from the scene roots (hierarchy order)."""
        out: list[str] = []

        def walk(i: int) -> None:
            out.append(self.nodes[i].name)
            for c in self.nodes[i].children:
                walk(c)

        for r in self.roots:
            walk(r)
        return out

    def subtree(self, name_or_index) -> list[Node]:
        start = self.node(name_or_index) if isinstance(name_or_index, str) else self.nodes[name_or_index]
        if start is None:
            return []
        out: list[Node] = []

        def walk(n: Node) -> None:
            out.append(n)
            for c in n.children:
                walk(self.nodes[c])

        walk(start)
        return out

    def reachable(self) -> list[Node]:
        out: list[Node] = []
        for r in self.roots:
            out.extend(self.subtree(r))
        return out

    def world_positions(self, nodes: list[Node] | None = None) -> np.ndarray:
        """All mesh vertices of the given nodes (default: whole scene) in world space."""
        pts = []
        for n in (nodes if nodes is not None else self.reachable()):
            if n.mesh is None:
                continue
            for p in self.meshes[n.mesh]:
                if len(p.positions):
                    pts.append(p.positions @ n.world[:3, :3].T + n.world[:3, 3])
        return np.vstack(pts) if pts else np.zeros((0, 3))

    def bounds(self, nodes: list[Node] | None = None):
        """(min xyz, max xyz) of mesh vertices in world space, or None if there are none."""
        pts = self.world_positions(nodes)
        if not len(pts):
            return None
        return pts.min(axis=0), pts.max(axis=0)

    def size(self, nodes: list[Node] | None = None) -> list[float]:
        """[width (x), height (y), depth (z)] in meters, rounded to millimeters."""
        b = self.bounds(nodes)
        if b is None:
            return [0.0, 0.0, 0.0]
        return [round(float(v), 3) for v in (b[1] - b[0])]

    def tris(self, nodes: list[Node] | None = None) -> int:
        total = 0
        for n in (nodes if nodes is not None else self.reachable()):
            if n.mesh is not None:
                total += sum(p.tris for p in self.meshes[n.mesh])
        return total

    def node_tris(self, name: str) -> int:
        n = self.node(name)
        if n is None or n.mesh is None:
            return 0
        return sum(p.tris for p in self.meshes[n.mesh])

    def node_materials(self, name: str) -> list[str | None]:
        n = self.node(name)
        if n is None or n.mesh is None:
            return []
        return [p.material for p in self.meshes[n.mesh]]


def load(path: str) -> Glb:
    return Glb(path)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def to_hex(rgb_linear) -> str:
    s = np.rint(linear_to_srgb(np.asarray(rgb_linear)[:3]) * 255).astype(int)
    return "#%02x%02x%02x" % (int(s[0]), int(s[1]), int(s[2]))
