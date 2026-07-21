if (isLoggedIn()) {
  location.href = "account.html";
}

const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");

tabLogin.addEventListener("click", () => {
  tabLogin.classList.add("active");
  tabRegister.classList.remove("active");
  loginForm.hidden = false;
  registerForm.hidden = true;
});

tabRegister.addEventListener("click", () => {
  tabRegister.classList.add("active");
  tabLogin.classList.remove("active");
  registerForm.hidden = false;
  loginForm.hidden = true;
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("loginMsg");
  msg.textContent = "登录中…";
  msg.className = "form-msg";
  try {
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("loginEmail").value.trim(),
        password: document.getElementById("loginPassword").value,
      }),
    });
    setToken(data.access_token);
    location.href = "account.html";
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "form-msg error";
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("registerMsg");
  msg.textContent = "注册中…";
  msg.className = "form-msg";
  try {
    await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("registerEmail").value.trim(),
        display_name: document.getElementById("registerName").value.trim(),
        password: document.getElementById("registerPassword").value,
      }),
    });
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("registerEmail").value.trim(),
        password: document.getElementById("registerPassword").value,
      }),
    });
    setToken(data.access_token);
    location.href = "account.html";
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "form-msg error";
  }
});
