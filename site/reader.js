const params = new URLSearchParams(location.search);
const id = params.get("id");

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
  // it at build time (see scripts/extract_fulltext.py).
  const txtRes = await fetch(`data/fulltext/${encodeURIComponent(rec.id)}.txt`);
  if (!txtRes.ok) {
    document.getElementById("content").innerHTML =
      "<p>正文文件加载失败：本地预览需先运行 scripts/extract_fulltext.py 生成 data/fulltext。</p>";
    return;
  }
  const raw = await txtRes.text();
  renderBody(raw);
}

function renderBody(raw) {
  const content = document.getElementById("content");
  content.innerHTML = "";
  let currentJuan = null;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const juan = tab === -1 ? "" : line.slice(0, tab);
    const text = tab === -1 ? line : line.slice(tab + 1);
    if (!text) continue;
    if (juan && juan !== currentJuan) {
      currentJuan = juan;
      const h = document.createElement("h2");
      h.className = "juan";
      h.textContent = `卷 ${juan}`;
      content.appendChild(h);
    }
    const p = document.createElement("p");
    p.textContent = text;
    content.appendChild(p);
  }
  if (!content.childElementCount) {
    content.innerHTML = "<p>此文本未提取到可显示的段落。</p>";
  }
}

main();
