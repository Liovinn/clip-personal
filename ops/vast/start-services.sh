#!/usr/bin/env bash
set -Eeuo pipefail
supervisor_config=${SUPERVISOR_CONFIG:-/etc/supervisor/supervisord.conf}
ctl=(supervisorctl -c "$supervisor_config")

# `status` exits nonzero for failed/stopped base-image programs, even while
# Supervisor itself is healthy. Query the daemon directly; never start a
# competing daemon or restart Vast's Jupyter/SSH infrastructure here.
if ! daemon_pid=$("${ctl[@]}" pid) || [[ ! $daemon_pid =~ ^[1-9][0-9]*$ ]]; then
  echo "Cannot reach Vast's existing Supervisor using $supervisor_config. Check the instance logs." >&2
  exit 1
fi

services=(openshorts-backend openshorts-frontend openshorts-renderer)
"${ctl[@]}" reread
"${ctl[@]}" update "${services[@]}"
"${ctl[@]}" restart "${services[@]}"
