#!/usr/bin/env bash
# Provision a Vast CUDA instance and supervise the three OpenShorts services.
set -Eeuo pipefail
trap 'echo "OpenShorts setup failed at line $LINENO. Fix the error above and run this script again." >&2' ERR

[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Use a Linux x86_64 Vast instance.' >&2; exit 1; }
[[ $EUID == 0 ]] || { echo 'Run this script as root (sudo bash ...).' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
export PIP_NO_CACHE_DIR=1
export HF_HOME=/workspace/.cache/huggingface
app_dir=/workspace/clip-personal
mkdir -p /workspace/.cache/openshorts
exec 9>/workspace/.cache/openshorts/setup.lock
flock -n 9 || { echo 'OpenShorts setup is already running.'; exit 0; }

apt-get update -qq
apt-get install -y --no-install-recommends git curl ca-certificates ffmpeg fontconfig \
  fonts-liberation fonts-noto-core fonts-noto-color-emoji libgl1 libglib2.0-0 \
  libnss3 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
  libgbm1 libasound2t64 supervisor

# The documented Vast base image includes Node LTS. Load NVM for non-login boots.
if ! command -v node >/dev/null; then
  for nvm_file in "${NVM_DIR:-/opt/nvm}/nvm.sh" /usr/local/nvm/nvm.sh /root/.nvm/nvm.sh; do
    if [[ -f $nvm_file ]]; then
      # shellcheck source=/dev/null
      source "$nvm_file"
      break
    fi
  done
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Node.js is missing. Use the documented Vast base image.' >&2
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node 22+ required; select the documented Vast base image."); process.exit(1); }'
node_bin=$(command -v node)
# yt-dlp's default JavaScript challenge runtime is Deno, not Node.
if ! command -v deno >/dev/null; then
  npm install --global --no-audit --no-fund deno
fi
deno --version
python_bin=/venv/main/bin/python
[[ -x $python_bin ]] || { echo 'Expected /venv/main/bin/python. Use the documented Vast base image.' >&2; exit 1; }
"$python_bin" -c 'import sys; assert (3, 11) <= sys.version_info[:2] <= (3, 12), "Python 3.11 or 3.12 required"'
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader

if [[ ! -d $app_dir ]]; then
  git clone --depth 1 https://github.com/Liovinn/clip-personal.git "$app_dir"
else
  [[ -d $app_dir/.git ]] || { echo "$app_dir exists but is not a Git checkout." >&2; exit 1; }
  [[ -z $(git -C "$app_dir" status --porcelain) ]] || { echo 'Local source changes found; commit or save them before updating.' >&2; exit 1; }
  git -C "$app_dir" pull --ff-only
fi
cd "$app_dir"
mkdir -p .cache/vast output uploads
printf '%s\n' "$node_bin" > .cache/vast/node-path

# Reuse completed installs on restart; changes to the setup inputs re-provision.
fingerprint=$(sha256sum requirements.txt ops/vast/constraints.txt dashboard/package-lock.json \
  render-service/package-lock.json remotion/package-lock.json ops/vast/bootstrap.sh | sha256sum | cut -d' ' -f1)
if [[ ! -f .cache/vast/installed || $(cat .cache/vast/installed) != "$fingerprint" || ! -x .venv/bin/python ]]; then
  "$python_bin" -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  # Explicit CUDA wheels support Blackwell (including the RTX 5060 Ti).
  .venv/bin/python -m pip install torch==2.11.0 torchvision==0.26.0 \
    --index-url https://download.pytorch.org/whl/cu128
  .venv/bin/python -m pip install -c ops/vast/constraints.txt -r requirements.txt 'yt-dlp[default]'
  .venv/bin/python -m pip check
  for project in dashboard render-service remotion; do
    (cd "$project" && npm ci --no-audit --no-fund)
  done
  (cd render-service && npm run build && node --input-type=module -e \
    'import {ensureBrowser} from "@remotion/renderer"; await ensureBrowser();')
  install -d /usr/local/share/fonts/openshorts
  install -m 644 fonts/*.ttf /usr/local/share/fonts/openshorts/
  install -m 644 fonts/openshorts-fontmap.conf /etc/fonts/conf.d/60-openshorts.conf
  fc-cache -f
  chmod +x bin/ffmpeg ops/vast/run-service.sh
  printf '%s\n' "$fingerprint" > .cache/vast/installed
fi

# Exercise CUDA kernels and NVENC, rather than only detecting a GPU by name.
bash ops/vast/run-service.sh check

for service in backend frontend renderer; do
  cat > "/etc/supervisor/conf.d/openshorts-$service.conf" <<EOF
[program:openshorts-$service]
directory=$app_dir
command=/bin/bash $app_dir/ops/vast/run-service.sh $service
autostart=true
autorestart=true
startsecs=5
stopwaitsecs=30
stopasgroup=true
killasgroup=true
stdout_logfile=$app_dir/.cache/vast/$service.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=2
redirect_stderr=true
EOF
done
if ! supervisorctl status >/dev/null 2>&1; then
  supervisord -c /etc/supervisor/supervisord.conf 9>&-
fi
supervisorctl reread
supervisorctl update
supervisorctl restart 'openshorts-*'

for port_path in '8000/health/ready' '3100/health' '5175/api/config'; do
  ready=0
  for _attempt in $(seq 1 120); do
    if curl --fail --silent "http://127.0.0.1:$port_path" >/dev/null; then ready=1; break; fi
    sleep 2
  done
  [[ $ready == 1 ]] || { echo "Service $port_path failed; check .cache/vast/*.log" >&2; exit 1; }
done
echo 'OpenShorts is ready. Forward SSH port 5175, then open http://localhost:15175/#app.'
echo 'Add your Gemini key in Settings. Download finished clips before destroying this instance.'
