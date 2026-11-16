"""Voice line generator for Monster Battle 9001: offline speech synthesis, radio, broadcast and
hall processing, loudness mastering, encoding and speech-recognition checks. Since round 4 the
script is the monster's molt line (shared/src/defs/voiceLines.json) and the communication rose's
army lines (client/src/audio/roseLines.json), each spoken in every squad's voice."""

from pathlib import Path
import os

SR = 44100
VOICE_DIR = Path(__file__).resolve().parent.parent          # tools/audio/voice
REPO = VOICE_DIR.parents[2]
SCRIPT_JSON = REPO / "shared" / "src" / "defs" / "voiceLines.json"
# the communication rose's army lines: per wedge, the sentences every squad voice shouts
# (client/src/audio/roseLines.json; the wedges' order is shared/src/net/rose.ts, ROSE_ARMY)
ROSE_JSON = REPO / "client" / "src" / "audio" / "roseLines.json"
ROSE_TS = REPO / "shared" / "src" / "net" / "rose.ts"
OUT_DIR = REPO / "client" / "public" / "assets" / "audio" / "voice"
MANIFEST = REPO / "client" / "public" / "assets" / "manifest.voice.json"
DOC = REPO / "docs" / "audio" / "VOICE.md"
DOC_DIR = REPO / "docs" / "audio" / "voice"
SCRATCH = Path(os.environ.get("MB_SCRATCH", "/tmp/mb-scratch/voice"))
