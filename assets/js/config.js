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

  // Google Sheet catalogue, published as CSV:
  //   Sheet → File → Share → Publish to web → (your tab) → "Comma-separated values" → Publish
  // Paste the link it gives you (ends in output=csv). Leave "" to use the
  // built-in list in data.js.
  sheetCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTXhpFyQv6VenJh30CDKzZk-r9MCYZdnl8eWjBTCLkbsg__t8UD7fSJXrgYSum_pymoouTMyBOvOQpR/pub?output=csv"
};
