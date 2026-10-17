#!/usr/bin/env python3
"""Build/verify a code-only, read-only TEST API delta from two pinned images.

Both image workspaces are extracted by disposable CI containers. The bundle
contains only changed compiled files. It never contains dependencies, Prisma
schema/migrations, credentials, or a writable startup patch.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys


COMPILED_ROOTS = (
    "apps/api/dist",
    "packages/config/dist",
    "packages/contracts/dist",
    "packages/database/dist",
    "packages/observability/dist",
    "packages/site-audit/dist",
)
ALLOWED_SUFFIXES = (".js", ".js.map", ".mjs", ".cjs", ".d.ts", ".d.ts.map", ".json")
FORMAT = "holymedia-test-api-file-bind-v1"


def sha256(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def files(root):
    result = {}
    for prefix in COMPILED_ROOTS:
        folder = root / prefix
        if not folder.is_dir() or folder.is_symlink():
            raise ValueError("compiled_root_missing_or_symlink: " + prefix)
        for path in folder.rglob("*"):
            if path.is_symlink():
                raise ValueError("compiled_symlink: " + str(path))
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            if not relative.endswith(ALLOWED_SUFFIXES):
                raise ValueError("unexpected_compiled_suffix: " + relative)
            result[relative] = path
    return result


def build(old_root, new_root, output, old_image, new_image, source_sha):
    if output.exists():
        raise ValueError("output_already_exists")
    old, new = files(old_root), files(new_root)
    removed = sorted(set(old) - set(new))
    if removed:
        raise ValueError("compiled_deletions_require_different_delivery: " + ",".join(removed[:5]))
    output.mkdir(parents=True, mode=0o700)
    entries = []
    for relative in sorted(new):
        candidate_hash = sha256(new[relative])
        old_hash = sha256(old[relative]) if relative in old else None
        if old_hash == candidate_hash:
            continue
        destination = output / "files" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(new[relative], destination)
        destination.chmod(0o444)
        entries.append({"path": relative, "sha256": candidate_hash,
                        "old_sha256": old_hash, "bytes": destination.stat().st_size})
    if not entries:
        raise ValueError("no_compiled_changes")
    manifest = {"format": FORMAT, "old_image": old_image,
                "candidate_image": new_image, "source_sha": source_sha,
                "compiled_roots": COMPILED_ROOTS, "files": entries}
    (output / "manifest.json").write_text(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8")
    (output / "manifest.json").chmod(0o444)
    print(json.dumps({"files": len(entries), "bytes": sum(e["bytes"] for e in entries),
                      "manifest_sha256": sha256(output / "manifest.json")}, sort_keys=True))


def verify(bundle):
    manifest_path = bundle / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != FORMAT or tuple(manifest.get("compiled_roots", [])) != COMPILED_ROOTS:
        raise ValueError("bundle_format_or_roots_mismatch")
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise ValueError("empty_or_invalid_manifest")
    names = []
    for entry in entries:
        relative = entry["path"]
        if not any(relative.startswith(prefix + "/") for prefix in COMPILED_ROOTS) or not relative.endswith(ALLOWED_SUFFIXES):
            raise ValueError("bundle_path_outside_compiled_roots")
        path = bundle / "files" / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size != entry["bytes"] or sha256(path) != entry["sha256"]:
            raise ValueError("bundle_file_drift: " + relative)
        names.append(relative)
    if names != sorted(set(names)):
        raise ValueError("manifest_paths_not_sorted_unique")
    actual = {path.relative_to(bundle / "files").as_posix()
              for path in (bundle / "files").rglob("*") if path.is_file()}
    if actual != set(names):
        raise ValueError("unmanifested_bundle_file")
    return manifest


def compose(bundle, output, service):
    manifest = verify(bundle)
    if service not in ("api", "qrs_api") or not bundle.is_absolute():
        raise ValueError("service_or_bundle_path_invalid")
    mounts = []
    for entry in manifest["files"]:
        path = entry["path"]
        mounts.append({"type": "bind", "source": str(bundle / "files" / path),
                       "target": "/workspace/" + path, "read_only": True,
                       "bind": {"create_host_path": False}})
    output.write_text(json.dumps({"services": {service: {"volumes": mounts}}},
                                 sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"mounts": len(mounts), "output": str(output)}))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    build_parser = sub.add_parser("build")
    for name in ("old_root", "new_root", "output", "old_image", "new_image", "source_sha"):
        build_parser.add_argument(name)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("bundle", type=Path)
    compose_parser = sub.add_parser("compose")
    compose_parser.add_argument("bundle", type=Path)
    compose_parser.add_argument("output", type=Path)
    compose_parser.add_argument("--service", required=True)
    args = parser.parse_args()
    if args.action == "build":
        build(Path(args.old_root), Path(args.new_root), Path(args.output),
              args.old_image, args.new_image, args.source_sha)
    elif args.action == "verify":
        manifest = verify(args.bundle)
        print(json.dumps({"files": len(manifest["files"]), "status": "verified"}))
    else:
        compose(args.bundle, args.output, args.service)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "FAIL", "reason": str(error)}), file=sys.stderr)
        sys.exit(1)
