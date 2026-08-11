if (!isLoggedIn()) {
  location.href = "login.html";
}

document.getElementById("logoutBtn").addEventListener("click", logout);

async function loadAccount() {
  try {
    const me = await apiFetch("/api/auth/me");
    document.getElementById("accountEmail").textContent = me.email;

    const quota = await apiFetch("/api/dhamma/quota");
    renderQuota(quota);

    if (me.role === "admin") {
      document.getElementById("adminCard").hidden = false;
    }
  } catch (err) {
    if (err.status === 401) {
      logout();
      return;
    }
    document.getElementById("quotaBox").innerHTML = `<p class="error">加载失败：${err.message}</p>`;
  }
}

function renderQuota(quota) {
  const box = document.getElementById("quotaBox");
  if (quota.is_unlimited) {
    box.innerHTML = `<p class="unlimited">✓ 管理员账号 · AI 语义综合溯源不限量使用</p>`;
    return;
  }
  const balance = quota.rmb_balance.toFixed(4);
  const spent = quota.total_spent_rmb.toFixed(4);
  box.innerHTML = `
    <div class="quota-row"><span>剩余额度</span><strong>¥${balance}</strong></div>
    <div class="quota-row"><span>累计已用</span><span>¥${spent}</span></div>
    <div class="quota-row"><span>累计 token 数</span><span>${quota.total_tokens_used.toLocaleString()}</span></div>
    ${quota.rmb_balance <= 0 ? '<p class="error">额度已用完，请联系管理员充值。</p>' : ""}
  `;
}

document.getElementById("grantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("grantMsg");
  msg.textContent = "处理中…";
  msg.className = "form-msg";
  try {
    const result = await apiFetch("/api/dhamma/admin/grant", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("grantEmail").value.trim(),
        add_rmb: parseFloat(document.getElementById("grantAmount").value),
      }),
    });
    msg.textContent = result.is_unlimited
      ? `${result.email} 是管理员账号，无需充值。`
      : `已充值，${result.email} 当前余额 ¥${result.rmb_balance.toFixed(2)}`;
    msg.className = "form-msg success";
    e.target.reset();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "form-msg error";
  }
});

loadAccount();
