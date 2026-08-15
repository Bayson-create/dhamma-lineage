#!/usr/bin/env python3
"""Create the versioned CBETA lineage-v4 mapping and audit manifest.

The source mapping is intentionally copied forward rather than rewritten in
place.  Existing layer decisions remain available for rollback, while every
record receives an explicit review status.  Unmapped records stay searchable
but are not promoted into one of the eight lineage layers without evidence.

The previous layer-card output is used only to preserve already-published
card membership as explicit IDs.  New builds never infer a card from a title.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


REFERENCE_WORDS = ("目录", "編校", "编校", "出版", "研究论文", "研究論文", "佛寺志", "外典", "劝善")
EXCLUDED_WORDS = ("不纳入", "不納入", "退出层级", "退出層級", "不计入", "不計入")


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def category_overrides(layer_cards: dict) -> dict[str, str]:
    result: dict[str, str] = {}
    for cards in layer_cards.values():
        for card in cards:
            card_id = card.get("id")
            if not card_id or card_id in {"pending_review", "other"}:
                continue
            for doc_id in card.get("ids", []):
                result.setdefault(str(doc_id), str(card_id))
    return result


def review_for(record: dict, base_mapping: dict) -> dict:
    doc_id = str(record["id"])
    override = base_mapping.get("text_overrides", {}).get(doc_id) or {}
    layer = record.get("layer")
    note = str(override.get("note") or record.get("layer_note") or "").strip()
    evidence = str(override.get("evidence") or record.get("lineage_evidence") or "").strip()

    if layer is None:
        if any(word in note for word in EXCLUDED_WORDS):
            status = "excluded_from_lineage"
        elif any(word in note for word in REFERENCE_WORDS):
            status = "reference_material"
        else:
            status = "pending_review"
        reason = note or "未找到可验证的八层归属依据；保留原文并进入逐篇学术复核队列。"
        basis = "header_only_pending"
    elif override:
        status = "audited_override"
        reason = note or "逐篇覆盖项；归属来自显式映射。"
        basis = "explicit_text_override"
    else:
        status = "rule_based_preserved"
        reason = note or "保留既有藏别／卷册规则归属；后续学术复核可通过新覆盖项修订。"
        basis = "canon_or_volume_rule"

    return {
        "review_status": status,
        "review_reason": reason,
        "review_basis": basis,
        "evidence": evidence,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-mapping", required=True)
    parser.add_argument("--previous-index", required=True)
    parser.add_argument("--previous-cards", required=True)
    parser.add_argument("--output-mapping", required=True)
    parser.add_argument("--output-audit", required=True)
    args = parser.parse_args()

    base_path = Path(args.base_mapping)
    base = load_json(base_path, {})
    records = load_json(Path(args.previous_index), [])
    cards = load_json(Path(args.previous_cards), {})
    if not isinstance(records, list) or len(records) == 0:
        raise SystemExit("previous index is empty; build the full CBETA metadata index first")

    mapping = dict(base)
    mapping["version"] = "lineage-v4"
    mapping["previous_version"] = str(base.get("version", "unknown"))
    mapping["review_policy"] = {
        "title_keywords_are_candidates_only": True,
        "unmapped_records_remain_searchable": True,
        "unmapped_records_enter_pending_review": True,
        "reviewed_on": "2026-08-15",
    }

    category_map = category_overrides(cards)
    reviews: dict[str, dict] = {}
    audit_rows = []
    for record in records:
        doc_id = str(record["id"])
        review = review_for(record, base)
        reviews[doc_id] = review
        audit_rows.append({
            "id": doc_id,
            "path": record.get("path"),
            "title": record.get("title"),
            "author": record.get("author"),
            "canon": record.get("canon"),
            "vol": record.get("vol"),
            "no": record.get("no"),
            "layer": record.get("layer"),
            "lineage_category": category_map.get(doc_id),
            **review,
            "original_layer_note": record.get("layer_note"),
        })

    mapping["category_overrides"] = category_map
    mapping["reviews"] = reviews
    mapping["audit_summary"] = {
        "record_count": len(audit_rows),
        "layer_counts": {str(k): v for k, v in sorted(Counter(str(r.get("layer")) for r in audit_rows).items())},
        "review_status_counts": dict(sorted(Counter(r["review_status"] for r in audit_rows).items())),
        "pending_ids": [r["id"] for r in audit_rows if r["review_status"] == "pending_review"],
    }

    output_mapping = Path(args.output_mapping)
    output_mapping.parent.mkdir(parents=True, exist_ok=True)
    output_mapping.write_text(json.dumps(mapping, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    output_audit = Path(args.output_audit)
    output_audit.parent.mkdir(parents=True, exist_ok=True)
    output_audit.write_text(json.dumps({
        "format": "cbeta-lineage-audit/v4",
        "mapping_version": "lineage-v4",
        "source_mapping": str(base_path),
        "record_count": len(audit_rows),
        "summary": mapping["audit_summary"],
        "records": audit_rows,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(f"lineage-v4 records: {len(audit_rows)}")
    print(f"categories preserved explicitly: {len(category_map)}")
    print(f"pending review: {len(mapping['audit_summary']['pending_ids'])}")
    print(f"mapping: {output_mapping}")
    print(f"audit: {output_audit}")


if __name__ == "__main__":
    main()
