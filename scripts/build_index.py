#!/usr/bin/env python3
"""
Extract per-text metadata from the CBETA XML-P5 corpus into a single
flat JSON index, and assign each text a "lineage layer" (1-8) using
the rules in data/layer_mapping.json.

Usage:
    python3 scripts/build_index.py [CORPUS_ROOT] [-o OUTPUT_JSON]

CORPUS_ROOT defaults to the repo root (this script's parent directory).
This does NOT copy or rewrite the XML files - it only reads headers.
"""
import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"tei": "http://www.tei-c.org/ns/1.0"}

CANON_DIR_RE = re.compile(r"^[A-Z]{1,2}$")


def text_of(el):
    return "".join(el.itertext()).strip() if el is not None else ""


def parse_header(xml_path: Path):
    """Pull title / author / canon / vol / no out of a CBETA TEI header
    without parsing the (often huge) body. Stops once </teiHeader> is hit."""
    chunk_size = 1 << 16
    buf = []
    with xml_path.open("r", encoding="utf-8", errors="ignore") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            buf.append(chunk)
            if "</teiHeader>" in chunk:
                break
    header_text = "".join(buf)
    end = header_text.find("</teiHeader>")
    if end != -1:
        header_text = header_text[: end + len("</teiHeader>")]
    header_text = (
        "<root xmlns=\"http://www.tei-c.org/ns/1.0\" xmlns:cb=\"http://www.cbeta.org/ns/1.0\">"
        + header_text[header_text.find("<teiHeader") :]
        + "</root>"
    )
    try:
        root = ET.fromstring(header_text)
    except ET.ParseError:
        return None

    title_m = text_of(root.find(".//tei:title[@level='m']", NS))
    author = text_of(root.find(".//tei:author", NS))
    extent = text_of(root.find(".//tei:extent", NS))

    idno = root.find(".//tei:idno[@type='CBETA']", NS)
    canon = vol = no = None
    if idno is not None:
        parts = [text_of(c) for c in idno.findall("tei:idno", NS)]
        types = [c.get("type") for c in idno.findall("tei:idno", NS)]
        for t, v in zip(types, parts):
            if t == "canon":
                canon = v
            elif t == "vol":
                vol = v
            elif t == "no":
                no = v

    return {
        "title": title_m,
        "author": author,
        "extent": extent,
        "canon": canon,
        "vol": vol,
        "no": no,
    }


def load_mapping(mapping_path: Path):
    with mapping_path.open(encoding="utf-8") as f:
        return json.load(f)


def assign_layer(doc_id, meta, mapping):
    override = mapping.get("text_overrides", {}).get(doc_id)
    if override is not None:
        return {
            "layer": override["layer"],
            "confidence": override.get("confidence", "high"),
            "note": override.get("note", "manual override"),
        }

    canon = meta.get("canon")
    vol = meta.get("vol")
    rule = mapping.get("canons", {}).get(canon)
    if rule is None:
        return {"layer": None, "confidence": "unmapped", "note": "canon not in mapping table"}

    if "layer" in rule:
        return {"layer": rule["layer"], "confidence": rule.get("confidence", "medium"), "note": rule.get("note", "")}

    if "volume_ranges" in rule and vol is not None:
        try:
            v = int(vol)
        except ValueError:
            v = None
        if v is not None:
            for r in rule["volume_ranges"]:
                lo, hi = r["range"]
                if lo <= v <= hi:
                    return {"layer": r["layer"], "confidence": r.get("confidence", "medium"), "note": r.get("note", "")}
        return {"layer": None, "confidence": "unmapped", "note": "volume out of known ranges"}

    return {"layer": None, "confidence": "unmapped", "note": "no applicable rule"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus_root", nargs="?", default=None)
    ap.add_argument("-o", "--output", default=None)
    ap.add_argument("-m", "--mapping", default=None)
    args = ap.parse_args()

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    corpus_root = Path(args.corpus_root) if args.corpus_root else repo_root
    mapping_path = Path(args.mapping) if args.mapping else repo_root / "data" / "layer_mapping.json"
    output_path = Path(args.output) if args.output else repo_root / "data" / "index.json"

    mapping = load_mapping(mapping_path)

    records = []
    skipped = 0
    xml_files = sorted(corpus_root.glob("*/**/*.xml"))
    total = len(xml_files)
    for i, xml_path in enumerate(xml_files, 1):
        if "schema" in xml_path.parts:
            continue
        meta = parse_header(xml_path)
        if meta is None:
            skipped += 1
            continue
        layer_info = assign_layer(xml_path.stem, meta, mapping)
        rel = xml_path.relative_to(corpus_root)
        records.append(
            {
                "id": xml_path.stem,
                "path": str(rel),
                "title": meta["title"],
                "author": meta["author"],
                "extent": meta["extent"],
                "canon": meta["canon"],
                "vol": meta["vol"],
                "no": meta["no"],
                "layer": layer_info["layer"],
                "layer_confidence": layer_info["confidence"],
                "layer_note": layer_info["note"],
            }
        )
        if i % 1000 == 0:
            print(f"  {i}/{total} processed...", file=sys.stderr)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=1)

    by_layer = {}
    unmapped = 0
    for r in records:
        l = r["layer"]
        by_layer[l] = by_layer.get(l, 0) + 1
        if l is None:
            unmapped += 1

    print(f"\nTotal texts indexed: {len(records)} (skipped {skipped} unparsable headers)")
    print(f"Unmapped (no layer assigned): {unmapped}")
    print("Distribution by layer:")
    for k in sorted(by_layer, key=lambda x: (x is None, x)):
        label = k if k is not None else "UNMAPPED"
        print(f"  layer {label}: {by_layer[k]}")
    print(f"\nWrote {output_path}")


if __name__ == "__main__":
    main()
