let INDEX = [];
let INDEX_BY_ID_MAP = null;
let LAYER_CARDS = null;
let V4_INDEX = [];
let MODERN_INDEX = [];
let MODERN_ACCESS = false;
let MODERN_ERROR = '';
let SEARCH_MODE = new URLSearchParams(location.search).get("mode") || "normal";
if (!["normal", "keyword", "ai"].includes(SEARCH_MODE)) SEARCH_MODE = "normal";
const displaySimplified = (value) => typeof toSimplified === "function" ? toSimplified(String(value ?? "")) : String(value ?? "");

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
    layer_note: "V4 不可变三语正文；层级来自 tipitaka lineage v2 映射。",
  }));
  LAYER_CARDS = await cardsRes.json();
  await loadModernTheravadaCatalog();
  INDEX_BY_ID_MAP = new Map([...INDEX, ...V4_INDEX, ...MODERN_INDEX].map((r) => [r.id, r]));
  renderHome();
}

async function loadModernTheravadaCatalog() {
  MODERN_INDEX = [];
  MODERN_ACCESS = false;
  MODERN_ERROR = '';
  if (typeof isLoggedIn !== 'function' || !isLoggedIn()) return;
  try {
    const access = await apiFetch('/api/research/modern-theravada/access');
    if (!access?.allowed) return;
    const catalog = await apiFetch('/api/research/modern-theravada/catalog');
    MODERN_ACCESS = true;
    MODERN_INDEX = (catalog.works || []).map((work) => ({
      id: `modern-theravada:${work.id}`,
      private_work_id: work.id,
      title: work.title || work.id,
      author: work.author || '',
      collection: work.collection || 'modern',
      page_count: work.page_count || 0,
      record_count: work.record_count || 0,
      layer: 8,
      source: 'modern_theravada',
      layer_confidence: 'high',
    }));
  } catch (error) {
    if (error?.status !== 401 && error?.status !== 403) MODERN_ERROR = error?.message || String(error);
  }
}

async function searchModernPrivate(query, cursor = null) {
  if (!MODERN_ACCESS) return { results: [], total: 0, next_cursor: null, allowed: false };
  const params = new URLSearchParams({ q: query, page_size: '40' });
  if (cursor) params.set('cursor', cursor);
  try {
    const data = await apiFetch(`/api/research/modern-theravada/search?${params.toString()}`);
    return { ...data, allowed: true, error: null };
  } catch (error) {
    return { results: [], total: 0, next_cursor: null, allowed: true, error: error.message };
  }
}

function metadataNeedle(value) {
  return String(value || '').replace(/\s+/g, '').toLocaleLowerCase();
}

function metadataVariants(value) {
  const raw = String(value || '');
  return [...new Set([raw, toTraditional(raw), displaySimplified(raw)].map(metadataNeedle).filter(Boolean))];
}

function titleAuthorMatches(query) {
  const needles = metadataVariants(query);
  if (!needles.length) return [];
  return allRecords().flatMap((rec) => {
    const fields = [];
    const title = metadataNeedle(rec.title);
    const author = metadataNeedle(rec.author);
    const path = metadataNeedle(Array.isArray(rec.path) ? rec.path.join(' / ') : rec.path);
    if (needles.some((needle) => title.includes(needle))) fields.push('经名');
    if (needles.some((needle) => path.includes(needle))) fields.push('目录');
    if (needles.some((needle) => author.includes(needle))) fields.push('作者');
    return fields.length ? [{ rec, matchFields: [...new Set(fields)] }] : [];
  });
}

function mergeTitleAuthorMatches(localGroups, v4Run, modernRun, matches) {
  const seenLocal = new Set(Object.values(localGroups).flat().map(({ rec }) => rec?.id));
  for (const { rec, matchFields } of matches) {
    if (rec.source === 'tipitaka_v4') {
      const page = v4Run.layers?.[String(rec.layer)] || v4Run.layers?.[rec.layer];
      if (!page) continue;
      const existing = page.results.find((item) => item.work_id === rec.id);
      if (!existing) {
        page.results.unshift({
          ...rec,
          work_id: rec.id,
          lineage_layer: rec.layer,
          titleMatch: true,
          titleMatchOnly: true,
          matchFields,
          reader_url: rec.reader_url,
        });
        page.total = Number(page.total || 0) + 1;
      } else {
        existing.matchFields = [...new Set([...(existing.matchFields || []), ...matchFields])];
      }
      continue;
    }
    if (rec.source === 'modern_theravada') {
      if (!modernRun || !MODERN_ACCESS) continue;
      const existing = modernRun.results.find((item) => item.work_id === rec.private_work_id);
      if (!existing) {
        modernRun.results.unshift({ ...rec, work_id: rec.private_work_id, titleMatch: true, titleMatchOnly: true, matchFields });
        modernRun.total = Number(modernRun.total || 0) + 1;
      } else {
        existing.matchFields = [...new Set([...(existing.matchFields || []), ...matchFields])];
      }
      continue;
    }
    if (seenLocal.has(rec.id)) {
      const current = Object.values(localGroups).flat().find(({ rec: item }) => item?.id === rec.id);
      if (current) current.item.matchFields = [...new Set([...(current.item.matchFields || []), ...matchFields])];
      continue;
    }
    const layer = LAYER_ORDER.includes(rec.layer) ? rec.layer : 0;
    localGroups[layer].unshift({ rec, item: { matches: [], titleMatch: true, matchFields, relevance: 1 } });
    seenLocal.add(rec.id);
  }
}

function allRecords() {
  return [...INDEX, ...V4_INDEX, ...MODERN_INDEX];
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
  el.innerHTML = `<span>${escapeHtml(displaySimplified(card.label))}</span><span class="card-count">${card.count} 篇</span>`;
  if (!empty) el.addEventListener("click", () => toggleDrilldown(el, card));
  return el;
}

function renderExternalCard(label, href) {
  const el = document.createElement("a");
  el.className = "home-card home-card-external";
  el.href = href;
  el.target = "_blank";
  el.rel = "noopener";
  el.innerHTML = `<span>${escapeHtml(displaySimplified(label))}</span><span class="card-count">外部站点</span>`;
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
      const isModern = r.source === "modern_theravada";
      const href = isV4
        ? (r.reader_url || `https://bayson-create.github.io/Sutta-Study-Guide/#/tipitaka/read/${encodeURIComponent(r.id)}`)
        : isModern
          ? `https://bayson-create.github.io/Sutta-Study-Guide/#/research/modern-theravada/read/${encodeURIComponent(r.private_work_id)}`
        : `reader.html?id=${encodeURIComponent(r.id)}`;
      const source = isV4 ? '<span class="source-pill">V4 三语本</span>' : isModern ? '<span class="source-pill">现代上座部</span>' : "";
      const tradition = r.lineage_tradition ? `<span class="lineage-tag">${escapeHtml(displaySimplified(r.lineage_tradition))}</span>` : "";
      const textType = r.lineage_text_type ? `<span class="lineage-tag">${escapeHtml(displaySimplified(r.lineage_text_type))}</span>` : "";
      return `<li><a href="${escapeHtml(href)}"${isV4 || isModern ? ' target="_blank" rel="noopener"' : ""} title="${escapeHtml(displaySimplified(r.lineage_evidence || r.layer_note || ""))}">${escapeHtml(displaySimplified(r.title || r.id))}</a>${source}${tradition}${textType}</li>`;
    })
    .join("");
  panel.innerHTML = `<button class="home-drilldown-close">收起 ✕</button><h5>${card.label}（${items.length} 篇）</h5><ul class="text-list">${listHtml}</ul>`;
  panel.querySelector(".home-drilldown-close").addEventListener("click", () => panel.remove());
  body.appendChild(panel);
}

// 清淨道論 draws on layer-1/2 material more than anything else in this
// layer (closer to a "3.5th layer" bridge text), so it leads; the rest of
// what would otherwise be the plain script.py.mako order follows.
const LAYER4_ORDER = ["vimuttimagga", "mahavibhasa", "kosa", "nyayanusara", "other"];

// 中論 and 大智度論 are both traditionally tied to Nagarjuna's circle, so
// they're grouped in one bordered pair rather than shown as two separate
// standalone cards.
const PAIRED_CARD_IDS = new Set(["madhyamaka_base", "mahaprajnaparamita_sastra"]);

function renderLayerCards(layer, accentVar) {
  let cards = LAYER_CARDS[String(layer)];
  if (!cards && layer !== 8) return null;
  cards = (cards || []).slice();
  if (layer === 3 || layer === 4) {
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    cards = layer === 4 ? LAYER4_ORDER.map((id) => byId[id]).filter(Boolean) : cards;
    const v4Items = V4_INDEX.filter((r) => r.layer === layer);
    if (v4Items.length) cards.push({ id: "v4", label: layer === 3 ? "V4 上座部阿毗达磨" : "V4 三语本", count: v4Items.length, ids: v4Items.map((r) => r.id) });
  }

  // Keep the existing public modern-teacher entry separate from the
  // permission-gated modern Theravada catalog. The public records remain in
  // the CBETA index; only the latter depends on authorization.
  if (layer === 8) {
    const publicItems = INDEX.filter((r) => Number(r.layer) === 8 && r.source !== "modern_theravada");
    if (publicItems.length && !cards.some((card) => card.id === "modern-public")) {
      cards.unshift({ id: "modern-public", label: "现代法师", count: publicItems.length, ids: publicItems.map((r) => r.id) });
    }
    if (MODERN_INDEX.length && !cards.some((card) => card.id === 'modern-theravada')) {
      cards.push({ id: 'modern-theravada', label: '现代上座部', count: MODERN_INDEX.length, ids: MODERN_INDEX.map((r) => r.id) });
    }
  }

  // Generated metadata may contain empty placeholders. Remove them before
  // grouping so a zero-count academic-review card takes no space.
  cards = cards.filter((card) => Number(card.count || 0) > 0);
  if (!cards.length) return null;

  const wrap = document.createElement("div");
  const groups = new Map();
  for (const c of cards) {
    const key = c.group || "__default__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  let lastRow = null;
  const pendingCards = [];
  const groupOrder = layer === 7 ? ["哲学体系", "宗派体系", "补充传统", "__default__"] : Array.from(groups.keys());
  for (const groupLabel of groupOrder) {
    const groupCards = groups.get(groupLabel);
    if (!groupCards) continue;
    const visibleCards = groupCards.filter((card) => card.id !== "pending_review" && card.label !== "待学术复核");
    pendingCards.push(...groupCards.filter((card) => card.id === "pending_review" || card.label === "待学术复核"));
    if (!visibleCards.length) continue;
    if (groupLabel !== "__default__") {
      const label = document.createElement("div");
      label.className = "home-cardgroup-label";
      label.textContent = groupLabel;
      wrap.appendChild(label);
    }
    const row = document.createElement("div");
    row.className = "home-cards";
    lastRow = row;
    let i = 0;
    while (i < visibleCards.length) {
      const c = visibleCards[i];
      if (PAIRED_CARD_IDS.has(c.id) && i + 1 < visibleCards.length && PAIRED_CARD_IDS.has(visibleCards[i + 1].id)) {
        const pair = document.createElement("div");
        pair.className = "home-card-pair";
        pair.appendChild(renderCard(c, accentVar));
        pair.appendChild(renderCard(visibleCards[i + 1], accentVar));
        row.appendChild(pair);
        i += 2;
      } else {
        row.appendChild(renderCard(c, accentVar));
        i += 1;
      }
    }
    wrap.appendChild(row);
  }
  if (pendingCards.length) {
    if (!lastRow) {
      lastRow = document.createElement("div");
      lastRow.className = "home-cards";
      wrap.appendChild(lastRow);
    }
    pendingCards.forEach((card) => lastRow.appendChild(renderCard(card, accentVar)));
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
    label.innerHTML = `<span class="layer-num">${escapeHtml(displaySimplified(num))}</span><span class="layer-short">${escapeHtml(displaySimplified(short || ""))}</span>`;
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
      tag.textContent = displaySimplified(LAYER_TAGLINES[layer]);
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
        const localItems = v4Items.length ? items.filter((r) => r.source !== "tipitaka_v4") : items.filter((r) => r.source !== "modern_theravada");
        const localLabel = layer === 8 ? "现代法师" : (v4Items.length ? "CBETA 本地文本" : "浏览全部");
        row.appendChild(renderCard({ id: "all", label: localLabel, count: localItems.length, ids: localItems.map((r) => r.id) }, accentVar));
        if (v4Items.length) row.appendChild(renderCard({ id: `v4-${layer}`, label: "V4 三语本", count: v4Items.length, ids: v4Items.map((r) => r.id) }, accentVar));
        if (layer === 1) row.appendChild(renderExternalCard("早期佛教研究站点 ↗", "https://bayson-create.github.io/Early-Buddhist/"));
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
    header.innerHTML = `<h2>${escapeHtml(displaySimplified(LAYER_NAMES[layer]))}</h2><span class="layer-count">${items.length} 篇</span>`;
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
          const isModern = r.source === "modern_theravada";
          const href = isV4
            ? (r.reader_url || `https://bayson-create.github.io/Sutta-Study-Guide/#/tipitaka/read/${encodeURIComponent(r.id)}`)
            : isModern
              ? `https://bayson-create.github.io/Sutta-Study-Guide/#/research/modern-theravada/read/${encodeURIComponent(r.private_work_id)}`
            : `reader.html?id=${encodeURIComponent(r.id)}`;
          const source = isV4 ? '<span class="source-pill">V4 三语本</span>' : isModern ? '<span class="source-pill">现代上座部</span>' : "";
          const tradition = r.lineage_tradition ? `<span class="lineage-tag">${escapeHtml(displaySimplified(r.lineage_tradition))}</span>` : "";
          const textType = r.lineage_text_type ? `<span class="lineage-tag">${escapeHtml(displaySimplified(r.lineage_text_type))}</span>` : "";
          const matchLabel = r._matchFields?.length ? `<span class="hit-count">${escapeHtml(r._matchFields.join('／'))}命中</span>` : "";
          li.innerHTML = `<a class="${lowConf ? "confidence-low" : ""}" href="${escapeHtml(href)}"${isV4 || isModern ? ' target="_blank" rel="noopener"' : ""} title="${escapeHtml(displaySimplified(r.lineage_evidence || r.layer_note || ""))}">${escapeHtml(displaySimplified(r.title || r.id))}</a>${source}${matchLabel}${tradition}${textType}`;
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

  const filtered = titleAuthorMatches(q).map(({ rec, matchFields }) => ({ ...rec, _matchFields: matchFields }));
  if (q.length >= 2) {
    document.getElementById("layers").innerHTML = "";
    await runFullTextSearch(q);
  } else {
    renderFiltered(filtered);
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
  const lines = escapeHtml(displaySimplified(text || "")).split("\n");
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
    html += `<div class="ai-layer-block"><h4>${escapeHtml(displaySimplified(AI_LAYER_LABELS[key] || key))}（${layerHits.length}）</h4><ul class="ai-hit-list">`;
    layerHits.forEach((hit, index) => {
      const hitId = `lineage-ai-hit-${key}-${index}`;
      const isV4 = hit.source_type === "tipitaka_v4" || !!hit.reader_url;
      const sourceLabel = isV4 ? "V4 三语本" : "CBETA";
      hits.push({ hitId, hit });
      html += `<li id="${hitId}"><a class="hit-link" href="#" target="_blank" rel="noopener">${escapeHtml(displaySimplified(hit.title || hit.cbeta_id || "来源"))}</a> <span class="source-pill">${sourceLabel}</span>${hit.paranum ? `<span class="juan">${escapeHtml(displaySimplified(hit.paranum))}</span>` : ""}<p><mark class="snippet">${escapeHtml(displaySimplified(hit.snippet || ""))}</mark></p></li>`;
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

function emptyLayerGroups() {
  const groups = {};
  for (const layer of LAYER_ORDER) groups[layer] = [];
  groups[0] = [];
  return groups;
}

function v4HighlightSnippet(item, query) {
  const text = displaySimplified(item.snippet || item.text || '');
  const terms = [...new Set([...(item.matched_terms || []), query].map(displaySimplified).map(String).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return `<mark>${escapeHtml(text.slice(0, 220))}</mark>`;
  const matcher = new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
  let html = '', last = 0, match;
  while ((match = matcher.exec(text))) {
    html += escapeHtml(text.slice(last, match.index));
    html += `<mark>${escapeHtml(match[0])}</mark>`;
    last = match.index + match[0].length;
  }
  return (html + escapeHtml(text.slice(last))).slice(0, 1400);
}

function v4LayerRun(v4Run, layer) {
  if (v4Run?.layers?.[String(layer)]) return v4Run.layers[String(layer)];
  if (v4Run?.layers?.[layer]) return v4Run.layers[layer];
  const results = (v4Run?.results || []).filter(item => Number(item.lineage_layer) === Number(layer));
  return { results, total: results.length, next_cursor: null, error: v4Run?.error || null, layer };
}

function ensureV4LayerRuns(v4Run) {
  const run = v4Run || { results: [], total: 0, next_cursor: null };
  if (run.layers) return run;
  run.layers = Object.fromEntries([1, 2, 3, 4].map((layer) => [String(layer), {
    results: (run.results || []).filter((item) => Number(item.lineage_layer) === layer),
    total: (run.results || []).filter((item) => Number(item.lineage_layer) === layer).length,
    next_cursor: null,
    error: run.error || null,
    layer,
  }]));
  return run;
}

function interleaveUnifiedItems(localItems, v4Items, modernItems) {
  const sources = [
    localItems.map(value => ({ source: 'cbeta', value })),
    v4Items.map(value => ({ source: 'v4', value })),
    modernItems.map(value => ({ source: 'modern', value })),
  ];
  const output = [];
  const max = Math.max(...sources.map(source => source.length), 0);
  for (let index = 0; index < max; index++) for (const source of sources) if (source[index]) output.push(source[index]);
  return output;
}

function unifiedLayerTotal(localItems, v4, modernRun, layer) {
  return localItems.length + Number(v4?.total || v4?.results?.length || 0) + (layer === 8 ? Number(modernRun?.total || modernRun?.results?.length || 0) : 0);
}

function createUnifiedLayerState(localGroups, v4Run, modernRun) {
  const state = { layers: {} };
  for (const layer of [...LAYER_ORDER, 0]) {
    const total = unifiedLayerTotal(localGroups?.[layer] || [], v4LayerRun(v4Run, layer), modernRun, layer);
    state.layers[layer] = { visibleCount: Math.min(5, total), total };
  }
  return state;
}

function renderUnifiedLayerResults(localGroups, v4Run, query, { keyword = false, mode = 'exact', modernRun = null, state = null } = {}) {
  const layerState = state || createUnifiedLayerState(localGroups, v4Run, modernRun);
  let html = '<section class="lineage-unified-results">';
  let anyVisible = false;
  let anyError = false;
  for (const layer of [...LAYER_ORDER, 0]) {
    const localItems = localGroups?.[layer] || [];
    const v4 = v4LayerRun(v4Run, layer);
    const v4Items = v4.results || [];
    const modernItems = layer === 8 ? (modernRun?.results || []) : [];
    const allItems = interleaveUnifiedItems(localItems, v4Items, modernItems);
    const current = layerState.layers[layer] || (layerState.layers[layer] = { visibleCount: 5, total: 0 });
    const total = unifiedLayerTotal(localItems, v4, modernRun, layer);
    current.total = total;
    const visibleItems = allItems.slice(0, Math.min(current.visibleCount, total));
    const v4Error = Boolean(v4?.error);
    const modernError = layer === 8 && Boolean(modernRun?.error);
    const hasError = v4Error || modernError;
    if (!visibleItems.length && !hasError) continue;
    anyVisible = anyVisible || visibleItems.length > 0;
    anyError = anyError || hasError;
    const label = layer === 0 ? '未归入八层 · 参考资料' : LAYER_NAMES[layer];
    html += `<div class="layer-block open" data-layer="${layer}"><div class="layer-header"><h2>${escapeHtml(displaySimplified(label))}</h2><span class="layer-count">${visibleItems.length} 篇</span></div><div class="layer-body">`;
    if (v4Error) html += `<p class="fulltext-status">V4 三语本暂时不可用：${escapeHtml(v4.error)} <button type="button" data-v4-layer-retry="${layer}">重试 V4 检索</button></p>`;
    if (modernError) html += `<p class="fulltext-status">现代上座部私有检索暂时不可用：${escapeHtml(modernRun.error)} <button type="button" data-modern-layer-retry>重试现代资料</button></p>`;
    if (visibleItems.length) {
      const lis = visibleItems.map(({ source, value }) => {
        if (source === 'cbeta') {
          const { rec, item } = value;
          if (item.titleMatch && !item.matches?.length) {
            const fields = (item.matchFields || ['经名／作者']).join('／');
            return `<li><div class="hit-doc"><a href="reader.html?id=${encodeURIComponent(rec.id)}">${escapeHtml(displaySimplified(rec.title || rec.id))}</a><span class="source-pill">CBETA 本地文本</span><span class="hit-count">${escapeHtml(fields)}命中${rec.author ? ` · ${escapeHtml(displaySimplified(rec.author))}` : ''}</span></div></li>`;
          }
          const rel = mode === 'fuzzy' ? `<span class="relevance">匹配度 ${Math.round(item.relevance * 100)}%</span>` : '';
          const positionLis = item.matches.map(m => {
            const href = `reader.html?id=${encodeURIComponent(rec.id)}&off=${m.offset}&len=${m.term.length}`;
            return `<li><a href="${href}">${m.juan ? `卷${escapeHtml(m.juan)} · ` : ''}${highlightTerm(m.snippet, m.term)}</a></li>`;
          });
          const titleMeta = item.matchFields?.length ? `<span class="hit-count">${escapeHtml(item.matchFields.join('／'))}命中</span>` : '';
          return `<li><div class="hit-doc"><a href="reader.html?id=${encodeURIComponent(rec.id)}">${escapeHtml(displaySimplified(rec.title || rec.id))}</a><span class="source-pill">CBETA 本地文本</span>${titleMeta}${rel}<span class="hit-count">${item.matches.length} 处${item.truncated ? '+' : ''}</span></div><ol class="match-positions">${collapsibleItems(positionLis, 5, '处')}</ol></li>`;
        }
        if (source === 'v4') {
          const href = value.reader_url || `https://bayson-create.github.io/Sutta-Study-Guide/#/tipitaka/read/${encodeURIComponent(value.work_id)}?row=${encodeURIComponent(value.row_id || '')}&hl=${encodeURIComponent(query)}&hl_lang=zh&hl_anchor=${encodeURIComponent(value.anchor || value.snippet || '')}`;
          const titleMeta = value.titleMatch ? `<span class="hit-count">${escapeHtml((value.matchFields || ['经名／作者']).join('／'))}命中</span>` : `<span class="hit-count">${escapeHtml((value.path || []).map(displaySimplified).join(' / '))}</span>`;
          const snippet = value.titleMatchOnly ? '' : `<p class="snippet">${v4HighlightSnippet(value, query)}</p>`;
          return `<li><div class="hit-doc"><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(displaySimplified(value.title || value.work_id))}${value.paranum ? ` · ${escapeHtml(displaySimplified(value.paranum))}` : ''}</a><span class="source-pill">V4 三语本</span>${titleMeta}</div>${snippet}</li>`;
        }
        const href = `https://bayson-create.github.io/Sutta-Study-Guide/#/research/modern-theravada/read/${encodeURIComponent(value.work_id || value.private_work_id)}`;
        const titleMeta = value.titleMatch ? `<span class="hit-count">${escapeHtml((value.matchFields || ['经名／作者']).join('／'))}命中</span>` : `<span class="hit-count">原书第 ${escapeHtml(String(value.page_anchor || ''))} 页 · ${escapeHtml(value.match_level || '')}</span>`;
        const snippet = value.titleMatchOnly ? '' : `<p class="snippet">${v4HighlightSnippet(value, query)}</p>`;
        return `<li><div class="hit-doc"><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(displaySimplified(value.title || value.work_id || value.private_work_id))}${value.chapter_id ? ` · ${escapeHtml(displaySimplified(value.chapter_id))}` : ''}</a><span class="source-pill">现代上座部</span>${titleMeta}</div>${snippet}</li>`;
      }).join('');
      html += `<ul class="fulltext-list">${lis}</ul>`;
    }
    const remaining = Math.max(0, total - visibleItems.length);
    if (remaining > 0) html += `<div class="fulltext-progressive"><button type="button" data-layer-expand="${layer}">展开其余 ${remaining.toLocaleString()} 篇</button></div>`;
    html += '</div></div>';
  }
  if (!anyVisible && !anyError) html += '<p class="fulltext-status">未检索到相关内容。</p>';
  return html + '</section>';
}

function bindUnifiedV4Pagination(root, query, state) {
  const wrapper = root?.querySelector('.lineage-unified-results');
  if (!wrapper) return;
  const redraw = () => {
    wrapper.outerHTML = renderUnifiedLayerResults(state.localGroups, state.run, query, {
      ...state.options,
      modernRun: state.modernRun,
      state: state.layerState,
    });
    bindUnifiedV4Pagination(root, query, state);
  };
  const getLayerRun = (layer) => {
    state.run.layers ||= {};
    state.run.layers[String(layer)] ||= { results: [], total: 0, next_cursor: null, layer };
    return state.run.layers[String(layer)];
  };
  const loadLayerMore = async (layer) => {
    const layerState = state.layerState.layers[layer] ||= { visibleCount: 5, total: 0 };
    const run = getLayerRun(layer);
    const modern = layer === 8 ? (state.modernRun || { results: [], total: 0, next_cursor: null }) : null;
    const target = layerState.visibleCount + 40;
    const requests = [];
    while (interleaveUnifiedItems(state.localGroups?.[layer] || [], run.results || [], modern?.results || []).length < target && run.next_cursor) {
      const cursor = run.next_cursor;
      requests.push(window.V4LineageSearch.search(query, cursor, layer).then(page => {
        run.results = [...(run.results || []), ...(page.results || [])];
        run.total = Number(page.total ?? run.total);
        run.next_cursor = page.next_cursor || null;
        run.error = page.error || null;
      }));
      break;
    }
    if (modern && interleaveUnifiedItems(state.localGroups?.[layer] || [], run.results || [], modern.results || []).length < target && modern.next_cursor) {
      const cursor = modern.next_cursor;
      requests.push(searchModernPrivate(query, cursor).then(page => {
        state.modernRun.results = [...(state.modernRun.results || []), ...(page.results || [])];
        state.modernRun.total = Number(page.total ?? state.modernRun.total);
        state.modernRun.next_cursor = page.next_cursor || null;
        state.modernRun.error = page.error || null;
      }));
    }
    if (requests.length) await Promise.all(requests);
    const localCount = (state.localGroups?.[layer] || []).length;
    const available = interleaveUnifiedItems(state.localGroups?.[layer] || [], run.results || [], modern?.results || []).length;
    const total = unifiedLayerTotal(state.localGroups?.[layer] || [], run, state.modernRun, layer);
    layerState.total = total;
    layerState.visibleCount = Math.min(target, Math.max(available, Math.min(total, target)));
    if (available < layerState.visibleCount && (run.error || modern?.error)) throw new Error(run.error || modern.error);
  };
  wrapper.querySelectorAll('[data-layer-expand]').forEach((button) => {
    button.addEventListener('click', async () => {
      const layer = Number(button.dataset.layerExpand);
      button.disabled = true;
      button.textContent = '正在展开…';
      try {
        await loadLayerMore(layer);
        redraw();
      } catch (error) {
        button.disabled = false;
        button.textContent = `展开失败，重试（${error.message}）`;
      }
    });
  });
  wrapper.querySelectorAll('[data-v4-layer-retry]').forEach((button) => {
    button.addEventListener('click', async () => {
      const layer = Number(button.dataset.v4LayerRetry);
      button.disabled = true;
      button.textContent = '正在重试…';
      try {
        const page = await window.V4LineageSearch.search(query, null, layer);
        state.run.layers[String(layer)] = { ...page, layer, error: null };
        redraw();
      } catch (error) {
        button.disabled = false;
        button.textContent = `重试失败：${error.message}`;
      }
    });
  });
  wrapper.querySelectorAll('[data-modern-layer-retry]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = '正在重试…';
      state.modernRun = await searchModernPrivate(query);
      redraw();
    });
  });
}

async function runFullTextSearch(q) {
  const mySeq = ++searchSeq;
  const box = document.getElementById("fulltextResults");
  box.hidden = false;
  box.innerHTML = "";
  const localBox = document.createElement("div");
  localBox.className = "lineage-unified-container";
  localBox.innerHTML = `<p class="fulltext-status">CBETA 与 V4 正文检索"${escapeHtml(q)}"中…</p>`;
  box.append(localBox);
  const v4Promise = window.V4LineageSearch?.searchByLayer
    ? window.V4LineageSearch.searchByLayer(q)
    : window.V4LineageSearch?.search
      ? window.V4LineageSearch.search(q).catch(error => ({ results: [], total: 0, error: error.message }))
    : Promise.resolve({ results: [], total: 0, error: 'V4 搜索模块未加载' });
  const modernPromise = searchModernPrivate(q);

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
      const [rawV4Run, modernRun] = await Promise.all([v4Promise, modernPromise]);
      const v4Run = ensureV4LayerRuns(rawV4Run);
      const emptyGroups = emptyLayerGroups();
      mergeTitleAuthorMatches(emptyGroups, v4Run, modernRun, titleAuthorMatches(q));
      const layerState = createUnifiedLayerState(emptyGroups, v4Run, modernRun);
      localBox.innerHTML = `<p class="fulltext-status">"${escapeHtml(q)}"里没有可用于 CBETA 检索的常见词组，以下仍显示可用结果。</p>${renderUnifiedLayerResults(emptyGroups, v4Run, q, { keyword: SEARCH_MODE === 'keyword', mode: 'fuzzy', modernRun, state: layerState })}`;
      bindUnifiedV4Pagination(localBox, q, { run: v4Run, modernRun, localGroups: emptyGroups, layerState, options: { keyword: SEARCH_MODE === 'keyword', mode: 'fuzzy' } });
      return;
    }
    const [rawV4Run, modernRun] = await Promise.all([v4Promise, modernPromise]);
    const v4Run = ensureV4LayerRuns(rawV4Run);
    const emptyGroups = emptyLayerGroups();
    mergeTitleAuthorMatches(emptyGroups, v4Run, modernRun, titleAuthorMatches(q));
    const layerState = createUnifiedLayerState(emptyGroups, v4Run, modernRun);
    localBox.innerHTML = `<p class="fulltext-status">CBETA 正文暂时不可用：${escapeHtml(String(err))}</p>${renderUnifiedLayerResults(emptyGroups, v4Run, q, { keyword: SEARCH_MODE === 'keyword', mode, modernRun, state: layerState })}`;
    bindUnifiedV4Pagination(localBox, q, { run: v4Run, modernRun, localGroups: emptyGroups, layerState, options: { keyword: SEARCH_MODE === 'keyword', mode } });
    return;
  }
  if (mySeq !== searchSeq) return; // a newer keystroke superseded this search

  const [rawV4Run, modernRun] = await Promise.all([v4Promise, modernPromise]);
  const v4Run = ensureV4LayerRuns(rawV4Run);
  const titleMatches = titleAuthorMatches(q);

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

  mergeTitleAuthorMatches(groups, v4Run, modernRun, titleMatches);
  const externalResultCount = (v4Run.results || []).length + (modernRun.results || []).length;
  if (results.length === 0 && titleMatches.length === 0 && SEARCH_MODE !== "keyword" && externalResultCount === 0) {
    const emptyState = createUnifiedLayerState(groups, v4Run, modernRun);
    localBox.innerHTML = `<p class="fulltext-status">未检索到与"${escapeHtml(q)}"相关的内容。</p>${renderUnifiedLayerResults(groups, v4Run, q, { mode, modernRun, state: emptyState })}`;
    bindUnifiedV4Pagination(localBox, q, { run: v4Run, modernRun, localGroups: groups, layerState: emptyState, options: { mode } });
    return;
  }

  const modeLabel = mode === "fuzzy" ? "模糊匹配（按关键词覆盖度排序）" : "精确匹配";
  const totalMatches = results.reduce((s, r) => s + r.matches.length, 0);
  const unifiedOptions = { keyword: SEARCH_MODE === 'keyword', mode };
  const layerState = createUnifiedLayerState(groups, v4Run, modernRun);
  if (SEARCH_MODE === "keyword") {
    localBox.innerHTML = displaySimplified(`<div class="keyword-trace-summary"><strong>关键词命中</strong>：各层统一展示可用来源；空白层级只表示当前字面未命中。</div>${renderUnifiedLayerResults(groups, v4Run, q, { ...unifiedOptions, modernRun, state: layerState })}`);
    bindUnifiedV4Pagination(localBox, q, { run: v4Run, modernRun, localGroups: groups, layerState, options: unifiedOptions });
    return;
  }
  const html = `<h2 class="fulltext-heading">法义资料检索结果："${escapeHtml(q)}"（CBETA ${results.length} 篇、${totalMatches} 处匹配；${modeLabel}；按层统一展示）</h2>${renderUnifiedLayerResults(groups, v4Run, q, { ...unifiedOptions, modernRun, state: layerState })}`;
  localBox.innerHTML = displaySimplified(html);
  bindUnifiedV4Pagination(localBox, q, { run: v4Run, modernRun, localGroups: groups, layerState, options: unifiedOptions });
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
