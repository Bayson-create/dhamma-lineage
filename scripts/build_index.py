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


def layer_reason(meta, layer, fallback_note):
    title = meta.get("title") or ""
    canon = meta.get("canon") or ""

    if layer is None:
        return fallback_note

    def has_any(words):
        return any(w in title for w in words)

    if layer == 1:
        if canon == "N" or has_any(["南傳", "長部", "中部", "相應部", "增支部", "小部", "法句", "小誦", "念處", "本生", "阿含", "律"]):
            return "题名和来源显示为早期经律、南传尼柯耶/小部或汉译阿含相关文本，归第1层。"
        return "内容属于早期佛教经律或阿含系统，归第1层。"

    if layer == 2:
        return "文本属于巴利传统注疏或其汉译相关材料，解释早期律论文本，归第2层。"

    if layer == 3:
        if has_any(["法集", "分別", "界論", "人施設", "雙論", "發趣", "論事"]):
            return "题名对应南传阿毗达磨七论之一，属部派阿毗达磨根本文献，归第3层。"
        if has_any(["集異門", "法蘊", "識身", "界身", "品類", "發智", "施設", "阿毗曇"]):
            return "题名对应说一切有部阿毗达磨根本论书或部派阿毗达磨残存文献，归第3层。"
        return "内容属于部派阿毗达磨根本文献，归第3层。"

    if layer == 4:
        if has_any(["大毘婆沙", "毘婆沙"]):
            return "题名属于毘婆沙类部派大型释论，系统解释阿毗达磨，归第4层。"
        if has_any(["俱舍", "順正理", "顯宗"]):
            return "题名属于俱舍/顺正理系统及其注疏，代表部派体系论，归第4层。"
        if has_any(["清淨道", "攝阿毘達磨", "阿毗達摩攝義", "解脫道", "成實", "那先", "彌蘭"]):
            return "题名属于南传或部派系统化论书，归第4层部派体系论。"
        return "内容属于部派佛教系统化论书或其注疏，归第4层。"

    if layer == 5:
        if has_any(["般若", "金剛", "心經"]):
            return "题名属于般若系核心经典或早期印度般若论书，直接构成大乘基础体系的重要经证，归第5层。"
        if has_any(["法華", "蓮華", "華嚴", "十地", "解深密", "如來藏", "勝鬘", "涅槃", "維摩", "淨名", "楞伽", "寶積", "大集"]):
            return "题名属于法华、解深密、华严/十地或如来藏等核心大乘经典簇，归第5层。"
        if has_any(["中論", "中觀", "十二門", "百論", "大智度", "瑜伽師地", "因緣心", "佛性"]):
            return "题名属于中观、般若或瑜伽行基础论书系统，归第5层。"
        return "内容属于大乘经典、释经论或大乘基础体系论，归第5层。"

    if layer == 6:
        if has_any(["攝大乘", "唯識", "三十", "三自性", "百法", "辨法法性", "中邊", "集量", "釋量", "因明", "觀所緣", "起信", "入菩薩行"]):
            return "题名属于唯识、摄大乘、因明量论、起信论或入菩萨行论等成熟体系论，归第6层。"
        return "内容属于成熟大乘体系论或其直接注释传统，归第6层。"

    if layer == 7:
        if has_any(["律", "戒", "毘尼", "梵網"]):
            return "题名属于律宗、戒律注疏或戒法仪轨资料，归第7层宗派体系。"
        if has_any(["疏", "義記", "義疏", "講義", "集註", "鈔", "抄", "釋", "述", "文句", "玄義", "註", "注", "解"]):
            return "题名显示为经典或论书的后期注疏、讲义或义解，属于宗派解释传统，归第7层。"
        if has_any(["禪", "語錄", "祖堂", "傳燈", "壇經", "公案", "頌古", "牧牛"]):
            return "题名属于禅宗语录、灯录、公案或修行文献，归第7层宗派体系。"
        if has_any(["天台", "止觀", "四教", "法華文句", "法華玄義"]):
            return "题名属于天台宗判教、止观或法华注疏体系，归第7层宗派体系。"
        if has_any(["華嚴", "法界", "五教", "一乘"]):
            return "题名属于华严宗经疏、判教或法界观体系，归第7层宗派体系。"
        if has_any(["淨土", "念佛", "往生", "阿彌陀"]):
            return "题名属于净土宗念佛、往生或净土注疏资料，归第7层宗派体系。"
        if has_any(["密", "真言", "瑜伽", "壇", "道場儀", "燄口", "大手印", "大圓滿", "道次第", "宗喀巴", "西藏"]):
            return "题名属于密教、藏传道次第或相关仪轨修法资料，归第7层宗派体系。"
        return "内容属于汉传或藏传宗派注疏、语录、仪轨、宗义或宗派史传资料，归第7层。"

    if layer == 8:
        if canon == "TX":
            return "来源为《太虚大师全书》，属现代法师著作集，归第8层。"
        if canon == "Y":
            return "来源为《印顺法师佛学著作集》，属现代法师著作集，归第8层。"
        if canon == "YP":
            return "来源为《演培法师全集》，属现代法师著作集，归第8层。"
        if canon == "LC":
            return "来源为吕澂佛学著作集，属近现代佛学著作，归第8层。"
        return "内容属于近现代佛教人物或现代佛学著作，归第8层。"

    return fallback_note


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
    xml_files = []
    for canon_dir in sorted(p for p in corpus_root.iterdir() if p.is_dir()):
        if not CANON_DIR_RE.match(canon_dir.name):
            continue
        xml_files.extend(sorted(canon_dir.glob("**/*.xml")))
    total = len(xml_files)
    for i, xml_path in enumerate(xml_files, 1):
        if "schema" in xml_path.parts:
            continue
        meta = parse_header(xml_path)
        if meta is None:
            skipped += 1
            continue
        layer_info = assign_layer(xml_path.stem, meta, mapping)
        note = layer_reason(meta, layer_info["layer"], layer_info["note"])
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
                "layer_note": note,
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
