/* Shared auth helpers for dhamma-lineage's AI features (法义溯源 AI 综合
 * synthesis, account page). Accounts are shared with Sutta Study Guide's
 * backend - same /api/auth endpoints, same user table. */

const API_BASE = location.hostname === "localhost" || location.hostname === "127.0.0.1"
  ? "http://localhost:8000"
  : "https://sutta-api.agreeablemeadow-9da329ca.swedencentral.azurecontainerapps.io";

const AUTH_TOKEN_KEY = "dhamma_auth_token";

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function isLoggedIn() {
  return !!getToken();
}

function logout() {
  clearToken();
  location.href = "index.html";
}

/** fetch() wrapper that adds the Authorization header when logged in, and
 * throws an Error with a readable message (parsed from the API's `detail`
 * field) on non-2xx responses instead of leaving the caller to inspect
 * response.ok. */
async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = Object.assign({}, options.headers || {});
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, Object.assign({}, options, { headers }));
  if (!res.ok) {
    let detail = `请求失败（HTTP ${res.status}）`;
    try {
      const data = await res.json();
      if (data && data.detail) detail = data.detail;
    } catch (_) {
      /* body wasn't JSON - keep the generic message */
    }
    const err = new Error(detail);
    err.status = res.status;
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      if (retryAfter) err.retryAfterSeconds = parseInt(retryAfter, 10);
    }
    throw err;
  }
  return res.json();
}

/** Injects a 登录/个人 link into any page that includes a <header>. Call
 * after DOMContentLoaded. */
function renderAuthNav() {
  const header = document.querySelector("header");
  if (!header) return;
  const nav = document.createElement("p");
  nav.className = "nav-link auth-nav";
  nav.innerHTML = isLoggedIn()
    ? `<a href="account.html">→ 我的账号</a>`
    : `<a href="login.html">→ 登录 / 注册</a>`;
  header.appendChild(nav);
}

document.addEventListener("DOMContentLoaded", renderAuthNav);
