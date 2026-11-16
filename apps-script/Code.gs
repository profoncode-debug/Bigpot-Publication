/* =========================================================================
   Bigpot Publication — admin API (Google Apps Script)
   -------------------------------------------------------------------------
   The admin dashboard (admin.html) talks to this script, and this script is
   the only thing that writes to the Google Sheet. Every request is checked
   against your admin password.

   THE SHEET (tabs are created automatically if missing)
     Books      PUBLIC  what the website shows (title, price, photos, in stock)
     Inventory  private cost price, copies in stock, low-stock alert level
     Sales      private one row per book sold (price, cost, profit, payment)
     Expenses   private shipping, packaging, ads, rent… anything not a book
     Restocks   private every print run / purchase of new copies
     Summary    private totals (revenue, profit, stock value) as live formulas

   ⚠ Publish ONLY the "Books" tab to the web. Never "Entire document" —
     that would make costs, sales and customer phone numbers public.

   ONE-TIME SETUP (about 10 minutes)
   0. Make the Sheet in the owner's Google account: upload
      sheet-template/Bigpot-Sheet.xlsx to Google Drive → open it →
      File → Save as Google Sheets. (Or start from a blank Sheet and import
      sheet-template/Books.csv — the other tabs are created automatically.)
   1. Open the Google Sheet (owner's account) → Extensions → Apps Script.
      If Google says "Sorry, unable to open the file at present", you are
      signed in to several Google accounts: use an Incognito window with only
      the Sheet owner's account, OR create a new project at
      script.google.com and add the Script property SPREADSHEET_ID (the long
      id between /d/ and /edit in the Sheet's address bar).
   2. Delete whatever is in Code.gs and paste this whole file. Save.
   3. Left sidebar → ⚙ Project Settings → Script properties → Add:
        ADMIN_PASSWORD   →  a long password only you know (12+ characters)
      (optional)
        DRIVE_FOLDER_ID  →  a Drive folder for photos; leave out and one
                            called "Bigpot book images" is created for you
   4. Top right → Deploy → New deployment → type "Web app":
        Execute as:      Me
        Who has access:  Anyone
      → Deploy → Authorize access (choose your account → Advanced →
        "Go to … (unsafe)" → Allow; this warning is normal for your own script).
   5. Copy the "Web app URL" (ends in /exec) into assets/js/config.js as
      adminApiUrl, then publish the site.
   6. Sheet → File → Share → Publish to web → choose the "Books" tab (not
      Entire document) → "Comma-separated values (.csv)" → Publish. Paste
      that link into config.js as sheetCsvUrl.

   After editing this script later: Deploy → Manage deployments → ✏ →
   Version: "New version" → Deploy (the URL stays the same).
   ========================================================================= */

const TABS = {
  Books:     ["id", "category", "title", "subtitle", "tagline", "edition", "description",
              "price", "in_stock", "images", "sort_order"],
  Inventory: ["id", "title", "cost_price", "stock", "low_stock_alert", "updated"],
  Sales:     ["order_id", "date", "customer", "phone", "book_id", "title", "qty", "unit_price",
              "discount", "amount", "unit_cost", "cost", "profit", "payment_mode",
              "payment_status", "notes"],
  Expenses:  ["id", "date", "category", "description", "amount", "paid_via", "notes"],
  Restocks:  ["id", "date", "book_id", "title", "qty", "unit_cost", "total", "supplier", "notes"]
};
const PUBLIC_FIELDS = TABS.Books;
const TOKEN_DAYS = 14;
const MAX_FAILS = 8;            // wrong passwords allowed per 15 minutes
const LOCK_MINUTES = 15;

/* ------------------------------------------------------------- entry */
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return reply({ ok: false, error: "Bad request" }); }

  try {
    if (req.action === "login") return reply(login(req.password));
    if (!validToken(req.token)) return reply({ ok: false, error: "auth", message: "Please sign in again." });

    const write = (fn) => { withLock(fn); return { ok: true, data: snapshot() }; };
    switch (req.action) {
      case "all":            return reply({ ok: true, data: snapshot() });
      case "saveBook":       return reply(guarded(() => write(() => saveBook(req.book))));
      case "deleteBook":     return reply(write(() => deleteBook(req.id)));
      case "reorder":        return reply(write(() => reorder(req.ids)));
      case "upload":         return reply(uploadImage(req.name, req.mime, req.data));
      case "addSale":        return reply(guarded(() => write(() => addSale(req.sale))));
      case "setOrderStatus": return reply(write(() => setOrderStatus(req.order_id, req.status)));
      case "deleteOrder":    return reply(write(() => deleteOrder(req.order_id, req.restock !== false)));
      case "addExpense":     return reply(guarded(() => write(() => addExpense(req.expense))));
      case "deleteExpense":  return reply(write(() => deleteById("Expenses", req.id)));
      case "addRestock":     return reply(guarded(() => write(() => addRestock(req.restock))));
      case "deleteRestock":  return reply(write(() => deleteRestock(req.id)));
      default:               return reply({ ok: false, error: "Unknown action" });
    }
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

// Public read of the catalogue (only the Books tab, only public columns).
// The website can use this instead of the published CSV.
function doGet(e) {
  if (e && e.parameter && e.parameter.action === "books") {
    const cache = CacheService.getScriptCache();
    let json = cache.get("public-books");
    if (!json) {
      const books = readTab("Books").objects
        .filter((b) => b.title)
        .map((b) => { const o = {}; PUBLIC_FIELDS.forEach((k) => { o[k] = b[k]; }); return o; });
      json = JSON.stringify({ ok: true, books: books });
      try { cache.put("public-books", json, 60); } catch (err) { /* too big to cache */ }
    }
    return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
  }
  return reply({ ok: true, message: "Bigpot admin API is running." });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Validation errors thrown as UserError come back as a friendly message.
function UserError(msg) { const e = new Error(msg); e.user = true; return e; }
function guarded(fn) {
  try { return fn(); }
  catch (err) { if (err.user) return { ok: false, error: err.message, message: err.message }; throw err; }
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally {
    lock.releaseLock();
    try { CacheService.getScriptCache().remove("public-books"); } catch (err) { /* ignore */ }
  }
}

/* -------------------------------------------------------------- auth */
function props() { return PropertiesService.getScriptProperties(); }

function login(password) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get("fails") || 0);
  if (fails >= MAX_FAILS) {
    return { ok: false, error: "locked", message: "Too many wrong attempts. Try again in " + LOCK_MINUTES + " minutes." };
  }
  const real = props().getProperty("ADMIN_PASSWORD");
  if (!real) return { ok: false, error: "setup", message: "ADMIN_PASSWORD is not set in Script properties." };
  if (!password || !safeEqual(String(password), real)) {
    cache.put("fails", String(fails + 1), LOCK_MINUTES * 60);
    Utilities.sleep(800);
    return { ok: false, error: "wrong", message: "Wrong password." };
  }
  cache.remove("fails");
  const expires = Date.now() + TOKEN_DAYS * 864e5;
  return { ok: true, token: expires + "." + sign(String(expires)) };
}

// token = "<expiry ms>.<HMAC of expiry keyed by the password>"
// Changing ADMIN_PASSWORD signs everyone out.
function validToken(token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expires = Number(parts[0]);
  if (!expires || expires < Date.now()) return false;
  return safeEqual(parts[1], sign(parts[0]));
}

function sign(text) {
  const key = props().getProperty("ADMIN_PASSWORD") + "|bigpot-admin";
  const raw = Utilities.computeHmacSha256Signature(text, key);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------- sheet */
let _ss = null;
function book() {
  if (_ss) return _ss;
  const sid = props().getProperty("SPREADSHEET_ID");
  _ss = sid ? SpreadsheetApp.openById(sid) : SpreadsheetApp.getActiveSpreadsheet();
  if (!_ss) throw new Error("Set SPREADSHEET_ID in Script properties (the long id in the Sheet's URL).");
  return _ss;
}

// The Books tab: one called "Books" (or SHEET_NAME), else the first tab that
// isn't one of the private tabs — so an older single-tab Sheet keeps working.
function findSheet(name) {
  const ss = book();
  if (name === "Books") {
    const custom = props().getProperty("SHEET_NAME");
    const named = ss.getSheetByName(custom || "Books");
    if (named) return named;
    const priv = Object.keys(TABS).concat(["Summary"]).filter((t) => t !== "Books");
    const first = ss.getSheets().filter((s) => priv.indexOf(s.getName()) === -1)[0];
    if (first) return first;
  }
  return ss.getSheetByName(name);
}

function tab(name) {
  let sh = findSheet(name);
  if (!sh) {
    sh = book().insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]);
    sh.setFrozenRows && sh.setFrozenRows(1);
    if (name !== "Books") ensureSummary();
  }
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim().toLowerCase());
  while (head.length && !head[head.length - 1]) head.pop();
  TABS[name].forEach((c) => {
    if (head.indexOf(c) === -1) {
      head.push(c);
      sh.getRange(1, head.length).setValue(c);
    }
  });
  return { sh: sh, head: head, name: name };
}

function tz() {
  try { return book().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }
  catch (err) { return "Asia/Kolkata"; }
}

function norm(v, zone) {
  if (v instanceof Date) return Utilities.formatDate(v, zone, "yyyy-MM-dd");
  return v;
}

function readTab(name) {
  const t = tab(name);
  const n = t.sh.getLastRow() - 1;
  const zone = tz();
  const rows = n > 0 ? t.sh.getRange(2, 1, n, t.head.length).getValues().map((r) => r.map((v) => norm(v, zone))) : [];
  const objects = rows.map((r) => { const o = {}; t.head.forEach((h, i) => { if (h) o[h] = r[i]; }); return o; });
  return { sh: t.sh, head: t.head, rows: rows, objects: objects };
}

function rowValues(d, obj, existing) {
  return d.head.map((h, i) => (h in obj ? cell(obj[h]) : (existing ? existing[i] : "")));
}
function writeRow(d, index, obj) {           // index = 0-based data row, -1 = append
  const target = index === -1 ? d.rows.length + 2 : index + 2;
  const out = rowValues(d, obj, index === -1 ? null : d.rows[index]);
  d.sh.getRange(target, 1, 1, out.length).setValues([out]);
  if (index === -1) { d.rows.push(out); d.objects.push(Object.assign({}, obj)); }
  else { d.rows[index] = out; Object.assign(d.objects[index], obj); }
}
function appendRows(d, objs) {
  if (!objs.length) return;
  const out = objs.map((o) => rowValues(d, o, null));
  d.sh.getRange(d.rows.length + 2, 1, out.length, d.head.length).setValues(out);
  out.forEach((r, i) => { d.rows.push(r); d.objects.push(objs[i]); });
}
function findIndex(d, key, value) {
  return d.objects.findIndex((o) => String(o[key]) === String(value));
}

// Text that starts with = + - @ would be run as a formula by Sheets.
function cell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v).slice(0, 5000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return isFinite(n) ? n : null;
}
const round2 = (n) => Math.round(n * 100) / 100;
const today = () => Utilities.formatDate(new Date(), tz(), "yyyy-MM-dd");
function cleanDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : today(); }

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
function newId(prefix) { return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }

/* ---------------------------------------------------------- snapshot */
function snapshot() {
  withLockOnly(ensureIds);
  const books = readTab("Books").objects.filter((b) => b.title || b.id);
  const inv = readTab("Inventory").objects;
  const invById = {};
  inv.forEach((r) => { if (r.id !== "") invById[String(r.id)] = r; });
  books.forEach((b) => {
    const r = invById[String(b.id)] || {};
    b.cost_price = r.cost_price === undefined ? "" : r.cost_price;
    b.stock = r.stock === undefined ? "" : r.stock;
    b.low_stock_alert = r.low_stock_alert === undefined ? "" : r.low_stock_alert;
  });
  books.sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  return {
    books: books,
    sales: readTab("Sales").objects.filter((s) => s.order_id),
    expenses: readTab("Expenses").objects.filter((x) => x.id),
    restocks: readTab("Restocks").objects.filter((x) => x.id),
    today: today()
  };
}
function withLockOnly(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// Rows typed straight into the Sheet may have no id; give them one so the
// admin page can edit them without creating duplicates.
function ensureIds() {
  const d = readTab("Books");
  const idCol = d.head.indexOf("id"), tCol = d.head.indexOf("title");
  const ids = d.rows.map((r) => String(r[idCol]));
  let changed = false;
  const col = d.rows.map((r, i) => {
    if (ids[i] || !r[tCol]) return [ids[i]];
    const base = slugify(r[tCol]) || "book";
    let id = base, n = 2;
    while (ids.indexOf(id) !== -1) id = base + "-" + n++;
    ids[i] = id; changed = true;
    return [id];
  });
  if (changed) d.sh.getRange(2, idCol + 1, col.length, 1).setValues(col);
}

/* ------------------------------------------------------------- books */
function saveBook(b) {
  if (!b || !String(b.title || "").trim()) throw UserError("Title is required.");
  const d = readTab("Books");
  const ids = d.objects.map((o) => String(o.id));

  let id = String(b.id || "").trim();
  let index = id ? ids.indexOf(id) : -1;
  if (index === -1) {                              // new book → unique id
    const base = slugify(id) || slugify(b.title) || "book";
    id = base; let n = 2;
    while (ids.indexOf(id) !== -1) id = base + "-" + n++;
  }

  const images = (Array.isArray(b.images) ? b.images : String(b.images || "").split("|"))
    .map((s) => String(s).trim()).filter(Boolean);
  const price = num(b.price);
  let sortOrder = Number(b.sort_order);
  if (!sortOrder) sortOrder = d.objects.reduce((m, o) => Math.max(m, Number(o.sort_order) || 0), 0) + 10;

  writeRow(d, index, {
    id: id,
    category: String(b.category || "").trim().toLowerCase(),
    title: String(b.title).trim(),
    subtitle: b.subtitle || "",
    tagline: b.tagline || "",
    edition: b.edition || "",
    description: b.description || "",
    price: price === null ? "" : price,
    in_stock: b.in_stock === false || b.in_stock === "no" ? "no" : "yes",
    images: images.join(" | "),
    sort_order: sortOrder
  });

  // private numbers live on the Inventory tab
  const inv = readTab("Inventory");
  const i = findIndex(inv, "id", id);
  const patch = { id: id, title: String(b.title).trim(), updated: today() };
  if ("cost_price" in b) { const c = num(b.cost_price); patch.cost_price = c === null ? "" : c; }
  if ("stock" in b) { const s = num(b.stock); patch.stock = s === null ? "" : Math.round(s); }
  if ("low_stock_alert" in b) { const l = num(b.low_stock_alert); patch.low_stock_alert = l === null ? "" : Math.round(l); }
  writeRow(inv, i, patch);
}

function deleteBook(id) {
  const d = readTab("Books");
  const i = findIndex(d, "id", id);
  if (i === -1) throw UserError("Book not found.");
  d.sh.deleteRow(i + 2);
  const inv = readTab("Inventory");
  const j = findIndex(inv, "id", id);
  if (j !== -1) inv.sh.deleteRow(j + 2);
}

function reorder(ids) {
  if (!Array.isArray(ids)) throw UserError("ids missing");
  const d = readTab("Books");
  const sc = d.head.indexOf("sort_order");
  const col = d.objects.map((o) => {
    const pos = ids.indexOf(String(o.id));
    return [pos === -1 ? (Number(o.sort_order) || 9999) : (pos + 1) * 10];
  });
  if (col.length) d.sh.getRange(2, sc + 1, col.length, 1).setValues(col);
}

/* ------------------------------------------------------------- stock */
// change = +copies / −copies. Returns the inventory row after the change.
function changeStock(inv, books, id, change, newCost) {
  let i = findIndex(inv, "id", id);
  const cur = i === -1 ? {} : inv.objects[i];
  const before = num(cur.stock);
  const patch = { id: id, updated: today() };
  const bi = findIndex(books, "id", id);
  if (bi !== -1) patch.title = books.objects[bi].title;
  if (before !== null || change > 0) patch.stock = (before || 0) + change;
  if (newCost !== undefined) patch.cost_price = newCost;
  writeRow(inv, i, patch);
  // keep the website's "in stock" flag in step with the count
  if (bi !== -1 && patch.stock !== undefined) {
    const shown = String(books.objects[bi].in_stock).toLowerCase() !== "no";
    if (patch.stock <= 0 && shown) writeRow(books, bi, { in_stock: "no" });
    if (patch.stock > 0 && !shown && change > 0) writeRow(books, bi, { in_stock: "yes" });
  }
  return patch;
}

/* ------------------------------------------------------------- sales */
function addSale(s) {
  if (!s || !Array.isArray(s.lines) || !s.lines.length) throw UserError("Add at least one book to the sale.");
  const books = readTab("Books"), inv = readTab("Inventory"), sales = readTab("Sales");
  const date = cleanDate(s.date);

  // order id like BP-261116-03 (date + running number for that day)
  const stamp = date.slice(2).replace(/-/g, "");
  let n = 0;
  sales.objects.forEach((o) => {
    const m = String(o.order_id).match(/^BP-(\d{6})-(\d+)$/);
    if (m && m[1] === stamp) n = Math.max(n, Number(m[2]));
  });
  const orderId = "BP-" + stamp + "-" + ("0" + (n + 1)).slice(-2);
  const status = s.payment_status === "pending" ? "pending" : "paid";

  const rows = s.lines.map((l) => {
    const bi = findIndex(books, "id", l.book_id);
    if (bi === -1) throw UserError("Unknown book: " + l.book_id);
    const qty = Math.round(num(l.qty) || 0);
    if (qty <= 0) throw UserError("Copies must be at least 1.");
    const price = num(l.unit_price);
    if (price === null || price < 0) throw UserError("Enter a selling price for " + books.objects[bi].title);
    const discount = Math.max(0, num(l.discount) || 0);
    const ii = findIndex(inv, "id", l.book_id);
    const unitCost = ii === -1 ? null : num(inv.objects[ii].cost_price);   // cost comes from the Sheet
    const amount = round2(qty * price - discount);
    const cost = unitCost === null ? "" : round2(qty * unitCost);
    return {
      order_id: orderId, date: date,
      customer: String(s.customer || "").trim(), phone: String(s.phone || "").trim(),
      book_id: l.book_id, title: books.objects[bi].title,
      qty: qty, unit_price: price, discount: discount || "", amount: amount,
      unit_cost: unitCost === null ? "" : unitCost, cost: cost,
      profit: cost === "" ? "" : round2(amount - cost),
      payment_mode: String(s.payment_mode || "").trim(),
      payment_status: status, notes: String(s.notes || "").trim()
    };
  });
  appendRows(sales, rows);
  rows.forEach((r) => changeStock(inv, books, r.book_id, -r.qty));
  return orderId;
}

function setOrderStatus(orderId, status) {
  const d = readTab("Sales");
  const col = d.head.indexOf("payment_status");
  const value = status === "pending" ? "pending" : "paid";
  let found = false;
  d.objects.forEach((o, i) => {
    if (String(o.order_id) === String(orderId)) { d.sh.getRange(i + 2, col + 1).setValue(value); found = true; }
  });
  if (!found) throw UserError("Order not found.");
}

function deleteOrder(orderId, restock) {
  const d = readTab("Sales");
  const hits = [];
  d.objects.forEach((o, i) => { if (String(o.order_id) === String(orderId)) hits.push(i); });
  if (!hits.length) throw UserError("Order not found.");
  const lines = hits.map((i) => d.objects[i]);
  hits.reverse().forEach((i) => d.sh.deleteRow(i + 2));
  if (restock) {
    const books = readTab("Books"), inv = readTab("Inventory");
    lines.forEach((l) => { if (num(l.qty)) changeStock(inv, books, l.book_id, num(l.qty)); });
  }
}

/* ---------------------------------------------------------- expenses */
function addExpense(x) {
  const amount = num(x && x.amount);
  if (!amount || amount <= 0) throw UserError("Enter the amount spent.");
  const d = readTab("Expenses");
  appendRows(d, [{
    id: newId("E"), date: cleanDate(x.date),
    category: String(x.category || "Other").trim(),
    description: String(x.description || "").trim(),
    amount: round2(amount), paid_via: String(x.paid_via || "").trim(),
    notes: String(x.notes || "").trim()
  }]);
}

function deleteById(name, id) {
  const d = readTab(name);
  const i = findIndex(d, "id", id);
  if (i === -1) throw UserError("Not found — reload and try again.");
  d.sh.deleteRow(i + 2);
  return d.objects[i];
}

/* ---------------------------------------------------------- restocks */
// New copies printed / bought. Cost price becomes the weighted average of
// the copies already in stock and the new ones.
function addRestock(r) {
  const qty = Math.round(num(r && r.qty) || 0);
  if (qty <= 0) throw UserError("Copies must be at least 1.");
  const books = readTab("Books"), inv = readTab("Inventory"), d = readTab("Restocks");
  const bi = findIndex(books, "id", r.book_id);
  if (bi === -1) throw UserError("Pick a book.");
  const unitCost = num(r.unit_cost);
  if (unitCost !== null && unitCost < 0) throw UserError("Cost can't be negative.");

  let newCost;
  if (unitCost !== null) {
    const ii = findIndex(inv, "id", r.book_id);
    const cur = ii === -1 ? {} : inv.objects[ii];
    const have = Math.max(0, num(cur.stock) || 0), oldCost = num(cur.cost_price);
    newCost = have > 0 && oldCost !== null ? round2((have * oldCost + qty * unitCost) / (have + qty)) : unitCost;
  }
  appendRows(d, [{
    id: newId("R"), date: cleanDate(r.date), book_id: r.book_id, title: books.objects[bi].title,
    qty: qty, unit_cost: unitCost === null ? "" : unitCost,
    total: unitCost === null ? "" : round2(qty * unitCost),
    supplier: String(r.supplier || "").trim(), notes: String(r.notes || "").trim()
  }]);
  changeStock(inv, books, r.book_id, qty, newCost);
}

function deleteRestock(id) {
  const row = deleteById("Restocks", id);
  const q = num(row.qty);
  if (q) changeStock(readTab("Inventory"), readTab("Books"), row.book_id, -q);
}

/* ----------------------------------------------------------- summary */
function colLetter(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function ensureSummary() {
  const ss = book();
  if (ss.getSheetByName("Summary")) return;
  ["Inventory", "Sales", "Expenses", "Restocks"].forEach((t) => {
    if (!ss.getSheetByName(t)) { const sh = ss.insertSheet(t); sh.getRange(1, 1, 1, TABS[t].length).setValues([TABS[t]]); }
  });
  const c = (t, h) => t + "!" + colLetter(TABS[t].indexOf(h) + 1) + "2:" + colLetter(TABS[t].indexOf(h) + 1);
  const sh = ss.insertSheet("Summary");
  sh.getRange(1, 1, 11, 2).setValues([
    ["Bigpot — totals (all time, update automatically)", ""],
    ["Sales (revenue)",          "=SUM(" + c("Sales", "amount") + ")"],
    ["Cost of books sold",       "=SUM(" + c("Sales", "cost") + ")"],
    ["Gross profit",             "=SUM(" + c("Sales", "profit") + ")"],
    ["Expenses",                 "=SUM(" + c("Expenses", "amount") + ")"],
    ["Net profit",               "=B4-B5"],
    ["Payments pending",         "=SUMIF(" + c("Sales", "payment_status") + ",\"pending\"," + c("Sales", "amount") + ")"],
    ["Spent on printing/stock",  "=SUM(" + c("Restocks", "total") + ")"],
    ["Copies in stock",          "=SUM(" + c("Inventory", "stock") + ")"],
    ["Stock value (at cost)",    "=SUMPRODUCT(IFERROR(VALUE(" + c("Inventory", "cost_price") + "),0),IFERROR(VALUE(" + c("Inventory", "stock") + "),0))"],
    ["Orders",                   "=COUNTUNIQUE(" + c("Sales", "order_id") + ")"]
  ]);
}

/* ------------------------------------------------------------ images */
function imageFolder() {
  const p = props();
  const id = p.getProperty("DRIVE_FOLDER_ID");
  if (id) return DriveApp.getFolderById(id);
  const folder = DriveApp.createFolder("Bigpot book images");
  p.setProperty("DRIVE_FOLDER_ID", folder.getId());
  return folder;
}

function uploadImage(name, mime, data) {
  if (!/^image\/(jpeg|png|webp)$/.test(String(mime))) return { ok: false, error: "Only JPG, PNG or WebP images." };
  const bytes = Utilities.base64Decode(String(data || ""));
  if (bytes.length > 8 * 1024 * 1024) return { ok: false, error: "Image is larger than 8 MB." };
  const safe = String(name || "page").replace(/[^\w.\- ]/g, "").slice(0, 80) || "page";
  const file = imageFolder().createFile(Utilities.newBlob(bytes, mime, Date.now() + "-" + safe));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: "https://drive.google.com/file/d/" + file.getId() + "/view" };
}

// Run this once from the editor (▶ Run → setupSheet) to create all tabs now.
function setupSheet() {
  Object.keys(TABS).forEach(tab);
  ensureSummary();
}
