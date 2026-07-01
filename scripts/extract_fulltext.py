#!/usr/bin/env python3
"""
Extract plain-text paragraphs (with juan/卷 numbers) from every text listed
in data/index.json, writing one compact text file per document to
data/fulltext/<id>.txt. Each line is one paragraph, prefixed with its
juan number: "<juan>\t<text>". This is the source the full-text search
index and the Dhamma Trace snippet lookup are built from.

Usage:
    python3 scripts/extract_fulltext.py [CORPUS_ROOT] [--limit N]
"""
import argparse
import json
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

NS = "{http://www.tei-c.org/ns/1.0}"


def extract_paragraphs(xml_path: Path):
    """Stream-parse the body, yielding (juan, paragraph_text)."""
    juan = ""
    paragraphs = []
    context = ET.iterparse(str(xml_path), events=("start", "end"))
    in_body = False
    p_buf = []
    p_depth = 0

    for event, el in context:
        tag = el.tag
        local = tag.rsplit("}", 1)[-1] if "}" in tag else tag

        if event == "start":
            if local == "body":
                in_body = True
            elif in_body and local == "div" and el.get("type") == "juan":
                juan = el.get("n") or juan
            elif in_body and local == "p":
                p_depth += 1
                if p_depth == 1:
                    p_buf = []
            elif in_body and p_depth >= 1 and el.text:
                p_buf.append(el.text)

        elif event == "end":
            if in_body and p_depth >= 1:
                if el.tail:
                    p_buf.append(el.tail)
            if local == "p" and in_body:
                p_depth -= 1
                if p_depth == 0:
                    text = "".join(p_buf)
                    text = " ".join(text.split())
                    if text:
                        paragraphs.append((juan, text))
                    p_buf = []
            elif local == "body":
                in_body = False
            el.clear()

    return paragraphs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus_root", nargs="?", default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--index", default=None)
    ap.add_argument("--out-dir", default=None)
    args = ap.parse_args()

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    corpus_root = Path(args.corpus_root) if args.corpus_root else repo_root
    index_path = Path(args.index) if args.index else repo_root / "data" / "index.json"
    out_dir = Path(args.out_dir) if args.out_dir else repo_root / "data" / "fulltext"
    out_dir.mkdir(parents=True, exist_ok=True)

    records = json.loads(index_path.read_text(encoding="utf-8"))
    if args.limit:
        records = records[: args.limit]

    ok, failed, empty = 0, 0, 0
    for i, rec in enumerate(records, 1):
        xml_path = corpus_root / rec["path"]
        out_path = out_dir / f"{rec['id']}.txt"
        try:
            paras = extract_paragraphs(xml_path)
        except ET.ParseError as e:
            failed += 1
            print(f"  PARSE ERROR {rec['id']}: {e}", file=sys.stderr)
            continue
        if not paras:
            empty += 1
            continue
        with out_path.open("w", encoding="utf-8") as f:
            for juan, text in paras:
                f.write(f"{juan}\t{text}\n")
        ok += 1
        if i % 500 == 0:
            print(f"  {i}/{len(records)} extracted...", file=sys.stderr)

    print(f"\nExtracted {ok} texts, {empty} empty, {failed} failed, out of {len(records)}")
    print(f"Output dir: {out_dir}")


if __name__ == "__main__":
    main()
