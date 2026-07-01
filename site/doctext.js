// Shared parsing of data/fulltext/<id>.txt, used by both the search
// index (fulltext-search.js) and the reader (reader.js) so that a
// character offset computed during search means the same thing when
// the reader jumps to it. Each line is "<juan>\t<paragraph text>"; the
// concatenated full text (used for substring search) is the paragraph
// texts joined with NO separator, so offsets are paragraph-boundary
// insensitive - see paragraphAtOffset to map back to a paragraph.

function parseFulltext(raw) {
  const paragraphs = [];
  let offset = 0;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const juan = tab === -1 ? "" : line.slice(0, tab);
    const text = tab === -1 ? line : line.slice(tab + 1);
    if (!text) continue;
    paragraphs.push({ juan, text, offset });
    offset += text.length;
  }
  return paragraphs;
}

function fullTextOf(paragraphs) {
  return paragraphs.map((p) => p.text).join("");
}

// Binary search for the last paragraph whose start offset is <= offset.
function paragraphAtOffset(paragraphs, offset) {
  let lo = 0,
    hi = paragraphs.length - 1,
    ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (paragraphs[mid].offset <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
