"""Offline procfs attribution regressions; never touches Docker."""

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import production_web_swap_probe as probe  # noqa: E402


class ProbeTests(unittest.TestCase):
    def test_process_identity_and_cgroup_counters(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            proc = root / "proc"
            group = root / "cgroup"
            (proc / "42").mkdir(parents=True)
            (proc / "pressure").mkdir()
            (group / "system.slice" / "web.scope").mkdir(parents=True)
            # Fields after comm begin with state. majflt is field 12, starttime 22.
            tail = ["S"] + ["0"] * 40
            tail[9], tail[19] = "17", "9001"
            (proc / "42" / "stat").write_text("42 (web process) " + " ".join(tail))
            (proc / "42" / "status").write_text("Name:\tweb\nVmSwap:\t64 kB\n")
            (proc / "42" / "cgroup").write_text("0::/system.slice/web.scope\n")
            (proc / "vmstat").write_text("pswpin 70\npswpout 0\npgmajfault 21\noom_kill 0\n")
            (proc / "meminfo").write_text("MemAvailable: 1000000 kB\nSwapFree: 400000 kB\n")
            (proc / "pressure" / "memory").write_text(
                "some avg10=0.00 avg60=0.00 total=0\nfull avg10=0.00 avg60=0.00 total=0\n")
            (group / "system.slice" / "web.scope" / "memory.stat").write_text(
                "pgmajfault 3\nworkingset_refault_anon 4\npgscan 5\npgsteal 6\n")
            (group / "system.slice" / "web.scope" / "memory.swap.current").write_text("4096\n")
            selection = {"pids": {"42": 9001}, "cgroups": ["/system.slice/web.scope"]}
            with patch.object(probe, "PROC", proc), patch.object(probe, "CGROUP", group):
                snap = probe.capture(selection, "before-stop")
                self.assertEqual(snap["host"]["vm"]["pswpin"], 70)
                self.assertEqual(snap["pids"]["42"]["major_faults"], 17)
                self.assertEqual(snap["pids"]["42"]["vm_swap_kib"], 64)
                self.assertEqual(snap["cgroups"]["/system.slice/web.scope"]["swap_bytes"], 4096)
                reused = tail.copy()
                reused[19] = "9002"
                (proc / "42" / "stat").write_text("42 (web process) " + " ".join(reused))
                self.assertEqual(probe.capture(selection, "stopping-old")["pids"]["42"],
                                 {"gone": True})
                (proc / "42" / "stat").unlink()
                (group / "system.slice" / "web.scope" / "memory.stat").unlink()
                gone = probe.capture(selection, "old-stopped")
                self.assertEqual(gone["pids"]["42"], {"gone": True})
                self.assertEqual(gone["cgroups"]["/system.slice/web.scope"], {"gone": True})

    def test_invalid_or_incomplete_snapshot_fails(self):
        with self.assertRaisesRegex(ValueError, "invalid_probe_selection"):
            probe.capture({}, "before-stop")
        with self.assertRaisesRegex(ValueError, "invalid_probe_count"):
            probe.benchmark({"pids": {}}, 4)


if __name__ == "__main__":
    unittest.main()
