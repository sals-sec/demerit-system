export function renderApplicationHtml(template, origin, nonce) {
  return template
    .replaceAll("__SALS_SITE_ORIGIN__", origin)
    .replaceAll("<script", `<script nonce="${nonce}"`);
}

export function applicationSecurityHeaders(nonce) {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "content-security-policy": [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; "),
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  };
}
