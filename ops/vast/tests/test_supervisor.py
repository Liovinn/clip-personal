"""Exercise service startup against a real, isolated Supervisor daemon."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "start-services.sh"
SERVICES = ("openshorts-backend", "openshorts-frontend", "openshorts-renderer")


@unittest.skipUnless(os.name == "posix" and shutil.which("supervisord"),
                     "requires Linux and Supervisor")
class SupervisorRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="os-supervisor-")
        self.root = Path(self.temp.name)
        (self.root / "conf.d").mkdir()
        self.config = self.root / "supervisord.conf"
        self.config.write_text(f"""
[unix_http_server]
file={self.root}/supervisor.sock
[supervisord]
logfile={self.root}/supervisord.log
pidfile={self.root}/supervisord.pid
childlogdir={self.root}
[rpcinterface:supervisor]
supervisor.rpcinterface_factory=supervisor.rpcinterface:make_main_rpcinterface
[supervisorctl]
serverurl=unix://{self.root}/supervisor.sock
[include]
files={self.root}/conf.d/*.conf
[program:unrelated-failed]
command=/bin/false
startsecs=1
startretries=0
""")
        self.started = False

    def ctl(self, *args):
        return subprocess.run(["supervisorctl", "-c", str(self.config), *args],
                              text=True, capture_output=True, timeout=15)

    def tearDown(self):
        if self.started:
            self.ctl("shutdown")
            for _ in range(100):
                if not (self.root / "supervisor.sock").exists():
                    break
                time.sleep(0.05)
        self.temp.cleanup()

    def run_startup(self):
        return subprocess.run(["bash", str(SCRIPT)], text=True,
                              capture_output=True, timeout=30,
                              env={**os.environ, "SUPERVISOR_CONFIG": str(self.config)})

    def test_reuses_daemon_when_unrelated_program_is_fatal(self):
        subprocess.run(["supervisord", "-c", str(self.config)], check=True, timeout=15)
        self.started = True
        for _ in range(100):
            if "FATAL" in self.ctl("status", "unrelated-failed").stdout:
                break
            time.sleep(0.05)
        self.assertIn("FATAL", self.ctl("status", "unrelated-failed").stdout)
        self.assertNotEqual(self.ctl("status").returncode, 0)
        daemon_pid = self.ctl("pid").stdout.strip()
        self.assertTrue(daemon_pid.isdigit())

        for service in SERVICES:
            (self.root / "conf.d" / f"{service}.conf").write_text(f"""
[program:{service}]
command=/bin/sleep 60
autostart=false
startsecs=0
""")
        # Both initial recovery and subsequent retries must reuse the daemon.
        for _ in range(2):
            result = self.run_startup()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(self.ctl("pid").stdout.strip(), daemon_pid)
            for service in SERVICES:
                self.assertIn("RUNNING", self.ctl("status", service).stdout)
            self.assertIn("FATAL", self.ctl("status", "unrelated-failed").stdout)

    def test_unreachable_daemon_reports_error_without_starting_another(self):
        result = self.run_startup()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Cannot reach Vast's existing Supervisor", result.stderr)
        self.assertFalse((self.root / "supervisord.pid").exists())


if __name__ == "__main__":
    unittest.main()
