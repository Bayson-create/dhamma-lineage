let INDEX = [];

async function loadIndex() {
  const res = await fetch("data/index.json");
  INDEX = await res.json();
  render(INDEX);
}

function groupByLayer(records) {
  const groups = {};
  for (const l of LAYER_ORDER) groups[l] = [];
  for (const r of records) {
    if (LAYER_ORDER.includes(r.layer)) groups[r.layer].push(r);
  }
  return groups;
}

function render(records) {
  const main = document.getElementById("layers");
  main.innerHTML = "";
  const groups = groupByLayer(records);

  for (const layer of LAYER_ORDER) {
    const items = groups[layer];
    const block = document.createElement("div");
    block.className = "layer-block";

    const header = document.createElement("div");
    header.className = "layer-header";
    header.innerHTML = `<h2>${LAYER_NAMES[layer]}</h2><span class="layer-count">${items.length} 篇</span>`;
    header.addEventListener("click", () => block.classList.toggle("open"));

    const body = document.createElement("div");
    body.className = "layer-body";

    if (items.length === 0) {
      body.innerHTML = `<p class="empty">（空白 — 当前语料中未检索到归属此层的文本）</p>`;
    } else {
      const ul = document.createElement("ul");
      ul.className = "text-list";
      items
        .sort((a, b) => (a.title || "").localeCompare(b.title || "", "zh-Hans-CN"))
        .forEach((r) => {
          const li = document.createElement("li");
          const lowConf = r.layer_confidence === "low";
          li.innerHTML = `<a class="${lowConf ? "confidence-low" : ""}" href="reader.html?id=${encodeURIComponent(r.id)}" title="${r.layer_note || ""}">${r.title || r.id}</a>`;
          ul.appendChild(li);
        });
      body.appendChild(ul);
    }

    block.appendChild(header);
    block.appendChild(body);
    main.appendChild(block);
  }
}

let searchSeq = 0;

document.getElementById("searchInput").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  const fulltextBox = document.getElementById("fulltextResults");

  if (!q) {
    render(INDEX);
    fulltextBox.hidden = true;
    fulltextBox.innerHTML = "";
    return;
  }

  const filtered = INDEX.filter(
    (r) => (r.title || "").includes(q) || (r.author || "").includes(q)
  );
  render(filtered);
  document.querySelectorAll(".layer-block").forEach((b) => {
    if (b.querySelector(".text-list")) b.classList.add("open");
  });

  if (q.length >= 2) runFullTextSearch(q);
  else {
    fulltextBox.hidden = true;
    fulltextBox.innerHTML = "";
  }
});

// Short queries (single terms, technical vocabulary like "四念處") use
// exact substring search. Longer input - a full sentence, a question, a
// stated opinion - uses the fuzzy bigram-coverage search instead, since
// requiring that exact wording to appear verbatim in classical Chinese
// would almost always return nothing.
const FUZZY_THRESHOLD_LEN = 6;

async function runFullTextSearch(q) {
  const mySeq = ++searchSeq;
  const box = document.getElementById("fulltextResults");
  box.hidden = false;
  box.innerHTML = `<p class="fulltext-status">正文检索"${escapeHtml(q)}"中…</p>`;

  const useFuzzy = q.length > FUZZY_THRESHOLD_LEN;
  let results;
  let mode = useFuzzy ? "fuzzy" : "exact";
  try {
    results = useFuzzy
      ? await fuzzySentenceSearch(q, { limit: 200 })
      : await fullTextSearch(q, { limit: 200 });
    if (!useFuzzy && results.length === 0) {
      // an exact phrase with no verbatim hits still deserves a fuzzy pass
      results = await fuzzySentenceSearch(q, { limit: 200 });
      mode = "fuzzy";
    }
  } catch (err) {
    if (mySeq !== searchSeq) return;
    if (err.code === "NO_INFORMATIVE_TERMS") {
      box.innerHTML = `<p class="fulltext-status">"${escapeHtml(q)}"里没有可用于检索的常见词组，换个说法试试。</p>`;
      return;
    }
    box.innerHTML = `<p class="fulltext-status">正文检索出错：${escapeHtml(String(err))}</p>`;
    return;
  }
  if (mySeq !== searchSeq) return; // a newer keystroke superseded this search

  if (results.length === 0) {
    box.innerHTML = `<p class="fulltext-status">正文中未检索到与"${escapeHtml(q)}"相关的内容。</p>`;
    return;
  }

  const byId = new Map(INDEX.map((r) => [r.id, r]));
  const groups = {};
  for (const l of LAYER_ORDER) groups[l] = [];
  groups[0] = []; // unmapped / reference material

  for (const item of results) {
    const rec = byId.get(item.docId);
    if (!rec) continue;
    const layer = LAYER_ORDER.includes(rec.layer) ? rec.layer : 0;
    groups[layer].push({ rec, item });
  }

  const modeLabel = mode === "fuzzy" ? "模糊匹配（按关键词覆盖度排序）" : "精确匹配";
  const totalMatches = results.reduce((s, r) => s + r.matches.length, 0);
  let html = `<h2 class="fulltext-heading">正文检索结果："${escapeHtml(q)}"（${results.length} 篇命中，共 ${totalMatches} 处匹配位置，${modeLabel}，按层分组，全部列出）</h2>`;
  for (const layer of [...LAYER_ORDER, 0]) {
    const items = groups[layer];
    if (items.length === 0) continue;
    const label = layer === 0 ? "未归入八层 · 参考资料" : LAYER_NAMES[layer];
    const docLis = items.map(({ rec, item }) => {
      const rel = mode === "fuzzy" ? `<span class="relevance">匹配度 ${Math.round(item.relevance * 100)}%</span>` : "";
      const positionLis = item.matches.map((m) => {
        const href = `reader.html?id=${encodeURIComponent(rec.id)}&off=${m.offset}&len=${m.term.length}`;
        return `<li><a href="${href}">${m.juan ? `卷${escapeHtml(m.juan)} · ` : ""}${highlightTerm(m.snippet, m.term)}</a></li>`;
      });
      const positionsHtml = `<ol class="match-positions">${collapsibleItems(positionLis, 5, "处")}</ol>`;
      return `<li><div class="hit-doc"><a href="reader.html?id=${encodeURIComponent(rec.id)}">${escapeHtml(rec.title || rec.id)}</a>${rel}<span class="hit-count">${item.matches.length} 处${item.truncated ? "+" : ""}</span></div>${positionsHtml}</li>`;
    });
    html += `<div class="fulltext-group"><h3>${label}（${items.length}）</h3><ul class="fulltext-list">${collapsibleItems(docLis, 5, "篇")}</ul></div>`;
  }
  box.innerHTML = html;
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

loadIndex();
