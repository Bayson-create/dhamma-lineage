# dhamma-lineage · 法义溯源

A static, citation-first Buddhist canon explorer built on [CBETA XML-P5](https://github.com/cbeta-org/xml-p5). It does three things:

1. **Browse by lineage** — the corpus (5,000+ texts) is classified into 8 historical layers, from early Pali-derived texts through Abhidharma, Mahayana sutras, mature treatises, sectarian schools, to modern teachers' collected works. Layers with no matching text are shown as empty, not hidden — the gap is itself information.
2. **Full-text search** — client-side, no server, no LLM. A character-bigram inverted index lets the static site search across the whole corpus and return results grouped by layer. Queries are accepted in either Simplified or Traditional Chinese (normalized via a bundled char-level map, `site/s2t.js`), since the corpus itself is almost entirely Traditional. Short queries (technical terms like 四念處) are matched as an exact substring; longer input (a full sentence, a question, an opinion) is matched fuzzily — scored by how many of its word-pairs co-occur in each text — since that exact modern wording will essentially never appear verbatim in classical Chinese.
3. **Dhamma Trace (法义溯源)** — give it a phrase or an idea (e.g. "接纳自己", "放下执著", or a full question like "这是佛陀说的吗"). It searches every layer using the same exact/fuzzy logic above and shows, layer by layer, where it is attested and where it is silent, with a match-relevance score for fuzzy hits. It does not rank traditions, and it does not synthesize an answer with an LLM — every result links back to the primary source so you can verify it yourself.

## Why no LLM in the trace feature

The most tempting (and most dangerous) way to build "trace this idea back to its source" is to have a model answer directly. That is also the easiest way to fabricate a citation that looks authoritative. This project instead treats retrieval as the whole product: the corpus is indexed once, offline, and every claim on the page is a literal excerpt from an actual CBETA text with a link to read it in full. If a layer shows nothing, that's because nothing in the current index matches — not because the topic "doesn't matter" at that layer.

## How the 8-layer classification works

`data/layer_mapping.json` maps CBETA canon codes (and, for the Taishō canon, its traditional volume-based catalog divisions, e.g. 阿含部, 般若部, 毘曇部) to the 8 layers. Every mapping rule carries a `confidence` flag (`high` / `medium` / `low`) and a note explaining the reasoning — this is a starting point for human review, not a finished classification. Texts whose canon edition is a historical variant of an already-classified Taishō text (赵城金藏, 中华藏, 高丽藏, 乾隆藏, 永乐北藏, 宋藏遗珍, 洪武南藏) are intentionally left unmapped rather than forced into a layer; some non-doctrinal reference material (temple gazetteers, official-history excerpts, catalogs) is also left out of the lineage view by design.

## Architecture

Everything runs static, no backend, no API key:

- `scripts/build_index.py` — parses each text's TEI header (title, author, Taishō vol/no) and assigns a layer using `data/layer_mapping.json`, producing `data/index.json`.
- `scripts/extract_fulltext.py` — streams each text's TEI body into plain-text paragraphs (`data/fulltext/<id>.txt`), stripping markup.
- `scripts/build_search_index.py` — builds a character-bigram inverted index over the extracted text, sharded and with a document-frequency ceiling to keep the index a manageable size for a static site.
- `site/` — plain HTML/CSS/vanilla JS. `app.js` renders the layer tree, `trace.js` + `fulltext-search.js` power Dhamma Trace, `reader.js` parses TEI XML client-side into a readable page.

The raw CBETA corpus (~3.4GB) is **not** committed to this repository. CI (`.github/workflows/deploy.yml`) shallow-clones [cbeta-org/xml-p5](https://github.com/cbeta-org/xml-p5) on every deploy, runs the three scripts above, and publishes `site/` (with the generated `data/` alongside it) to GitHub Pages.

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

## License and attribution

Code in this repository (`site/`, `scripts/`) is licensed under Apache 2.0 (see `LICENSE`).

The Buddhist texts themselves are not ours: they are CBETA's [xml-p5](https://github.com/cbeta-org/xml-p5) corpus, "available for non-commercial use when distributed with [the TEI] header intact." This site reads that corpus at build time and does not redistribute it as a separate download; the reader page fetches and renders the original TEI XML directly. See `NOTICE` for the full attribution CBETA asks for.
