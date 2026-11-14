"""Neural voice model files: where they come from and where they are kept.

The neural voices (Kokoro and Piper, see synth.py) need model files of 60 to 330 MB. They are not
committed. Each file below is pinned to an exact revision of a Hugging Face repository and to its
SHA-256 hash; `path(name)` downloads it into the cache on first use and checks the hash, so every
machine builds from the same bytes. The cache is outside the repository:

  $MB_MODELS (default /opt/mbtools/models)/<name>

Only the build needs the network, and only the first time. The game itself never loads these
files: it plays the finished .ogg and .mp3 lines.

Licenses (the reason these and not others): Kokoro-82M is Apache 2.0 (model and voices; the files
here are the ONNX export used by the kokoro-onnx package). Piper voices carry the license of the
recordings they were trained on, listed per voice below; only voices whose recordings and base
model are public domain, CC0 or CC BY 4.0 are listed. CC BY 4.0 asks for credit, which
docs/audio/VOICE.md gives for every voice in use."""

from __future__ import annotations

import hashlib
import os
import sys
import urllib.request
from pathlib import Path

MODELS_DIR = Path(os.environ.get("MB_MODELS", "/opt/mbtools/models"))

_HF = "https://huggingface.co/{repo}/resolve/{rev}/{path}"
_KOKORO = ("fastrtc/kokoro-onnx", "8d07950c9b6c87ce6809e9bba7bd494336217c2a")
_PIPER = ("rhasspy/piper-voices", "6b9cfaacb4fb2e02a9621227e3c1a48bec9710c3")
_PARAKEET = ("csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "84b478d541cdbf0c296a7ab5f1e20a6f8f998114")

# name in the cache -> (repository, revision, path in the repository, sha256, bytes)
FILES: dict[str, tuple[str, str, str, str, int]] = {
    "kokoro/kokoro-v1.0.onnx": (*_KOKORO, "kokoro-v1.0.onnx",
                                "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5", 325532387),
    "kokoro/voices-v1.0.bin": (*_KOKORO, "voices-v1.0.bin",
                               "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d", 28214398),
    # The second speech recognizer (mbvoice/asr2.py), a measuring instrument only: NVIDIA Parakeet
    # TDT 0.6B v2, CC BY 4.0, in the 8-bit ONNX export made for sherpa-onnx.
    "asr/parakeet-tdt-0.6b-v2-int8/encoder.int8.onnx": (*_PARAKEET, "encoder.int8.onnx",
        "92a10bd9c23936ea0566c29f963bc57c2a5df4261b6a8921c39abea66557ca8b", 652282309),
    "asr/parakeet-tdt-0.6b-v2-int8/decoder.int8.onnx": (*_PARAKEET, "decoder.int8.onnx",
        "4d097bae3bac5c96018d5293ba39f1b657296102b142affda40378f38b020f41", 7257753),
    "asr/parakeet-tdt-0.6b-v2-int8/joiner.int8.onnx": (*_PARAKEET, "joiner.int8.onnx",
        "77a29f3e5ac7d37074e0af465391b80f314015d5b97f0f90c6c7767f1d56f428", 1739080),
    "asr/parakeet-tdt-0.6b-v2-int8/tokens.txt": (*_PARAKEET, "tokens.txt",
        "ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d", 9384),
    # Speaker recognition (mbvoice/speakers.py), a measuring instrument only: WeSpeaker ResNet34
    # trained on VoxCeleb, Apache 2.0.
    "speaker/voxceleb_resnet34.onnx": ("Wespeaker/wespeaker-voxceleb-resnet34",
                                       "ff1ac5bca8ef11e90662b879aa923979e0bd277b", "voxceleb_resnet34.onnx",
                                       "9fea6516d7ad6bf0a76c7689f5a49b65d330fad6dde96c91bb4435ffbfe056a1", 26534127),
}

# Piper voices: name -> (path in rhasspy/piper-voices without extension, model sha256, model bytes,
# config sha256, config bytes, recordings and license)
PIPER_VOICES: dict[str, tuple[str, str, int, str, int, str]] = {
    "en_GB-alba-medium": (
        "en/en_GB/alba/medium/en_GB-alba-medium",
        "1f9da809b6da1ef4190bb5dd6cce4f4af803274539e9cf9e0693085150bac3d7", 63221984,
        "6214603a0dd60e9dcd05502e23ef07fbe3d9af36d3189c8cc3eb129e1a099d6f", 5471,
        "Alba, a Scottish English speaker (University of Edinburgh DataShare 10283/3270), CC BY 4.0; "
        "base model Hi-Fi TTS reader 92, CC BY 4.0"),
    "en_GB-cori-high": (
        "en/en_GB/cori/high/en_GB-cori-high",
        "470b4dd634c98f8a4850d7626ffc3dfc90774628eeef6605a6dd8f88f30a5903", 114219352,
        "9e7fb5b5671612c22f3c81cbe46c1ae87b031a4632bcb509e499dad6f1e2adec", 4963,
        "LibriVox recordings, public domain"),
    "en_US-bryce-medium": (
        "en/en_US/bryce/medium/en_US-bryce-medium",
        "dc9caa6c313199ffb5ac698b6e542fa6cba388aeaf2731e25262e33b9810aef1", 63531379,
        "7ceb1bc4af6d4e41b6d1edbb86c67e91e01eaa71f66db4cd0ae92ac704d415be", 4966,
        "the trainer's own voice, public domain"),
    "en_US-john-medium": (
        "en/en_US/john/medium/en_US-john-medium",
        "789c6c875726e627ddee93d51d8727859abe9c091c3d141591f4b83c2072e988", 63531379,
        "af60f177b6b550f3d7a302720c0fb89e7f94a82b5dca464775ef63b1c69ba09a", 4965,
        "LibriVox recordings, public domain"),
    "en_US-norman-medium": (
        "en/en_US/norman/medium/en_US-norman-medium",
        "b9739443232a80a59c7d18810dd856899bf16a7964725f5ab81ea49b1351cb71", 63531379,
        "6c2db7f558a4a8deb9fe822583c1c5105f6c4e834dd0f9de8ad17a888ee9fe1d", 4968,
        "LibriVox recordings, public domain"),
    "en_US-joe-medium": (
        "en/en_US/joe/medium/en_US-joe-medium",
        "abf4b998e34045cbd00eaf050de2de620f81ded6eb8b85a24b022a1c2b3f08d2", 63221984,
        "7b5f0293c0bf5bda8e377be1696da84af798befeef31038e43beefc01fe858da", 5465,
        "Open Home Foundation voice datasets, CC0"),
    "en_US-mike-medium": (
        "en/en_US/mike/medium/en_US-mike-medium",
        "6876866e3dfadc7f044bc5e4fbac16c47b5a1e79eaec04e3bb0c2c6e9da8a857", 63221984,
        "57893c9e492cc6650e2a91e26ec7aa3bf23c267c080649f7cfb6aa1843fcd6ed", 5466,
        "Open Home Foundation voice datasets, CC0"),
}

for _name, (_p, _msha, _mbytes, _csha, _cbytes, _lic) in PIPER_VOICES.items():
    FILES[f"piper/{_name}.onnx"] = (*_PIPER, _p + ".onnx", _msha, _mbytes)
    FILES[f"piper/{_name}.onnx.json"] = (*_PIPER, _p + ".onnx.json", _csha, _cbytes)


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def path(name: str) -> Path:
    """Local path of a model file, downloaded (and checked) first if it is not in the cache."""
    if name not in FILES:
        raise SystemExit(f"unknown model file {name!r} (known: mbvoice/models.py FILES)")
    repo, rev, rpath, sha, size = FILES[name]
    target = MODELS_DIR / name
    if target.exists() and target.stat().st_size == size:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    url = _HF.format(repo=repo, rev=rev, path=rpath)
    print(f"voice: downloading {name} ({size / 1e6:.0f} MB) from {repo} into {MODELS_DIR}", file=sys.stderr, flush=True)
    part = target.with_name(f"{target.name}.{os.getpid()}.part")
    try:
        with urllib.request.urlopen(url, timeout=120) as r, part.open("wb") as out:
            while block := r.read(1 << 20):
                out.write(block)
        got = _sha256(part)
        if got != sha:
            raise SystemExit(f"{name}: downloaded file has SHA-256 {got}, expected {sha} ({url})")
        os.replace(part, target)          # atomic: a second process never sees half a file
    finally:
        part.unlink(missing_ok=True)
    return target


def files_for(voice: dict) -> list[str]:
    """The model files a voice description from cast.json needs (none for the older engines)."""
    if voice.get("engine") == "kokoro":
        return ["kokoro/kokoro-v1.0.onnx", "kokoro/voices-v1.0.bin"]
    if voice.get("engine") == "piper":
        return [f"piper/{voice['voice']}.onnx", f"piper/{voice['voice']}.onnx.json"]
    return []


def fetch_for_cast(cast: dict) -> None:
    """Download every model file the cast needs, once, before worker processes start."""
    for sp in cast["speakers"].values():
        for name in files_for(sp["voice"]):
            path(name)


def verify_all() -> list[str]:
    """Hash check of the files already in the cache (for audits; the build checks on download)."""
    bad = []
    for name, (_, _, _, sha, _) in FILES.items():
        p = MODELS_DIR / name
        if p.exists() and _sha256(p) != sha:
            bad.append(name)
    return bad
