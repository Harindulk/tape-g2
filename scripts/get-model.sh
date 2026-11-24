#!/bin/sh
# Downloads the whisper.cpp base.en model (~142 MB) used for local speech-to-text.
set -e
mkdir -p server/models
curl -L --fail -o server/models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
