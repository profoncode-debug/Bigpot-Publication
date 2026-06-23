/* =========================================================================
   Bigpot Publication — authentication (customers + admin)
   Renders the header account UI, the login/sign-up modal and "My orders".
   Quietly does nothing until Supabase is configured (see supabase.js).
   ========================================================================= */
(function () {
  "use strict";

  const sb = window.sb;
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  const area = $("#authArea");
  if (!area) return;

  // No backend yet → keep the header clean (login can't work offline).
  if (!window.SUPABASE_ENABLED) { area.hidden = true; return; }

  const modal       = $("#authModal");
  const ordersModal = $("#ordersModal");
  const msg         = $("#authMsg");
  const formEl      = $("#authForm");
  const tabLogin    = $("#authTabLogin");
  const tabSignup   = $("#authTabSignup");
  const nameField   = $("#authNameField");
  const phoneField  = $("#authPhoneField");
  const submitBtn   = $("#authSubmit");
  const magicBtn    = $("#authMagic");

  let mode = "login";          // "login" | "signup"
  let currentUser = null;
  let isAdmin = false;

  /* --------------------------------------------------- modal helpers */
  function openModal(m) { m.classList.add("is-open"); m.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; }
  function closeModal(m) { m.classList.remove("is-open"); m.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; }
  function setMsg(text, isErr) { if (!msg) return; msg.textContent = text || ""; msg.hidden = !text; msg.classList.toggle("auth-msg--error", !!isErr); }

  function setMode(next) {
    mode = next;
    tabLogin.classList.toggle("is-active", mode === "login");
    tabSignup.classList.toggle("is-active", mode === "signup");
    const signup = mode === "signup";
    nameField.hidden = !signup;
    phoneField.hidden = !signup;
    submitBtn.textContent = signup ? "Create account" : "Sign in";
    setMsg("");
  }

  /* --------------------------------------------------- header render */
  function initials(name, email) {
    const base = (name || email || "?").trim();
    return base.slice(0, 1).toUpperCase();
  }

  function renderArea() {
    if (!currentUser) {
      area.innerHTML = `<button class="authbtn" id="authBtn">Log in</button>`;
      $("#authBtn").addEventListener("click", () => { setMode("login"); openModal(modal); });
      return;
    }
    const name = (currentUser.user_metadata && currentUser.user_metadata.full_name) || currentUser.email;
    area.innerHTML = `
      <div class="acct">
        <button class="acct__btn" id="acctBtn" aria-expanded="false">
          <span class="acct__avatar">${initials(name, currentUser.email)}</span>
          <span class="acct__name">${escapeHtml(firstName(name))}</span>
          <span class="acct__chev" aria-hidden="true">▾</span>
        </button>
        <div class="acct__menu" id="acctMenu" hidden>
          <p class="acct__email">${escapeHtml(currentUser.email)}</p>
          <button class="acct__item" id="miOrders">My orders</button>
          ${isAdmin ? `<a class="acct__item" href="admin.html">Admin panel</a>` : ""}
          <button class="acct__item acct__item--out" id="miLogout">Log out</button>
        </div>
      </div>`;
    const btn = $("#acctBtn"), menu = $("#acctMenu");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hasAttribute("hidden");
      menu.toggleAttribute("hidden", !open);
      btn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", () => { if (menu && !menu.hasAttribute("hidden")) { menu.setAttribute("hidden", ""); btn.setAttribute("aria-expanded", "false"); } });
    $("#miLogout").addEventListener("click", doLogout);
    $("#miOrders").addEventListener("click", openOrders);
  }

  /* --------------------------------------------------- session */
  async function refreshUser() {
    // getSession() reads from local storage instantly (no network), so the
    // header never waits on a slow/failed request to draw the button.
    try {
      const { data } = await sb.auth.getSession();
      currentUser = data && data.session ? data.session.user : null;
    } catch (_) {
      currentUser = null;
    }
    isAdmin = false;
    renderArea();                       // draw Log in / account right away
    if (currentUser) {
      try {
        const { data: prof } = await sb.from("profiles").select("role").eq("id", currentUser.id).single();
        isAdmin = prof && prof.role === "admin";
        if (isAdmin) renderArea();      // re-draw to add the Admin link
      } catch (_) { /* profile may not be readable yet */ }
    }
  }

  sb.auth.onAuthStateChange(() => { refreshUser(); });

  /* --------------------------------------------------- submit */
  if (formEl) {
    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#authEmail").value.trim();
      const password = $("#authPassword").value;
      submitBtn.disabled = true;
      setMsg("Please wait…");
      try {
        if (mode === "signup") {
          const full_name = $("#authName").value.trim();
          const phone = $("#authPhone").value.trim();
          const { data, error } = await sb.auth.signUp({
            email, password, options: { data: { full_name, phone } }
          });
          if (error) throw error;
          if (data.session) { setMsg("Account created — you're in!"); setTimeout(() => closeModal(modal), 700); }
          else setMsg("Check your email to confirm your account, then log in.");
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
          setMsg("Signed in!");
          setTimeout(() => closeModal(modal), 500);
        }
      } catch (err) {
        setMsg(err.message || "Something went wrong.", true);
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  if (magicBtn) {
    magicBtn.addEventListener("click", async () => {
      const email = $("#authEmail").value.trim();
      if (!email) { setMsg("Enter your email first, then tap the magic link.", true); return; }
      setMsg("Sending a sign-in link…");
      try {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split("#")[0] } });
        if (error) throw error;
        setMsg("Magic link sent — check your inbox.");
      } catch (err) { setMsg(err.message || "Could not send link.", true); }
    });
  }

  async function doLogout() {
    await sb.auth.signOut();
    currentUser = null; isAdmin = false;
    renderArea();
  }

  /* --------------------------------------------------- my orders */
  async function openOrders() {
    const list = $("#ordersList");
    openModal(ordersModal);
    list.innerHTML = `<p class="orders__empty">Loading…</p>`;
    try {
      const { data, error } = await sb.from("orders")
        .select("created_at, books_requested, message, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!data.length) { list.innerHTML = `<p class="orders__empty">You have no orders yet.</p>`; return; }
      list.innerHTML = data.map((o) => `
        <div class="orow">
          <div class="orow__top">
            <span class="orow__date">${new Date(o.created_at).toLocaleDateString()}</span>
            <span class="orow__status orow__status--${o.status}">${o.status}</span>
          </div>
          <p class="orow__books">${escapeHtml(o.books_requested || "—")}</p>
          ${o.message ? `<p class="orow__msg">${escapeHtml(o.message)}</p>` : ""}
        </div>`).join("");
    } catch (err) {
      list.innerHTML = `<p class="orders__empty">Could not load orders.</p>`;
    }
  }

  /* --------------------------------------------------- wire modals */
  if (modal) {
    $$("[data-close]", modal).forEach((el) => el.addEventListener("click", () => closeModal(modal)));
    tabLogin.addEventListener("click", () => setMode("login"));
    tabSignup.addEventListener("click", () => setMode("signup"));
    setMode("login");
  }
  if (ordersModal) {
    $$("[data-close]", ordersModal).forEach((el) => el.addEventListener("click", () => closeModal(ordersModal)));
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modal && modal.classList.contains("is-open")) closeModal(modal);
    if (ordersModal && ordersModal.classList.contains("is-open")) closeModal(ordersModal);
  });

  /* --------------------------------------------------- utils */
  function firstName(s) { return String(s || "").split(/[\s@]/)[0]; }
  function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  /* --------------------------------------------------- go */
  renderArea();      // instant "Log in" button — never blank while auth loads
  refreshUser();     // then reflect the real session (account menu / admin)
})();
