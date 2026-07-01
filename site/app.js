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

async function runFullTextSearch(q) {
  const mySeq = ++searchSeq;
  const box = document.getElementById("fulltextResults");
  box.hidden = false;
  box.innerHTML = `<p class="fulltext-status">正文检索"${escapeHtml(q)}"中…</p>`;

  let results;
  try {
    results = await fullTextSearch(q, { limit: 200 });
  } catch (err) {
    if (mySeq !== searchSeq) return;
    box.innerHTML = `<p class="fulltext-status">正文检索出错：${escapeHtml(String(err))}</p>`;
    return;
  }
  if (mySeq !== searchSeq) return; // a newer keystroke superseded this search

  if (results.length === 0) {
    box.innerHTML = `<p class="fulltext-status">正文中未检索到"${escapeHtml(q)}"。</p>`;
    return;
  }

  const byId = new Map(INDEX.map((r) => [r.id, r]));
  const groups = {};
  for (const l of LAYER_ORDER) groups[l] = [];
  groups[0] = []; // unmapped / reference material

  for (const { docId, snippet } of results) {
    const rec = byId.get(docId);
    if (!rec) continue;
    const layer = LAYER_ORDER.includes(rec.layer) ? rec.layer : 0;
    groups[layer].push({ rec, snippet });
  }

  let html = `<h2 class="fulltext-heading">正文检索结果："${escapeHtml(q)}"（${results.length} 处命中，按层分组）</h2>`;
  for (const layer of [...LAYER_ORDER, 0]) {
    const items = groups[layer];
    if (items.length === 0) continue;
    const label = layer === 0 ? "未归入八层 · 参考资料" : LAYER_NAMES[layer];
    html += `<div class="fulltext-group"><h3>${label}（${items.length}）</h3><ul class="fulltext-list">`;
    for (const { rec, snippet } of items) {
      html += `<li><a href="reader.html?id=${encodeURIComponent(rec.id)}">${escapeHtml(rec.title || rec.id)}</a><span class="snippet">${escapeHtml(snippet)}</span></li>`;
    }
    html += `</ul></div>`;
  }
  box.innerHTML = html;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

loadIndex();
