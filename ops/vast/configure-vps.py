#!/usr/bin/env python3
"""Privately configure delivery on an already running personal instance."""
import getpass
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root))
import vps_exports


def main():
    value = getpass.getpass("Paste the private VPS setting value (hidden): ").strip()
    if not value:
        print("No value entered. Configuration was not changed.", file=sys.stderr)
        return 1
    os.environ["OPENSHORTS_VPS_CONFIG_B64"] = value
    try:
        vps_exports.configuration()
    except vps_exports.ExportError as error:
        print(str(error), file=sys.stderr)
        return 1
    folder = root / ".cache/vast"
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / "vps-config.b64"
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write(value)
    destination.chmod(0o600)
    print("Private VPS delivery configured. Refresh OpenShorts to show Save to VPS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
