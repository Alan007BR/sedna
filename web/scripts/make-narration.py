"""Synthesise the demo video's narration, one clip per line, with a neural text-to-speech voice (edge-tts).

Reads web/scripts/narration.json, writes <out>/<id>.wav (48 kHz mono) and <out>/durations.json, which
record-demo.mjs uses to time each scene to its line. The voice is synthetic, and the video says so on screen.
Only the script's text is sent to the speech service.
  python web/scripts/make-narration.py <ffmpeg> <out dir>
Code written with AI assistance (Claude); see AI_USAGE.md.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import wave
from pathlib import Path

import edge_tts

HERE = Path(__file__).resolve().parent


async def main(ffmpeg: str, out: Path) -> None:
    spec = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
    out.mkdir(parents=True, exist_ok=True)
    durations = {}
    for line in spec["lines"]:
        mp3 = out / f"{line['id']}.mp3"
        wav = out / f"{line['id']}.wav"
        for attempt in range(5):  # the speech service sometimes answers with no audio; asking again works
            try:
                await edge_tts.Communicate(line["say"], spec["voice"], rate=spec.get("rate", "+0%")).save(str(mp3))
                break
            except edge_tts.exceptions.NoAudioReceived:
                if attempt == 4:
                    raise
                await asyncio.sleep(2)
        # trim the silence the service adds at both ends, so the timing is the speech itself
        trim = "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse"
        subprocess.run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(mp3), "-af", trim, "-ar", "48000", "-ac", "1", str(wav)], check=True)
        with wave.open(str(wav)) as w:
            durations[line["id"]] = round(w.getnframes() / w.getframerate(), 3)
        print(f"{line['id']}: {durations[line['id']]:.2f} s")
    (out / "durations.json").write_text(json.dumps(durations, indent=1))
    print(f"total speech {sum(durations.values()):.2f} s")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], Path(sys.argv[2])))
