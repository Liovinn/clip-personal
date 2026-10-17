"""Measure an existing ZIP route without downloading the whole archive."""
import argparse
import base64
import getpass
import json
import time
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Prepared ZIP URL (keep signed parameters private)")
    parser.add_argument("--username", help="HTTPS gateway Basic Auth user; password is prompted")
    parser.add_argument("--bytes", type=int, default=8 * 1024 * 1024)
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.url)
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
        parser.error("Use an HTTP(S) URL without embedded credentials")
    if not 1024 <= args.bytes <= 64 * 1024 * 1024:
        parser.error("Sample size must be between 1 KiB and 64 MiB")
    headers = {"Range": f"bytes=0-{args.bytes - 1}", "Accept-Encoding": "identity"}
    if args.username:
        if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
            parser.error("Use HTTPS before sending a password to a remote host")
        credentials = f"{args.username}:{getpass.getpass('Instance password: ')}"
        headers["Authorization"] = "Basic " + base64.b64encode(credentials.encode()).decode()
    started = time.monotonic()
    try:
        with urllib.request.urlopen(urllib.request.Request(args.url, headers=headers), timeout=60) as response:
            if response.status != 206:
                raise ValueError("The URL did not return a partial ZIP download (HTTP 206)")
            total = 0
            while total < args.bytes:
                chunk = response.read(min(64 * 1024, args.bytes - total))
                if not chunk:
                    break
                total += len(chunk)
            seconds = time.monotonic() - started
            print(json.dumps({"bytes": total, "seconds": round(seconds, 2),
                              "MB_per_second": round(total / max(seconds, 0.001) / 1_000_000, 3),
                              "range_supported": True}))
    except (urllib.error.URLError, ValueError) as error:
        # Never print a signed URL, password, or provider response body.
        raise SystemExit(f"Transfer check failed ({type(error).__name__}). Check TLS trust, authentication, URL, and instance status.") from None


if __name__ == "__main__":
    main()
