let INDEX_BY_ID = null;

async function ensureIndex() {
  if (!INDEX_BY_ID) {
    const list = await (await fetch("data/index.json")).json();
    INDEX_BY_ID = new Map(list.map((r) => [r.id, r]));
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function highlightTerm(snippet, term) {
  const escSnippet = escapeHtml(snippet);
  const escTerm = escapeHtml(term);
  const idx = escSnippet.indexOf(escTerm);
  if (idx === -1) return escSnippet;
  return (
    escSnippet.slice(0, idx) +
    `<b class="hl">${escTerm}</b>` +
    escSnippet.slice(idx + escTerm.length)
  );
}

// Short input (a technical term like "四念處" or "空性") is matched as an
// exact substring. Longer input - a whole sentence, a question, a stated
// opinion - is matched fuzzily: scored by how many of its word-pairs
// co-occur in each text, since that exact modern wording will essentially
// never appear verbatim in classical Chinese. A layer only counts as
// "命中" if some text clears RELEVANCE_HIT_THRESHOLD; weaker, noisier
// overlaps are dropped rather than padding the layer with false hits.
const FUZZY_THRESHOLD_LEN = 6;
const RELEVANCE_HIT_THRESHOLD = 0.5;
const RELEVANCE_SHOW_THRESHOLD = 0.34;

async function runTrace(query) {
  const box = document.getElementById("traceResult");
  const q = query.trim();
  if (!q) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `<p class="trace-status">正在逐层检索"${escapeHtml(q)}"…</p>`;

  await ensureIndex();

  const useFuzzy = q.length > FUZZY_THRESHOLD_LEN;
  let results;
  try {
    if (useFuzzy) {
      results = await fuzzySentenceSearch(q, { limit: 400 });
    } else {
      const exact = await fullTextSearch(q, { limit: 400 });
      results = exact.map((r) => ({ ...r, relevance: 1 }));
      if (results.length === 0) {
        // an exact short term with no verbatim hits still gets a fuzzy pass
        results = await fuzzySentenceSearch(q, { limit: 400 });
      }
    }
  } catch (err) {
    if (err.code === "NO_INFORMATIVE_TERMS") {
      box.innerHTML = `<p class="trace-status">"${escapeHtml(q)}"里没有可用于检索的常见词组，换个说法试试。</p>`;
      return;
    }
    box.innerHTML = `<p class="trace-status">检索出错：${escapeHtml(String(err))}</p>`;
    return;
  }

  const shown = results.filter((r) => r.relevance >= RELEVANCE_SHOW_THRESHOLD);

  const groups = {};
  for (const l of LAYER_ORDER) groups[l] = [];
  for (const item of shown) {
    const rec = INDEX_BY_ID.get(item.docId);
    if (!rec || !LAYER_ORDER.includes(rec.layer)) continue; // reference-only material excluded from the lineage view
    groups[rec.layer].push({ rec, item });
  }

  const hitLayers = LAYER_ORDER.filter((l) => groups[l].some(({ item }) => item.relevance >= RELEVANCE_HIT_THRESHOLD));
  const modeNote = useFuzzy ? "（模糊匹配：按关键词共现程度排序，非逐字匹配）" : "";
  const summary =
    hitLayers.length === 0
      ? `八层文献中均未检索到与"${escapeHtml(q)}"充分相关的文字${modeNote}。`
      : `命中层级：${hitLayers.map((l) => "第" + l + "层").join("、")}；空白层级：${
          LAYER_ORDER.filter((l) => !hitLayers.includes(l)).map((l) => "第" + l + "层").join("、") || "无"
        }${modeNote}。`;

  let html = `<p class="trace-summary">${summary}</p><ol class="trace-layers">`;

  for (const layer of LAYER_ORDER) {
    const items = groups[layer].sort((a, b) => b.item.relevance - a.item.relevance);
    const isHit = items.some(({ item }) => item.relevance >= RELEVANCE_HIT_THRESHOLD);
    html += `<li class="trace-layer ${isHit ? "hit" : "empty"}">`;
    html += `<div class="trace-layer-head"><span class="trace-layer-name">${LAYER_NAMES[layer]}</span>`;
    html += `<span class="trace-layer-count">${isHit ? items.length + " 篇命中" : "空白"}</span></div>`;

    if (!isHit) {
      html += `<p class="trace-empty-note">此层未检索到与该表述充分相关的文字。这不代表该层"不谈这个道理"，只代表当前语料里没有使用足够接近的措辞——空白本身就是一种证据：它提示这个说法可能是后起的表达，而不是承自这一层的固定术语。</p>`;
    } else {
      const docLis = items.map(({ rec, item }) => {
        const rel = useFuzzy ? `<span class="relevance">匹配度 ${Math.round(item.relevance * 100)}%</span>` : "";
        const positionLis = item.matches.map((m) => {
          const href = `reader.html?id=${encodeURIComponent(rec.id)}&off=${m.offset}&len=${m.term.length}`;
          return `<li><a href="${href}">${m.juan ? `卷${escapeHtml(m.juan)} · ` : ""}${highlightTerm(m.snippet, m.term)}</a></li>`;
        });
        const positionsHtml = `<ol class="match-positions">${collapsibleItems(positionLis, 5, "处")}</ol>`;
        return `<li><div class="hit-doc"><a href="reader.html?id=${encodeURIComponent(rec.id)}">${escapeHtml(rec.title || rec.id)}</a>${rel}<span class="author">${escapeHtml(rec.author || "")}</span><span class="hit-count">${item.matches.length} 处${item.truncated ? "+" : ""}</span></div>${positionsHtml}</li>`;
      });
      html += `<ul class="trace-hits">${collapsibleItems(docLis, 5, "篇")}</ul>`;
    }
    html += `</li>`;
  }
  html += `</ol>`;
  box.innerHTML = html;
}

document.getElementById("traceBtn").addEventListener("click", () => {
  runTrace(document.getElementById("traceInput").value);
});
document.getElementById("traceInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runTrace(e.target.value);
});
