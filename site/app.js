let INDEX = [];
let INDEX_BY_ID_MAP = null;
let LAYER_CARDS = null;
let V4_INDEX = [];
let SEARCH_MODE = new URLSearchParams(location.search).get("mode") || "normal";
if (!["normal", "keyword", "ai"].includes(SEARCH_MODE)) SEARCH_MODE = "normal";

const LAYER_TAGLINES = {
  1: "佛陀亲说，最原始的教法记录",
  2: "对早期经典的注释与复注，阐释经义",
  8: "依止前人教法，弘扬佛法，利益众生",
};

async function loadIndex() {
  const [indexRes, cardsRes, v4Res] = await Promise.all([
    fetch("data/index.json"),
    fetch("data/layer_cards.json"),
    fetch("data/v4-lineage-index.json"),
  ]);
  INDEX = await indexRes.json();
  const v4Payload = v4Res.ok ? await v4Res.json() : { works: [] };
  V4_INDEX = (v4Payload.works || []).map((work) => ({
    ...work,
    id: work.work_id,
    layer: Number(work.layer),
    source: "tipitaka_v4",
    layer_confidence: "high",
    layer_note: "V4 不可变三语正文；层级来自 tipitaka lineage v1 映射。",
  }));
  INDEX_BY_ID_MAP = new Map([...INDEX, ...V4_INDEX].map((r) => [r.id, r]));
  LAYER_CARDS = await cardsRes.json();
  renderHome();
}

function allRecords() {
  return [...INDEX, ...V4_INDEX];
}

function groupByLayer(records) {
  const groups = {};
  for (const l of LAYER_ORDER) groups[l] = [];
  for (const r of records) {
    if (LAYER_ORDER.includes(r.layer)) groups[r.layer].push(r);
  }
  return groups;
}

/* ---- Default homepage view: colored per-layer bands with curated
 * representative-text cards (see scripts/build_layer_cards.py). ---- */

function renderCard(card, accentVar) {
  const empty = card.count === 0;
  const cls = ["home-card", card.id === "other" ? "other" : "", empty ? "empty" : ""].filter(Boolean).join(" ");
  const el = document.createElement("div");
  el.className = cls;
  el.style.setProperty("--card-accent", `var(${accentVar})`);
  el.innerHTML = `<span>${card.label}</span><span class="card-count">${card.count} 篇</span>`;
  if (!empty) el.addEventListener("click", () => toggleDrilldown(el, card));
  return el;
}

function toggleDrilldown(cardEl, card) {
  const body = cardEl.closest(".home-band-body");
  const existing = body.querySelector(".home-drilldown");
  const already = existing && existing.dataset.cardId === card.id;
  if (existing) existing.remove();
  if (already) return;

  const panel = document.createElement("div");
  panel.className = "home-drilldown";
  panel.dataset.cardId = card.id;
  const items = card.ids
    .map((id) => INDEX_BY_ID_MAP.get(id))
    .filter(Boolean)
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", "zh-Hans-CN"));
  const listHtml = items
    .map((r) => {
      const isV4 = r.source === "tipitaka_v4";
      const href = isV4
        ? (r.reader_url || `https://bayson-create.github.io/Sutta-Study-Guide/#/tipitaka/read/${encodeURIComponent(r.id)}`)
        : `reader.html?id=${encodeURIComponent(r.id)}`;
      const source = isV4 ? '<span class="source-pill">V4 三语本</span>' : "";
      return `<li><a href="${escapeHtml(href)}"${isV4 ? ' target="_blank" rel="noopener"' : ""}>${escapeHtml(r.title || r.id)}</a>${source}</li>`;
    })
    .join("");
  panel.innerHTML = `<button class="home-drilldown-close">收起 ✕</button><h5>${card.label}（${items.length} 篇）</h5><ul class="text-list">${listHtml}</ul>`;
  panel.querySelector(".home-drilldown-close").addEventListener("click", () => panel.remove());
  body.appendChild(panel);
}

// 清淨道論 draws on layer-1/2 material more than anything else in this
// layer (closer to a "3.5th layer" bridge text), so it leads; the rest of
// what would otherwise be the plain script.py.mako order follows.
const LAYER4_ORDER = ["vimuttimagga", "abhidhammattha", "mahavibhasa", "kosa", "nyayanusara", "other"];

// 中論 and 大智度論 are both traditionally tied to Nagarjuna's circle, so
// they're grouped in one bordered pair rather than shown as two separate
// standalone cards.
const PAIRED_CARD_IDS = new Set(["madhyamaka_base", "mahaprajnaparamita_sastra"]);

function renderLayerCards(layer, accentVar) {
  let cards = LAYER_CARDS[String(layer)];
  if (!cards) return null;
  cards = cards.slice();
  if (layer === 4) {
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    cards = LAYER4_ORDER.map((id) => byId[id]).filter(Boolean);
    const v4Items = V4_INDEX.filter((r) => r.layer === 4);
    if (v4Items.length) cards.push({ id: "v4", label: "V4 三语本", count: v4Items.length, ids: v4Items.map((r) => r.id) });
  }

  const wrap = document.createElement("div");
  const groups = new Map();
  for (const c of cards) {
    const key = c.group || "__default__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  for (const [groupLabel, groupCards] of groups) {
    if (groupLabel !== "__default__") {
      const label = document.createElement("div");
      label.className = "home-cardgroup-label";
      label.textContent = groupLabel;
      wrap.appendChild(label);
    }
    const row = document.createElement("div");
    row.className = "home-cards";
    let i = 0;
    while (i < groupCards.length) {
      const c = groupCards[i];
      if (PAIRED_CARD_IDS.has(c.id) && i + 1 < groupCards.length && PAIRED_CARD_IDS.has(groupCards[i + 1].id)) {
        const pair = document.createElement("div");
        pair.className = "home-card-pair";
        pair.appendChild(renderCard(c, accentVar));
        pair.appendChild(renderCard(groupCards[i + 1], accentVar));
        row.appendChild(pair);
        i += 2;
      } else {
        row.appendChild(renderCard(c, accentVar));
        i += 1;
      }
    }
    wrap.appendChild(row);
  }
  return wrap;
}

function renderHome() {
  const main = document.getElementById("layers");
  main.innerHTML = "";
  main.className = "home-layers";
  const groups = groupByLayer(allRecords());

  for (const layer of LAYER_ORDER) {
    const items = groups[layer];
    const accentVar = `--l${layer}`;
    const bgVar = `--l${layer}-bg`;

    const band = document.createElement("div");
    band.className = "home-band";

    const label = document.createElement("div");
    label.className = "home-band-label";
    label.style.background = `var(${accentVar})`;
    const [num, short] = (LAYER_NAMES[layer] || "").split(" · ");
    label.innerHTML = `<span class="layer-num">${num}</span><span class="layer-short">${short || ""}</span>`;
    band.appendChild(label);

    const body = document.createElement("div");
    body.className = "home-band-body";
    body.style.background = `var(${bgVar})`;

    const head = document.createElement("div");
    head.className = "home-band-head";
    head.innerHTML = `<span class="card-count">${items.length} 篇</span>`;
    if (LAYER_TAGLINES[layer]) {
      const tag = document.createElement("p");
      tag.className = "home-band-tagline";
      tag.textContent = LAYER_TAGLINES[layer];
      head.appendChild(tag);
    }
    body.appendChild(head);

    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "home-band-empty";
      empty.textContent = "（空白 — 当前语料中未检索到归属此层的文本）";
      body.appendChild(empty);
    } else {
      const cardsEl = renderLayerCards(layer, accentVar);
      if (cardsEl) {
        body.appendChild(cardsEl);
      } else {
        // Keep the broad CBETA entry point, but make the immutable V4 lane
        // explicit in the first two layers so it is discoverable from the
        // directory itself, not only from search results.
        const row = document.createElement("div");
        row.className = "home-cards";
        const v4Items = (layer === 1 || layer === 2) ? V4_INDEX.filter((r) => r.layer === layer) : [];
        const localItems = v4Items.length ? items.filter((r) => r.source !== "tipitaka_v4") : items;
        row.appendChild(renderCard({ id: "all", label: v4Items.length ? "CBETA 本地文本" : "浏览全部", count: localItems.length, ids: localItems.map((r) => r.id) }, accentVar));
        if (v4Items.length) row.appendChild(renderCard({ id: `v4-${layer}`, label: "V4 三语本", count: v4Items.length, ids: v4Items.map((r) => r.id) }, accentVar));
        body.appendChild(row);
      }
    }

    band.appendChild(body);
    main.appendChild(band);
  }
}

/* ---- Search-filtered view: falls back to a plain accordion list (the
 * card layout is curated for the full corpus, not meaningful to filter
 * down to arbitrary title/author matches). ---- */

function renderFiltered(records) {
  const main = document.getElementById("layers");
  main.innerHTML = "";
  main.className = "";
  const groups = groupByLayer(records);

  for (const layer of LAYER_ORDER) {
    const items = groups[layer];
    const block = document.createElement("div");
    block.className = "layer-block open";

    const header = document.createElement("div");
    header.className = "layer-header";
    header.innerHTML = `<h2>${LAYER_NAMES[layer]}</h2><span class="layer-count">${items.length} 篇</span>`;
    header.addEventListener("click", () => block.classList.toggle("open"));

    const body = document.createElement("div");
    body.className = "layer-body";

    if (items.length === 0) {
      body.innerHTML = `<p class="empty">（无匹配）</p>`;
    } else {
      const ul = document.createElement("ul");
      ul.className = "text-list";
      items
        .sort((a, b) => (a.title || "").localeCompare(b.title || "", "zh-Hans-CN"))
        .forEach((r) => {
          const li = document.createElement("li");
          const lowConf = r.layer_confidence === "low";
          const isV4 = r.source === "tipitaka_v4";
          const href = isV4
            ? (r.reader_url || `https://bayson-create.github.io/Sutta-Study-Guide/#/tipitaka/read/${encodeURIComponent(r.id)}`)
            : `reader.html?id=${encodeURIComponent(r.id)}`;
          const source = isV4 ? '<span class="source-pill">V4 三语本</span>' : "";
          li.innerHTML = `<a class="${lowConf ? "confidence-low" : ""}" href="${escapeHtml(href)}"${isV4 ? ' target="_blank" rel="noopener"' : ""} title="${escapeHtml(r.layer_note || "")}">${escapeHtml(r.title || r.id)}</a>${source}`;
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

function setSearchMode(mode, { updateUrl = true } = {}) {
  SEARCH_MODE = ["normal", "keyword", "ai"].includes(mode) ? mode : "normal";
  document.querySelectorAll("[data-search-mode]").forEach((button) => {
    const active = button.dataset.searchMode === SEARCH_MODE;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (updateUrl) {
    const params = new URLSearchParams(location.search);
    params.set("mode", SEARCH_MODE);
    const q = document.getElementById("searchInput")?.value.trim();
    if (q) params.set("q", q); else params.delete("q");
    history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
  }
}

function clearSearchResults() {
  renderHome();
  const fulltextBox = document.getElementById("fulltextResults");
  fulltextBox.hidden = true;
  fulltextBox.innerHTML = "";
}

async function runSelectedSearch() {
  const input = document.getElementById("searchInput");
  const q = input.value.trim();
  setSearchMode(SEARCH_MODE);
  if (!q) {
    clearSearchResults();
    return;
  }

  if (SEARCH_MODE === "ai") {
    await runAiSearch(q);
    return;
  }

  // Titles/authors in the index are Traditional (the corpus is almost
  // entirely Traditional); normalize the query the same way full-text
  // search does so typing Simplified still matches.
  const qTrad = typeof toTraditional === "function" ? toTraditional(q) : q;
  const filtered = INDEX.filter(
    (r) => (r.title || "").includes(qTrad) || (r.author || "").includes(qTrad)
  );
  renderFiltered(filtered);

  if (q.length >= 2) await runFullTextSearch(q);
  else {
    fulltextBox.hidden = true;
    fulltextBox.innerHTML = "";
  }
}

document.getElementById("searchBtn").addEventListener("click", runSelectedSearch);
document.getElementById("searchInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runSelectedSearch();
  }
});
document.querySelectorAll("[data-search-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    setSearchMode(button.dataset.searchMode);
    if (document.getElementById("searchInput").value.trim()) runSelectedSearch();
  });
});

function renderLineageAiMarkdown(text) {
  const lines = escapeHtml(text || "").split("\n");
  let html = "", inList = false;
  for (const line of lines) {
    if (/^####\s+/.test(line)) { html += `<h5>${line.replace(/^####\s+/, "")}</h5>`; continue; }
    if (/^###\s+/.test(line)) { html += `<h4>${line.replace(/^###\s+/, "")}</h4>`; continue; }
    if (/^##\s+/.test(line)) { html += `<h3>${line.replace(/^##\s+/, "")}</h3>`; continue; }
    if (/^[*-]\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${line.replace(/^[*-]\s+/, "")}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (line.trim()) html += `<p>${line}</p>`;
  }
  if (inList) html += "</ul>";
  return html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

const aiFulltextCache = new Map();
async function aiFetchFulltext(id) {
  if (aiFulltextCache.has(id)) return aiFulltextCache.get(id);
  const promise = fetch(`data/fulltext/${encodeURIComponent(id)}.txt`)
    .then((response) => response.ok ? response.text() : null)
    .then((raw) => raw ? parseFulltext(raw) : null)
    .catch(() => null);
  aiFulltextCache.set(id, promise);
  return promise;
}

function aiFindOffset(fullText, snippet) {
  const clean = String(snippet || "").replace(/\s+/g, "");
  for (const candidate of [String(snippet || ""), clean, clean.slice(10, 40)]) {
    if (!candidate) continue;
    const offset = fullText.indexOf(candidate);
    if (offset !== -1) return { offset, len: candidate.length };
  }
  return null;
}

async function aiHitHref(hit) {
  if (hit.reader_url) return hit.reader_url;
  const id = hit.dhamma_lineage_id;
  if (!id) return hit.cbeta_url || "#";
  const base = `reader.html?id=${encodeURIComponent(id)}`;
  const paragraphs = await aiFetchFulltext(id);
  if (!paragraphs) return base;
  const match = aiFindOffset(fullTextOf(paragraphs), hit.snippet);
  return match ? `${base}&off=${match.offset}&len=${match.len}` : base;
}

const AI_LAYER_LABELS = Object.assign({}, LAYER_NAMES, {
  found_but_unclassified: "已收录但未分层",
  unmatched: "未匹配到分层索引",
});

async function renderAiSearch(data, query) {
  const box = document.getElementById("fulltextResults");
  const keys = [...LAYER_ORDER.map(String), "found_but_unclassified", "unmatched"];
  const hits = [];
  let html = `<section class="lineage-ai-results"><h2 class="fulltext-heading">AI 语义综合：${escapeHtml(query)}</h2><div class="ai-synthesis">${renderLineageAiMarkdown(data.synthesis || "")}</div>`;
  html += `<details class="ai-layer-detail" open><summary>查看分层检索证据（共 ${Number(data.hit_count || 0)} 条）</summary>`;
  for (const key of keys) {
    const layerHits = data.layers?.[key] || [];
    if (!layerHits.length) continue;
    html += `<div class="ai-layer-block"><h4>${escapeHtml(AI_LAYER_LABELS[key] || key)}（${layerHits.length}）</h4><ul class="ai-hit-list">`;
    layerHits.forEach((hit, index) => {
      const hitId = `lineage-ai-hit-${key}-${index}`;
      const isV4 = hit.source_type === "tipitaka_v4" || !!hit.reader_url;
      const sourceLabel = isV4 ? "V4 三语本" : "CBETA";
      hits.push({ hitId, hit });
      html += `<li id="${hitId}"><a class="hit-link" href="#" target="_blank" rel="noopener">${escapeHtml(hit.title || hit.cbeta_id || "来源")}</a> <span class="source-pill">${sourceLabel}</span>${hit.paranum ? `<span class="juan">${escapeHtml(hit.paranum)}</span>` : ""}<p><mark class="snippet">${escapeHtml(hit.snippet || "")}</mark></p></li>`;
    });
    html += "</ul></div>";
  }
  html += "</details></section>";
  box.innerHTML = html;
  await Promise.all(hits.map(async ({ hitId, hit }) => {
    const link = await aiHitHref(hit);
    const anchor = document.querySelector(`#${hitId} .hit-link`);
    if (anchor && link && link !== "#") anchor.href = link;
  }));
}

async function runAiSearch(q) {
  const mySeq = ++searchSeq;
  const box = document.getElementById("fulltextResults");
  box.hidden = false;
  box.innerHTML = `<p class="fulltext-status">正在检索各层证据并生成综合回答“${escapeHtml(q)}”…</p>`;
  if (!isLoggedIn()) {
    box.innerHTML += `<p class="fulltext-status">AI 语义综合需要<a href="login.html">登录</a>；普通搜索与关键词溯源无需登录。</p>`;
    return;
  }
  try {
    const data = await apiFetch(`/api/dhamma/trace?q=${encodeURIComponent(q)}`);
    if (mySeq !== searchSeq) return;
    await renderAiSearch(data, q);
  } catch (error) {
    if (mySeq !== searchSeq) return;
    if (error.status === 402) box.innerHTML = `<p class="fulltext-status">${escapeHtml(error.message)} <a href="account.html">前往账号页面</a></p>`;
    else if (error.status === 401) box.innerHTML = `<p class="fulltext-status">登录已过期，请<a href="login.html">重新登录</a>。</p>`;
    else box.innerHTML = `<p class="fulltext-status">AI 语义综合暂时不可用：${escapeHtml(error.message)}</p>`;
  }
}

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
      if (window.V4LineageSearch) window.V4LineageSearch.renderInto(q, box);
      return;
    }
    box.innerHTML = `<p class="fulltext-status">CBETA 正文暂时不可用：${escapeHtml(String(err))}</p>`;
    if (window.V4LineageSearch) window.V4LineageSearch.renderInto(q, box);
    return;
  }
  if (mySeq !== searchSeq) return; // a newer keystroke superseded this search

  if (results.length === 0 && SEARCH_MODE !== "keyword") {
    box.innerHTML = `<p class="fulltext-status">CBETA 正文中未检索到与"${escapeHtml(q)}"相关的内容。</p>`;
    if (window.V4LineageSearch) window.V4LineageSearch.renderInto(q, box);
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
  if (SEARCH_MODE === "keyword") {
    let keywordHtml = `<div class="keyword-trace-summary"><strong>关键词命中</strong>：按字面精确/模糊匹配逐层展示；空白层级只表示当前 CBETA 词面未命中，不等于该层没有相关思想。</div>`;
    for (const layer of [...LAYER_ORDER, 0]) {
      const items = groups[layer];
      const label = layer === 0 ? "未归入八层 · 参考资料" : LAYER_NAMES[layer];
      const isHit = items.length > 0;
      keywordHtml += `<div class="layer-block ${isHit ? "open" : ""}"><div class="layer-header"><h2>${label}</h2><span class="layer-count">${isHit ? `${items.length} 篇命中` : "空白"}</span></div><div class="layer-body">`;
      if (!isHit) {
        keywordHtml += `<p class="empty">此层当前没有足够接近的字面命中。</p>`;
      } else {
        const docLis = items.map(({ rec, item }) => {
          const rel = mode === "fuzzy" ? `<span class="relevance">匹配度 ${Math.round(item.relevance * 100)}%</span>` : "";
          const positionLis = item.matches.map((m) => {
            const href = `reader.html?id=${encodeURIComponent(rec.id)}&off=${m.offset}&len=${m.term.length}`;
            return `<li><a href="${href}">${m.juan ? `卷${escapeHtml(m.juan)} · ` : ""}${highlightTerm(m.snippet, m.term)}</a></li>`;
          });
          return `<li><div class="hit-doc"><a href="reader.html?id=${encodeURIComponent(rec.id)}">${escapeHtml(rec.title || rec.id)}</a><span class="source-pill">CBETA</span>${rel}<span class="hit-count">${item.matches.length} 处${item.truncated ? "+" : ""}</span></div><ol class="match-positions">${collapsibleItems(positionLis, 5, "处")}</ol></li>`;
        });
        keywordHtml += `<ul class="fulltext-list">${collapsibleItems(docLis, 5, "篇")}</ul>`;
      }
      keywordHtml += "</div></div>";
    }
    box.innerHTML = keywordHtml;
    if (window.V4LineageSearch) window.V4LineageSearch.renderInto(q, box);
    return;
  }
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
  if (window.V4LineageSearch) window.V4LineageSearch.renderInto(q, box);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
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

loadIndex().then(() => {
  setSearchMode(SEARCH_MODE, { updateUrl: false });
  const params = new URLSearchParams(location.search);
  const q = params.get("q") || "";
  if (q) {
    document.getElementById("searchInput").value = q;
    runSelectedSearch();
  }
});
