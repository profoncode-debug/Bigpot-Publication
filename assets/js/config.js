/* =========================================================================
   Bigpot Publication — site settings (the only file you normally edit)
   ========================================================================= */

window.SITE_CONFIG = {
  // WhatsApp number that receives orders: country code + number, digits only.
  // e.g. "919876543210" for +91 98765 43210
  whatsappNumber: "919474685023",

  // Price used for any book whose "price" cell in the Sheet is empty.
  defaultPrice: 999,

  // UPI payments (QR image lives at assets/img/upi-qr.png)
  upiId:   "9474685023@okbizaxis",
  upiName: "Mahapatra Equipment",     // must match the name on the UPI account

  // Admin dashboard (admin.html): the Apps Script "Web app URL" (ends in /exec).
  // Setup steps are at the top of apps-script/Code.gs.
  adminApiUrl: "https://script.google.com/macros/s/AKfycbygVjjoqT3SJS_gGrPkvC0j5LiO3rDF95Y7vLzkaWVnahEqmkt-oGGtPSs5yt3j4cOY/exec",

  // Where the website reads its books from — the Sheet's "Books" tab:
  //   Sheet → File → Share → Publish to web → choose the "Books" tab
  //   (NOT "Entire document" — that would make costs and sales public)
  //   → "Comma-separated values (.csv)" → Publish. Paste the link here.
  // If you leave this "" but set adminApiUrl, the site reads the Books tab
  // through the admin script instead (no publishing needed, a little slower).
  // With both empty, the built-in list in data.js is shown.
  // ⚠ This link is still the OLD Sheet — replace it with the owner's one.
  sheetCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTXhpFyQv6VenJh30CDKzZk-r9MCYZdnl8eWjBTCLkbsg__t8UD7fSJXrgYSum_pymoouTMyBOvOQpR/pub?output=csv"
};
