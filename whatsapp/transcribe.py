#!/usr/bin/env python3
"""Transcribe audio file using Whisper"""
import sys
import whisper

if len(sys.argv) < 2:
    print("Usage: python transcribe.py <audio_file>")
    sys.exit(1)

audio_path = sys.argv[1]
model_name = sys.argv[2] if len(sys.argv) > 2 else "base"

# Load model (cached after first load)
model = whisper.load_model(model_name)

# Transcribe
result = model.transcribe(audio_path, language="en")

# Output just the text
print(result["text"].strip())
