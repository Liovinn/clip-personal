"""Exercise gateway checks against HTTP responses without a GPU or rental."""
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
from pathlib import Path
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import ProxyHandler, build_opener


spec = importlib.util.spec_from_file_location("check_access", Path(__file__).resolve().parents[1] / "check-access.py")
access = importlib.util.module_from_spec(spec)
spec.loader.exec_module(access)
AUTH = "Basic " + base64.b64encode(b"vastai:fixture-password").decode()


class GatewayHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == "/public":
            status, body = 200, b"{}"
        elif self.headers.get("Authorization") != AUTH:
            status, body = 401, b"authentication required"
        elif self.path == "/broken":
            status, body = 502, b"upstream unavailable"
        elif self.path == "/html":
            status, body = 200, b"<html>Login</html>"
        else:
            status, body = 200, b'{"gemini_configured":false}'
        self.send_response(status)
        self.end_headers()
        self.wfile.write(body)


class GatewayCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), GatewayHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.opener = build_opener(ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def test_requires_authentication_and_accepts_real_app_config(self):
        access.check_endpoint(self.opener, self.base + "/api/config", AUTH, expect_json=True)

    def test_rejects_public_app_even_if_it_responds_successfully(self):
        with self.assertRaisesRegex(ValueError, "unauthenticated"):
            access.check_endpoint(self.opener, self.base + "/public", AUTH, expect_json=True)

    def test_rejects_wrong_credentials_and_failed_upstream(self):
        for path, auth, expected in (("/", "Basic wrong", 401), ("/broken", AUTH, 502)):
            with self.subTest(path=path), self.assertRaises(HTTPError) as caught:
                access.check_endpoint(self.opener, self.base + path, auth)
            self.assertEqual(caught.exception.code, expected)
            caught.exception.close()

    def test_login_html_does_not_count_as_healthy_app(self):
        with self.assertRaises(ValueError):
            access.check_endpoint(self.opener, self.base + "/html", AUTH, expect_json=True)


if __name__ == "__main__":
    unittest.main()
