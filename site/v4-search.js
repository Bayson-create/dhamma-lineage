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
  const retryButton = query => `<button type="button" class="v4-lineage-retry" data-v4-retry="${escapeHtml(query)}">重试 V4 检索</button>`;
  function section(data, query, visibleCount = 5) {
    const groups = new Map([[1, []], [2, []], [3, []], [4, []]]);
    const results = data.results || [];
    const visible = results.slice(0, visibleCount);
    visible.forEach(item => { if (groups.has(Number(item.lineage_layer))) groups.get(Number(item.lineage_layer)).push(item); });
    const total = Number(data.total || results.length);
    let html = `<section class="v4-lineage-results"><div class="v4-lineage-heading">V4 三语本 <span>${total.toLocaleString()} 处命中</span><small>正文 · 精确行定位 · 已显示 ${Math.min(visibleCount, results.length).toLocaleString()} 条</small></div>`;
    for (const [layer, items] of groups) {
      if (!items.length) continue;
      html += `<div class="v4-lineage-group"><h3>第${layer}层 · V4 三语本 <small>${items.length} 条</small></h3><ul>`;
      html += items.map(item => `<li><a href="${escapeHtml(href(item, query))}" target="_blank" rel="noopener"><strong>${escapeHtml(simplify(item.title || item.work_id))}</strong>${item.paranum ? ` · ${escapeHtml(simplify(item.paranum))}` : ''}</a><span>${escapeHtml((item.path || []).map(simplify).join(' / '))}</span><p>${highlight(simplify(item.snippet || item.text || '').slice(0, 220), [...(item.matched_terms || []).map(simplify), simplify(query), query])}</p></li>`).join('');
      html += '</ul></div>';
    }
    if (!data.results?.length) html += `<p class="v4-lineage-empty">V4 三语本未找到正文命中。</p>`;
    const shown = Math.min(visibleCount, results.length);
    const remaining = Math.max(0, total - shown);
    if (remaining > 0) html += `<div class="v4-lineage-more"><button class="v4-lineage-expand" data-v4-visible="${shown}" data-v4-cursor="${escapeHtml(data.next_cursor || '')}">展开其余 ${remaining.toLocaleString()} 篇</button></div>`;
    return html + '</section>';
  }
  async function search(query, cursor = null, layer = null) {
    const params = new URLSearchParams({ q: query, lang: 'zh', limit: '40', types: 'corpus', layer: layer ? String(layer) : '1|2|3|4' });
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`${API}/api/tipitaka/v1/search?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
  async function searchByLayer(query) {
    const pages = await Promise.all([1, 2, 3, 4].map(async layer => {
      try {
        return { ...(await search(query, null, layer)), layer };
      } catch (error) {
        return { results: [], total: 0, next_cursor: null, error: error.message, layer };
      }
    }));
    return {
      query,
      layers: Object.fromEntries(pages.map(page => [String(page.layer), page])),
      results: pages.flatMap(page => page.results || []),
      total: pages.reduce((sum, page) => sum + Number(page.total || 0), 0),
      error: pages.every(page => page.error) ? pages[0].error : pages.some(page => page.error) ? '部分层级 V4 检索暂时不可用' : null,
    };
  }
  async function renderInto(query, box) {
    box.innerHTML = '<div class="v4-lineage-loading">V4 三语本检索中…</div>';
    try {
      const data = await search(query);
      renderState({ box, query, data, visibleCount: 5 });
    } catch (error) {
      box.innerHTML = `<div class="v4-lineage-error">V4 三语本暂时不可用：${escapeHtml(error.message)} ${retryButton(query)}</div>`;
      const retry = box.querySelector('[data-v4-retry]');
      retry?.addEventListener('click', () => renderInto(query, box));
    }
  }
  function renderState(state) {
    state.box.innerHTML = section(state.data, state.query, state.visibleCount);
    const source = state.box.querySelector('.v4-lineage-results');
    const expand = source?.querySelector('.v4-lineage-expand');
    if (!expand) return;
    expand.addEventListener('click', async () => {
      expand.disabled = true;
      expand.textContent = '正在展开…';
      try {
        const shown = Number(expand.dataset.v4Visible || state.visibleCount);
        if (shown < state.data.results.length) {
          state.visibleCount = Math.min(shown + 40, state.data.results.length);
        } else if (state.data.next_cursor) {
          const page = await search(state.query, state.data.next_cursor);
          state.data = { ...page, results: [...(state.data.results || []), ...(page.results || [])] };
          state.visibleCount = Math.min(shown + 40, state.data.results.length);
        }
        renderState(state);
      } catch (error) {
        expand.disabled = false;
        expand.textContent = `展开失败，重试（剩余 ${Math.max(0, Number(state.data.total || 0) - Number(expand.dataset.v4Visible || 0)).toLocaleString()} 篇）`;
      }
    });
  }
  window.V4LineageSearch = { search, searchByLayer, renderInto };
})();
