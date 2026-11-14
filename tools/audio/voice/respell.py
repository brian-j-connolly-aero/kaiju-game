#!/opt/mbtools/venv/bin/python
"""Try respellings for one line before putting them into pronounce.json.

  respell.py <lineId> "candidate text" ["another candidate" ..]

Speaks the line as the script has it and each candidate with the line's own voice and chain,
transcribes the unprocessed and the finished clip, and prints the word errors against the
subtitle text. Nothing is written. A candidate earns its place in pronounce.json only when it
clearly lowers the errors."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mbvoice import SR, asr  # noqa: E402
from mbvoice.chains import apply_chain  # noqa: E402
from mbvoice.pipeline import line_plan, master, raw_speech  # noqa: E402
from mbvoice.script import load_cast, load_lines, load_pronounce  # noqa: E402


def trial(line: dict, plan: dict, text: str) -> tuple[int, int, str, str]:
    raw = raw_speech(text, plan["voice"], plan["max_pause_ms"], plan["min_pause_ms"])
    seed = int.from_bytes(hashlib.sha256(line["id"].encode()).digest()[:8], "little")
    y, _ = apply_chain(plan["chain"], raw, plan["chain_cfg"], np.random.default_rng(seed))
    h_raw, h_fin = asr.transcribe(raw, SR), asr.transcribe(master(y), SR)
    return asr.word_errors(line["text"], h_raw)[0], asr.word_errors(line["text"], h_fin)[0], h_raw, h_fin


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    lines = {l["id"]: l for l in load_lines()}
    line = lines[sys.argv[1]]
    plan = line_plan(line, load_cast(), {"words": {}, "lines": {}})
    current = line_plan(line, load_cast(), load_pronounce())["text"]
    texts = [line["text"]] + ([current] if current != line["text"] else []) + sys.argv[2:]
    print(f"{line['id']} ({line['speaker']}, {plan['voice']['engine']} {plan['voice'].get('voice', '')}, {plan['chain']})")
    print(f"  subtitle: {line['text']}")
    for text in texts:
        e_raw, e_fin, h_raw, h_fin = trial(line, plan, text)
        print(f"  fed: {text}")
        print(f"      unprocessed {e_raw} errors: {h_raw}")
        print(f"      finished    {e_fin} errors: {h_fin}")


if __name__ == "__main__":
    main()
