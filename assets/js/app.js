/* =========================================================================
   Bigpot Publication — interactions
   Loads the catalogue from Supabase (falls back to data.js when offline /
   unconfigured), then wires filters · lightbox · order capture · reveal · nav
   ========================================================================= */
(function () {
  "use strict";

  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const sb = window.sb;
  const SUPA = !!window.SUPABASE_ENABLED;

  /* ---------------------------------------------------------------- year */
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ------------------------------------------------ image src helper */
  // Accepts a relative repo path ("RPF BOOKS/…/0.jpg") or a full storage URL.
  function toSrc(path) {
    if (!path) return "";
    return /^https?:\/\//.test(path) ? path : encodeURI(path);
  }

  /* ------------------------------------------------ normalise records */
  function fromDB(b) {
    const imgs = (Array.isArray(b.pages) && b.pages.length ? b.pages : [b.cover_path]).filter(Boolean);
    return {
      id: b.slug || b.id, category: b.category, title: b.title, subtitle: b.subtitle,
      tagline: b.tagline, edition: b.edition, description: b.description,
      price: b.price, inStock: b.in_stock !== false, images: imgs
    };
  }
  function fromLocal(b) {
    return {
      id: b.id, category: b.category, title: b.title, subtitle: b.subtitle,
      tagline: b.tagline, edition: b.edition, description: b.description,
      price: null, inStock: true, images: b.pages.map((f) => b.folder + "/" + f)
    };
  }

  function localBooks() {
    const local = (typeof CATALOGUE !== "undefined") ? CATALOGUE : [];
    return local.map(fromLocal);
  }

  // Fetch live books, but never hang: time out and return [] on any problem.
  async function fetchDBBooks() {
    if (!SUPA) return [];
    try {
      const query = sb
        .from("books")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      const timeout = new Promise((resolve) =>
        setTimeout(() => resolve({ data: null, error: "timeout" }), 6000)
      );
      const { data, error } = await Promise.race([query, timeout]);
      if (error) throw error;
      return (data || []).map(fromDB);
    } catch (err) {
      console.warn("[Bigpot] Catalogue fetch failed — keeping the built-in list.", err);
      return [];
    }
  }

  /* ------------------------------------------------------------- state */
  let BOOKS = [];
  const grid = $("#bookGrid");

  /* ----------------------------------------------------- render cards */
  function cardMarkup(book) {
    const badge = book.category === "rpf" ? "RPF" : "ENGG";
    const pages = book.images.length;
    const soldOut = book.inStock === false
      ? `<span class="card__badge card__badge--out">Out of stock</span>` : "";
    return `
      <article class="card reveal" data-id="${escapeAttr(book.id)}" data-cat="${book.category}">
        <button class="card__media" type="button" aria-label="Preview ${escapeAttr(book.title)}">
          <img class="card__img" src="${toSrc(book.images[0])}" alt="${escapeAttr(book.title)} cover" loading="lazy" />
          <span class="card__badge">${badge}</span>
          ${soldOut}
          <span class="card__pages">${pages} pages</span>
          <span class="card__view">View sample pages &rarr;</span>
        </button>
        <div class="card__body">
          <p class="card__tag">${escapeHtml(book.tagline || "")}</p>
          <h3 class="card__title">${escapeHtml(book.title)}</h3>
          <p class="card__sub">${escapeHtml(book.subtitle || "")}</p>
          <div class="card__foot">
            <span class="card__edition">${escapeHtml(book.edition || "")}</span>
            <span class="card__arrow" aria-hidden="true">&rarr;</span>
          </div>
        </div>
      </article>`;
  }

  function renderGrid() {
    if (!grid) return;
    if (!BOOKS.length) {
      grid.innerHTML = `<p class="grid__empty">No titles to show yet.</p>`;
      return;
    }
    grid.innerHTML = BOOKS.map(cardMarkup).join("");
    $$(".card__media", grid).forEach((btn) => {
      btn.addEventListener("click", () => openLightbox(btn.closest(".card").dataset.id));
    });
    observeReveals();
  }

  /* ----------------------------------------------------------- filtering */
  function bindFilters() {
    const filters = $$(".filter");
    filters.forEach((f) => {
      f.addEventListener("click", () => {
        filters.forEach((x) => x.classList.remove("is-active"));
        f.classList.add("is-active");
        const want = f.dataset.filter;
        $$(".card", grid).forEach((card) => {
          card.classList.toggle("is-hidden", !(want === "all" || card.dataset.cat === want));
        });
      });
    });
    const apply = (name) => {
      const btn = filters.find((f) => f.dataset.filter === name);
      if (btn) btn.click();
    };
    $$('a[href="#rpf"]').forEach((a) => a.addEventListener("click", () => setTimeout(() => apply("rpf"), 50)));
    $$('a[href="#engineering"]').forEach((a) => a.addEventListener("click", () => setTimeout(() => apply("engineering"), 50)));
  }

  /* ------------------------------------------------------------ lightbox */
  const lb       = $("#lightbox");
  const lbImg    = $("#lbImg");
  const lbTitle  = $("#lbTitle");
  const lbSub    = $("#lbSub");
  const lbCat    = $("#lbCat");
  const lbCount  = $("#lbCount");
  const lbThumbs = $("#lbThumbs");
  const lbPrev   = $("#lbPrev");
  const lbNext   = $("#lbNext");
  const lbOrder  = $("#lbOrder");

  let activeBook = null;
  let activeIndex = 0;

  function openLightbox(id) {
    activeBook = BOOKS.find((b) => String(b.id) === String(id));
    if (!activeBook) return;
    activeIndex = 0;

    const LABELS = (typeof CATEGORY_LABELS !== "undefined") ? CATEGORY_LABELS : {};
    lbCat.textContent   = LABELS[activeBook.category] || "";
    lbTitle.textContent = activeBook.title;
    lbSub.textContent   = activeBook.subtitle || "";

    lbThumbs.innerHTML = activeBook.images
      .map((p, i) => `<img src="${toSrc(p)}" alt="Page ${i + 1}" data-i="${i}" />`)
      .join("");
    $$("img", lbThumbs).forEach((t) => t.addEventListener("click", () => showPage(parseInt(t.dataset.i, 10))));

    showPage(0);
    lb.classList.add("is-open");
    lb.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function showPage(i) {
    if (!activeBook) return;
    const n = activeBook.images.length;
    activeIndex = (i + n) % n;
    lbImg.src = toSrc(activeBook.images[activeIndex]);
    lbImg.alt = `${activeBook.title} — page ${activeIndex + 1}`;
    lbCount.textContent = `Page ${activeIndex + 1} / ${n}`;
    $$("img", lbThumbs).forEach((t, idx) => t.classList.toggle("is-active", idx === activeIndex));
    const at = lbThumbs.children[activeIndex];
    if (at) at.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  function closeLightbox() {
    lb.classList.remove("is-open");
    lb.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  if (lb) {
    $$("[data-close]", lb).forEach((el) => el.addEventListener("click", closeLightbox));
    lbPrev.addEventListener("click", () => showPage(activeIndex - 1));
    lbNext.addEventListener("click", () => showPage(activeIndex + 1));
    if (lbOrder) {
      lbOrder.addEventListener("click", () => {
        if (activeBook) prefillOrder(activeBook.title);
        closeLightbox();
      });
    }
    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("is-open")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showPage(activeIndex - 1);
      if (e.key === "ArrowRight") showPage(activeIndex + 1);
    });
  }

  /* --------------------------------------------------- order pre-fill */
  function prefillOrder(title) {
    const booksField = $("#cBooks");
    if (booksField) {
      const existing = booksField.value.trim();
      booksField.value = existing && !existing.includes(title)
        ? existing + ", " + title : title;
    }
    const contact = document.getElementById("contact");
    if (contact) contact.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => booksField && booksField.focus(), 600);
  }

  /* ----------------------------------------------------- scroll reveal */
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" })
    : null;

  function observeReveals() {
    $$(".reveal:not(.is-visible)").forEach((el, i) => {
      if (io) {
        if (el.classList.contains("card")) el.style.transitionDelay = (i % 4) * 70 + "ms";
        io.observe(el);
      } else {
        el.classList.add("is-visible");
      }
    });
  }

  /* ------------------------------------------------- header on scroll */
  const header = $("#header");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* --------------------------------------------------- mobile nav */
  const toggle = $("#navToggle");
  const nav = $("#nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    $$("a", nav).forEach((a) => a.addEventListener("click", () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }));
  }

  /* ------------------------------------------------ order / contact form */
  const form = $("#contactForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const payload = {
        name:            (data.get("name") || "").toString().trim(),
        contact:         (data.get("contact") || "").toString().trim(),
        books_requested: (data.get("books") || "").toString().trim(),
        message:         (data.get("message") || "").toString().trim()
      };
      const note = $("#formNote");
      const submitBtn = form.querySelector('button[type="submit"]');

      if (!payload.name || !payload.contact) {
        showNote(note, "Please add your name and a way to reach you.", true);
        return;
      }

      if (SUPA) {
        try {
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Sending…"; }
          const { data: u } = await sb.auth.getUser();
          payload.user_id = u && u.user ? u.user.id : null;
          const { error } = await sb.from("orders").insert(payload);
          if (error) throw error;
          form.reset();
          showNote(note, "Thank you — your enquiry has been received. We'll be in touch.", false);
        } catch (err) {
          console.error(err);
          showNote(note, "Could not send right now. Please try again or call us.", true);
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Send Enquiry"; }
        }
      } else {
        // Local fallback: open the user's email client (no backend configured)
        const subject = encodeURIComponent("Book enquiry — Bigpot Publication");
        const body = encodeURIComponent(
          `Name: ${payload.name}\nContact: ${payload.contact}\nBooks: ${payload.books_requested}\n\n${payload.message}`
        );
        window.location.href = `mailto:hello@bigpotpublication.in?subject=${subject}&body=${body}`;
        showNote(note, "Opening your email app to send the enquiry…", false);
      }
    });
  }

  function showNote(el, msg, isError) {
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle("form-note--error", !!isError);
  }

  /* ------------------------------------------------ small utils */
  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

  /* ------------------------------------------------------------- init */
  function applyActiveFilter() {
    const active = document.querySelector(".filter.is-active");
    if (active) active.click();
  }

  async function init() {
    bindFilters();
    observeReveals();              // reveal hero/section copy immediately

    // 1) Instant content from the bundled list — never an empty page.
    BOOKS = localBooks();
    window.BOOKS = BOOKS;          // expose for the "order this book" helper
    renderGrid();

    // 2) Upgrade to live database data when/if it arrives.
    const db = await fetchDBBooks();
    if (db.length) {
      BOOKS = db;
      window.BOOKS = BOOKS;
      renderGrid();
      applyActiveFilter();         // preserve the chosen category after re-render
    }
  }
  init();
})();
