"""Create a deterministic, minimal HolyPilot plugin ZIP from the reviewed folder."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent / "holypilot"
EXPECTED = {
    ".claude-plugin/plugin.json",
    "README.md",
    "LICENSE",
    "assets/holy-pilot-symbol.svg",
    "skills/campaign-analysis/SKILL.md",
    "skills/report-preparation/SKILL.md",
    "skills/optimization-opportunities/SKILL.md",
    "skills/safe-change-preview/SKILL.md",
    "skills/change-verification/SKILL.md",
}


def build(destination: Path) -> str:
    actual = {file.relative_to(ROOT).as_posix() for file in ROOT.rglob("*") if file.is_file()}
    if actual != EXPECTED:
        raise ValueError(f"publishable file set mismatch: extra={sorted(actual - EXPECTED)}, missing={sorted(EXPECTED - actual)}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in sorted(EXPECTED):
            data = (ROOT / relative).read_bytes()
            # A fixed timestamp makes the ZIP hash reproducible in Linux CI.
            from zipfile import ZipInfo

            entry = ZipInfo(relative, date_time=(2026, 10, 20, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, data, compress_type=ZIP_DEFLATED, compresslevel=9)
    with ZipFile(destination) as archive:
        if set(archive.namelist()) != EXPECTED or archive.testzip() is not None:
            raise ValueError("ZIP verification failed")
    return hashlib.sha256(destination.read_bytes()).hexdigest()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python claude-plugin/package.py DESTINATION.zip")
    output = Path(sys.argv[1]).resolve()
    print(f"{output} sha256={build(output)}")
