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
    renderAiTraceResult(data);
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

function renderAiTraceResult(data) {
  const result = document.getElementById("aiTraceResult");
  let html = `<div class="ai-synthesis">${renderSynthesisMarkdown(data.synthesis)}</div>`;

  html += `<details class="ai-layer-detail"><summary>查看各层检索到的原始引用（共 ${data.hit_count} 条）</summary>`;
  const keys = [...LAYER_ORDER.map(String), "found_but_unclassified", "unmatched"];
  for (const key of keys) {
    const hits = data.layers[key] || [];
    if (hits.length === 0) continue;
    html += `<div class="ai-layer-block"><h4>${AI_LAYER_LABELS[key] || key}（${hits.length}）</h4><ul class="ai-hit-list">`;
    for (const h of hits) {
      const link = h.dhamma_lineage_id
        ? `reader.html?id=${encodeURIComponent(h.dhamma_lineage_id)}`
        : h.cbeta_url;
      const title = link
        ? `<a href="${link}" target="_blank" rel="noopener">${escapeHtml(h.title)}</a>`
        : escapeHtml(h.title);
      html += `<li>${title} <span class="cbeta-id">${escapeHtml(h.cbeta_id)}</span><br>
        <span class="snippet">${escapeHtml(h.snippet).slice(0, 120)}…</span></li>`;
    }
    html += `</ul></div>`;
  }
  html += `</details>`;

  result.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", renderAiTraceEntry);
