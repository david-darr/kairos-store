"""Validate reviewed store items using only Python's standard library."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

import skills_guard
import store_schema
import tab_checks

ROOT = Path(__file__).resolve().parents[1]


def no_links(path):
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise ValueError(f"Links are forbidden: {path}")


def load_item(folder, root=ROOT):
    root, folder = Path(root).absolute(), Path(folder).absolute()
    if not folder.is_relative_to(root):
        raise ValueError("Item escaped repository")
    parts = folder.relative_to(root).parts
    if len(parts) != 3 or parts[0] != "items" or parts[1] not in store_schema.KINDS:
        raise ValueError("Expected items/<kind>/<slug>")
    for p in (root, root / "items", folder.parent, folder):
        no_links(p)
    content = {}
    total = entries = 0
    for base, dirs, names in os.walk(folder, followlinks=False):
        for name in dirs + names:
            entries += 1
            if entries > 1000:
                raise ValueError("Too many item entries")
            p = Path(base) / name
            no_links(p)
            store_schema.safe_path(p.relative_to(folder).as_posix())
        for name in names:
            p = Path(base) / name
            if not p.is_file():
                raise ValueError("Special files forbidden")
            # Bound reads before allocating attacker-controlled content.
            relative = p.relative_to(folder).as_posix()
            size = p.stat().st_size
            cap = 16_384 if relative == "manifest.json" else (100_000 if relative == "SKILL.md" else store_schema.LIMITS[parts[1]][2])
            total += size
            if size > cap or total > store_schema.LIMITS[parts[1]][1] + 16_384:
                raise ValueError(f"File exceeds size limit: {p}")
            content[relative] = p.read_bytes()
        if len(content) > store_schema.LIMITS[parts[1]][0] + 1:
            raise ValueError("Too many files")
    meta = store_schema.manifest(json.loads(content.get("manifest.json", b"{}")), parts[1], parts[2])
    store_schema.validate_bytes(meta, content)
    if meta["kind"] in ("skill", "tab"):
        # Ignore files cannot hide submitted content from review.
        findings = []
        for name in meta["files"]:
            findings.extend(skills_guard.scan_file(folder / name, name, force_text=True))
            if meta["kind"] == "tab" and name.endswith(".py"):
                tab_checks.check_python(content[name].decode("utf-8-sig"), name)
        result = skills_guard.scan_skill(folder, source="community")
        result.findings.extend(findings)
        result.verdict = skills_guard._determine_verdict(result.findings)
        if result.verdict == "dangerous":
            raise ValueError(skills_guard.format_scan_report(result))
        if result.verdict == "caution":
            print(f"REVIEW {folder}:\n{skills_guard.format_scan_report(result)}")
    return meta, content


def item_folders(root=ROOT):
    base = Path(root) / "items"
    no_links(base)
    if not base.exists():
        return []
    found = []
    for kind in sorted(base.iterdir()):
        no_links(kind)
        if not kind.is_dir() or kind.name not in store_schema.KINDS:
            raise ValueError(f"Wrong kind: {kind.name}")
        for slug in sorted(kind.iterdir()):
            no_links(slug)
            if not slug.is_dir():
                raise ValueError(f"Expected item folder: {slug}")
            found.append(slug)
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--changed-from", help="Validate folders touched since this git commit")
    parser.add_argument("paths", nargs="*")
    args = parser.parse_args()
    try:
        # Check the entire tree's layout even when only payloads changed.
        folders = item_folders()
        if args.changed_from:
            paths = subprocess.check_output(["git", "diff", "--name-only", "-z", args.changed_from, "HEAD", "--", "items"], cwd=ROOT).decode().split("\0")
            changed = {"/".join(p.split("/")[:3]) for p in paths if p}
            folders = [f for f in folders if f.relative_to(ROOT).as_posix() in changed]
        elif args.paths:
            folders = [ROOT / store_schema.safe_path(p) for p in args.paths]
        for folder in folders:
            load_item(folder)
            print(f"OK {folder.relative_to(ROOT).as_posix()}")
        revoked_path = ROOT / "revoked.json"
        no_links(revoked_path)
        if revoked_path.stat().st_size > store_schema.MAX_INDEX_BYTES:
            raise ValueError("revoked.json exceeds 2 MiB")
        store_schema.revocations(json.loads(revoked_path.read_text(encoding="utf-8")))
    except (ValueError, OSError, SyntaxError, KeyError, TypeError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
