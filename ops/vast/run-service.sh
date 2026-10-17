#!/usr/bin/env bash
set -Eeuo pipefail
app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$app_dir"
node_bin=$(cat .cache/vast/node-path)
PATH="$app_dir/.venv/bin:$app_dir/bin:$(dirname "$node_bin"):$PATH"
export PATH
export PYTHONUNBUFFERED=1
export HF_HOME=/workspace/.cache/huggingface
LD_LIBRARY_PATH="$(.venv/bin/python -c 'import glob,sysconfig; print(":".join(glob.glob(sysconfig.get_paths()["purelib"] + "/nvidia/*/lib")))')${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LD_LIBRARY_PATH
export BILLING_ENABLED=0
export MAX_CONCURRENT_JOBS=1
export ASR_GPU_CONCURRENCY=1
export ASR_HOST_SLOTS=1
export WHISPER_MODEL=large-v3-turbo
export WHISPER_DEVICE=cuda
export WHISPER_COMPUTE=float16
export TRANSCRIBE_BACKEND=whisper
export FFMPEG_ENCODER=auto
export FFMPEG_THREADS=2
export NVIDIA_DRIVER_CAPABILITIES=compute,video,utility

case ${1:-} in
  check)
    .venv/bin/python - <<'PY'
import torch
import ctranslate2
import cv2
import mediapipe
assert torch.cuda.is_available(), 'PyTorch cannot use CUDA; check the CUDA wheel and host driver.'
matrix = torch.ones((16, 16), device='cuda', dtype=torch.float16)
assert (matrix @ matrix).sum().item() == 4096
assert ctranslate2.get_cuda_device_count() > 0, 'CTranslate2 cannot see CUDA.'
print('CUDA kernel check passed:', torch.cuda.get_device_name())
from faster_whisper import WhisperModel
import numpy as np
print('Downloading/checking Whisper Turbo; this can take a few minutes on first setup.', flush=True)
model = WhisperModel('large-v3-turbo', device='cuda', compute_type='float16')
segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language='en', vad_filter=False)
list(segments)
print('Whisper GPU transcription check passed.')
from ultralytics import YOLO
YOLO('yolov8n.pt')
PY
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=256x256:rate=1 \
      -frames:v 1 -c:v h264_nvenc -f null -
    ;;
  backend)
    exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8000
    ;;
  frontend)
    export VITE_PROXY_TARGET=http://127.0.0.1:8000
    export VITE_RENDER_TARGET=http://127.0.0.1:3100
    cd dashboard
    exec "$node_bin" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5175 --strictPort
    ;;
  renderer)
    export REMOTION_BUNDLE_PATH="$app_dir/remotion"
    export OUTPUT_DIR="$app_dir/output"
    export PORT=3100
    export HOST=127.0.0.1
    cd render-service
    exec "$node_bin" dist/server.js
    ;;
  *) echo 'Usage: run-service.sh {check|backend|frontend|renderer}' >&2; exit 2 ;;
esac
