/**
 * dsh-desktop-shell — navigation boundary policy (pure, testable).
 *
 * Same-origin navigation (the loopback DSH origin) is allowed inside the main
 * window; external http/https links are handed to the system browser; every
 * other protocol (file:, javascript:, data:, shell:, custom) is denied
 * outright and never reaches the OS.
 */

/** Whether a navigation target shares the allowed origin. */
export function isAllowedOrigin(candidate, allowedOrigin) {
  return candidate === allowedOrigin;
}

/**
 * Classify one navigation attempt.
 * @returns { action: "allow" | "open-external" | "deny", href? }
 */
export function classifyNavigation(targetUrl, allowedOrigin) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return { action: "deny" };
  }
  if (url.origin === allowedOrigin) return { action: "allow" };
  if (url.protocol === "http:" || url.protocol === "https:") {
    return { action: "open-external", href: url.href };
  }
  return { action: "deny" };
}

/**
 * Open an external URL through the system browser, but ONLY after confirming
 * the protocol is http: or https:. Returns false and opens nothing otherwise.
 */
export function openExternalSafe(rawUrl, openExternal = null) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (openExternal !== null) openExternal(url.href);
  return true;
}
