"""Check the local HTTPS/auth gateway before announcing app readiness.

The generated certificate is self-signed. The relaxed TLS check below applies
only to fixed loopback URLs, never to a browser or an external request.
"""
import base64
import json
import os
import ssl
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener


def check_endpoint(opener, url, authorization, *, expect_json=False):
    try:
        with opener.open(url, timeout=3):
            raise ValueError("gateway allowed an unauthenticated request")
    except HTTPError as exc:
        status = exc.code
        exc.close()
        if status != 401:
            raise ValueError(f"expected an authentication challenge, got HTTP {status}") from None
    with opener.open(Request(url, headers={"Authorization": authorization}), timeout=3) as response:
        if response.status != 200:
            raise ValueError(f"authenticated request returned HTTP {response.status}")
        if expect_json and not isinstance(json.loads(response.read(65536)), dict):
            raise ValueError("app configuration response is not a JSON object")


def main():
    password = os.environ.get("WEB_PASSWORD") or os.environ.get("OPEN_BUTTON_TOKEN")
    if not password:
        print("Gateway check failed: missing Vast access token. Check the instance logs.", file=sys.stderr)
        return 1
    username = os.environ.get("WEB_USERNAME") or "vastai"
    authorization = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()
    opener = build_opener(ProxyHandler({}), HTTPSHandler(context=ssl._create_unverified_context()))
    for attempt in range(5):
        try:
            check_endpoint(opener, "https://127.0.0.1:1111/", authorization)
            check_endpoint(opener, "https://127.0.0.1:5176/api/config", authorization, expect_json=True)
            print("Portal and OpenShorts HTTPS/authentication checks passed (inside the instance).")
            return 0
        except (OSError, URLError, ValueError):
            if attempt < 4:
                time.sleep(2)
    # Never print provider responses, headers or credentials.
    print("Gateway check failed: inspect supervisorctl status and Caddy/portal logs. "
          "OpenShorts may be running internally, but browser access is not ready. "
          "Use Jupyter Terminal or SSH to investigate.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
