/**
 * Site auditor — the honest kind of check.
 *
 * Fetches a business's own website (public page, no login), measures what a
 * visitor would actually experience, and pulls the contact email that the
 * business itself publishes. No headless browser, no scraping of third-party
 * platforms: just the page the owner put online.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const JUNK_EMAIL = /(example\.com|sentry|wixpress|@2x|\.png|\.jpg|\.webp|\.svg|domain\.com|yourdomain|email\.com|godaddy|squarespace|wordpress\.com)/i;

/* Site checks are network-bound and a page rarely changes within a few hours.
   Cache them so re-running the same city costs seconds, not minutes. */
const AUDIT_TTL = Number(process.env.CACHE_TTL_MS) || 6 * 60 * 60 * 1000;
const auditCache = new Map();

export function extractEmails(html = "") {
  const out = new Set();
  for (const m of String(html).matchAll(/mailto:([^"'?>\s]+)/gi)) {
    const e = decodeURIComponent(m[1]).split("?")[0].trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !JUNK_EMAIL.test(e)) out.add(e);
  }
  for (const m of String(html).matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    const e = m[0].toLowerCase();
    if (!JUNK_EMAIL.test(e) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(e)) out.add(e);
  }
  return [...out].slice(0, 3);
}

export function detectPlatform(html = "", url = "") {
  const h = `${html.slice(0, 20000)} ${url}`.toLowerCase();
  if (/wix\.com|wixsite\.com|wixstatic/.test(h)) return "Wix";
  if (/squarespace/.test(h)) return "Squarespace";
  if (/shopify/.test(h)) return "Shopify";
  if (/webflow/.test(h)) return "Webflow";
  if (/godaddysites|secureserver\.net/.test(h)) return "GoDaddy builder";
  if (/linktr\.ee/.test(h)) return "Linktree";
  if (/wp-content|wp-includes/.test(h)) return "WordPress";
  if (/blogspot/.test(h)) return "Blogspot";
  if (/facebook\.com|instagram\.com/.test(h) && h.length < 400) return "Social page";
  return "";
}

const fetchPage = async (url, ms) => {
  const t0 = Date.now();
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(ms),
  });
  const html = await r.text();
  return { r, html, ms: Date.now() - t0 };
};

/**
 * @returns {{
 *   url, finalUrl, status, ok, https, ms, kb, mobile, title, platform,
 *   emails: string[], issues: string[], broken: boolean, error: string
 * }}
 */
export async function auditWebsite(rawUrl, { timeout = 9000, findEmail = true } = {}) {
  const cacheKey = `${rawUrl}|${findEmail}`;
  const hit = auditCache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return { ...hit.value, cached: true };

  const out = {
    url: rawUrl,
    finalUrl: rawUrl,
    status: 0,
    ok: false,
    https: String(rawUrl).startsWith("https://"),
    ms: 0,
    kb: 0,
    mobile: null,
    title: "",
    platform: "",
    booking: null,
    contactForm: null,
    phoneOnSite: null,
    emails: [],
    issues: [],
    broken: false,
    error: "",
  };
  if (!/^https?:\/\//i.test(rawUrl || "")) {
    out.error = "no website on file";
    return out;
  }

  let html = "";
  try {
    const main = await fetchPage(rawUrl, timeout);
    html = main.html;
    out.status = main.r.status;
    out.ok = main.r.ok;
    out.finalUrl = main.r.url;
    out.https = String(main.r.url).startsWith("https://");
    out.ms = main.ms;
    out.kb = Math.round(Buffer.byteLength(html) / 1024);
    out.title = (html.match(/<title[^>]*>([^<]{0,120})/i)?.[1] || "").trim();
    out.platform = detectPlatform(html, out.finalUrl);
    out.emails = extractEmails(html);
    const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    out.mobile = viewport;
    // "Site is fine but nobody can book" is the most common gap for clinics.
    out.booking =
      /(calendly\.com|book\s*(now|online|an appointment)|appointment|schedule (a|your) (visit|appointment)|acuityscheduling|zocdoc|squareup\.com\/appointments|opendental|dentrix)/i.test(
        html
      );
    out.contactForm = /<form[\s\S]{0,2500}?<(input|textarea)[^>]*(email|tel|phone|message)/i.test(html);
    out.phoneOnSite = /tel:\+?\d|\(\d{3}\)\s?\d{3}-\d{4}|\+\d{1,3}[\s-]?\d{2,}/.test(html);
  } catch (e) {
    out.error = String(e.message || e).slice(0, 120);
    out.ms = Date.now() - out.ms;
  }

  // One or two extra pages only if the homepage did not already give an email.
  if (findEmail && out.ok && !out.emails.length) {
    const base = out.finalUrl.replace(/\/+$/, "");
    for (const p of ["/contact", "/contact-us", "/about"]) {
      try {
        const sub = await fetchPage(base + p, 6000);
        if (!sub.r.ok) continue;
        const found = extractEmails(sub.html);
        if (found.length) {
          out.emails = found;
          break;
        }
      } catch {
        /* a missing contact page is normal, not an error */
      }
    }
  }

  const hard = [];
  if (out.error) hard.push(`site did not load (${out.error})`);
  else if (!out.ok) hard.push(`homepage returns HTTP ${out.status}`);
  if (!out.https) hard.push("no HTTPS");
  if (out.mobile === false) hard.push("no mobile viewport (breaks on phones)");
  if (out.ok && !out.title) hard.push("no page title (bad for Google)");

  const soft = [];
  if (out.ms > 4000) soft.push(`slow: ${(out.ms / 1000).toFixed(1)}s to first response`);
  if (out.kb > 3000) soft.push(`heavy page: ${(out.kb / 1024).toFixed(1)} MB of HTML`);

  out.hardIssues = hard;
  out.softIssues = soft;
  out.issues = [...hard, ...soft];
  // One slow sample is noise; a hard failure is a fact. A site only counts as
  // broken on a hard failure, or on two soft signals together.
  out.broken = hard.length > 0 || soft.length >= 2;
  auditCache.set(cacheKey, { value: out, exp: Date.now() + AUDIT_TTL });
  return out;
}

export function auditSummary(audit) {
  if (!audit || audit.error === "no website on file") return "No website on file";
  if (audit.error) return `Site does not load (${audit.error})`;
  const bits = [`HTTP ${audit.status}`, audit.https ? "HTTPS" : "no HTTPS", `${(audit.ms / 1000).toFixed(1)}s`, `${audit.kb} KB`];
  if (audit.mobile === false) bits.push("no mobile viewport");
  return bits.join(" · ");
}
