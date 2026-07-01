#!/usr/bin/env python3
"""
Build a compact character-bigram inverted index over data/fulltext/*.txt
so the static site can do client-side full-text search without shipping
the whole corpus to the browser.

Design notes (v2 - replaces a first attempt that produced an 857MB index,
larger than the 624MB of source text it was indexing):
  - doc ids are stored as small integers, not strings (doc_ids.json holds
    the integer -> CBETA id mapping).
  - bigrams that appear in more than DF_CEILING of all documents are
    dropped from the index. These are near-universal function-word
    bigrams ("之一", "如是", "佛言"...) that match almost every text and
    are useless for narrowing a search anyway - they account for a large
    share of the raw index size relative to their value.
  - postings are bucketed into a fixed number of shard files (hashed by
    bigram) instead of one shard per leading character, so file count and
    per-file size are predictable regardless of script/character mix.

Usage:
    python3 scripts/build_search_index.py [--df-ceiling 0.12] [--buckets 64]
"""
import argparse
import json
import sys
import zlib
from collections import defaultdict
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--df-ceiling", type=float, default=0.12,
                     help="drop bigrams appearing in more than this fraction of docs")
    ap.add_argument("--buckets", type=int, default=64)
    args = ap.parse_args()

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    fulltext_dir = repo_root / "data" / "fulltext"
    out_dir = repo_root / "data" / "search_index"
    out_dir.mkdir(parents=True, exist_ok=True)

    index_path = repo_root / "data" / "index.json"
    records = {r["id"]: r for r in json.loads(index_path.read_text(encoding="utf-8"))}

    files = sorted(p for p in fulltext_dir.glob("*.txt") if p.stem in records)
    doc_ids = [p.stem for p in files]
    id_to_int = {doc_id: i for i, doc_id in enumerate(doc_ids)}

    postings = defaultdict(set)  # bigram -> set(int doc id)
    for i, fp in enumerate(files, 1):
        text = fp.read_text(encoding="utf-8")
        lines = (l.split("\t", 1)[-1] for l in text.splitlines())
        joined = "".join(lines)
        doc_int = id_to_int[fp.stem]
        seen = set(a + b for a, b in zip(joined, joined[1:]))
        for bg in seen:
            postings[bg].add(doc_int)
        if i % 1000 == 0:
            print(f"  {i}/{len(files)} indexed...", file=sys.stderr)

    n_docs = len(doc_ids)
    df_ceiling_count = int(n_docs * args.df_ceiling)
    kept = {bg: ids for bg, ids in postings.items() if len(ids) <= df_ceiling_count}
    dropped = len(postings) - len(kept)
    print(f"\n{len(postings)} unique bigrams; dropping {dropped} with doc-freq > "
          f"{args.df_ceiling:.0%} ({df_ceiling_count} docs); keeping {len(kept)}",
          file=sys.stderr)

    buckets = defaultdict(dict)
    for bg, ids in kept.items():
        b = zlib.crc32(bg.encode("utf-8")) % args.buckets
        buckets[b][bg] = sorted(ids)

    manifest = {}
    total_bytes = 0
    for b in range(args.buckets):
        fname = f"shard_{b:03d}.json"
        payload = buckets.get(b, {})
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        (out_dir / fname).write_text(data, encoding="utf-8")
        total_bytes += len(data.encode("utf-8"))
        manifest[fname] = len(payload)

    (out_dir / "manifest.json").write_text(
        json.dumps({"buckets": args.buckets, "shards": manifest}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    (out_dir / "doc_ids.json").write_text(
        json.dumps(doc_ids, ensure_ascii=False), encoding="utf-8"
    )

    print(f"Indexed {n_docs} documents")
    print(f"Index size: {total_bytes / 1024 / 1024:.1f} MB across {args.buckets} shards")
    print(f"Output dir: {out_dir}")


if __name__ == "__main__":
    main()
