#!/usr/bin/env python3
"""Curates the featured-category cards shown on the redesigned homepage
(site/index.html) for layers 3-7, matching texts in site/data/index.json
by title keyword (the same style of keyword list build_index.py already
uses to explain a text's layer assignment - reused here for the finer-
grained sub-categories the homepage cards need).

Every text in a layer ends up in exactly one card: a named category if its
title matches that category's keywords (first match wins, in the order
listed below), otherwise the layer's catch-all "其他经典" card.

Output: site/data/layer_cards.json, consumed by home.js.
"""
import json
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parent.parent / "site"
INDEX_PATH = SITE_DIR / "data" / "index.json"
OUT_PATH = SITE_DIR / "data" / "layer_cards.json"

# (card_id, label, keywords, group) - group is a sub-heading used only for
# layers 5 and 7, which the reference design splits into two rows.
LAYER_CARD_DEFS = {
    3: [
        ("theravada7", "上座部七论", ["法集", "分別論", "界論", "人施設", "雙論", "發趣論", "論事"], None),
        ("sarvastivada7", "说一切有部七论", ["集異門", "法蘊", "識身", "界身", "品類", "發智", "施設", "阿毗曇", "阿毘曇"], None),
    ],
    4: [
        ("visuddhimagga", "清淨道論", ["清淨道"], None),
        ("vimuttimagga", "解脫道論", ["解脫道"], None),
        ("abhidhammattha", "攝阿毗達磨義論", ["攝阿毘達磨義", "阿毗達摩攝義", "阿毘達摩攝義"], None),
        ("mahavibhasa", "大毗婆沙論", ["大毘婆沙", "鞞婆沙", "阿毘曇毘婆沙"], None),
        ("kosa", "俱舍論", ["俱舍"], None),
        ("nyayanusara", "順正理論", ["順正理", "顯宗"], None),
    ],
    5: [
        ("prajna", "般若", ["般若", "金剛經", "心經"], "大乘经典"),
        ("lotus", "法華", ["法華", "蓮華經"], "大乘经典"),
        ("sandhinirmocana", "解深密", ["解深密"], "大乘经典"),
        ("avatamsaka", "華嚴", ["華嚴"], "大乘经典"),
        ("dashabhumika", "十地", ["十地"], "大乘经典"),
        ("tathagatagarbha", "如來藏經典", ["如來藏", "勝鬘", "涅槃", "維摩", "淨名", "楞伽", "寶積", "大集"], "大乘经典"),
        ("madhyamaka_base", "中論", ["中論", "中觀論", "十二門論", "百論"], "大乘基础体系论"),
        ("mahaprajnaparamita_sastra", "大智度論", ["大智度"], "大乘基础体系论"),
        ("yogacarabhumi", "瑜伽師地論", ["瑜伽師地"], "大乘基础体系论"),
    ],
    6: [
        ("abhidharmasamuccaya", "阿毗達磨集論", ["阿毗達磨集", "阿毘達磨集", "大乘阿毘達磨雜集"], None),
        ("mahayanasamgraha", "攝大乘論", ["攝大乘"], None),
        ("vijnaptimatrata", "成唯識論", ["成唯識", "唯識三十", "唯識二十", "百法明門"], None),
        ("bodhicaryavatara", "入菩薩行論", ["入菩薩行"], None),
    ],
    7: [
        ("madhyamaka_school", "中觀", ["中觀"], "哲学体系"),
        ("yogacara_school", "唯識", ["唯識", "八識規矩", "八識"], "哲学体系"),
        ("tiantai", "天台", ["天台", "止觀", "四教", "法華文句", "法華玄義"], "宗派体系"),
        ("huayan_school", "華嚴", ["華嚴", "法界", "五教", "一乘"], "宗派体系"),
        ("chan", "禪宗", ["禪", "語錄", "祖堂", "傳燈", "壇經", "公案", "頌古", "牧牛"], "宗派体系"),
        ("tibetan", "藏傳", ["密", "真言", "瑜伽", "壇", "道場儀", "燄口", "大手印", "大圓滿", "道次第", "宗喀巴", "西藏"], "宗派体系"),
    ],
}


def matches(title: str, keywords: list[str]) -> bool:
    return any(k in title for k in keywords)


def main():
    records = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    by_layer: dict[int, list[dict]] = {}
    for r in records:
        by_layer.setdefault(r.get("layer"), []).append(r)

    out = {}
    for layer, defs in LAYER_CARD_DEFS.items():
        texts = by_layer.get(layer, [])
        claimed_ids = set()
        cards = []
        for card_id, label, keywords, group in defs:
            matched = [r for r in texts if r["id"] not in claimed_ids and matches(r.get("title") or "", keywords)]
            claimed_ids.update(r["id"] for r in matched)
            cards.append({
                "id": card_id,
                "label": label,
                "group": group,
                "count": len(matched),
                "ids": [r["id"] for r in matched],
            })
        remainder = [r["id"] for r in texts if r["id"] not in claimed_ids]
        cards.append({"id": "other", "label": "其他经典", "group": None, "count": len(remainder), "ids": remainder})
        out[str(layer)] = cards

    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Wrote {OUT_PATH}")
    for layer, cards in out.items():
        print(f"layer {layer}: total {sum(c['count'] for c in cards)}")
        for c in cards:
            print(f"  {c['label']:20s} {c['count']}")


if __name__ == "__main__":
    main()
