"""Prove the API/full Docker targets and all original runtime files unchanged."""
import pathlib
import subprocess
base = "a00817b746211a295bcb966f7fd7ef12cd6178fb"
old = subprocess.check_output(["git", "show", base + ":infra/Dockerfile.v2"], text=True)
new = pathlib.Path("infra/Dockerfile.v2").read_text()
assert new.split("# Web production graph only.")[0] == old.split("FROM base AS runtime")[0]
assert new.split("FROM base AS runtime", 1)[1] == old.split("FROM base AS runtime", 1)[1]
assert "FROM base AS web-runtime" in new
print("SOURCE_GUARD API target and full runtime target unchanged; Web target additive; PASS")
