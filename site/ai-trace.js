/* AI 语义综合溯源 - calls the dhamma-trace backend (FoJin semantic search
 * + DeepSeek cross-layer synthesis). Deliberately a separate code path
 * from trace.js's exact/fuzzy bigram matching - see the note in
 * trace.html's ai-trace-section for why the two are kept visually and
 * functionally distinct. */

function renderAiTraceEntry() {
  const body = document.getElementById("aiTraceBody");
  if (!isLoggedIn()) {
    body.innerHTML = `<p class="ai-trace-status">需要<a href="login.html">登录</a>后才能使用。</p>`;
    return;
  }
  body.innerHTML = `
    <button id="aiTraceBtn" class="ai-trace-btn">对上方输入框中的内容做 AI 综合分析</button>
    <p id="aiTraceStatus" class="ai-trace-status"></p>
    <div id="aiTraceResult"></div>
  `;
  document.getElementById("aiTraceBtn").addEventListener("click", () => {
    const q = document.getElementById("traceInput").value.trim();
    if (!q) return;
    runAiTrace(q);
  });
}

/* Minimal markdown rendering for the LLM's synthesis text (### headings,
 * **bold**, plain paragraphs) - it isn't arbitrary untrusted HTML, but
 * escape first regardless since it echoes retrieved snippet text. */
function renderSynthesisMarkdown(text) {
  const lines = escapeHtml(text).split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    if (/^####\s+/.test(line)) { html += `<h5>${line.replace(/^####\s+/, "")}</h5>`; continue; }
    if (/^###\s+/.test(line)) { html += `<h4>${line.replace(/^###\s+/, "")}</h4>`; continue; }
    if (/^##\s+/.test(line)) { html += `<h3>${line.replace(/^##\s+/, "")}</h3>`; continue; }
    if (/^\*\s+/.test(line) || /^-\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${line.replace(/^[*-]\s+/, "")}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (line.trim() === "") continue;
    html += `<p>${line}</p>`;
  }
  if (inList) html += "</ul>";
  return html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

async function runAiTrace(q) {
  const status = document.getElementById("aiTraceStatus");
  const result = document.getElementById("aiTraceResult");
  document.getElementById("aiTraceBtn").disabled = true;
  status.textContent = `正在检索并请 AI 分析"${q}"，可能需要二三十秒…`;
  status.className = "ai-trace-status";
  result.innerHTML = "";

  try {
    const data = await apiFetch(`/api/dhamma/trace?q=${encodeURIComponent(q)}`);
    await renderAiTraceResult(data);
    status.textContent = data.from_cache
      ? "（命中缓存，本次未消耗额度）"
      : `本次消耗 ¥${data.charged_rmb.toFixed(4)}${
          data.remaining_balance_rmb !== null ? `，剩余额度 ¥${data.remaining_balance_rmb.toFixed(4)}` : ""
        }`;
  } catch (err) {
    if (err.status === 402) {
      status.innerHTML = `${err.message} <a href="account.html">前往账号页面</a>`;
    } else if (err.status === 429) {
      status.textContent = err.message;
    } else if (err.status === 401) {
      status.innerHTML = `登录已过期，请<a href="login.html">重新登录</a>。`;
    } else {
      status.textContent = `分析失败：${err.message}`;
    }
    status.className = "ai-trace-status error";
  } finally {
    document.getElementById("aiTraceBtn").disabled = false;
  }
}

const AI_LAYER_LABELS = Object.assign({}, LAYER_NAMES, {
  found_but_unclassified: "已收录但未分层",
  unmatched: "未匹配到分层索引",
});

/* Locates a FoJin snippet inside dhamma-lineage's own extracted fulltext
 * (data/fulltext/<id>.txt, the same file reader.js highlights against),
 * so we can deep-link to the exact spot with ?off=&len= like the existing
 * bigram trace already does. FoJin's snippet is normally a verbatim CBETA
 * excerpt, but whitespace can be normalized differently, so a couple of
 * fallback candidates are tried before giving up (in which case the link
 * still works, just without a highlighted jump target). */
const _fulltextCache = new Map();

async function fetchFulltextParagraphs(id) {
  if (_fulltextCache.has(id)) return _fulltextCache.get(id);
  const promise = fetch(`data/fulltext/${encodeURIComponent(id)}.txt`)
    .then((res) => (res.ok ? res.text() : null))
    .then((raw) => (raw ? parseFulltext(raw) : null))
    .catch(() => null);
  _fulltextCache.set(id, promise);
  return promise;
}

function findSnippetOffset(fullText, snippet) {
  const stripped = snippet.replace(/\s+/g, "");
  const candidates = [snippet, stripped];
  for (const cand of candidates) {
    if (!cand) continue;
    const idx = fullText.indexOf(cand);
    if (idx !== -1) return { offset: idx, len: cand.length };
  }
  // Snippet may be truncated right at an arbitrary character by FoJin -
  // a middle slice avoids that truncation boundary.
  if (stripped.length > 40) {
    const mid = stripped.slice(10, 40);
    const idx = fullText.indexOf(mid);
    if (idx !== -1) return { offset: idx, len: mid.length };
  }
  return null;
}

async function buildHitLink(h) {
  const base = h.dhamma_lineage_id ? `reader.html?id=${encodeURIComponent(h.dhamma_lineage_id)}` : h.cbeta_url;
  if (!h.dhamma_lineage_id) return base;
  const paragraphs = await fetchFulltextParagraphs(h.dhamma_lineage_id);
  if (!paragraphs) return base;
  const hit = findSnippetOffset(fullTextOf(paragraphs), h.snippet);
  if (!hit) return base;
  return `${base}&off=${hit.offset}&len=${hit.len}`;
}

async function renderAiTraceResult(data) {
  const result = document.getElementById("aiTraceResult");
  let html = `<div class="ai-synthesis">${renderSynthesisMarkdown(data.synthesis)}</div>`;

  html += `<details class="ai-layer-detail" open><summary>查看各层检索到的原始引用（共 ${data.hit_count} 条）</summary>`;
  const keys = [...LAYER_ORDER.map(String), "found_but_unclassified", "unmatched"];
  const allHits = [];
  for (const key of keys) {
    const hits = data.layers[key] || [];
    if (hits.length === 0) continue;
    html += `<div class="ai-layer-block" data-layer-key="${key}"><h4>${AI_LAYER_LABELS[key] || key}（${hits.length}）</h4><ul class="ai-hit-list">`;
    hits.forEach((h, i) => {
      const hitId = `ai-hit-${key}-${i}`;
      allHits.push({ hitId, h });
      html += `<li id="${hitId}"><a class="hit-link" href="#" target="_blank" rel="noopener">${escapeHtml(h.title)}</a> <span class="cbeta-id">${escapeHtml(h.cbeta_id)}</span>${h.juan_num ? `<span class="juan">卷${h.juan_num}</span>` : ""}<br>
        <mark class="snippet">${escapeHtml(h.snippet)}</mark></li>`;
    });
    html += `</ul></div>`;
  }
  html += `</details>`;

  result.innerHTML = html;

  // Resolve precise jump-to-highlight links in the background - the list
  // is fully usable (plain links) before these resolve.
  await Promise.all(
    allHits.map(async ({ hitId, h }) => {
      const link = await buildHitLink(h);
      const a = document.querySelector(`#${hitId} .hit-link`);
      if (a && link) a.href = link;
    })
  );
}

document.addEventListener("DOMContentLoaded", renderAiTraceEntry);
