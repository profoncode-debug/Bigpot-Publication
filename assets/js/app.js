/* =========================================================================
   Bigpot Publication — interactions
   Catalogue from a published Google Sheet (falls back to data.js),
   search + filters, book preview, order list → WhatsApp, reveal, counters.
   ========================================================================= */
(function () {
  "use strict";

  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const CFG = window.SITE_CONFIG || {};
  const LABELS = (typeof CATEGORY_LABELS !== "undefined") ? CATEGORY_LABELS : {};
  const CART_KEY = "bigpot-order-v1";
  const DEFAULT_PRICE = Number(CFG.defaultPrice) > 0 ? Number(CFG.defaultPrice) : null;

  /* ====================================================== data layer */
  // Accepts a repo path ("RPF BOOKS/…/0.jpg"), a full URL, or a Google Drive
  // share link (file shared as "Anyone with the link").
  function toSrc(path) {
    if (!path) return "";
    const drive = path.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
    if (drive) return "https://lh3.googleusercontent.com/d/" + drive[1];
    return /^https?:\/\//.test(path) ? path : encodeURI(path);
  }

  // Sheet columns (row 1, any order): id · category · title · subtitle ·
  // tagline · edition · description · price · in_stock · images · sort_order
  function fromSheet(r, i) {
    const images = (r.images || "").split(/\s*[\n|]\s*/).filter(Boolean);
    const stock = (r.in_stock || "").trim().toLowerCase();
    const price = parseFloat(String(r.price || "").replace(/[^\d.]/g, ""));
    return {
      id: r.id || slugify(r.title) || "row-" + i,
      category: (r.category || "other").trim().toLowerCase(),
      title: r.title, subtitle: r.subtitle, tagline: r.tagline,
      edition: r.edition, description: r.description,
      price: isNaN(price) ? DEFAULT_PRICE : price,
      inStock: !["no", "false", "0", "out", "out of stock"].includes(stock),
      images,
      sort: parseFloat(r.sort_order) || i
    };
  }
  function fromLocal(b) {
    return {
      id: b.id, category: b.category, title: b.title, subtitle: b.subtitle,
      tagline: b.tagline, edition: b.edition, description: b.description,
      price: DEFAULT_PRICE, inStock: true, images: b.pages.map((f) => b.folder + "/" + f)
    };
  }
  const localBooks = () => ((typeof CATALOGUE !== "undefined") ? CATALOGUE : []).map(fromLocal);

  async function fetchSheetBooks() {
    if (!CFG.sheetCsvUrl) return [];
    const ctrl = "AbortController" in window ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), 8000);
    try {
      const res = await fetch(CFG.sheetCsvUrl, { signal: ctrl && ctrl.signal, cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = parseCSV(await res.text());
      if (rows.length < 2) return [];
      const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
      return rows.slice(1)
        .map((cells) => Object.fromEntries(head.map((h, i) => [h, (cells[i] || "").trim()])))
        .filter((r) => r.title)
        .map(fromSheet)
        .filter((b) => b.images.length)
        .sort((a, b) => a.sort - b.sort);
    } catch (err) {
      console.warn("[Bigpot] Sheet fetch failed — keeping the built-in list.", err);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  // Minimal RFC-4180 CSV parser (quotes, commas and newlines inside cells).
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = []; let row = []; let cell = ""; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /* ========================================================= helpers */
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function slugify(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const catLabel = (c) => LABELS[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : "");
  const catShort = (c) => c === "rpf" ? "RPF" : c === "engineering" ? "Engineering" : catLabel(c);
  const hasDevanagari = (s) => /[ऀ-ॿ]/.test(s || "");
  const icon = (id, size = 18) => `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"/></svg>`;

  function openWhatsApp(text) {
    const num = String(CFG.whatsappNumber || "").replace(/\D/g, "");
    const url = "https://wa.me/" + num + (text ? "?text=" + encodeURIComponent(text) : "");
    const win = window.open(url, "_blank");
    if (win) { try { win.opener = null; } catch (e) { /* ignore */ } }
    else window.location.href = url;
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-on"), 2200);
  }

  function lockScroll(on) { document.body.classList.toggle("is-locked", on); }

  /* =========================================================== state */
  let BOOKS = [];
  let filter = "all";
  let query = "";
  let expanded = false;
  const PAGE_SIZE = 8;              // books shown before "View all"
  const byId = (id) => BOOKS.find((b) => String(b.id) === String(id));

  /* ========================================================== order */
  let cart = loadCart();
  function loadCart() {
    try { const v = JSON.parse(localStorage.getItem(CART_KEY) || "{}"); return v && typeof v === "object" ? v : {}; }
    catch (e) { return {}; }
  }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* ignore */ } }
  const cartIds = () => Object.keys(cart).filter((id) => cart[id] > 0 && byId(id));
  const cartCount = () => cartIds().reduce((n, id) => n + cart[id], 0);

  function addToCart(id, silent) {
    const b = byId(id);
    if (!b || b.inStock === false) return;
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    syncCart(true);
    if (!silent) toast("Added “" + b.title + "” to your order");
  }
  function setQty(id, q) {
    if (q <= 0) delete cart[id]; else cart[id] = Math.min(q, 999);
    saveCart();
    syncCart();
  }

  function syncCart(bump) {
    const n = cartCount();
    const cc = $("#cartCount"), fc = $("#fabCount"), fab = $("#fab"), cb = $("#cartBtn");
    if (cc) { cc.textContent = n; cc.hidden = n === 0; }
    if (fc) fc.textContent = n;
    if (fab) fab.hidden = n === 0;
    if (bump && cb) { cb.classList.remove("bump"); void cb.offsetWidth; cb.classList.add("bump"); }
    // update card buttons
    $$(".card", grid).forEach((card) => {
      const btn = $("[data-action=add]", card);
      if (btn) paintAddBtn(btn, byId(card.dataset.id));
    });
    if (activeBook && lbAdd) paintAddBtn(lbAdd, activeBook, true);
    renderDrawer();
  }

  function paintAddBtn(btn, book, long) {
    if (!book) return;
    const q = cart[book.id] || 0;
    btn.disabled = book.inStock === false;
    btn.classList.toggle("btn--added", q > 0);
    btn.classList.toggle("btn--primary", q === 0);
    if (book.inStock === false) btn.innerHTML = "Out of stock";
    else if (q > 0) btn.innerHTML = icon("i-check", 16) + (long ? ` In your order (${q}) · add another` : ` Added${q > 1 ? " ×" + q : ""}`);
    else btn.innerHTML = icon("i-plus", 16) + (long ? " Add to my order" : " Add");
  }

  /* ------------------------------------------------------- drawer */
  const drawer = $("#drawer");
  function openDrawer() {
    renderDrawer();
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    lockScroll(true);
    setTimeout(() => $(".drawer__panel", drawer).focus({ preventScroll: true }), 50);
  }
  function closeDrawer() {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    if (!lb.classList.contains("is-open")) lockScroll(false);
  }

  function renderDrawer() {
    const body = $("#drawerItems"), foot = $("#orderForm"), total = $("#drawerTotal");
    if (!body) return;
    const ids = cartIds();
    if (!ids.length) {
      body.innerHTML = `
        <div class="drawer__empty">
          ${icon("i-bag", 48)}
          <p><b>Your order list is empty.</b></p>
          <p>Add books from the catalogue, then send them all in one WhatsApp message.</p>
          <a href="#catalogue" class="btn btn--primary" data-close>Browse the books</a>
        </div>`;
      foot.hidden = true;
      return;
    }
    foot.hidden = false;
    body.innerHTML = ids.map((id) => {
      const b = byId(id), q = cart[id];
      return `
        <div class="line" data-id="${escapeHtml(id)}">
          <img src="${escapeHtml(toSrc(b.images[0]))}" alt="" loading="lazy" />
          <div>
            <p class="line__title">${escapeHtml(b.title)}</p>
            <p class="line__meta">${escapeHtml(b.edition || catLabel(b.category))}${b.price != null ? " · " + rupees(b.price) : ""}</p>
            <button class="line__remove" type="button" data-line="remove">Remove</button>
          </div>
          <div class="qty" role="group" aria-label="Quantity">
            <button type="button" data-line="dec" aria-label="One less">${icon("i-minus", 14)}</button>
            <span>${q}</span>
            <button type="button" data-line="inc" aria-label="One more">${icon("i-plus", 14)}</button>
          </div>
        </div>`;
    }).join("");

    const n = cartCount();
    const allPriced = ids.every((id) => byId(id).price != null);
    const sum = ids.reduce((s, id) => s + (byId(id).price || 0) * cart[id], 0);
    total.innerHTML = allPriced
      ? `<span>${n} ${n === 1 ? "copy" : "copies"}</span><b>${rupees(sum)}</b>`
      : `<span>${n} ${n === 1 ? "copy" : "copies"}</span><small>We'll confirm the price on WhatsApp</small>`;
    const payBtn = $("#payBtn");
    if (payBtn) {
      payBtn.hidden = !allPriced || !CFG.upiId;
      $("#payBtnLabel").textContent = "Pay " + rupees(sum) + " via UPI";
    }
  }

  /* order summary text shared by "order now" and "I've paid" */
  function orderTotal() {
    const ids = cartIds();
    if (!ids.length || !ids.every((id) => byId(id).price != null)) return null;
    return ids.reduce((s, id) => s + byId(id).price * cart[id], 0);
  }
  function orderText(paid) {
    const ids = cartIds();
    const name = $("#oName").value.trim();
    const addr = $("#oAddr").value.trim();
    const lines = ids.map((id, i) => {
      const b = byId(id);
      return `${i + 1}. ${b.title}${b.edition ? " (" + b.edition + ")" : ""} × ${cart[id]}${b.price != null ? " — " + rupees(b.price * cart[id]) : ""}`;
    });
    let text = "Hello Bigpot Publication, I'd like to order:\n\n" + lines.join("\n");
    const total = orderTotal();
    if (total != null) text += "\n\nTotal: " + rupees(total);
    if (paid) text += "\nPayment: Paid " + rupees(total) + " via UPI (screenshot attached)";
    if (name) text += "\n\nName: " + name;
    if (addr) text += "\nDelivery address: " + addr;
    return text;
  }

  /* ------------------------------------------------------- UPI pay */
  const paybox = $("#paybox");
  function openPay() {
    const total = orderTotal();
    if (total == null || !paybox) return;
    $("#payAmount").textContent = rupees(total);
    $("#payUpiId").textContent = CFG.upiId;
    $("#payName").textContent = CFG.upiName || "";
    const params = new URLSearchParams({ pa: CFG.upiId, pn: CFG.upiName || "", am: total.toFixed(2), cu: "INR", tn: "Bigpot book order" });
    $("#payApp").href = "upi://pay?" + params.toString().replace(/\+/g, "%20");
    paybox.classList.add("is-open");
    paybox.setAttribute("aria-hidden", "false");
    lockScroll(true);
    setTimeout(() => $(".paybox__panel", paybox).focus({ preventScroll: true }), 50);
  }
  function closePay() {
    paybox.classList.remove("is-open");
    paybox.setAttribute("aria-hidden", "true");
    if (!drawer.classList.contains("is-open")) lockScroll(false);
  }
  if (paybox) {
    $$("[data-close]", paybox).forEach((el) => el.addEventListener("click", closePay));
    $("#payCopy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(CFG.upiId); toast("UPI ID copied"); }
      catch (e) { toast("UPI ID: " + CFG.upiId); }
    });
    $("#paidSend").addEventListener("click", () => openWhatsApp(orderText(true)));
  }

  if (drawer) {
    drawer.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) { closeDrawer(); return; }
      const act = e.target.closest("[data-line]");
      if (!act) return;
      const id = act.closest(".line").dataset.id;
      const q = cart[id] || 0;
      if (act.dataset.line === "inc") setQty(id, q + 1);
      if (act.dataset.line === "dec") setQty(id, q - 1);
      if (act.dataset.line === "remove") setQty(id, 0);
    });
    $("#orderForm").addEventListener("submit", (e) => {
      e.preventDefault();
      if (cartIds().length) openWhatsApp(orderText(false));
    });
    $("#payBtn").addEventListener("click", openPay);
  }
  ["#cartBtn", "#fab"].forEach((s) => { const el = $(s); if (el) el.addEventListener("click", openDrawer); });

  /* ====================================================== catalogue */
  const grid = $("#bookGrid");

  function cardMarkup(book) {
    const cat = book.category;
    const sold = book.inStock === false ? `<span class="card__badge">Out of stock</span>` : "";
    const price = book.price != null
      ? `<span class="card__price">${rupees(book.price)}</span>`
      : `<span class="card__price card__price--ask">Price on request</span>`;
    return `
      <article class="card reveal${cat === "engineering" ? " card--eng" : ""}" data-id="${escapeHtml(book.id)}" data-cat="${escapeHtml(cat)}">
        <button class="card__cover" type="button" data-action="preview" aria-label="Look inside ${escapeHtml(book.title)}">
          <span class="card__book"><img src="${escapeHtml(toSrc(book.images[0]))}" alt="" loading="lazy" /></span>
          ${sold}
          <span class="card__peek">${icon("i-eye", 14)} Look inside · ${book.images.length} pages</span>
        </button>
        <div class="card__body">
          <div class="card__meta">
            <span class="chip${cat === "engineering" ? " chip--eng" : ""}">${escapeHtml(catShort(cat))}</span>
            <span class="card__edition">${escapeHtml(book.edition || "")}</span>
          </div>
          <h3 class="card__title"${hasDevanagari(book.title) ? ' lang="hi"' : ""}>${escapeHtml(book.title)}</h3>
          <p class="card__sub"${hasDevanagari(book.subtitle) ? ' lang="hi"' : ""}>${escapeHtml(book.subtitle || book.tagline || "")}</p>
          <div class="card__foot">
            ${price}
            <button class="btn btn--primary btn--sm" type="button" data-action="add"></button>
          </div>
        </div>
      </article>`;
  }

  function renderGrid() {
    if (!grid) return;
    grid.innerHTML = BOOKS.map(cardMarkup).join("");
    $$(".card", grid).forEach((card) => paintAddBtn($("[data-action=add]", card), byId(card.dataset.id)));
    applyFilters();
    observeReveals();
    bindTilt();
  }

  grid && grid.addEventListener("click", (e) => {
    const act = e.target.closest("[data-action]");
    if (!act) return;
    const id = act.closest(".card").dataset.id;
    if (act.dataset.action === "preview") openLightbox(id);
    if (act.dataset.action === "add") {
      if (cart[id]) openDrawer(); else addToCart(id);
    }
  });

  /* gentle 3-D tilt of the cover on pointer devices */
  function bindTilt() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    $$(".card__cover", grid).forEach((cover) => {
      const book = $(".card__book", cover);
      cover.addEventListener("pointermove", (e) => {
        const r = cover.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5;
        const y = (e.clientY - r.top) / r.height - .5;
        book.style.setProperty("--ry", (x * 16).toFixed(1) + "deg");
        book.style.setProperty("--rx", (-y * 10).toFixed(1) + "deg");
      });
      cover.addEventListener("pointerleave", () => {
        book.style.setProperty("--ry", "0deg");
        book.style.setProperty("--rx", "0deg");
      });
    });
  }

  /* ---------------------------------------------- filters + search */
  function renderFilters() {
    const box = $("#filters");
    if (!box) return;
    const cats = [];
    BOOKS.forEach((b) => { if (!cats.includes(b.category)) cats.push(b.category); });
    if (filter !== "all" && !cats.includes(filter)) filter = "all";
    const pill = (key, label, n) =>
      `<button class="filter${filter === key ? " is-active" : ""}" type="button" data-filter="${escapeHtml(key)}" aria-pressed="${filter === key}">${escapeHtml(label)} <span class="filter__n">${n}</span></button>`;
    box.innerHTML = pill("all", "All books", BOOKS.length) +
      cats.map((c) => pill(c, catLabel(c), BOOKS.filter((b) => b.category === c).length)).join("");
  }

  function setFilter(key) {
    filter = key;
    $$(".filter").forEach((f) => {
      const on = f.dataset.filter === key;
      f.classList.toggle("is-active", on);
      f.setAttribute("aria-pressed", on);
    });
    applyFilters();
  }

  function applyFilters() {
    const q = query.trim().toLowerCase();
    const limit = (expanded || q) ? Infinity : PAGE_SIZE;   // a search always shows every match
    let matches = 0;
    $$(".card", grid).forEach((card) => {
      const b = byId(card.dataset.id);
      const hay = [b.title, b.subtitle, b.tagline, b.description, b.edition].join(" ").toLowerCase();
      const ok = (filter === "all" || b.category === filter) && (!q || q.split(/\s+/).every((w) => hay.includes(w)));
      if (ok) matches++;
      const show = ok && matches <= limit;
      card.classList.toggle("is-hidden", !show);
      if (show) card.classList.add("is-visible");
    });
    const empty = $("#gridEmpty");
    if (empty) empty.hidden = matches > 0;

    const wrap = $("#moreWrap"), btn = $("#moreBtn");
    if (wrap && btn) {
      wrap.hidden = !!q || matches <= PAGE_SIZE;
      wrap.classList.toggle("is-open", expanded);
      btn.innerHTML = (expanded ? "Show fewer " : `View all ${matches} books `) + icon("i-down", 18);
      btn.setAttribute("aria-expanded", String(expanded));
    }
  }

  const moreBtn = $("#moreBtn");
  moreBtn && moreBtn.addEventListener("click", () => {
    expanded = !expanded;
    applyFilters();
    if (!expanded) $("#catalogue").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const filtersBox = $("#filters");
  filtersBox && filtersBox.addEventListener("click", (e) => {
    const f = e.target.closest(".filter");
    if (f) setFilter(f.dataset.filter);
  });
  const search = $("#bookSearch");
  search && search.addEventListener("input", () => { query = search.value; applyFilters(); });

  $$("[data-goto-filter]").forEach((a) => a.addEventListener("click", () => setFilter(a.dataset.gotoFilter)));

  /* ---------------------------------------------- hero cover carousel */
  // Every book from the catalogue takes a turn in the centre; the row slides
  // one step left every few seconds. Hover pauses it; click a side book to
  // bring it forward, click the centre book to look inside.
  const heroBox = $("#heroBooks");
  let heroIdx = 0, heroTimer = null;
  const HERO_DELAY = 3200;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function renderHeroBooks() {
    if (!heroBox || !BOOKS.length) return;
    // first build starts on the 2nd book; a re-build (live Sheet arriving) keeps its place
    heroIdx = heroBox.childElementCount ? Math.min(heroIdx, BOOKS.length - 1) : Math.min(1, BOOKS.length - 1);
    heroBox.innerHTML = BOOKS.map((b, i) =>
      `<button class="hero__book" type="button" data-i="${i}" aria-label="${escapeHtml(b.title)}"><img src="${escapeHtml(toSrc(b.images[0]))}" alt="" ${i > 3 ? 'loading="lazy"' : ""} /></button>`
    ).join("");
    layoutHero();
    startHero();
  }

  function layoutHero() {
    const n = BOOKS.length;
    $$(".hero__book", heroBox).forEach((el) => {
      const off = ((+el.dataset.i - heroIdx) % n + n) % n;     // 0 = centre
      let pos;
      if (off === 0) pos = "is-center";
      else if (off === 1) pos = "is-right";
      else if (off === n - 1) pos = "is-left";
      else pos = off <= n / 2 ? "is-out-right" : "is-out-left";
      el.className = "hero__book " + pos;
      el.tabIndex = pos === "is-center" || pos === "is-left" || pos === "is-right" ? 0 : -1;
    });
  }

  function heroGo(i) {
    const n = BOOKS.length;
    heroIdx = ((i % n) + n) % n;
    layoutHero();
  }
  function startHero() {
    stopHero();
    if (reduceMotion || BOOKS.length < 2) return;
    heroTimer = setInterval(() => { if (!document.hidden) heroGo(heroIdx + 1); }, HERO_DELAY);
  }
  function stopHero() { clearInterval(heroTimer); heroTimer = null; }

  if (heroBox) {
    heroBox.addEventListener("click", (e) => {
      const el = e.target.closest(".hero__book");
      if (!el) return;
      if (el.classList.contains("is-center")) openLightbox(BOOKS[+el.dataset.i].id);
      else { heroGo(+el.dataset.i); startHero(); }
    });
    heroBox.addEventListener("mouseenter", stopHero);
    heroBox.addEventListener("mouseleave", startHero);
    heroBox.addEventListener("focusin", stopHero);
    heroBox.addEventListener("focusout", startHero);
    // swipe left / right on phones
    let hx = null, swiped = false;
    heroBox.addEventListener("touchstart", (e) => { hx = e.touches[0].clientX; swiped = false; stopHero(); }, { passive: true });
    heroBox.addEventListener("touchend", (e) => {
      if (hx == null) return;
      const dx = e.changedTouches[0].clientX - hx;
      if (Math.abs(dx) > 35) { swiped = true; heroGo(heroIdx + (dx < 0 ? 1 : -1)); }
      hx = null;
      startHero();
    });
    heroBox.addEventListener("click", (e) => { if (swiped) { e.stopImmediatePropagation(); swiped = false; } }, true);
  }

  /* ======================================================= lightbox */
  const lb = $("#lightbox");
  const lbImg = $("#lbImg"), lbThumbs = $("#lbThumbs"), lbCount = $("#lbCount");
  const lbAdd = $("#lbAdd"), lbOrder = $("#lbOrder");
  let activeBook = null, activeIndex = 0, lastFocus = null;

  function openLightbox(id) {
    activeBook = byId(id);
    if (!activeBook) return;
    lastFocus = document.activeElement;
    const b = activeBook;
    activeIndex = 0;

    const cat = $("#lbCat");
    cat.textContent = catLabel(b.category);
    cat.classList.toggle("chip--eng", b.category === "engineering");
    $("#lbTitle").textContent = b.title;
    const sub = $("#lbSub");
    sub.textContent = b.subtitle || "";
    sub.setAttribute("lang", hasDevanagari(b.subtitle) ? "hi" : "en");
    $("#lbEdition").textContent = [b.tagline, b.edition].filter(Boolean).join(" · ");
    $("#lbDesc").textContent = b.description || "";
    $("#lbDesc").hidden = !b.description;
    const price = $("#lbPrice");
    price.textContent = b.price != null ? rupees(b.price) : "Price on request — we'll confirm on WhatsApp";
    price.classList.toggle("lightbox__price--ask", b.price == null);
    paintAddBtn(lbAdd, b, true);
    lbOrder.disabled = b.inStock === false;

    lbThumbs.innerHTML = b.images
      .map((p, i) => `<img src="${escapeHtml(toSrc(p))}" alt="Page ${i + 1}" data-i="${i}" loading="lazy" />`).join("");

    showPage(0);
    lb.classList.add("is-open");
    lb.setAttribute("aria-hidden", "false");
    lockScroll(true);
    setTimeout(() => $(".lightbox__panel", lb).focus({ preventScroll: true }), 50);
  }

  function showPage(i) {
    if (!activeBook) return;
    const n = activeBook.images.length;
    activeIndex = (i + n) % n;
    lbImg.classList.add("is-loading");
    lbImg.onload = () => lbImg.classList.remove("is-loading");
    lbImg.src = toSrc(activeBook.images[activeIndex]);
    lbImg.alt = `${activeBook.title} — page ${activeIndex + 1}`;
    lbCount.textContent = `${activeIndex + 1} / ${n}`;
    $$("img", lbThumbs).forEach((t, idx) => t.classList.toggle("is-active", idx === activeIndex));
    const at = lbThumbs.children[activeIndex];
    if (at) at.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    const nn = activeBook.images[(activeIndex + 1) % n];
    if (nn) { const pre = new Image(); pre.src = toSrc(nn); }
  }

  function closeLightbox() {
    lb.classList.remove("is-open");
    lb.setAttribute("aria-hidden", "true");
    activeBook = null;
    if (!drawer.classList.contains("is-open")) lockScroll(false);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  if (lb) {
    $$("[data-close]", lb).forEach((el) => el.addEventListener("click", closeLightbox));
    $("#lbPrev").addEventListener("click", () => showPage(activeIndex - 1));
    $("#lbNext").addEventListener("click", () => showPage(activeIndex + 1));
    lbThumbs.addEventListener("click", (e) => { const t = e.target.closest("img"); if (t) showPage(+t.dataset.i); });
    lbAdd.addEventListener("click", () => { if (activeBook) addToCart(activeBook.id); });
    lbOrder.addEventListener("click", () => {
      const b = activeBook;
      if (!b || b.inStock === false) return;
      const line = [b.title, b.edition, b.price != null ? rupees(b.price) : ""].filter(Boolean).join(" · ");
      openWhatsApp("Hello Bigpot Publication, I'd like to order:\n\n• " + line + "\n\nQuantity: 1\nName: \nDelivery address: ");
    });

    // swipe between pages on touch screens
    let sx = null;
    const stage = $(".lightbox__stage", lb);
    stage.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener("touchend", (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 40) showPage(activeIndex + (dx < 0 ? 1 : -1));
      sx = null;
    });
  }

  document.addEventListener("keydown", (e) => {
    if (lb && lb.classList.contains("is-open")) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showPage(activeIndex - 1);
      if (e.key === "ArrowRight") showPage(activeIndex + 1);
    } else if (paybox && paybox.classList.contains("is-open") && e.key === "Escape") {
      closePay();
    } else if (drawer && drawer.classList.contains("is-open") && e.key === "Escape") {
      closeDrawer();
    }
  });

  /* ================================================= page chrome */
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  $$("[data-wa-direct]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    openWhatsApp("Hello Bigpot Publication, I have a question about your books.");
  }));

  const header = $("#header");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const toggle = $("#navToggle"), nav = $("#nav");
  if (toggle && nav) {
    const setNav = (open) => {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      header.classList.toggle("is-scrolled", open || window.scrollY > 24);
    };
    toggle.addEventListener("click", () => setNav(!nav.classList.contains("is-open")));
    $$("a", nav).forEach((a) => a.addEventListener("click", () => setNav(false)));
    document.addEventListener("click", (e) => {
      if (nav.classList.contains("is-open") && !nav.contains(e.target) && !toggle.contains(e.target)) setNav(false);
    });
  }

  /* enquiry form → WhatsApp */
  const form = $("#contactForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#cName").value.trim(), books = $("#cBooks").value.trim(), msg = $("#cMsg").value.trim();
      const note = $("#formNote");
      $("#cName").closest(".field").classList.toggle("is-invalid", !name);
      $("#cBooks").closest(".field").classList.toggle("is-invalid", !books);
      if (!name || !books) {
        showNote(note, "Please add your name and the books or topic you're asking about.", true);
        return;
      }
      let text = "Hello Bigpot Publication,\n\nName: " + name + "\nEnquiry: " + books;
      if (msg) text += "\n\n" + msg;
      openWhatsApp(text);
      showNote(note, "Opening WhatsApp — just press send there.", false);
    });
  }
  function showNote(el, msg, isError) {
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle("form-note--error", !!isError);
  }

  /* ================================================= reveal + counters */
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          en.target.classList.add("is-visible");
          $$("[data-count]", en.target).forEach(countUp);
          io.unobserve(en.target);
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" })
    : null;

  function observeReveals() {
    $$(".reveal:not(.is-visible)").forEach((el, i) => {
      if (io) {
        if (el.classList.contains("card")) el.style.transitionDelay = (i % 4) * 60 + "ms";
        io.observe(el);
      } else el.classList.add("is-visible");
    });
  }

  function countUp(el) {
    const to = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || "";
    if (isNaN(to) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = to + suffix; return; }
    const t0 = performance.now(), dur = 1100;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ============================================================ init */
  function render() {
    renderFilters();
    renderGrid();
    renderHeroBooks();
    syncCart();
  }

  async function init() {
    observeReveals();
    BOOKS = localBooks();          // instant content — never an empty page
    render();
    const live = await fetchSheetBooks();
    if (live.length) {
      BOOKS = live;
      render();
    }
  }
  init();
})();
