#!/usr/bin/env python3
"""Speaker similarity of a clip's voice to Henrick's real recordings (resemblyzer cosine).
usage: voice-score.py <audio-or-video>   -> prints "voice 0.83". Two real lines of his score about 0.71.
"""
import os, subprocess, sys, tempfile
import numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ref = os.path.join(root, "public/audio/voice/henrick-reference.mp3")
def wav(p):
    out = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", p, "-vn", "-ar", "16000", "-ac", "1", out], check=True)
    return out
enc = VoiceEncoder(verbose=False)
r = enc.embed_utterance(preprocess_wav(wav(ref)))
e = enc.embed_utterance(preprocess_wav(wav(sys.argv[1])))
print("voice %.2f" % float(np.dot(e, r) / (np.linalg.norm(e) * np.linalg.norm(r))))
