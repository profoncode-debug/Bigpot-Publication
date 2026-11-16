/* =========================================================================
   Bigpot admin dashboard — talks to the Apps Script web app
   (apps-script/Code.gs), which is the only thing that writes to the Sheet.
   Every change is saved to the Sheet first; the dashboard then redraws
   from the fresh copy the script sends back.
   ========================================================================= */
(function () {
  "use strict";

  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const CFG = window.SITE_CONFIG || {};
  const API = CFG.adminApiUrl || "";
  const TOKEN_KEY = "bigpot-admin-token";
  const TAB_KEY = "bigpot-admin-tab";
  const LABELS = (typeof CATEGORY_LABELS !== "undefined") ? CATEGORY_LABELS : {};
  const DEFAULT_PRICE = Number(CFG.defaultPrice) > 0 ? Number(CFG.defaultPrice) : null;
  const DEFAULT_LOW = 10;
  const EXP_CATS = ["Shipping", "Packaging", "Marketing", "Rent", "Salaries", "Utilities", "Other"];

  let D = { books: [], sales: [], expenses: [], restocks: [], today: "" };
  let loaded = false;
  let bookQuery = "", salesQuery = "", salesFilter = "all";

  /* ---------------------------------------------------------- utils */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const icon = (id, n = 18) => `<svg width="${n}" height="${n}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const splitImages = (s) => String(s || "").split(/\s*[\n|]\s*/).filter(Boolean);
  const inStock = (b) => !["no", "false", "0", "out", "out of stock"].includes(String(b.in_stock || "").trim().toLowerCase());
  const catLabel = (c) => LABELS[c] || c || "No category";
  const num = (v) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(String(v).replace(/[^\d.\-]/g, ""));
    return isFinite(n) && String(v).trim() !== "" ? n : null;
  };
  const rs = (n) => (n < 0 ? "−₹" : "₹") + Math.abs(Math.round(n)).toLocaleString("en-IN");
  const rsExact = (n) => (n < 0 ? "−₹" : "₹") + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const priceOf = (b) => num(b.price) !== null ? num(b.price) : DEFAULT_PRICE;
  const bookById = (id) => D.books.find((b) => String(b.id) === String(id));
  const bookLabel = (b) => b.title + (b.edition ? " (" + b.edition + ")" : "");
  const lowAt = (b) => num(b.low_stock_alert) !== null ? num(b.low_stock_alert) : DEFAULT_LOW;
  const tracked = (b) => num(b.stock) !== null;

  function localToday() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  const today = () => D.today || localToday();
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function niceDate(iso) {
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return esc(iso || "—");
    const sameYear = m[1] === today().slice(0, 4);
    return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + (sameYear ? "" : " " + m[1]);
  }
  const monthName = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1] + " " + ym.slice(0, 4);

  function toSrc(path) {
    if (!path) return "";
    const drive = path.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
    if (drive) return "https://lh3.googleusercontent.com/d/" + drive[1];
    return /^https?:\/\//.test(path) ? path : encodeURI(path);
  }

  let toastTimer;
  function toast(msg, isError) {
    const el = $("#toast");
    el.textContent = msg;
    el.style.background = isError ? "var(--red)" : "";
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-on"), isError ? 4200 : 2400);
  }

  const store = {
    get(k = TOKEN_KEY) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set(v, k = TOKEN_KEY) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    clear(k = TOKEN_KEY) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /* ------------------------------------------------------------ API */
  // text/plain keeps the request "simple" so the browser skips the CORS
  // preflight that Apps Script cannot answer.
  async function api(action, payload) {
    const body = JSON.stringify(Object.assign({ action, token: store.get() }, payload || {}));
    let res;
    try {
      res = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, redirect: "follow" });
    } catch (e) {
      throw new Error("Can't reach the admin service. Check your internet connection.");
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new Error("Unexpected reply from the admin service."); }
    if (data.error === "auth") { signOut(true); throw new Error(data.message || "Please sign in again."); }
    if (!data.ok) throw new Error(data.message || data.error || "Something went wrong.");
    if (data.data) { D = data.data; loaded = true; renderAll(); }
    return data;
  }

  /* ---------------------------------------------------------- views */
  function show(view) {
    ["viewSetup", "viewLogin", "viewApp"].forEach((v) => { $("#" + v).hidden = v !== view; });
    const app = view === "viewApp";
    $("#logoutBtn").hidden = !app;
    $("#reloadBtn").hidden = !app;
    $("#tabs").hidden = !app;
    document.body.classList.toggle("has-tabs", app);
  }

  function signOut(expired) {
    store.clear();
    D = { books: [], sales: [], expenses: [], restocks: [], today: "" };
    loaded = false;
    $$(".drawer.is-open").forEach((d) => closeDrawer(d, true));
    show("viewLogin");
    if (expired) toast("Your session ended. Please sign in again.", true);
  }

  $("#logoutBtn").addEventListener("click", () => signOut(false));

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("#pw").value;
    const note = $("#loginNote"), btn = $("#loginBtn");
    if (!pw) return;
    btn.disabled = true; btn.textContent = "Signing in…"; note.hidden = true;
    try {
      const data = await api("login", { password: pw });
      store.set(data.token);
      $("#pw").value = "";
      start();
    } catch (err) {
      note.textContent = err.message; note.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = "Sign in";
    }
  });

  async function load() {
    const rb = $("#reloadBtn"); rb.classList.add("is-spinning");
    try { await api("all"); }
    catch (err) {
      if (!loaded) $$(".panel").forEach((p) => { if (!p.hidden) p.insertAdjacentHTML("beforeend", `<p class="alist__empty">${esc(err.message)}</p>`); });
      toast(err.message, true);
    } finally { rb.classList.remove("is-spinning"); }
  }
  $("#reloadBtn").addEventListener("click", load);

  function start() {
    show("viewApp");
    setTab(store.get(TAB_KEY) || "overview");
    const sk = '<div class="skeleton"></div>';
    $("#kpis").innerHTML = '<div class="skeleton skeleton--kpi"></div>'.repeat(6);
    ["#bookList", "#salesList", "#expList", "#recentOrders"].forEach((s) => { $(s).innerHTML = sk.repeat(3); });
    load();
  }

  /* ------------------------------------------------------------ tabs */
  function setTab(name) {
    if (!$(`[data-panel="${name}"]`)) name = "overview";
    $$(".panel").forEach((p) => { p.hidden = p.dataset.panel !== name; });
    $$("#tabs [data-tab]").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("is-active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    store.set(name, TAB_KEY);
    if (name === "overview" && loaded) renderChart();
    window.scrollTo({ top: 0 });
  }
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) {
      e.preventDefault();
      if (g.dataset.filter) { salesFilter = g.dataset.filter; $("#salesFilter").value = salesFilter; renderSales(); }
      setTab(g.dataset.goto);
    }
    const n = e.target.closest("[data-new]");
    if (n) {
      if (n.dataset.new === "sale") openSale();
      if (n.dataset.new === "restock") openRestock(n.dataset.book);
      if (n.dataset.new === "expense") openExpense();
    }
  });

  /* ---------------------------------------------------------- money */
  function range(key) {
    const t = today(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    const ym = (yy, mm) => { while (mm < 1) { mm += 12; yy--; } return yy + "-" + String(mm).padStart(2, "0"); };
    switch (key) {
      case "month":     return [ym(y, m) + "-01", t];
      case "lastmonth": return [ym(y, m - 1) + "-01", ym(y, m - 1) + "-31"];
      case "3m":        return [ym(y, m - 2) + "-01", t];
      case "fy":        return [(m >= 4 ? y : y - 1) + "-04-01", t];
      case "year":      return [y + "-01-01", t];
      default:          return ["0000", "9999"];
    }
  }
  const inRange = (d, r) => { const s = String(d || ""); return s >= r[0] && s.slice(0, 10) <= r[1]; };

  function orders(list = D.sales) {
    const map = new Map();
    list.forEach((s) => {
      let o = map.get(s.order_id);
      if (!o) {
        o = { id: s.order_id, date: s.date, customer: s.customer, phone: s.phone, mode: s.payment_mode,
              status: String(s.payment_status || "paid").toLowerCase() === "pending" ? "pending" : "paid",
              notes: s.notes, lines: [], amount: 0, profit: 0, costMissing: false };
        map.set(s.order_id, o);
      }
      o.lines.push(s);
      o.amount += num(s.amount) || 0;
      if (num(s.profit) === null) o.costMissing = true; else o.profit += num(s.profit);
    });
    return [...map.values()].sort((a, b) => (String(b.date).localeCompare(String(a.date))) || String(b.id).localeCompare(String(a.id)));
  }

  function finance(r) {
    const sales = D.sales.filter((s) => inRange(s.date, r));
    const f = { revenue: 0, cogs: 0, gross: 0, units: 0, missing: 0, expenses: 0, printing: 0 };
    sales.forEach((s) => {
      f.revenue += num(s.amount) || 0;
      f.units += num(s.qty) || 0;
      if (num(s.profit) === null) f.missing++;
      else { f.gross += num(s.profit); f.cogs += num(s.cost) || 0; }
    });
    f.orders = new Set(sales.map((s) => s.order_id)).size;
    D.expenses.forEach((x) => { if (inRange(x.date, r)) f.expenses += num(x.amount) || 0; });
    D.restocks.forEach((x) => { if (inRange(x.date, r)) f.printing += num(x.total) || 0; });
    f.net = f.gross - f.expenses;
    return f;
  }

  function stockTotals() {
    const t = { copies: 0, value: 0, retail: 0, noCost: [], low: [], out: [] };
    D.books.forEach((b) => {
      const c = num(b.cost_price), s = num(b.stock);
      if (c === null) t.noCost.push(b);
      if (s === null) return;
      t.copies += Math.max(0, s);
      if (c !== null) t.value += Math.max(0, s) * c;
      t.retail += Math.max(0, s) * (priceOf(b) || 0);
      if (s <= 0) t.out.push(b); else if (s <= lowAt(b)) t.low.push(b);
    });
    return t;
  }

  /* ------------------------------------------------------- render all */
  function renderAll() {
    renderOverview();
    renderSales();
    renderBooks();
    renderStock();
    renderExpenses();
  }

  /* -------------------------------------------------------- overview */
  const PERIOD_LABEL = { month: "this month", lastmonth: "last month", "3m": "last 3 months", fy: "this financial year", year: "this year", all: "all time" };

  function renderOverview() {
    const key = $("#period").value;
    const f = finance(range(key));
    const st = stockTotals();
    const pend = orders().filter((o) => o.status === "pending");
    const pendAmt = pend.reduce((a, o) => a + o.amount, 0);

    const kpi = (label, value, sub, cls = "", attrs = "") =>
      `<div class="kpi ${cls}" ${attrs}><p class="kpi__label">${label}</p><p class="kpi__value">${value}</p><p class="kpi__sub">${sub}</p></div>`;
    $("#kpis").innerHTML = [
      kpi("Sales", rs(f.revenue), `${plural(f.orders, "order")} · ${plural(f.units, "copy").replace("copys", "copies")}`),
      kpi("Gross profit", rs(f.gross), f.revenue ? `${pct(f.gross, f.revenue)} margin after book cost` : "sales minus cost of books"),
      kpi("Expenses", rs(f.expenses), `<a href="#" data-goto="expenses">see breakdown</a>`),
      kpi("Net profit", rs(f.net), "gross profit minus expenses", "kpi--hero" + (f.net < 0 ? " is-neg" : "")),
      kpi("Payments pending", rs(pendAmt), pend.length ? `<a href="#" data-goto="sales" data-filter="pending">${plural(pend.length, "order")} to collect</a>` : "all collected", pend.length ? "kpi--warn" : ""),
      kpi("Stock value", rs(st.value), `${st.copies.toLocaleString("en-IN")} copies at cost${f.printing ? ` · ${rs(f.printing)} printed ${PERIOD_LABEL[key]}` : ""}`)
    ].join("");

    const alerts = [];
    if (st.noCost.length) alerts.push(`<div class="alert">${icon("i-alert")}<p><b>${plural(st.noCost.length, "book")} ${st.noCost.length === 1 ? "has" : "have"} no cost price.</b> Profit on ${st.noCost.length === 1 ? "it" : "them"} isn't counted until you add one.</p><button class="btn btn--ghost btn--sm" type="button" data-goto="stock">Fix</button></div>`);
    if (f.missing) alerts.push(`<div class="alert">${icon("i-alert")}<p><b>${plural(f.missing, "sale line")} ${PERIOD_LABEL[key]} had no cost price</b> when recorded, so profit above is lower than real.</p></div>`);
    if (st.out.length) alerts.push(`<div class="alert alert--red">${icon("i-box")}<p><b>Out of stock:</b> ${st.out.map((b) => esc(b.title)).join(", ")}</p><button class="btn btn--ghost btn--sm" type="button" data-new="restock" data-book="${esc(st.out[0].id)}">Add copies</button></div>`);
    $("#alerts").innerHTML = alerts.join("");
    $("#ovSub").textContent = "Showing " + PERIOD_LABEL[key] + ". Pending payments and stock are as of today.";

    // best sellers
    const r = range(key);
    const by = {};
    D.sales.filter((s) => inRange(s.date, r)).forEach((s) => {
      const k = s.book_id || s.title;
      by[k] = by[k] || { title: s.title, qty: 0, amount: 0, profit: 0 };
      by[k].qty += num(s.qty) || 0; by[k].amount += num(s.amount) || 0; by[k].profit += num(s.profit) || 0;
    });
    const top = Object.values(by).sort((a, b) => b.qty - a.qty).slice(0, 5);
    const maxQ = top.length ? top[0].qty : 1;
    $("#topSub").textContent = PERIOD_LABEL[key];
    $("#topBooks").innerHTML = top.length ? top.map((t) => `
      <div class="mrow">
        <div class="mrow__main"><p>${esc(t.title)}</p><span class="bar"><i style="width:${Math.max(4, (t.qty / maxQ) * 100)}%"></i></span></div>
        <div class="mrow__num"><b>${t.qty}</b> sold<small>${rs(t.amount)} · profit ${rs(t.profit)}</small></div>
      </div>`).join("") : `<p class="empty">No sales ${PERIOD_LABEL[key]} yet.</p>`;

    // running low
    const low = st.out.concat(st.low).slice(0, 6);
    $("#lowStock").innerHTML = low.length ? low.map((b) => `
      <div class="mrow">
        <div class="mrow__main"><p>${esc(b.title)}</p><small class="${num(b.stock) <= 0 ? "t-red" : "t-amber"}">${num(b.stock) <= 0 ? "Out of stock" : num(b.stock) + " left (alert at " + lowAt(b) + ")"}</small></div>
        <button class="btn btn--ghost btn--sm" type="button" data-new="restock" data-book="${esc(b.id)}">Add copies</button>
      </div>`).join("") : `<p class="empty">${D.books.some(tracked) ? "Everything is well stocked." : "Add copies in stock to a book and it'll be watched here."}</p>`;

    const recent = orders().slice(0, 5);
    $("#recentOrders").innerHTML = recent.length ? recent.map(orderRow).join("") : `<p class="alist__empty">No sales recorded yet. Tap <b>Record sale</b> when an order comes in.</p>`;

    renderChart();
  }
  $("#period").addEventListener("change", renderOverview);

  /* ----------------------------------------------------------- chart */
  function monthly() {
    const t = today(); let y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    const out = [];
    for (let i = 0; i < 12; i++) {
      const ym = y + "-" + String(m).padStart(2, "0");
      const f = finance([ym + "-01", ym + "-31"]);
      out.unshift({ ym, revenue: f.revenue, gross: f.gross, expenses: f.expenses, net: f.net, orders: f.orders });
      if (--m < 1) { m = 12; y--; }
    }
    return out;
  }

  function niceStep(span) {
    const raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const k = raw / p;
    return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 2.5 ? 2.5 : k <= 5 ? 5 : 10) * p;
  }
  const short = (n) => {
    const a = Math.abs(n), s = n < 0 ? "−" : "";
    if (a >= 1e7) return s + "₹" + +(a / 1e7).toFixed(1) + "Cr";
    if (a >= 1e5) return s + "₹" + +(a / 1e5).toFixed(1) + "L";
    if (a >= 1e3) return s + "₹" + +(a / 1e3).toFixed(1) + "k";
    return s + "₹" + Math.round(a);
  };

  function barPath(x, base, top, w) {
    const h = Math.abs(base - top);
    if (h < 0.5) return "";
    const r = Math.min(4, h, w / 2);
    if (top < base) return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
    return `M${x},${base}V${top - r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top - r}V${base}Z`;
  }

  let chartData = [];
  function renderChart() {
    const box = $("#chart");
    if (!box || box.offsetParent === null) return;
    chartData = monthly();
    const W = Math.max(300, box.clientWidth), H = W < 520 ? 210 : 250;
    const pad = { l: 46, r: 6, t: 12, b: 26 };
    const vals = chartData.flatMap((d) => [d.revenue, d.net]);
    let max = Math.max(0, ...vals), min = Math.min(0, ...vals);
    if (max === 0 && min === 0) max = 10000;
    const step = niceStep(max - min);
    max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
    const ph = H - pad.t - pad.b, pw = W - pad.l - pad.r;
    const y = (v) => pad.t + (max - v) / (max - min) * ph;
    const band = pw / chartData.length;
    const bw = Math.max(4, Math.min(18, (band - 8) / 2 - 1));
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Sales and net profit for the last 12 months">`;
    for (let v = min; v <= max + 1e-6; v += step) {
      svg += `<line class="grid${v === 0 ? " grid--zero" : ""}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`;
    }
    chartData.forEach((d, i) => {
      const cx = pad.l + band * i + band / 2;
      svg += `<rect class="hover-band" data-i="${i}" x="${pad.l + band * i}" y="${pad.t}" width="${band}" height="${ph}"/>`;
      svg += `<path class="bar-rev" d="${barPath(cx - bw - 1, y(0), y(d.revenue), bw)}"/>`;
      svg += `<path class="bar-net" d="${barPath(cx + 1, y(0), y(d.net), bw)}"/>`;
      const lbl = MONTHS[Number(d.ym.slice(5)) - 1];
      if (W >= 480 || i % 2 === 1) svg += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${lbl}</text>`;
    });
    svg += `</svg>`;
    const empty = !chartData.some((d) => d.revenue || d.expenses);
    box.innerHTML = svg + (empty ? `<p class="chart__empty">Your first recorded sale will show up here.</p>` : "");

    $("#chartTable").innerHTML = `<table><thead><tr><th>Month</th><th>Orders</th><th>Sales</th><th>Gross profit</th><th>Expenses</th><th>Net profit</th></tr></thead><tbody>${
      chartData.slice().reverse().map((d) => `<tr><td>${monthName(d.ym)}</td><td>${d.orders}</td><td>${rs(d.revenue)}</td><td>${rs(d.gross)}</td><td>${rs(d.expenses)}</td><td class="${d.net < 0 ? "t-red" : ""}">${rs(d.net)}</td></tr>`).join("")}</tbody></table>`;
  }

  const tip = $("#tip");
  function moveTip(e, html) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, yy = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (yy + r.height > innerHeight - 8) yy = e.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, yy) + "px";
  }
  $("#chart").addEventListener("pointermove", (e) => {
    const band = e.target.closest(".hover-band");
    $$("#chart .hover-band.is-on").forEach((b) => b !== band && b.classList.remove("is-on"));
    if (!band) { tip.hidden = true; return; }
    band.classList.add("is-on");
    const d = chartData[+band.dataset.i];
    moveTip(e, `<b>${monthName(d.ym)}</b>
      <span><i class="sw sw--rev"></i>Sales <em>${rs(d.revenue)}</em></span>
      <span class="tip__muted">Gross profit <em>${rs(d.gross)}</em></span>
      <span class="tip__muted">Expenses <em>${rs(d.expenses)}</em></span>
      <span><i class="sw sw--net"></i>Net profit <em>${rs(d.net)}</em></span>`);
  });
  $("#chart").addEventListener("pointerleave", () => { tip.hidden = true; $$("#chart .hover-band.is-on").forEach((b) => b.classList.remove("is-on")); });
  $("#chartTableBtn").addEventListener("click", (e) => {
    const t = $("#chartTable"), on = t.hidden;
    t.hidden = !on; $("#chart").hidden = on;
    e.currentTarget.textContent = on ? "Show chart" : "Show table";
    e.currentTarget.setAttribute("aria-pressed", String(on));
    if (!on) renderChart();
  });
  let rz;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => loaded && renderChart(), 150); });

  /* ----------------------------------------------------------- sales */
  function orderRow(o) {
    const items = o.lines.map((l) => esc(l.title) + " ×" + esc(l.qty)).join(", ");
    return `
      <div class="orow" data-order="${esc(o.id)}">
        <div class="orow__main">
          <p class="orow__title">${esc(o.customer || "Walk-in customer")} <span>${esc(o.id)}</span></p>
          <p class="orow__meta">${niceDate(o.date)}${o.mode ? " · " + esc(o.mode) : ""}${o.phone ? " · " + esc(String(o.phone).replace(/^'/, "")) : ""}</p>
          <p class="orow__items">${items}</p>
        </div>
        <div class="orow__amt">${rsExact(o.amount)}<small>${o.costMissing ? "profit: add cost" : "profit " + rs(o.profit)}</small></div>
        <button class="pill ${o.status === "pending" ? "pill--pending" : "pill--paid"}" type="button" data-act="toggle" title="${o.status === "pending" ? "Mark as received" : "Mark as pending"}">
          ${icon(o.status === "pending" ? "i-clock" : "i-check", 14)}${o.status === "pending" ? "Pending" : "Paid"}</button>
        <button class="icon-btn icon-btn--danger" type="button" data-act="delorder" aria-label="Delete order">${icon("i-trash")}</button>
      </div>`;
  }

  function renderSales() {
    const q = salesQuery.trim().toLowerCase();
    let list = orders();
    if (salesFilter !== "all") list = list.filter((o) => o.status === salesFilter);
    if (q) list = list.filter((o) => [o.id, o.customer, o.phone, o.notes, ...o.lines.map((l) => l.title)].join(" ").toLowerCase().includes(q));

    const amt = list.reduce((a, o) => a + o.amount, 0);
    const prof = list.reduce((a, o) => a + o.profit, 0);
    const pend = list.filter((o) => o.status === "pending").reduce((a, o) => a + o.amount, 0);
    $("#salesStrip").innerHTML = loaded ? `
      <span><b>${list.length}</b> orders</span><span><b>${rs(amt)}</b> sales</span>
      <span><b>${rs(prof)}</b> gross profit</span><span class="${pend ? "t-amber" : ""}"><b>${rs(pend)}</b> pending</span>` : "";

    const box = $("#salesList");
    if (!loaded) return;
    if (!D.sales.length) { box.innerHTML = `<p class="alist__empty">No sales yet. Tap <b>Record sale</b> each time you sell books — stock and profit update by themselves.</p>`; return; }
    if (!list.length) { box.innerHTML = `<p class="alist__empty">No orders match.</p>`; return; }
    let html = "", cur = "";
    list.forEach((o) => {
      const ym = String(o.date).slice(0, 7);
      if (ym !== cur) {
        cur = ym;
        const mt = list.filter((x) => String(x.date).slice(0, 7) === ym).reduce((a, x) => a + x.amount, 0);
        html += `<h3 class="ogroup">${/^\d{4}-\d{2}$/.test(ym) ? monthName(ym) : "No date"}<span>${rs(mt)}</span></h3>`;
      }
      html += orderRow(o);
    });
    box.innerHTML = html;
  }
  $("#salesSearch").addEventListener("input", (e) => { salesQuery = e.target.value; renderSales(); });
  $("#salesFilter").addEventListener("change", (e) => { salesFilter = e.target.value; renderSales(); });

  // order actions (overview + sales list)
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".orow [data-act]");
    if (!btn) return;
    const row = btn.closest(".orow"), id = row.dataset.order;
    const o = orders().find((x) => String(x.id) === id);
    if (!o) return;
    if (btn.dataset.act === "toggle") {
      const next = o.status === "pending" ? "paid" : "pending";
      row.classList.add("is-busy");
      try { await api("setOrderStatus", { order_id: id, status: next }); toast(next === "paid" ? "Marked as paid" : "Marked as pending"); }
      catch (err) { row.classList.remove("is-busy"); toast(err.message, true); }
    }
    if (btn.dataset.act === "delorder") {
      if (!confirm(`Delete order ${id}${o.customer ? " (" + o.customer + ")" : ""}?\n\nThe ${o.lines.reduce((a, l) => a + (num(l.qty) || 0), 0)} copies go back into stock.`)) return;
      row.classList.add("is-busy");
      try { await api("deleteOrder", { order_id: id }); toast("Order deleted, copies back in stock"); }
      catch (err) { row.classList.remove("is-busy"); toast(err.message, true); }
    }
  });

  /* ---------------------------------------------------------- drawers */
  function openDrawer(el, focusEl) {
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-locked");
    el.dataset.dirty = "";
    const body = $(".editor__body", el); if (body) body.scrollTop = 0;
    setTimeout(() => (focusEl || $("form", el)).focus({ preventScroll: true }), 60);
  }
  function closeDrawer(el, force) {
    if (!el.classList.contains("is-open")) return;
    if (!force && el.dataset.dirty && !confirm("Discard your changes?")) return;
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
    if (!$(".drawer.is-open")) document.body.classList.remove("is-locked");
    if (el.id === "editor") pics.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
  }
  $$(".drawer").forEach((d) => {
    $$("[data-close]", d).forEach((x) => x.addEventListener("click", () => closeDrawer(d, false)));
    $("form", d).addEventListener("input", () => { d.dataset.dirty = "1"; });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { const d = $$(".drawer.is-open").pop(); if (d) closeDrawer(d, false); } });

  async function submitWith(btn, busyText, fn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = busyText;
    try { await fn(); return true; }
    catch (err) { toast(err.message, true); return false; }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  const bookOptions = (selected) => D.books.map((b) =>
    `<option value="${esc(b.id)}" ${String(b.id) === String(selected) ? "selected" : ""}>${esc(bookLabel(b))}${tracked(b) ? " — " + num(b.stock) + " left" : ""}</option>`).join("");

  /* -------------------------------------------------------- sale form */
  const saleEd = $("#saleEd");
  let lines = [];

  function openSale() {
    if (!D.books.length) { toast("Add a book first", true); setTab("books"); return; }
    lines = [{ book_id: D.books[0].id, qty: 1, unit_price: priceOf(D.books[0]) ?? "", discount: "" }];
    $("#sCustomer").value = ""; $("#sPhone").value = ""; $("#sNotes").value = "";
    $("#sDate").value = today(); $("#sMode").value = "UPI"; $("#sStatus").value = "paid";
    $("#pasteBox").value = ""; $(".paste", saleEd).open = false;
    renderLines();
    openDrawer(saleEd, $("#sCustomer"));
  }

  function renderLines() {
    $("#sLines").innerHTML = lines.map((l, i) => {
      const b = bookById(l.book_id) || {};
      const cost = num(b.cost_price);
      const hint = [tracked(b) ? (num(b.stock) <= 0 ? '<span class="t-red">out of stock</span>' : num(b.stock) + " in stock") : "stock not tracked",
                    cost !== null ? "cost " + rsExact(cost) : '<span class="t-amber">no cost price</span>'].join(" · ");
      return `
        <div class="line" data-i="${i}">
          <div class="line__top">
            <select data-f="book_id" aria-label="Book">${bookOptions(l.book_id)}</select>
            <button class="icon-btn" type="button" data-f="remove" aria-label="Remove" ${lines.length === 1 ? "disabled" : ""}>${icon("i-x", 18)}</button>
          </div>
          <div class="line__nums">
            <label><span>Copies</span><input data-f="qty" inputmode="numeric" value="${esc(l.qty)}" /></label>
            <label><span>Price each ₹</span><input data-f="unit_price" inputmode="decimal" value="${esc(l.unit_price)}" /></label>
            <label><span>Discount ₹</span><input data-f="discount" inputmode="decimal" value="${esc(l.discount)}" placeholder="0" /></label>
          </div>
          <p class="line__hint">${hint}</p>
        </div>`;
    }).join("");
    renderSum();
  }

  function renderSum() {
    let total = 0, profit = 0, unknown = false;
    const warn = [];
    lines.forEach((l) => {
      const b = bookById(l.book_id) || {};
      const q = num(l.qty) || 0, p = num(l.unit_price) || 0, dsc = num(l.discount) || 0, c = num(b.cost_price);
      total += q * p - dsc;
      if (c === null) unknown = true; else profit += q * p - dsc - q * c;
      if (tracked(b) && q > num(b.stock)) warn.push(`only ${Math.max(0, num(b.stock))} of “${esc(b.title)}” in stock`);
    });
    $("#sSum").innerHTML = `<span>Total <b>${rsExact(total)}</b></span><span>Profit <b class="${profit < 0 ? "t-red" : ""}">${unknown ? "—" : rsExact(profit)}</b></span>` +
      (warn.length ? `<em class="t-red">${warn.join("; ")}</em>` : "") +
      (unknown && !warn.length ? `<em>Add a cost price to see profit</em>` : "");
  }

  $("#sLines").addEventListener("input", (e) => {
    const f = e.target.dataset.f, line = e.target.closest(".line");
    if (!f || !line) return;
    const l = lines[+line.dataset.i];
    l[f] = e.target.value;
    if (f === "book_id") { const b = bookById(l.book_id); l.unit_price = b ? priceOf(b) ?? "" : ""; renderLines(); }
    else renderSum();
  });
  $("#sLines").addEventListener("click", (e) => {
    const b = e.target.closest('[data-f="remove"]');
    if (!b) return;
    lines.splice(+b.closest(".line").dataset.i, 1);
    saleEd.dataset.dirty = "1";
    renderLines();
  });
  $("#sAddLine").addEventListener("click", () => {
    const used = new Set(lines.map((l) => String(l.book_id)));
    const b = D.books.find((x) => !used.has(String(x.id))) || D.books[0];
    lines.push({ book_id: b.id, qty: 1, unit_price: priceOf(b) ?? "", discount: "" });
    saleEd.dataset.dirty = "1";
    renderLines();
    const sel = $$("#sLines select"); sel[sel.length - 1].focus();
  });

  // Read the order message the website sends on WhatsApp:
  //   1. BNS 2023 (Edition 2023) × 2 — ₹1,998
  //   Payment: Paid ₹1,998 via UPI …   Name: …   Delivery address: …
  $("#pasteGo").addEventListener("click", () => {
    const text = $("#pasteBox").value;
    const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
    const found = [], missed = [];
    text.split(/\n/).forEach((ln) => {
      const m = ln.match(/^\s*\d+[.)]\s*(.+?)\s*[×x]\s*(\d+)(?:\s*[—-]+\s*₹?\s*([\d,]+(?:\.\d+)?))?\s*$/);
      if (!m) return;
      const name = norm(m[1]);
      const b = D.books.find((x) => norm(bookLabel(x)) === name) || D.books.find((x) => norm(x.title) === name) ||
                D.books.find((x) => name.startsWith(norm(x.title)));
      if (!b) { missed.push(m[1]); return; }
      const qty = Number(m[2]);
      const lineTotal = m[3] ? Number(m[3].replace(/,/g, "")) : null;
      found.push({ book_id: b.id, qty, unit_price: lineTotal ? +(lineTotal / qty).toFixed(2) : (priceOf(b) ?? ""), discount: "" });
    });
    if (!found.length) { toast("Couldn't find any books in that message", true); return; }
    lines = found;
    const name = text.match(/^\s*Name:\s*(.+)$/mi), addr = text.match(/^\s*Delivery address:\s*([\s\S]+?)$/mi);
    if (name) $("#sCustomer").value = name[1].trim();
    if (addr) $("#sNotes").value = "Address: " + addr[1].trim();
    const paid = /Payment:\s*Paid/i.test(text);
    $("#sStatus").value = paid ? "paid" : "pending";
    if (paid) $("#sMode").value = "UPI";
    $(".paste", saleEd).open = false;
    saleEd.dataset.dirty = "1";
    renderLines();
    toast(missed.length ? "Filled in. Not matched: " + missed.join(", ") : "Filled in from the message — check and save", !!missed.length);
  });

  $("#saleForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    for (const l of lines) {
      if (!(num(l.qty) > 0)) { toast("Copies must be at least 1", true); return; }
      if (num(l.unit_price) === null) { toast("Enter a price for every book", true); return; }
    }
    const sale = {
      date: $("#sDate").value, customer: $("#sCustomer").value.trim(), phone: $("#sPhone").value.trim(),
      payment_mode: $("#sMode").value, payment_status: $("#sStatus").value, notes: $("#sNotes").value.trim(),
      lines: lines.map((l) => ({ book_id: l.book_id, qty: num(l.qty), unit_price: num(l.unit_price), discount: num(l.discount) || 0 }))
    };
    const ok = await submitWith($("#sSave"), "Saving…", () => api("addSale", { sale }));
    if (ok) { closeDrawer(saleEd, true); toast("Sale saved · stock updated"); }
  });

  /* ----------------------------------------------------------- books */
  function renderBooks() {
    $("#bookCount").textContent = D.books.length;
    const cats = new Set(Object.keys(LABELS));
    D.books.forEach((b) => b.category && cats.add(b.category));
    $("#catList").innerHTML = [...cats].map((c) => `<option value="${esc(c)}">${esc(catLabel(c))}</option>`).join("");
    if (!loaded) return;

    const q = bookQuery.trim().toLowerCase();
    const shown = D.books.filter((b) => !q || [b.title, b.subtitle, b.edition, b.category].join(" ").toLowerCase().includes(q));
    const list = $("#bookList");
    if (!D.books.length) { list.innerHTML = `<p class="alist__empty">No books yet. Tap <b>Add book</b> to create the first one.</p>`; return; }
    if (!shown.length) { list.innerHTML = `<p class="alist__empty">Nothing matches “${esc(bookQuery)}”.</p>`; return; }

    const canMove = !q;
    list.innerHTML = shown.map((b) => {
      const i = D.books.indexOf(b);
      const imgs = splitImages(b.images);
      const ok = inStock(b);
      const price = priceOf(b), cost = num(b.cost_price);
      const margin = price && cost !== null ? `margin ${rs(price - cost)} (${pct(price - cost, price)})` : "no cost price";
      const stock = tracked(b) ? (num(b.stock) <= 0 ? '<span class="t-red">0 left</span>' : `${num(b.stock)} left`) : "stock not tracked";
      return `
        <div class="arow${ok ? "" : " is-out"}" data-id="${esc(b.id)}">
          <div class="arow__move">
            <button type="button" data-act="up" aria-label="Move up" ${!canMove || i === 0 ? "disabled" : ""}>${icon("i-up", 16)}</button>
            <button type="button" data-act="down" aria-label="Move down" ${!canMove || i === D.books.length - 1 ? "disabled" : ""}>${icon("i-down", 16)}</button>
          </div>
          <img class="arow__img" src="${esc(toSrc(imgs[0]))}" alt="" loading="lazy" />
          <div class="arow__main">
            <p class="arow__title">${esc(b.title)}</p>
            <p class="arow__meta">${esc(catLabel(b.category))}${b.edition ? " · " + esc(b.edition) : ""} · ${stock}</p>
            <p class="arow__meta ${cost === null ? "t-amber" : ""}">${margin}</p>
          </div>
          <div class="arow__price">${price ? rs(price) : "—"}${num(b.price) === null ? "<small>default</small>" : ""}</div>
          <label class="stock"><span class="switch"><input type="checkbox" data-act="stock" ${ok ? "checked" : ""} aria-label="Shown as in stock" /><i></i></span>${ok ? "On sale" : "Hidden"}</label>
          <div class="arow__acts">
            <button class="icon-btn arow__mv" type="button" data-act="up" aria-label="Move up" ${!canMove || i === 0 ? "disabled" : ""}>${icon("i-up")}</button>
            <button class="icon-btn arow__mv" type="button" data-act="down" aria-label="Move down" ${!canMove || i === D.books.length - 1 ? "disabled" : ""}>${icon("i-down")}</button>
            <button class="icon-btn" type="button" data-act="edit" aria-label="Edit">${icon("i-edit")}</button>
            <button class="icon-btn icon-btn--danger" type="button" data-act="delete" aria-label="Delete">${icon("i-trash")}</button>
          </div>
        </div>`;
    }).join("");
  }

  $("#adminSearch").addEventListener("input", (e) => { bookQuery = e.target.value; renderBooks(); });
  $("#addBtn").addEventListener("click", () => openEditor(null));

  const publicFields = (b) => ({ id: b.id, sort_order: b.sort_order, title: b.title, subtitle: b.subtitle, category: b.category,
    price: b.price, tagline: b.tagline, edition: b.edition, description: b.description, in_stock: b.in_stock, images: splitImages(b.images) });

  $("#bookList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.dataset.act === "stock") return;
    const row = btn.closest(".arow");
    const book = bookById(row.dataset.id);
    if (!book) return;
    const act = btn.dataset.act;
    if (act === "edit") openEditor(book);
    if (act === "up" || act === "down") move(book, act === "up" ? -1 : 1);
    if (act === "delete") {
      if (!confirm(`Delete “${book.title}”?\n\nIt disappears from the website and its stock row is removed. Past sales stay in your records.`)) return;
      row.classList.add("is-busy");
      try { await api("deleteBook", { id: book.id }); toast("Deleted “" + book.title + "”"); }
      catch (err) { row.classList.remove("is-busy"); toast(err.message, true); }
    }
  });

  $("#bookList").addEventListener("change", async (e) => {
    const box = e.target.closest('[data-act="stock"]');
    if (!box) return;
    const row = box.closest(".arow");
    const book = bookById(row.dataset.id);
    const next = box.checked ? "yes" : "no";
    row.classList.add("is-busy");
    try {
      await api("saveBook", { book: Object.assign(publicFields(book), { in_stock: next }) });
      toast(book.title + (next === "yes" ? " is on sale" : " hidden as out of stock"));
    } catch (err) { box.checked = !box.checked; row.classList.remove("is-busy"); toast(err.message, true); }
  });

  let reorderTimer;
  function move(book, dir) {
    const i = D.books.indexOf(book), j = i + dir;
    if (j < 0 || j >= D.books.length) return;
    [D.books[i], D.books[j]] = [D.books[j], D.books[i]];
    D.books.forEach((b, k) => { b.sort_order = (k + 1) * 10; });
    renderBooks();
    clearTimeout(reorderTimer);
    reorderTimer = setTimeout(async () => {
      try { await api("reorder", { ids: D.books.map((b) => b.id) }); toast("Order saved"); }
      catch (err) { toast(err.message, true); load(); }
    }, 700);
  }

  /* ---------------------------------------------------------- editor */
  const editor = $("#editor");
  const form = $("#edForm");
  let editing = null;
  let pics = [];               // [{ url, uploading, preview }]

  function openEditor(book) {
    editing = book;
    $("#edTitle").textContent = book ? "Edit book" : "Add a book";
    $("#edSave").textContent = book ? "Save changes" : "Add book";
    const b = book || {};
    $("#fTitle").value = b.title || "";
    $("#fSubtitle").value = b.subtitle || "";
    $("#fCategory").value = b.category || "";
    $("#fPrice").value = b.price ?? "";
    $("#fCost").value = b.cost_price ?? "";
    $("#fQty").value = b.stock ?? "";
    $("#fLow").value = b.low_stock_alert ?? "";
    $("#fTagline").value = b.tagline || "";
    $("#fEdition").value = b.edition || "";
    $("#fDesc").value = b.description || "";
    $("#fStock").checked = book ? inStock(b) : true;
    pics = splitImages(b.images).map((url) => ({ url }));
    renderPics();
    renderMargin();
    openDrawer(editor, book ? form : $("#fTitle"));
  }

  function renderMargin() {
    const p = num($("#fPrice").value) ?? DEFAULT_PRICE, c = num($("#fCost").value);
    const el = $("#fMargin");
    if (c === null || !p) { el.innerHTML = `<span>Profit per copy</span><b>—</b><small>add a cost to see it</small>`; return; }
    el.innerHTML = `<span>Profit per copy</span><b class="${p - c < 0 ? "t-red" : ""}">${rsExact(p - c)}</b><small>${pct(p - c, p)} of the price</small>`;
  }
  ["#fPrice", "#fCost"].forEach((s) => $(s).addEventListener("input", renderMargin));
  $("#fQty").addEventListener("input", () => { if (num($("#fQty").value) === 0) $("#fStock").checked = false; });

  function renderPics() {
    const box = $("#pics");
    box.innerHTML = pics.map((p, i) => `
      <div class="pic${p.uploading ? " is-uploading" : ""}" data-i="${i}">
        <img src="${esc(p.preview || toSrc(p.url))}" alt="Photo ${i + 1}" />
        ${i === 0 ? '<span class="pic__cover">Cover</span>' : ""}
        <div class="pic__bar">
          <button type="button" data-pic="left" aria-label="Move earlier" ${i === 0 ? "disabled" : ""}>${icon("i-left", 14)}</button>
          <button type="button" data-pic="del" aria-label="Remove photo">${icon("i-x", 14)}</button>
          <button type="button" data-pic="right" aria-label="Move later" ${i === pics.length - 1 ? "disabled" : ""}>${icon("i-right", 14)}</button>
        </div>
      </div>`).join("") + `
      <label class="pic pic--add">
        ${icon("i-camera", 26)}<span>Add photos</span>
        <input type="file" id="picFiles" accept="image/jpeg,image/png,image/webp" multiple />
      </label>`;
  }

  $("#pics").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pic]");
    if (!b) return;
    const i = +b.closest(".pic").dataset.i;
    if (b.dataset.pic === "del") pics.splice(i, 1);
    if (b.dataset.pic === "left" && i > 0) [pics[i - 1], pics[i]] = [pics[i], pics[i - 1]];
    if (b.dataset.pic === "right" && i < pics.length - 1) [pics[i + 1], pics[i]] = [pics[i], pics[i + 1]];
    editor.dataset.dirty = "1";
    renderPics();
  });

  $("#pics").addEventListener("change", (e) => {
    if (e.target.id !== "picFiles") return;
    Array.from(e.target.files || []).forEach(uploadFile);
    editor.dataset.dirty = "1";
  });

  $("#picUrlAdd").addEventListener("click", () => {
    const v = $("#picUrl").value.trim();
    if (!/^https?:\/\//.test(v)) { toast("Paste a full link starting with https://", true); return; }
    pics.push({ url: v });
    $("#picUrl").value = "";
    editor.dataset.dirty = "1";
    renderPics();
  });

  // shrink big phone photos before upload (max 1800px, JPEG) — faster & lighter
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1800, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read " + file.name)); };
      img.src = url;
    });
  }

  async function uploadFile(file) {
    if (!/^image\//.test(file.type)) { toast(file.name + " isn't an image", true); return; }
    const p = { url: "", uploading: true, preview: URL.createObjectURL(file) };
    pics.push(p);
    renderPics();
    try {
      const data = await shrink(file);
      const res = await api("upload", { name: file.name.replace(/\.\w+$/, "") + ".jpg", mime: "image/jpeg", data });
      p.url = res.url;
    } catch (err) {
      pics.splice(pics.indexOf(p), 1);
      toast(err.message, true);
    } finally {
      p.uploading = false;
      renderPics();
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#fTitle").value.trim();
    if (!title) { $("#fTitle").focus(); toast("Please give the book a title", true); return; }
    if (pics.some((p) => p.uploading)) { toast("Wait for the photos to finish uploading", true); return; }
    const images = pics.map((p) => p.url).filter(Boolean);
    if (!images.length) { toast("Add at least one photo (the cover)", true); return; }
    for (const [sel, what] of [["#fPrice", "Price"], ["#fCost", "Cost"], ["#fQty", "Copies in stock"], ["#fLow", "Stock alert"]]) {
      const v = $(sel).value.trim();
      if (v && num(v) === null) { $(sel).focus(); toast(what + " must be a number", true); return; }
    }

    const book = {
      id: editing ? editing.id : "",
      sort_order: editing ? editing.sort_order : "",
      title,
      subtitle: $("#fSubtitle").value.trim(),
      category: $("#fCategory").value.trim().toLowerCase(),
      price: $("#fPrice").value.trim(),
      cost_price: $("#fCost").value.trim(),
      stock: $("#fQty").value.trim(),
      low_stock_alert: $("#fLow").value.trim(),
      tagline: $("#fTagline").value.trim(),
      edition: $("#fEdition").value.trim(),
      description: $("#fDesc").value.trim(),
      in_stock: $("#fStock").checked ? "yes" : "no",
      images
    };
    const wasEditing = !!editing;
    const ok = await submitWith($("#edSave"), "Saving…", () => api("saveBook", { book }));
    if (ok) { closeDrawer(editor, true); toast((wasEditing ? "Saved “" : "Added “") + title + "”"); }
  });

  /* ----------------------------------------------------------- stock */
  function renderStock() {
    if (!loaded) return;
    const st = stockTotals();
    $("#stockStrip").innerHTML = `
      <span><b>${st.copies.toLocaleString("en-IN")}</b> copies on hand</span>
      <span><b>${rs(st.value)}</b> stock value at cost</span>
      <span><b>${rs(st.retail)}</b> if all sold</span>
      ${st.noCost.length ? `<span class="t-amber"><b>${st.noCost.length}</b> without cost price</span>` : ""}`;

    $("#stockTable").innerHTML = D.books.length ? `
      <div class="trow trow--head"><span>Book</span><span>In stock</span><span>Cost</span><span>Price</span><span>Margin</span><span>Value</span><span></span></div>` +
      D.books.map((b) => {
        const s = num(b.stock), c = num(b.cost_price), p = priceOf(b);
        const state = s === null ? ["muted", "not tracked"] : s <= 0 ? ["red", "out"] : s <= lowAt(b) ? ["amber", "low"] : ["green", "ok"];
        return `
        <div class="trow" data-id="${esc(b.id)}">
          <span class="trow__book"><b>${esc(b.title)}</b>${b.edition ? `<small>${esc(b.edition)}</small>` : ""}</span>
          <span class="trow__qty" data-l="In stock"><b>${s === null ? "—" : s}</b><i class="tag tag--${state[0]}">${state[1]}</i></span>
          <span data-l="Cost">${c === null ? '<button class="linkbtn t-amber" type="button" data-act="edit">add cost</button>' : rsExact(c)}</span>
          <span data-l="Price">${p ? rs(p) : "—"}</span>
          <span data-l="Margin" class="${c !== null && p - c < 0 ? "t-red" : ""}">${c === null || !p ? "—" : rsExact(p - c) + ` <small>${pct(p - c, p)}</small>`}</span>
          <span data-l="Value">${c === null || s === null ? "—" : rs(Math.max(0, s) * c)}</span>
          <span class="trow__acts">
            <button class="btn btn--ghost btn--sm" type="button" data-new="restock" data-book="${esc(b.id)}">${icon("i-plus", 14)} Copies</button>
            <button class="icon-btn" type="button" data-act="edit" aria-label="Edit cost and stock">${icon("i-edit")}</button>
          </span>
        </div>`;
      }).join("") : `<p class="alist__empty">No books yet.</p>`;

    const rs_ = D.restocks.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $("#restockList").innerHTML = rs_.length ? rs_.map((r) => `
      <div class="orow orow--simple" data-restock="${esc(r.id)}">
        <div class="orow__main">
          <p class="orow__title">${esc(r.title)}</p>
          <p class="orow__meta">${niceDate(r.date)}${r.supplier ? " · " + esc(r.supplier) : ""}${r.notes ? " · " + esc(r.notes) : ""}</p>
        </div>
        <div class="orow__amt">+${esc(r.qty)} copies<small>${num(r.unit_cost) !== null ? rsExact(num(r.unit_cost)) + " each · " + rs(num(r.total) || 0) : "cost not entered"}</small></div>
        <button class="icon-btn icon-btn--danger" type="button" data-act="delrestock" aria-label="Delete">${icon("i-trash")}</button>
      </div>`).join("") : `<p class="alist__empty">When you print or buy new copies, add them with <b>Add new copies</b>. Stock goes up and the cost price updates.</p>`;
  }

  $("#stockTable").addEventListener("click", (e) => {
    const b = e.target.closest('[data-act="edit"]');
    if (!b) return;
    const book = bookById(b.closest(".trow").dataset.id);
    if (book) { openEditor(book); setTimeout(() => $("#fCost").focus(), 120); }
  });

  $("#restockList").addEventListener("click", async (e) => {
    const b = e.target.closest('[data-act="delrestock"]');
    if (!b) return;
    const row = b.closest(".orow"), r = D.restocks.find((x) => String(x.id) === row.dataset.restock);
    if (!r || !confirm(`Delete this entry?\n\n${r.qty} copies of “${r.title}” will be taken back out of stock. (The cost price is not changed back — edit it on the book if needed.)`)) return;
    row.classList.add("is-busy");
    try { await api("deleteRestock", { id: r.id }); toast("Entry deleted"); }
    catch (err) { row.classList.remove("is-busy"); toast(err.message, true); }
  });

  /* --------------------------------------------------------- restock */
  const restockEd = $("#restockEd");
  function openRestock(bookId) {
    if (!D.books.length) { toast("Add a book first", true); return; }
    $("#rBook").innerHTML = bookOptions(bookId || D.books[0].id);
    $("#rQty").value = ""; $("#rSupplier").value = ""; $("#rNotes").value = "";
    const b = bookById($("#rBook").value);
    $("#rCost").value = b && num(b.cost_price) !== null ? num(b.cost_price) : "";
    $("#rDate").value = today();
    renderRestockHint();
    openDrawer(restockEd, $("#rQty"));
  }
  function renderRestockHint() {
    const b = bookById($("#rBook").value) || {};
    const have = Math.max(0, num(b.stock) || 0), old = num(b.cost_price);
    const q = num($("#rQty").value) || 0, u = num($("#rCost").value);
    let html = `Now: <b>${tracked(b) ? have : "not tracked"}</b> in stock · cost ${old === null ? "not set" : rsExact(old)}.`;
    if (q > 0) {
      html += `<br>After: <b>${have + q}</b> in stock`;
      if (u !== null) {
        const avg = have > 0 && old !== null ? Math.round(((have * old + q * u) / (have + q)) * 100) / 100 : u;
        html += ` · cost becomes <b>${rsExact(avg)}</b>${have > 0 && old !== null && old !== u ? " (average of old and new copies)" : ""} · you paid <b>${rs(q * u)}</b>`;
      }
    }
    $("#rHint").innerHTML = html;
  }
  ["#rQty", "#rCost"].forEach((s) => $(s).addEventListener("input", renderRestockHint));
  $("#rBook").addEventListener("change", () => {
    const b = bookById($("#rBook").value);
    $("#rCost").value = b && num(b.cost_price) !== null ? num(b.cost_price) : "";
    renderRestockHint();
  });
  $("#restockForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const qty = num($("#rQty").value);
    if (!(qty > 0)) { $("#rQty").focus(); toast("How many copies?", true); return; }
    if ($("#rCost").value.trim() && num($("#rCost").value) === null) { toast("Cost must be a number", true); return; }
    const restock = { book_id: $("#rBook").value, qty, unit_cost: $("#rCost").value.trim(), supplier: $("#rSupplier").value.trim(), date: $("#rDate").value, notes: $("#rNotes").value.trim() };
    const ok = await submitWith($("#rSave"), "Saving…", () => api("addRestock", { restock }));
    if (ok) { closeDrawer(restockEd, true); toast(qty + " copies added to stock"); }
  });

  /* -------------------------------------------------------- expenses */
  function renderExpenses() {
    if (!loaded) return;
    const r = range($("#expPeriod").value);
    const list = D.expenses.filter((x) => inRange(x.date, r)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const total = list.reduce((a, x) => a + (num(x.amount) || 0), 0);
    const byCat = {};
    list.forEach((x) => { const c = x.category || "Other"; byCat[c] = (byCat[c] || 0) + (num(x.amount) || 0); });
    $("#expStrip").innerHTML = `<span><b>${rs(total)}</b> spent</span>` +
      Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<span>${esc(c)} <b>${rs(v)}</b></span>`).join("");
    $("#expList").innerHTML = list.length ? list.map((x) => `
      <div class="orow orow--simple" data-exp="${esc(x.id)}">
        <div class="orow__main">
          <p class="orow__title">${esc(x.description || x.category || "Expense")}</p>
          <p class="orow__meta">${niceDate(x.date)} · ${esc(x.category || "Other")}${x.paid_via ? " · " + esc(x.paid_via) : ""}</p>
        </div>
        <div class="orow__amt">${rsExact(num(x.amount) || 0)}</div>
        <button class="icon-btn icon-btn--danger" type="button" data-act="delexp" aria-label="Delete">${icon("i-trash")}</button>
      </div>`).join("") : `<p class="alist__empty">No expenses ${PERIOD_LABEL[$("#expPeriod").value]}. Printing new copies goes under <b>Stock</b>, not here.</p>`;

    const cats = new Set(EXP_CATS); D.expenses.forEach((x) => x.category && cats.add(x.category));
    $("#xCatList").innerHTML = [...cats].map((c) => `<option value="${esc(c)}">`).join("");
  }
  $("#expPeriod").addEventListener("change", renderExpenses);

  $("#expList").addEventListener("click", async (e) => {
    const b = e.target.closest('[data-act="delexp"]');
    if (!b) return;
    const row = b.closest(".orow"), x = D.expenses.find((v) => String(v.id) === row.dataset.exp);
    if (!x || !confirm(`Delete this expense of ${rsExact(num(x.amount) || 0)}?`)) return;
    row.classList.add("is-busy");
    try { await api("deleteExpense", { id: x.id }); toast("Expense deleted"); }
    catch (err) { row.classList.remove("is-busy"); toast(err.message, true); }
  });

  const expEd = $("#expEd");
  function openExpense() {
    $("#xAmount").value = ""; $("#xDesc").value = ""; $("#xCategory").value = "Shipping";
    $("#xDate").value = today(); $("#xVia").value = "UPI";
    paintCats();
    openDrawer(expEd, $("#xAmount"));
  }
  function paintCats() {
    const cur = $("#xCategory").value.trim().toLowerCase();
    $("#xCats").innerHTML = EXP_CATS.map((c) => `<button type="button" class="chip${c.toLowerCase() === cur ? " is-on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
  }
  $("#xCats").addEventListener("click", (e) => {
    const c = e.target.closest("[data-cat]");
    if (!c) return;
    $("#xCategory").value = c.dataset.cat; expEd.dataset.dirty = "1"; paintCats();
  });
  $("#xCategory").addEventListener("input", paintCats);
  $("#expForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = num($("#xAmount").value);
    if (!(amount > 0)) { $("#xAmount").focus(); toast("Enter the amount spent", true); return; }
    const expense = { amount, date: $("#xDate").value, category: $("#xCategory").value.trim() || "Other", description: $("#xDesc").value.trim(), paid_via: $("#xVia").value };
    const ok = await submitWith($("#xSave"), "Saving…", () => api("addExpense", { expense }));
    if (ok) { closeDrawer(expEd, true); toast("Expense saved"); }
  });

  /* ----------------------------------------------------------- start */
  if (!API) show("viewSetup");
  else if (store.get()) start();
  else show("viewLogin");
})();
