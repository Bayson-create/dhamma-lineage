#!/usr/bin/env python3
"""Build featured cards from reviewed lineage metadata.

The former implementation classified every title by a loose first-match
keyword list, which made a large ``其他经典`` bin and could mislabel a work.
This version consumes explicit ``lineage_category`` values written by the
versioned lineage mapping. A title match is a review candidate, not historical
evidence, so anything without an explicit category is visibly ``待学术复核``.

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
        ("sarvastivada", "说一切有部阿毗达磨", ["集異門", "法蘊", "識身", "界身", "品類", "發智", "施設", "三法度", "薩婆多", "眾事分", "八犍度"], None),
        ("dharmaguptaka", "法藏部／分别说系阿毗达磨", [], None),
        ("pudgalavada", "正量部阿毗达磨（残本）", [], None),
        ("early_unresolved", "早期阿毗达磨（部派待考）", [], None),
    ],
    4: [
        ("vimuttimagga", "解脫道論", ["解脫道"], None),
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
        # Keep the existing philosophical core cards intact.  The two
        # Chinese-school cards below collect later school-forming material.
        ("sanlun", "三论", ["三論", "嘉祥", "吉藏"], "唐代八宗"),
        ("faxiang", "法相", ["法相", "慈恩", "窺基", "唯識述記"], "唐代八宗"),
        ("madhyamaka_school", "中觀", ["中觀"], "哲学体系"),
        ("yogacara_school", "唯識", ["唯識", "八識規矩", "八識"], "哲学体系"),
        ("tiantai", "天台", ["天台", "止觀", "四教", "法華文句", "法華玄義"], "宗派体系"),
        ("huayan_school", "華嚴", ["華嚴", "法界", "五教", "一乘"], "宗派体系"),
        ("chan", "禪宗", ["禪", "語錄", "祖堂", "傳燈", "壇經", "公案", "頌古", "牧牛"], "宗派体系"),
        ("vinaya", "律宗", ["律", "戒", "毘尼", "梵網"], "唐代八宗"),
        ("pureland", "净土宗", ["淨土", "净土", "念佛", "往生", "阿彌陀", "阿弥陀"], "唐代八宗"),
        ("esoteric", "密宗", ["真言", "陀羅尼", "曼荼羅", "灌頂", "密教", "金剛頂", "大日經"], "唐代八宗"),
        ("tibetan", "藏传传统", ["大手印", "大圓滿", "道次第", "宗喀巴", "西藏"], "补充传统"),
    ],
}


def matches(title: str, keywords: list[str]) -> bool:
    return any(k in title for k in keywords)


EXPLICIT = {
    "T28n1548": "dharmaguptaka",  # Śāriputrābhidharma: Dharmaguptaka/Vibhajyavāda evidence lane
    "T24n1482": "pudgalavada",    # nine-part Pudgalavāda/Saṃmitīya remnant
    "T28n1557": "early_unresolved",  # early translation; school remains open
}


def category_for(record, defs):
    explicit = EXPLICIT.get(record["id"])
    if explicit:
        return explicit
    category = record.get("lineage_category")
    if category and any(category == card_id for card_id, *_ in defs):
        return category
    return "pending_review"


def main():
    records = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    by_layer: dict[int, list[dict]] = {}
    for r in records:
        by_layer.setdefault(r.get("layer"), []).append(r)

    out = {}
    for layer, defs in LAYER_CARD_DEFS.items():
        texts = by_layer.get(layer, [])
        cards = []
        for card_id, label, keywords, group in defs:
            matched = []
            for r in texts:
                if category_for(r, defs) == card_id:
                    matched.append(r)
            cards.append({
                "id": card_id,
                "label": label,
                "group": group,
                "count": len(matched),
                "ids": [r["id"] for r in matched],
                "classification": "explicit_lineage_mapping",
            })
        remainder = [r["id"] for r in texts if category_for(r, defs) == "pending_review"]
        cards.append({"id": "pending_review", "label": "待学术复核", "group": None, "count": len(remainder), "ids": remainder, "review_status": "pending"})
        out[str(layer)] = cards

    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"Wrote {OUT_PATH}")
    for layer, cards in out.items():
        print(f"layer {layer}: total {sum(c['count'] for c in cards)}")
        for c in cards:
            print(f"  {c['label']:20s} {c['count']}")


if __name__ == "__main__":
    main()
