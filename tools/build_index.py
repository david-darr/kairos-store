"""Build the immutable-file digest catalog using the stdlib only."""
import argparse
import json
import os
from pathlib import Path
import sys

from store_schema import archive_sha256, MAX_INDEX_BYTES
from validate import ROOT, item_folders, load_item


def build(root=ROOT, commit=None):
    items = []
    for folder in item_folders(root):
        meta, content = load_item(folder, root)
        items.append({**{k: meta[k] for k in ("kind", "slug", "name", "description", "author", "version", "files")},
                      "path": folder.relative_to(root).as_posix(), "archive_sha256": archive_sha256(content)})
    value = {"schema_version": 1, "generated_from_commit": commit or os.environ.get("GITHUB_SHA") or "local", "items": items}
    if len(items) > 1000 or len(json.dumps(value, indent=2, ensure_ascii=False).encode("utf-8")) + 1 > MAX_INDEX_BYTES:
        raise ValueError("Catalog exceeds 1000 items or 2 MiB")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        value = build(args.root, args.commit)
        (args.root / "index.json").write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        print(f"Built index.json: {len(value['items'])} items")
    except (ValueError, OSError, SyntaxError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
