# dhamma-lineage · 法义溯源

A static, citation-first Buddhist canon explorer built on [CBETA XML-P5](https://github.com/cbeta-org/xml-p5). It does three things:

1. **Browse by lineage** — the corpus (5,000+ texts) is classified into 8 historical layers, from early Pali-derived texts through Abhidharma, Mahayana sutras, mature treatises, sectarian schools, to modern teachers' collected works. Layers with no matching text are shown as empty, not hidden — the gap is itself information.
2. **Full-text search** — client-side, no server, no LLM. A character-bigram inverted index lets the static site search across the whole corpus and return results grouped by layer, with **every matching document listed and every occurrence position shown individually** (not just a top-N sample). Queries are accepted in either Simplified or Traditional Chinese (normalized via a bundled char-level map, `site/s2t.js`), since the corpus itself is almost entirely Traditional. Short queries (technical terms like 四念處) are matched as an exact substring; longer input (a full sentence, a question, an opinion) is matched fuzzily — scored by how many of its word-pairs co-occur in each text — since that exact modern wording will essentially never appear verbatim in classical Chinese.
3. **Dhamma Trace (法义溯源)** — give it a phrase or an idea (e.g. "接纳自己", "放下执著", or a full question like "这是佛陀说的吗"). It searches every layer using the same exact/fuzzy logic above and shows, layer by layer, where it is attested and where it is silent, with a match-relevance score for fuzzy hits and every occurrence listed. It does not rank traditions, and it does not synthesize an answer with an LLM — every result links straight into the reader, scrolled and highlighted at that exact occurrence, so you can verify it in context.
4. **Reader** — renders each text in Simplified Chinese by default (converted from the Traditional source via a bundled char map, `site/t2s.js`), with a one-click toggle back to Traditional. Jumping in from a search result scrolls straight to the matching occurrence and highlights it; the highlight survives toggling script, since both conversions are strict 1-character-for-1-character maps.

## Why no LLM in the trace feature

The most tempting (and most dangerous) way to build "trace this idea back to its source" is to have a model answer directly. That is also the easiest way to fabricate a citation that looks authoritative. This project instead treats retrieval as the whole product: the corpus is indexed once, offline, and every claim on the page is a literal excerpt from an actual CBETA text with a link to read it in full. If a layer shows nothing, that's because nothing in the current index matches — not because the topic "doesn't matter" at that layer.

## How the 8-layer classification works, and how to correct it

`data/layer_mapping.json` maps CBETA canon codes (and, for the Taishō canon, its traditional volume-based catalog divisions, e.g. 阿含部, 般若部, 毘曇部) to the 8 layers. Every mapping rule carries a `confidence` flag (`high` / `medium` / `low`) and a note explaining the reasoning — this is a starting point for human review, not a finished classification. Texts whose canon edition is a historical variant of an already-classified Taishō text (赵城金藏, 中华藏, 高丽藏, 乾隆藏, 永乐北藏, 宋藏遗珍, 洪武南藏) are intentionally left unmapped rather than forced into a layer; some non-doctrinal reference material (temple gazetteers, official-history excerpts, catalogs) is also left out of the lineage view by design.

There are two ways to adjust which layer a text ends up in, and they apply in this order (`scripts/build_index.py`'s `assign_layer`):

1. **`text_overrides`** — a per-document correction, keyed by CBETA id (the xml filename without extension, e.g. `"T30n1564"`). Checked *first*, before any canon/volume rule, so this is how you fix one specific text without touching the broader rule that everything else in its canon/volume range still relies on. It's also how you surface an individual text from an otherwise-unmapped canon (A/C/K/L/P/S/U/GA/GB/D/ZS/...) instead of leaving it `null`. See the `A091n1057` entry in `data/layer_mapping.json` for a worked example.
2. **`canons`** — the broad rule, either a flat `{"layer": N}` for a whole canon (e.g. TX = 太虛大師全書 → layer 8) or `volume_ranges` for the Taishō canon, matching the traditional 部 catalog divisions. Change this when an entire volume range or canon is misclassified, not for a single text — that's what overrides are for.

After editing `data/layer_mapping.json`, re-run `scripts/build_index.py` (see "Running locally" below) to regenerate `data/index.json` and confirm the change took effect for the specific `id` you touched before pushing.

## Architecture

Everything runs static, no backend, no API key:

- `scripts/build_index.py` — parses each text's TEI header (title, author, Taishō vol/no) and assigns a layer using `data/layer_mapping.json`, producing `data/index.json`.
- `scripts/extract_fulltext.py` — streams each text's TEI body into plain-text paragraphs (`data/fulltext/<id>.txt`), stripping markup. This extracted text is what both search and the reader work from — the raw TEI XML itself is never shipped to the browser.
- `scripts/build_search_index.py` — builds a character-bigram inverted index over the extracted text, sharded and with a document-frequency ceiling to keep the index a manageable size for a static site.
- `scripts/gen_s2t_map.py` / `scripts/gen_t2s_map.py` — generate `site/s2t.js` / `site/t2s.js`, char-level Simplified↔Traditional conversion tables (via OpenCC), used respectively to normalize search queries and to display the reader in Simplified by default.
- `site/doctext.js` — shared parsing of `data/fulltext/<id>.txt` into paragraphs with character offsets, used by both the search index (to report *where* a match is) and the reader (to jump to and highlight that exact spot). Offsets are stable across the Simplified/Traditional toggle because both conversions are strict 1-char-for-1-char maps.
- `site/` — plain HTML/CSS/vanilla JS. `app.js` renders the layer tree and the full-text search results, `trace.js` + `fulltext-search.js` power Dhamma Trace, `reader.js` renders a text from its extracted plain text and can jump straight to a specific match offset.

The raw CBETA corpus (~3.4GB) is **not** committed to this repository. CI (`.github/workflows/deploy.yml`) shallow-clones [cbeta-org/xml-p5](https://github.com/cbeta-org/xml-p5) on every deploy, runs the scripts above, and publishes `site/` (with the generated `data/` alongside it) to GitHub Pages.

## Running locally

```bash
git clone https://github.com/cbeta-org/xml-p5.git corpus
python3 scripts/build_index.py corpus -o data/index.json -m data/layer_mapping.json
python3 scripts/extract_fulltext.py corpus --index data/index.json --out-dir data/fulltext
python3 scripts/build_search_index.py --df-ceiling 0.35 --buckets 256
mkdir -p site/data
cp data/index.json site/data/index.json
cp -r data/fulltext site/data/fulltext
cp -r data/search_index site/data/search_index
python3 -m http.server -d site 8000
```

## 版权声明 · Copyright Notice

本项目（八层分层规则、检索网页、阅读器网页与构建脚本）由 **[Bayson-create](https://github.com/Bayson-create)** 设计开发，© 2026 Bayson-create。代码以 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 开源；项目原创文字内容（README、分层说明、界面说明、非经文性的整理文字）以 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 共享，欢迎自由使用、转载、修改、二次开发，敬请注明出处并附本仓库链接。

### CBETA 文献来源

本项目索引与阅读器所显示的佛教文献来自 [CBETA XML-P5](https://github.com/cbeta-org/xml-p5) 语料库。佛典原文、校勘信息、TEI 标记及相关权利不属于本项目；CBETA 语料按其自身条件提供，通常要求非商业使用并保留 TEI header 中的来源与权利信息。本项目在构建时读取 CBETA XML，网页端显示从 XML 抽取的正文段落，并在每篇文本中保留标题、作者、CBETA id、藏经/册/号等来源信息，以便追溯原始文件。

部分文献还来自 CBETA 收录的其他著作集或机构出版物，例如太虚大师全书、印顺法师佛学著作集、演培法师全集、吕澂佛学著作集等；具体来源与权利归属请以每篇 CBETA TEI header 为准。详见本仓库的 [`NOTICE`](NOTICE)。

### 免责声明

本项目用于学习、检索、研究与个人阅读辅助，不销售文本访问权限，不以本项目声明替代 CBETA 或各原权利方的正式授权条款。若转载、再发布或商用任何 CBETA 来源文本，请自行核对 CBETA 及相关权利方的最新许可要求。

---

**Copyright**: © 2026 [Bayson-create](https://github.com/Bayson-create). Code under [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0); project-original written content under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

**Text attribution**: Buddhist texts are derived from [CBETA XML-P5](https://github.com/cbeta-org/xml-p5). The texts, TEI markup, and source rights remain with CBETA and the original credited rights holders. This project is non-commercial and preserves per-text provenance through CBETA ids and metadata; see [`NOTICE`](NOTICE).
