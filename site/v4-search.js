/* V4 lineage search bridge.  V4 rows remain in the canonical Study Guide
 * Blob; this site only receives a paged result and links to its reader. */
(() => {
  const API = (window.V4_LINEAGE_API || 'https://sutta-api.agreeablemeadow-9da329ca.swedencentral.azurecontainerapps.io').replace(/\/$/, '');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlight = (value, terms) => {
    const raw = String(value || '');
    const candidates = [...new Set((terms || []).map(item => String(item || '').trim()).filter(Boolean))]
      .sort((a, b) => b.length - a.length);
    if (!candidates.length) return escapeHtml(raw);
    const matcher = new RegExp(candidates.map(escapeRegExp).join('|'), 'giu');
    let html = '', last = 0, match;
    while ((match = matcher.exec(raw))) {
      html += escapeHtml(raw.slice(last, match.index));
      html += `<mark>${escapeHtml(match[0])}</mark>`;
      last = match.index + match[0].length;
    }
    return html + escapeHtml(raw.slice(last));
  };
  const simplify = value => typeof toSimplified === 'function' ? toSimplified(String(value || '')) : String(value || '');
  const href = (item, query) => item.reader_url || `https://bayson-create.github.io/Sutta-Study-Guide/#/tipitaka/read/${encodeURIComponent(item.work_id)}?row=${encodeURIComponent(item.row_id)}&hl=${encodeURIComponent(query)}&hl_lang=zh&hl_anchor=${encodeURIComponent(item.anchor || item.snippet || '')}`;
  function section(data, query) {
    const groups = new Map([[1, []], [2, []], [4, []]]);
    (data.results || []).forEach(item => { if (groups.has(Number(item.lineage_layer))) groups.get(Number(item.lineage_layer)).push(item); });
    let html = `<section class="v4-lineage-results"><div class="v4-lineage-heading">V4 三语本 <span>${Number(data.total || 0).toLocaleString()} 处命中</span><small>正文 · 精确行定位</small></div>`;
    for (const [layer, items] of groups) {
      if (!items.length) continue;
      html += `<div class="v4-lineage-group"><h3>第${layer}层 · V4 三语本 <small>${items.length} 条</small></h3><ul>`;
      html += items.map(item => `<li><a href="${escapeHtml(href(item, query))}" target="_blank" rel="noopener"><strong>${escapeHtml(simplify(item.title || item.work_id))}</strong>${item.paranum ? ` · ${escapeHtml(item.paranum)}` : ''}</a><span>${escapeHtml((item.path || []).join(' / '))}</span><p>${highlight(simplify(item.snippet || item.text || '').slice(0, 220), [...(item.matched_terms || []), query])}</p></li>`).join('');
      html += '</ul></div>';
    }
    if (data.next_cursor) html += `<button class="v4-lineage-next" data-v4-cursor="${escapeHtml(data.next_cursor)}">加载下一页</button>`;
    return html + '</section>';
  }
  async function renderInto(query, box) {
    const host = document.createElement('div'); host.className = 'v4-lineage-loading'; host.textContent = 'V4 三语本检索中…'; box.appendChild(host);
    const params = new URLSearchParams({ q: query, lang: 'zh', limit: '40', types: 'corpus', layer: '1|2|4' });
    try {
      const response = await fetch(`${API}/api/tipitaka/v1/search?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json(); host.outerHTML = section(data, query);
      bindNext(box.querySelector('.v4-lineage-results'), query, params);
    } catch (error) { host.className = 'v4-lineage-error'; host.textContent = `V4 三语本暂时不可用：${error.message}`; }
  }
  function bindNext(source, query, baseParams) {
    const next = source?.querySelector('.v4-lineage-next');
    if (!next) return;
    const container = source.parentElement;
    next.addEventListener('click', async () => {
      next.disabled = true; next.textContent = '加载中…';
      const pageParams = new URLSearchParams(baseParams); pageParams.set('cursor', next.dataset.v4Cursor);
      try {
        const response = await fetch(`${API}/api/tipitaka/v1/search?${pageParams}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const page = await response.json(); source.outerHTML = section(page, query);
        bindNext(container.querySelector('.v4-lineage-results'), query, baseParams);
      } catch (error) { next.disabled = false; next.textContent = `加载失败：${error.message}`; }
    });
  }
  window.V4LineageSearch = { renderInto };
})();
