// Client-side full-text search over the bigram inverted index in
// data/search_index/. Only fetches the shard files relevant to the
// query's bigrams, then fetches the small per-document plain-text file
// for each surviving candidate to verify matches and locate every
// occurrence (not just the first). Nothing about the corpus is shipped
// to the browser up front. Requires doctext.js and (optionally) s2t.js
// to be loaded first.

let manifest = null;
let docIds = null;

const MAX_MATCHES_PER_DOC = 40;

async function ensureManifest() {
  if (!manifest) {
    manifest = await (await fetch("data/search_index/manifest.json")).json();
    docIds = await (await fetch("data/search_index/doc_ids.json")).json();
  }
}

function bucketFor(bigram, buckets) {
  // must match scripts/build_search_index.py's zlib.crc32 % buckets
  let crc = crc32(bigram);
  return ((crc % buckets) + buckets) % buckets;
}

// minimal crc32 (matches zlib.crc32 used by the Python indexer)
const CRC_TABLE = (() => {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(str) {
  const bytes = new TextEncoder().encode(str);
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function bigramsOf(text) {
  const out = [];
  for (let i = 0; i < text.length - 1; i++) out.push(text.slice(i, i + 2));
  if (out.length === 0 && text.length === 1) out.push(text); // single-char fallback
  return out;
}

const shardCache = new Map();
async function loadShard(fname) {
  if (shardCache.has(fname)) return shardCache.get(fname);
  const data = await (await fetch("data/search_index/" + fname)).json();
  shardCache.set(fname, data);
  return data;
}

const docCache = new Map();
async function fetchDocRecord(docId) {
  if (docCache.has(docId)) return docCache.get(docId);
  const raw = await (await fetch(`data/fulltext/${docId}.txt`)).text();
  const paragraphs = parseFulltext(raw);
  const fullText = fullTextOf(paragraphs);
  const record = { paragraphs, fullText };
  docCache.set(docId, record);
  return record;
}

function snippetAround(text, offset, len) {
  const start = Math.max(0, offset - 20);
  const end = Math.min(text.length, offset + len + 20);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

function buildMatch(record, offset, len, term) {
  const paraIndex = paragraphAtOffset(record.paragraphs, offset);
  const juan = record.paragraphs[paraIndex] ? record.paragraphs[paraIndex].juan : "";
  return {
    offset,
    juan,
    term,
    snippet: snippetAround(record.fullText, offset, len),
  };
}

/**
 * Exact substring search: returns every document whose plain text
 * contains `query` as a literal substring, together with EVERY
 * occurrence of it in that document (capped at MAX_MATCHES_PER_DOC,
 * with `truncated: true` if there were more).
 *
 * Returns { docId, relevance: 1, matches: [{offset, juan, snippet, term}], truncated }[]
 */
async function fullTextSearch(query, { limit = 200 } = {}) {
  await ensureManifest();
  const q = (typeof toTraditional === "function" ? toTraditional(query) : query).trim();
  if (q.length < 1) return [];

  let candidateInts = null;

  if (q.length === 1) {
    // single character: can't bigram-index it precisely, fall back to
    // scanning shards whose bigrams start with this char (best effort,
    // capped) - acceptable since single-char queries are rare/broad.
    candidateInts = new Set(docIds.map((_, i) => i));
  } else {
    const grams = bigramsOf(q);
    for (const bg of grams) {
      const bucket = bucketFor(bg, manifest.buckets);
      const fname = `shard_${String(bucket).padStart(3, "0")}.json`;
      const shard = await loadShard(fname);
      const ids = shard[bg];
      if (!ids) {
        // bigram not in (pruned) index at all -> if it's a high-frequency
        // bigram it was dropped during indexing, so we can't prune the
        // candidate set on it; skip rather than treat as "no matches".
        continue;
      }
      const idSet = new Set(ids);
      candidateInts = candidateInts === null ? idSet : intersect(candidateInts, idSet);
      if (candidateInts.size === 0) break;
    }
    if (candidateInts === null) {
      // Every bigram in the query was too common to be worth indexing
      // (dropped at build time - see build_search_index.py's df-ceiling).
      // Scanning the entire corpus for a substring match is the only
      // correct fallback, but doing it sequentially can hang the page for
      // a very long time on thousands of docs, so it's capped and flagged.
      candidateInts = new Set(docIds.map((_, i) => i));
      candidateInts.__unindexedFallback = true;
    }
  }

  const candidateArray = Array.from(candidateInts);
  const capped = candidateInts.__unindexedFallback && candidateArray.length > 1200;
  const toScan = capped ? candidateArray.slice(0, 1200) : candidateArray;

  const results = [];
  const CONCURRENCY = 16;
  let cursor = 0;
  async function worker() {
    while (cursor < toScan.length && results.length < limit) {
      const intId = toScan[cursor++];
      const docId = docIds[intId];
      const record = await fetchDocRecord(docId);
      const matches = [];
      let from = 0;
      while (matches.length < MAX_MATCHES_PER_DOC) {
        const idx = record.fullText.indexOf(q, from);
        if (idx === -1) break;
        matches.push(buildMatch(record, idx, q.length, q));
        from = idx + q.length;
      }
      if (matches.length === 0) continue;
      const truncated = record.fullText.indexOf(q, from) !== -1;
      results.push({ docId, relevance: 1, matches, truncated });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (capped) results.truncatedScan = true;
  return results;
}

function intersect(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set();
  for (const x of small) if (big.has(x)) out.add(x);
  return out;
}

// Splits on whitespace/punctuation so bigrams never bridge across an
// unrelated clause boundary, then bigrams each remaining run of
// characters. Single leftover characters are kept as 1-char terms (they
// don't narrow the index, but they're still shown so callers can report
// which words of the query were actually informative).
const PUNCT_RE =
  /[\s,.，。！？；：、“”"'‘’《》〈〉「」『』（）()\[\]—…·\-~,!?;:]+/;

function segmentQuery(query) {
  return query.split(PUNCT_RE).filter(Boolean);
}

function queryBigrams(query) {
  const grams = new Set();
  for (const seg of segmentQuery(query)) {
    if (seg.length === 1) {
      grams.add(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i++) grams.add(seg.slice(i, i + 2));
  }
  return Array.from(grams);
}

/**
 * Fuzzy match for a whole sentence, question, or statement: scores every
 * document by how many of the query's distinct bigrams it contains (an
 * OR/coverage match, not "the phrase appears verbatim"), then ranks by
 * that score. This is what makes "接纳自己" or "这是佛陀说的吗" usable
 * queries even though that exact wording won't appear in classical
 * Chinese texts - what's being searched for is co-occurrence of the
 * query's constituent word-pairs, not the literal string.
 *
 * For each matching document, every occurrence of every matched bigram
 * is located (capped at MAX_MATCHES_PER_DOC total, sorted by position)
 * so the reader can jump to each one individually.
 *
 * Returns { docId, score, relevance, matches, truncated }[], sorted by
 * score desc. relevance is score / (number of query bigrams that exist
 * anywhere in the index), so a query containing some overly-common
 * (pruned) bigrams isn't penalized for them.
 */
async function fuzzySentenceSearch(query, { limit = 60 } = {}) {
  await ensureManifest();
  const norm = (typeof toTraditional === "function" ? toTraditional(query) : query).trim();
  if (!norm) return [];

  const grams = queryBigrams(norm);
  if (grams.length === 0) return [];

  const scores = new Map(); // intId -> match count
  let effectiveN = 0;
  const informativeGrams = [];
  for (const bg of grams) {
    if (bg.length < 2) continue; // leftover single char: not index-searchable
    const bucket = bucketFor(bg, manifest.buckets);
    const fname = `shard_${String(bucket).padStart(3, "0")}.json`;
    const shard = await loadShard(fname);
    const ids = shard[bg];
    if (!ids) continue; // pruned (too common) or genuinely absent
    effectiveN++;
    informativeGrams.push(bg);
    for (const id of ids) scores.set(id, (scores.get(id) || 0) + 1);
  }
  if (effectiveN === 0) {
    const err = new Error("query has no bigram informative enough to search on");
    err.code = "NO_INFORMATIVE_TERMS";
    throw err;
  }

  const ranked = Array.from(scores.entries())
    .map(([intId, count]) => ({ intId, count, relevance: count / effectiveN }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  const results = [];
  const CONCURRENCY = 12;
  let cursor = 0;
  async function worker() {
    while (cursor < ranked.length) {
      const item = ranked[cursor++];
      const docId = docIds[item.intId];
      const record = await fetchDocRecord(docId);
      const matches = [];
      for (const bg of informativeGrams) {
        if (matches.length >= MAX_MATCHES_PER_DOC) break;
        let from = 0;
        while (matches.length < MAX_MATCHES_PER_DOC) {
          const idx = record.fullText.indexOf(bg, from);
          if (idx === -1) break;
          matches.push(buildMatch(record, idx, bg.length, bg));
          from = idx + bg.length;
        }
      }
      matches.sort((a, b) => a.offset - b.offset);
      results.push({
        docId,
        score: item.count,
        relevance: item.relevance,
        matches,
        truncated: matches.length >= MAX_MATCHES_PER_DOC,
      });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => b.score - a.score);
  results.effectiveGramCount = effectiveN;
  results.totalGramCount = grams.length;
  return results;
}
