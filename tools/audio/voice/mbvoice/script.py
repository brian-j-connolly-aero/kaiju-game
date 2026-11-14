"""Loads the voice script (shared/src/defs/voiceLines.json, read-only here; then the lines the
client says for the events of phases 2 and 3, client/src/audio/eventLines.json) and the
pronunciation respellings (pronounce.json)."""

from __future__ import annotations

import json
import re

from . import EVENT_JSON, SCRIPT_JSON, VOICE_DIR

PRONOUNCE_JSON = VOICE_DIR / "pronounce.json"
CAST_JSON = VOICE_DIR / "cast.json"


def load_lines() -> list[dict]:
    """The whole script: the simulation's lines, then the client's event lines. Both are built,
    measured and documented the same way; their ids share one name space (the sound files)."""
    lines = json.loads(SCRIPT_JSON.read_text())
    if EVENT_JSON.exists():
        lines = lines + json.loads(EVENT_JSON.read_text())
    ids = [l["id"] for l in lines]
    if len(set(ids)) != len(ids):
        raise SystemExit("voiceLines.json and eventLines.json have duplicate ids")
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
    Word matching ignores case; whole words only."""
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
    return text
