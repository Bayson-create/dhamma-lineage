// Generic "show first N, then 展开其余/收起" wrapper for any list of
// pre-rendered <li> HTML strings. Used for both the per-layer document
// list and the per-document match-position list, wherever a hit count
// can get too long to read comfortably. Marks overflow items with
// [hidden] plus a shared data-clx-group id instead of wrapping them in
// an extra element, so the resulting markup stays valid <ul>/<ol> list
// content.

const COLLAPSE_THRESHOLD = 5;
let clxGroupCounter = 0;

/**
 * items: array of HTML strings, each a complete <li>...</li>.
 * Returns an HTML string: if items.length <= threshold, just joins them;
 * otherwise the overflow items are marked hidden and a toggle <li> is
 * appended to reveal them.
 */
function collapsibleItems(items, threshold = COLLAPSE_THRESHOLD, unitLabel = "项") {
  if (items.length <= threshold) return items.join("");
  const groupId = `clx-${++clxGroupCounter}`;
  const visible = items.slice(0, threshold).join("");
  const remaining = items.length - threshold;
  const hidden = items
    .slice(threshold)
    .map((li) => li.replace(/^<li/, `<li hidden data-clx-group="${groupId}"`))
    .join("");
  return (
    visible +
    hidden +
    `<li class="clx-toggle-row"><button type="button" class="clx-toggle" data-group="${groupId}" data-remaining="${remaining}" data-total="${items.length}" data-unit="${unitLabel}">展开其余 ${remaining} ${unitLabel}（共 ${items.length}）</button></li>`
  );
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".clx-toggle");
  if (!btn) return;
  const groupId = btn.dataset.group;
  const items = document.querySelectorAll(`[data-clx-group="${groupId}"]`);
  const opening = items.length > 0 && items[0].hidden;
  items.forEach((el) => (el.hidden = !opening));
  btn.textContent = opening
    ? "收起"
    : `展开其余 ${btn.dataset.remaining} ${btn.dataset.unit}（共 ${btn.dataset.total}）`;
});
