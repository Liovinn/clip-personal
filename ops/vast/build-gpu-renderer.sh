#!/usr/bin/env bash
# Optional native renderer. The ordinary Vast setup never needs Rust.
set -Eeuo pipefail
app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$app_dir"
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'osrender needs Linux x86_64.' >&2; exit 1; }
[[ $EUID == 0 ]] || { echo 'Build the Vast renderer as root.' >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
export CARGO_HOME=${CARGO_HOME:-/workspace/.cache/openshorts/cargo}
export RUSTUP_HOME=${RUSTUP_HOME:-/workspace/.cache/openshorts/rustup}
export PATH="$CARGO_HOME/bin:$PATH"
rust_version=1.90.0
fingerprint=$(find osrender -path osrender/target -prune -o -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
target=${OSRENDER_BIN:-/usr/local/bin/osrender}
stamp=.cache/vast/osrender-installed
if [[ -x $target && -f $stamp && $(cat "$stamp") == "$fingerprint:$rust_version:$target" ]]; then
  exit 0
fi
apt-get update -qq
apt-get install -y --no-install-recommends curl ca-certificates build-essential pkg-config clang libclang-dev \
  libavcodec-dev libavformat-dev libavutil-dev libavfilter-dev libavdevice-dev libswscale-dev libswresample-dev
if ! command -v rustup >/dev/null; then
  installer=$(mktemp)
  curl --fail --silent --show-error --location https://sh.rustup.rs -o "$installer"
  sh "$installer" -y --no-modify-path --profile minimal --default-toolchain "$rust_version"
  rm -f "$installer"
fi
rustup toolchain install "$rust_version" --profile minimal
cargo +"$rust_version" build --manifest-path osrender/Cargo.toml --release --locked
install -D -m 755 osrender/target/release/osrender "$target"
mkdir -p .cache/vast
printf '%s\n' "$fingerprint:$rust_version:$target" > "$stamp"
