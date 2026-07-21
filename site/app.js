let INDEX = [];
let INDEX_BY_ID_MAP = null;
let LAYER_CARDS = null;

const LAYER_TAGLINES = {
  1: "佛陀亲说，最原始的教法记录",
  2: "对早期经典的注释与复注，阐释经义",
  8: "依止前人教法，弘扬佛法，利益众生",
};

async function loadIndex() {
  const [indexRes, cardsRes] = await Promise.all([fetch("data/index.json"), fetch("data/layer_cards.json")]);
  INDEX = await indexRes.json();
  INDEX_BY_ID_MAP = new Map(INDEX.map((r) => [r.id, r]));
  LAYER_CARDS = await cardsRes.json();
  renderHome();
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
    .map((r) => `<li><a href="reader.html?id=${encodeURIComponent(r.id)}">${r.title || r.id}</a></li>`)
    .join("");
  panel.innerHTML = `<button class="home-drilldown-close">收起 ✕</button><h5>${card.label}（${items.length} 篇）</h5><ul class="text-list">${listHtml}</ul>`;
  panel.querySelector(".home-drilldown-close").addEventListener("click", () => panel.remove());
  body.appendChild(panel);
}

// 清淨道論 draws on layer-1/2 material more than anything else in this
// layer (closer to a "3.5th layer" bridge text), so it leads; the rest of
// what would otherwise be the plain script.py.mako order follows.
const LAYER4_ORDER = ["visuddhimagga", "vimuttimagga", "abhidhammattha", "mahavibhasa", "kosa", "nyayanusara", "other"];

// 中論 and 大智度論 are both traditionally tied to Nagarjuna's circle, so
// they're grouped in one bordered pair rather than shown as two separate
// standalone cards.
const PAIRED_CARD_IDS = new Set(["madhyamaka_base", "mahaprajnaparamita_sastra"]);

function renderLayerCards(layer, accentVar) {
  let cards = LAYER_CARDS[String(layer)];
  if (!cards) return null;
  if (layer === 4) {
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    cards = LAYER4_ORDER.map((id) => byId[id]).filter(Boolean);
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
  const groups = groupByLayer(INDEX);

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
        // Layers 1, 2, 8 have no curated sub-categories in the reference
        // design - just a single entry point into the full list.
        const row = document.createElement("div");
        row.className = "home-cards";
        row.appendChild(
          renderCard({ id: "all", label: "浏览全部", count: items.length, ids: items.map((r) => r.id) }, accentVar)
        );
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
    renderHome();
    fulltextBox.hidden = true;
    fulltextBox.innerHTML = "";
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
