/* =========================================================================
   Bigpot Publication — admin panel
   Role-gated (profiles.role = 'admin'): manage books (+ image upload) & orders.
   ========================================================================= */
(function () {
  "use strict";

  const sb = window.sb;
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  const gate = $("#gate"), dash = $("#dash"), gateMsg = $("#gateMsg");

  if (!window.SUPABASE_ENABLED) {
    gate.classList.remove("hide");
    gateMsg.innerHTML = "Supabase isn't configured yet. Add your project URL + anon key in " +
      "<code>assets/js/supabase.js</code>, then reload.";
    $("#gateForm").classList.add("hide");
    return;
  }

  const BUCKET = "book-images";
  let editorPages = [];   // current book's image paths/URLs
  let editingId = null;

  /* ----------------------------------------------------- auth gate */
  async function boot() {
    let user = null;
    try {
      const { data } = await sb.auth.getSession();   // instant, no network dependency
      user = data && data.session ? data.session.user : null;
    } catch (_) {}
    if (!user) { showGate(); return; }

    // verify admin role
    let role = null;
    try {
      const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).single();
      role = prof && prof.role;
    } catch (_) {}
    if (role !== "admin") {
      showGate("This account isn't an admin. Ask the owner to set your role to 'admin', or sign in with the admin account.");
      await sb.auth.signOut();
      return;
    }
    $("#adminUser").textContent = user.email;
    gate.classList.add("hide");
    dash.classList.remove("hide");
    loadBooks();
    loadOrders();
  }

  function showGate(msg) {
    dash.classList.add("hide");
    gate.classList.remove("hide");
    $("#gateForm").classList.remove("hide");
    if (msg) gateMsg.textContent = msg;
  }

  $("#gateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#gEmail").value.trim(), password = $("#gPassword").value;
    gateMsg.textContent = "Signing in…";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { gateMsg.textContent = error.message; return; }
    boot();
  });

  $("#logoutBtn").addEventListener("click", async () => { await sb.auth.signOut(); showGate("Signed out."); });

  /* ----------------------------------------------------- tabs */
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.remove("is-active"));
    t.classList.add("is-active");
    $$(".panel").forEach((p) => p.classList.remove("is-active"));
    $("#panel-" + t.dataset.tab).classList.add("is-active");
  }));

  /* ----------------------------------------------------- notices */
  function notice(msg, ok) {
    const el = $("#adminNotice");
    el.innerHTML = `<div class="notice ${ok ? "notice--ok" : "notice--err"}">${escapeHtml(msg)}</div>`;
    setTimeout(() => { el.innerHTML = ""; }, 4000);
  }

  /* ----------------------------------------------------- BOOKS */
  function imgSrc(p) { return /^https?:\/\//.test(p) ? p : encodeURI(p); }

  async function loadBooks() {
    const body = $("#booksBody");
    const { data, error } = await sb.from("books").select("*").order("sort_order", { ascending: true });
    if (error) { body.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`; return; }
    if (!data.length) { body.innerHTML = `<tr><td colspan="7" style="color:var(--mute)">No books yet — add one.</td></tr>`; return; }
    body.innerHTML = data.map((b) => `
      <tr data-id="${b.id}">
        <td>${b.cover_path ? `<img class="thumb" src="${imgSrc(b.cover_path)}" alt="" />` : "—"}</td>
        <td><strong>${escapeHtml(b.title)}</strong><br><span style="color:var(--mute);font-size:.8rem">${escapeHtml(b.subtitle || "")}</span></td>
        <td>${b.category === "rpf" ? "RPF" : "Engineering"}</td>
        <td>${escapeHtml(b.edition || "")}</td>
        <td>${b.in_stock ? "Yes" : "No"}</td>
        <td>${b.sort_order}</td>
        <td><div class="row-actions">
          <button class="mini" data-edit="${b.id}">Edit</button>
          <button class="mini mini--danger" data-del="${b.id}">Delete</button>
        </div></td>
      </tr>`).join("");

    window._books = data;
    $$("[data-edit]", body).forEach((btn) => btn.addEventListener("click", () => openEditor(data.find((x) => x.id === btn.dataset.edit))));
    $$("[data-del]", body).forEach((btn) => btn.addEventListener("click", () => deleteBook(btn.dataset.del)));
  }

  async function deleteBook(id) {
    if (!confirm("Delete this book? This cannot be undone.")) return;
    const { error } = await sb.from("books").delete().eq("id", id);
    if (error) return notice(error.message, false);
    notice("Book deleted.", true);
    loadBooks();
  }

  /* ---------------------------- book editor ---------------------------- */
  const bookModal = $("#bookModal");
  function openModal(m) { m.classList.add("is-open"); m.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; }
  function closeModal(m) { m.classList.remove("is-open"); m.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; }
  $$("[data-close]", bookModal).forEach((el) => el.addEventListener("click", () => closeModal(bookModal)));

  $("#addBookBtn").addEventListener("click", () => openEditor(null));

  function openEditor(book) {
    editingId = book ? book.id : null;
    editorPages = book && Array.isArray(book.pages) ? book.pages.slice() : [];
    $("#bookModalTitle").textContent = book ? "Edit book" : "Add book";
    $("#bTitle").value = book ? book.title || "" : "";
    $("#bSlug").value = book ? book.slug || "" : "";
    $("#bSubtitle").value = book ? book.subtitle || "" : "";
    $("#bTagline").value = book ? book.tagline || "" : "";
    $("#bCategory").value = book ? book.category || "rpf" : "rpf";
    $("#bEdition").value = book ? book.edition || "" : "";
    $("#bPrice").value = book && book.price != null ? book.price : "";
    $("#bSort").value = book ? book.sort_order : 100;
    $("#bDesc").value = book ? book.description || "" : "";
    $("#bStock").checked = book ? book.in_stock !== false : true;
    $("#bImages").value = "";
    $("#bookFormMsg").hidden = true;
    renderStrip();
    openModal(bookModal);
  }

  function renderStrip() {
    const strip = $("#bImgStrip");
    strip.innerHTML = editorPages.map((p, i) => `
      <figure><img src="${imgSrc(p)}" alt="" /><button type="button" data-rm="${i}" aria-label="Remove">&times;</button></figure>`).join("");
    $$("[data-rm]", strip).forEach((b) => b.addEventListener("click", () => { editorPages.splice(parseInt(b.dataset.rm, 10), 1); renderStrip(); }));
  }

  $("#bImages").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const slug = ($("#bSlug").value.trim() || "book").replace(/[^\w\-]+/g, "-").toLowerCase();
    const msg = $("#bookFormMsg");
    msg.hidden = false; msg.textContent = "Uploading…"; msg.classList.remove("auth-msg--error");
    try {
      for (const file of files) {
        const clean = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${slug}/${Date.now()}_${clean}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
        if (error) throw error;
        const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
        editorPages.push(data.publicUrl);
      }
      msg.textContent = "Images added.";
      renderStrip();
    } catch (err) {
      msg.textContent = err.message || "Upload failed."; msg.classList.add("auth-msg--error");
    }
    e.target.value = "";
  });

  $("#bookForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#bookFormMsg");
    const row = {
      slug: $("#bSlug").value.trim(),
      title: $("#bTitle").value.trim(),
      subtitle: $("#bSubtitle").value.trim() || null,
      tagline: $("#bTagline").value.trim() || null,
      category: $("#bCategory").value,
      edition: $("#bEdition").value.trim() || null,
      price: $("#bPrice").value ? Number($("#bPrice").value) : null,
      sort_order: parseInt($("#bSort").value, 10) || 0,
      description: $("#bDesc").value.trim() || null,
      in_stock: $("#bStock").checked,
      pages: editorPages,
      cover_path: editorPages[0] || null
    };
    if (!row.slug || !row.title) { msg.hidden = false; msg.textContent = "Title and slug are required."; msg.classList.add("auth-msg--error"); return; }

    $("#bookSaveBtn").disabled = true;
    try {
      let error;
      if (editingId) ({ error } = await sb.from("books").update(row).eq("id", editingId));
      else ({ error } = await sb.from("books").insert(row));
      if (error) throw error;
      closeModal(bookModal);
      notice("Book saved.", true);
      loadBooks();
    } catch (err) {
      msg.hidden = false; msg.textContent = err.message || "Could not save."; msg.classList.add("auth-msg--error");
    } finally {
      $("#bookSaveBtn").disabled = false;
    }
  });

  /* ----------------------------------------------------- ORDERS */
  async function loadOrders() {
    const body = $("#ordersBody");
    const filter = $("#orderFilter").value;
    let q = sb.from("orders").select("*").order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) { body.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`; return; }
    if (!data.length) { body.innerHTML = `<tr><td colspan="6" style="color:var(--mute)">No orders.</td></tr>`; return; }
    const statuses = ["new", "contacted", "fulfilled", "cancelled"];
    body.innerHTML = data.map((o) => `
      <tr data-id="${o.id}">
        <td style="white-space:nowrap">${new Date(o.created_at).toLocaleDateString()}<br><span style="color:var(--mute);font-size:.75rem">${new Date(o.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></td>
        <td>${escapeHtml(o.name || "")}</td>
        <td>${escapeHtml(o.contact || "")}</td>
        <td>${escapeHtml(o.books_requested || "—")}</td>
        <td style="max-width:240px">${escapeHtml(o.message || "")}</td>
        <td><select class="statussel" data-status="${o.id}">${statuses.map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      </tr>`).join("");
    $$("[data-status]", body).forEach((sel) => sel.addEventListener("change", async () => {
      const { error } = await sb.from("orders").update({ status: sel.value }).eq("id", sel.dataset.status);
      notice(error ? error.message : "Order updated.", !error);
    }));
  }
  $("#orderFilter").addEventListener("change", loadOrders);

  /* ----------------------------------------------------- utils */
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  boot();
})();
