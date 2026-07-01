const params = new URLSearchParams(location.search);
const id = params.get("id");
const highlightOffset = params.has("off") ? parseInt(params.get("off"), 10) : null;
const highlightLen = params.has("len") ? Math.max(1, parseInt(params.get("len"), 10) || 1) : 1;

let currentParagraphs = null;
let scriptMode = "simplified"; // default: CBETA is almost entirely Traditional source text

function convertForDisplay(text) {
  if (scriptMode === "simplified") {
    return typeof toSimplified === "function" ? toSimplified(text) : text;
  }
  return text;
}

async function main() {
  if (!id) {
    document.getElementById("content").innerHTML = "<p>未指定经文 id。</p>";
    return;
  }
  const idxRes = await fetch("data/index.json");
  const index = await idxRes.json();
  const rec = index.find((r) => r.id === id);
  if (!rec) {
    document.getElementById("content").innerHTML = "<p>目录中未找到该经文。</p>";
    return;
  }

  document.getElementById("title").textContent = rec.title || rec.id;
  document.getElementById("meta").textContent =
    `${rec.author || ""}　${rec.extent || ""}　CBETA: ${rec.canon}.${rec.vol}.${rec.no}`;
  document.title = `${rec.title || rec.id} · 法义溯源`;

  // Render from the pre-extracted plain text (data/fulltext/<id>.txt),
  // not the raw TEI XML: the 3.4GB CBETA corpus itself is never published
  // to the static site, only the small per-document text extracted from
  // it at build time (see scripts/extract_fulltext.py). Character offsets
  // passed in via ?off= refer to this same extracted text (see
  // site/doctext.js), so they stay valid whether shown as Simplified or
  // Traditional - both conversions are strictly 1 char -> 1 char.
  const txtRes = await fetch(`data/fulltext/${encodeURIComponent(rec.id)}.txt`);
  if (!txtRes.ok) {
    document.getElementById("content").innerHTML =
      "<p>正文文件加载失败：本地预览需先运行 scripts/extract_fulltext.py 生成 data/fulltext。</p>";
    return;
  }
  const raw = await txtRes.text();
  currentParagraphs = parseFulltext(raw);
  renderBody();
}

function renderBody() {
  const content = document.getElementById("content");
  content.innerHTML = "";
  if (!currentParagraphs || currentParagraphs.length === 0) {
    content.innerHTML = "<p>此文本未提取到可显示的段落。</p>";
    return;
  }

  const hlParaIndex =
    highlightOffset !== null ? paragraphAtOffset(currentParagraphs, highlightOffset) : -1;

  let currentJuan = null;
  currentParagraphs.forEach((para, i) => {
    if (para.juan && para.juan !== currentJuan) {
      currentJuan = para.juan;
      const h = document.createElement("h2");
      h.className = "juan";
      h.textContent = `卷 ${currentJuan}`;
      content.appendChild(h);
    }

    const p = document.createElement("p");
    if (i === hlParaIndex) {
      const localStart = Math.max(0, highlightOffset - para.offset);
      const localEnd = Math.min(para.text.length, localStart + highlightLen);
      const before = convertForDisplay(para.text.slice(0, localStart));
      const hit = convertForDisplay(para.text.slice(localStart, localEnd));
      const after = convertForDisplay(para.text.slice(localEnd));
      p.appendChild(document.createTextNode(before));
      const mark = document.createElement("mark");
      mark.textContent = hit;
      p.appendChild(mark);
      p.appendChild(document.createTextNode(after));
      p.id = "trace-hit";
    } else {
      p.textContent = convertForDisplay(para.text);
    }
    content.appendChild(p);
  });

  if (hlParaIndex !== -1) {
    // A plain requestAnimationFrame call here is unreliable on first
    // load: the browser's own scroll-anchoring/restoration can run after
    // it and silently override the jump. Disabling scroll restoration
    // and giving layout a beat before scrolling makes it land reliably.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    setTimeout(() => {
      const el = document.getElementById("trace-hit");
      if (el) el.scrollIntoView({ behavior: "auto", block: "center" });
    }, 60);
  }
}

document.getElementById("scriptToggle").addEventListener("click", () => {
  scriptMode = scriptMode === "simplified" ? "traditional" : "simplified";
  document.getElementById("scriptToggle").textContent =
    scriptMode === "simplified" ? "显示繁体" : "显示简体";
  renderBody();
});

main();
