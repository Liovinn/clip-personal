#!/usr/bin/env bash
# Called by Vast's Jupyter + SSH launch mode, before the image's normal boot.
set -Eeuo pipefail

fail() { echo "OpenShorts template: $*" >&2; exit 1; }

case ${1:-} in
  ''|--check-only) ;;
  *) fail 'Usage: onstart.sh [--check-only]' ;;
esac

[[ ${ENABLE_AUTH:-} == true && ${ENABLE_HTTPS:-} == true ]] ||
  fail 'Set ENABLE_AUTH=true and ENABLE_HTTPS=true.'
[[ -z ${AUTH_EXCLUDE:-} ]] || fail 'Remove AUTH_EXCLUDE so the app stays protected.'
[[ ${OPEN_BUTTON_PORT:-} == 1111 ]] || fail 'Set OPEN_BUTTON_PORT=1111.'

# Some editors preserve pasted outer quotes as literal characters. Remove one
# pair without evaluating the value; never source template values as shell code.
portal=${PORTAL_CONFIG:-}
if [[ $portal == \"*\" ]]; then portal=${portal:1:${#portal}-2}; fi
expected='localhost:1111:11111:/:Instance Portal|localhost:8080:8080:/:Jupyter|localhost:5176:5175:/:OpenShorts'
[[ $portal == "$expected" ]] || fail 'Replace PORTAL_CONFIG with the value in template.env.example.'
export PORTAL_CONFIG=$portal
[[ ${PROVISIONING_SCRIPT:-} == https://raw.githubusercontent.com/Liovinn/clip-personal/main/ops/vast/bootstrap.sh ]] ||
  fail 'Set PROVISIONING_SCRIPT to the published OpenShorts bootstrap.sh URL.'

for port in 22 1111 8080 5176; do
  variable=VAST_TCP_PORT_$port
  mapped=${!variable:-}
  if [[ ! $mapped =~ ^[0-9]+$ || ${#mapped} -gt 5 ]]; then
    fail "Missing/invalid TCP mapping for $port. Request ports 22, 1111, 8080 and 5176."
  fi
  if (( 10#$mapped < 1 || 10#$mapped > 65535 )); then
    fail "Missing/invalid TCP mapping for $port. Request ports 22, 1111, 8080 and 5176."
  fi
done

echo 'OpenShorts template access settings passed.'
[[ ${1:-} == --check-only ]] && exit 0

if [[ ! -f /.launch ]] || ! grep -qi jupyter /.launch; then
  fail 'Select Jupyter-python notebook + SSH launch mode, then start a new instance.'
fi
[[ -x /opt/instance-tools/bin/entrypoint.sh ]] ||
  fail 'Use the documented vastai/base-image image.'

# Vast provides SSH/Jupyter. The original entrypoint starts the portal, Caddy,
# Supervisor and PROVISIONING_SCRIPT. Do not start another SSH/Jupyter daemon.
exec /opt/instance-tools/bin/entrypoint.sh
