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

async function runTrace(query) {
  const box = document.getElementById("traceResult");
  const q = query.trim();
  if (!q) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `<p class="trace-status">正在逐层检索"${escapeHtml(q)}"…</p>`;

  await ensureIndex();

  let results;
  try {
    results = await fullTextSearch(q, { limit: 300 });
  } catch (err) {
    box.innerHTML = `<p class="trace-status">检索出错：${escapeHtml(String(err))}</p>`;
    return;
  }

  const groups = {};
  for (const l of LAYER_ORDER) groups[l] = [];
  for (const { docId, snippet } of results) {
    const rec = INDEX_BY_ID.get(docId);
    if (!rec || !LAYER_ORDER.includes(rec.layer)) continue; // reference-only material excluded from the lineage view
    groups[rec.layer].push({ rec, snippet });
  }

  const hitLayers = LAYER_ORDER.filter((l) => groups[l].length > 0);
  const summary =
    hitLayers.length === 0
      ? `八层文献中均未检索到"${escapeHtml(q)}"的精确文字匹配。`
      : `命中层级：${hitLayers.map((l) => "第" + l + "层").join("、")}；空白层级：${
          LAYER_ORDER.filter((l) => !hitLayers.includes(l)).map((l) => "第" + l + "层").join("、") || "无"
        }。`;

  let html = `<p class="trace-summary">${summary}</p><ol class="trace-layers">`;

  for (const layer of LAYER_ORDER) {
    const items = groups[layer];
    html += `<li class="trace-layer ${items.length ? "hit" : "empty"}">`;
    html += `<div class="trace-layer-head"><span class="trace-layer-name">${LAYER_NAMES[layer]}</span>`;
    html += `<span class="trace-layer-count">${items.length ? items.length + " 篇命中" : "空白"}</span></div>`;

    if (items.length === 0) {
      html += `<p class="trace-empty-note">此层未检索到与该表述精确匹配的文字。这不代表该层"不谈这个道理"，只代表当前语料里没有使用完全相同的措辞——空白本身就是一种证据：它提示这个说法可能是后起的表达，而不是承自这一层的固定术语。</p>`;
    } else {
      html += `<ul class="trace-hits">`;
      for (const { rec, snippet } of items.slice(0, 8)) {
        html += `<li><a href="reader.html?id=${encodeURIComponent(rec.id)}">${escapeHtml(rec.title || rec.id)}</a>`;
        html += `<span class="author">${escapeHtml(rec.author || "")}</span>`;
        html += `<span class="snippet">${escapeHtml(snippet)}</span></li>`;
      }
      if (items.length > 8) html += `<li class="more">…另有 ${items.length - 8} 篇命中，未全部列出</li>`;
      html += `</ul>`;
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
