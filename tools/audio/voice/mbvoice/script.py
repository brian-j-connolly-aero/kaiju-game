"""Loads the voice script and the pronunciation respellings (pronounce.json).

The script has two parts since round 4 (docs/ROADMAP.md):

- `shared/src/defs/voiceLines.json`, the simulation's cue lines: only the news telling the
  monster's player it can molt (`molt.available`) is left. Read-only here.
- `client/src/audio/roseLines.json`, the communication rose's army lines: for every wedge a few
  one-sentence lines, each spoken in every squad voice (`voices`). They become lines with the
  id `rose_<voice>_<wedge>_<n>`, the cue `rose.<wedge>`, the audience `humans` and the voice as
  the speaker, so that they are built, measured and documented like any other line. A later
  voice pass can rebuild every file from the same data file.
"""

from __future__ import annotations

import json
import re

from . import ROSE_JSON, SCRIPT_JSON, VOICE_DIR

PRONOUNCE_JSON = VOICE_DIR / "pronounce.json"
CAST_JSON = VOICE_DIR / "cast.json"


def load_rose() -> dict:
    """The rose's data file: {"voices": [...], "army": {"<wedge>": ["line", ...], ...}}."""
    return json.loads(ROSE_JSON.read_text())


def rose_lines(rose: dict | None = None) -> list[dict]:
    """The rose's army lines, one per sentence and voice, in voice, wedge and file order."""
    rose = rose if rose is not None else load_rose()
    out = []
    for voice in rose["voices"]:
        for wedge, texts in rose["army"].items():
            for n, text in enumerate(texts, start=1):
                out.append({"id": f"rose_{voice.lower()}_{wedge}_{n}", "cue": f"rose.{wedge}",
                            "audience": "humans", "speaker": voice, "text": text})
    return out


def load_lines() -> list[dict]:
    """The whole script: the simulation's lines, then the rose's. Both are built, measured and
    documented the same way; their ids share one name space (the sound files)."""
    lines = json.loads(SCRIPT_JSON.read_text())
    if ROSE_JSON.exists():
        lines = lines + rose_lines()
    ids = [l["id"] for l in lines]
    if len(set(ids)) != len(ids):
        raise SystemExit("voiceLines.json and roseLines.json give two lines the same id")
    return lines


def load_cast() -> dict:
    return json.loads(CAST_JSON.read_text())


def load_pronounce() -> dict:
    if not PRONOUNCE_JSON.exists():
        return {"words": {}, "lines": {}}
    data = json.loads(PRONOUNCE_JSON.read_text())
    data.setdefault("words", {})
    data.setdefault("lines", {})
    return data


def spoken_text(line: dict, voice: dict, pron: dict) -> str:
    """What is fed to the synthesizer for a line. The subtitle text is never changed.

    pronounce.json:
      "lines": { "<lineId>": "full replacement text" }
      "words": { "<word>": "respelling" }                     for every engine, or
               { "<word>": { "<engine>" | "<engine>:<voice>" | "*": "respelling" } }
    Word matching ignores case; whole words only. A voice with "shout" (cast.json) gets its
    sentence's end mark repeated that many times, which these synthesizers take as more urgency."""
    if line["id"] in pron["lines"]:
        entry = pron["lines"][line["id"]]
        if isinstance(entry, str):
            return entry
        for key in (f"{voice['engine']}:{voice.get('voice', '')}", voice["engine"], "*"):
            if key in entry:
                return entry[key]
    text = line["text"]
    for word, rule in pron["words"].items():
        if isinstance(rule, dict):
            rep = None
            for key in (f"{voice['engine']}:{voice.get('voice', '')}", voice["engine"], "*"):
                if key in rule:
                    rep = rule[key]
                    break
            if rep is None:
                continue
        else:
            rep = rule
        text = re.sub(rf"\b{re.escape(word)}\b", rep, text, flags=re.IGNORECASE)
    shout = int(voice.get("shout", 0))
    if shout > 1 and text.endswith("!"):
        text = text + "!" * (shout - 1)
    return text
