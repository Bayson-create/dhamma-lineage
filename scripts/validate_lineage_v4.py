#!/usr/bin/env python3
"""Validate the generated CBETA lineage-v4 artifacts."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", required=True)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--audit", required=True)
    parser.add_argument("--search-index", default=None)
    parser.add_argument("--expected-records", type=int, default=5005)
    args = parser.parse_args()

    index = read(Path(args.index))
    mapping = read(Path(args.mapping))
    audit = read(Path(args.audit))
    if len(index) != args.expected_records:
        raise SystemExit(f"expected {args.expected_records} records, got {len(index)}")
    if mapping.get("version") != "lineage-v4":
        raise SystemExit(f"unexpected mapping version: {mapping.get('version')}")
    if audit.get("mapping_version") != "lineage-v4" or audit.get("record_count") != len(index):
        raise SystemExit("audit manifest does not match lineage-v4 index")

    ids = [str(row.get("id")) for row in index]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate CBETA ids in index")
    if any(row.get("lineage_mapping_version") != "lineage-v4" for row in index):
        raise SystemExit("index contains a record without lineage-v4 metadata")
    if any(not row.get("review_status") for row in index):
        raise SystemExit("index contains a record without review_status")

    layer_counts = Counter(str(row.get("layer")) for row in index)
    if layer_counts.get("None") != 1102:
        raise SystemExit(f"unexpected unmapped count: {layer_counts.get('None')}")
    for doc_id in ("T28n1548", "T24n1482", "T28n1557"):
        row = next((item for item in index if item.get("id") == doc_id), None)
        if not row or row.get("layer") != 3:
            raise SystemExit(f"{doc_id} is not preserved in layer 3")

    if args.search_index:
        search_dir = Path(args.search_index)
        manifest = read(search_dir / "manifest.json")
        doc_ids = read(search_dir / "doc_ids.json")
        if len(doc_ids) != len(index):
            raise SystemExit("search doc_ids count does not match metadata index")
        if int(manifest.get("buckets", 0)) <= 0:
            raise SystemExit("search index has no buckets")

    print(json.dumps({
        "format": "cbeta-lineage-v4-validation",
        "records": len(index),
        "layer_counts": dict(sorted(layer_counts.items())),
        "review_status_counts": dict(sorted(Counter(row["review_status"] for row in index).items())),
        "search_index_checked": bool(args.search_index),
        "ok": True,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
