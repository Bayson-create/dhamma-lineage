#!/usr/bin/env python3
"""Build a light V4 lineage catalog without copying V4 corpus data."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.request import urlopen


EXPECTED = {1: 48, 2: 78, 3: 21, 4: 7}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-url", required=True)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    mapping = json.loads(Path(args.mapping).read_text(encoding="utf-8"))
    with urlopen(args.catalog_url, timeout=30) as response:
        catalog = json.load(response)
    if not isinstance(catalog, list):
        raise SystemExit("V4 catalog is not an array")

    selected = []
    for work in catalog:
        work_id = str(work.get("id") or "")
        layer = mapping.get("work_overrides", {}).get(work_id)
        if layer is None:
            path = work.get("path") or []
            layer = mapping.get("root_rules", {}).get(path[0]) if path else None
        if layer not in EXPECTED:
            continue
        selected.append({
            "work_id": work_id,
            "title": work.get("title", ""),
            "path": work.get("path", []),
            "row_count": int(work.get("row_count") or 0),
            "layer": int(layer),
            "reader_url": f"{mapping['reader_base']}{work_id}",
            "source": "tipitaka_v4",
        })
    counts = {str(layer): sum(item["layer"] == layer for item in selected) for layer in EXPECTED}
    if {int(key): value for key, value in counts.items()} != EXPECTED:
        raise SystemExit(f"unexpected V4 layer counts: {counts}, expected {EXPECTED}")
    payload = {
        "version": mapping.get("version", "v2"),
        "source": args.catalog_url,
        "counts": counts,
        "works": selected,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
