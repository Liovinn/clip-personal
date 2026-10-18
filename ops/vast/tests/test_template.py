"""Check the copy/paste template and reject unsafe or unreachable access setups."""
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
BASH = os.environ.get("OPENSHORTS_TEST_BASH") or shutil.which("bash")


def template_environment():
    tokens = shlex.split((ROOT / "template-docker-options.txt").read_text())
    env = {}
    ports = []
    for flag, value in zip(tokens[::2], tokens[1::2]):
        if flag == "-e":
            key, value = value.split("=", 1)
            env[key] = value
        elif flag == "-p":
            ports.append(value)
        else:
            raise AssertionError(f"Unexpected Docker option {flag}")
    return env, ports


@unittest.skipUnless(BASH, "requires Bash (Git Bash works on Windows)")
class TemplateAccessTests(unittest.TestCase):
    def setUp(self):
        self.env, self.ports = template_environment()
        # Simulate Vast assigning arbitrary public ports, not 1:1 mappings.
        for port, mapped in zip((22, 1111, 8080, 5176), (22001, 22002, 22003, 22004)):
            self.env[f"VAST_TCP_PORT_{port}"] = str(mapped)

    def check(self, **changes):
        env = {**os.environ, "AUTH_EXCLUDE": "", **self.env, **changes}
        result = subprocess.run([BASH, "ops/vast/onstart.sh", "--check-only"],
                                cwd=ROOT.parents[1], env=env, text=True,
                                capture_output=True, timeout=10)
        return result

    def test_copyable_options_are_valid_and_only_open_access_ports(self):
        self.assertEqual(self.ports, ["22:22", "1111:1111", "8080:8080", "5176:5176"])
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_env_example_and_docker_options_agree(self):
        for line in (ROOT / "template.env.example").read_text().splitlines():
            if line and not line.startswith("#"):
                key, value = line.split("=", 1)
                self.assertEqual(self.env[key], shlex.split(value)[0])

    def test_portal_keeps_the_name_required_by_base_image_service_guard(self):
        # instance_portal.sh and tunnel_manager.sh call exit_portal.sh with
        # "instance portal"; renaming that entry silently skips both services.
        self.assertIn("1111:11111:/:Instance Portal", self.env["PORTAL_CONFIG"])
        result = self.check(PORTAL_CONFIG=self.env["PORTAL_CONFIG"].replace(
            "Instance Portal", "Portal"))
        self.assertNotEqual(result.returncode, 0)

    def test_editor_literal_quotes_are_accepted(self):
        result = self.check(PORTAL_CONFIG='"' + self.env["PORTAL_CONFIG"] + '"')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_ports_and_bad_public_mappings_fail_before_boot(self):
        for port in (22, 1111, 8080, 5176):
            for value in ("", "0", "65536", "not-a-port"):
                with self.subTest(port=port, value=value):
                    result = self.check(**{f"VAST_TCP_PORT_{port}": value})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(f"TCP mapping for {port}", result.stderr)

    def test_unprotected_app_or_wrong_open_button_is_rejected(self):
        for changes in ({"ENABLE_AUTH": "false"}, {"ENABLE_HTTPS": "false"},
                        {"AUTH_EXCLUDE": "5176"}, {"OPEN_BUTTON_PORT": "8080"},
                        {"PROVISIONING_SCRIPT": ""}):
            with self.subTest(changes=changes):
                self.assertNotEqual(self.check(**changes).returncode, 0)

    def test_old_jupyter_proxy_and_shell_payload_are_rejected(self):
        for value in (self.env["PORTAL_CONFIG"].replace("8080:8080", "8080:18080"),
                      '$(echo unsafe)', self.env["PORTAL_CONFIG"] + '|invalid'):
            with self.subTest(value=value):
                self.assertNotEqual(self.check(PORTAL_CONFIG=value).returncode, 0)


if __name__ == "__main__":
    unittest.main()
