/**
 * LeadScout 2.0 — source adapters.
 *
 * Rules baked in here:
 *  - Only public, documented endpoints or Google/Bing-grade search APIs.
 *  - No login walls, no cookie reuse, no anti-bot evasion, no profile scraping.
 *  - Every record carries the URL we actually fetched it from.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const T = (ms) => AbortSignal.timeout(ms);

/* ------------------------------------------------------------------ */
/* short-lived cache                                                   */
/* Every run starts from scratch, but re-querying the same city within a */
/* few hours wastes time and Google credit. Results are cached in memory. */
/* ------------------------------------------------------------------ */
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 6 * 60 * 60 * 1000;
const cache = new Map();

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) {
    hit.hits = (hit.hits || 0) + 1;
    return hit.value;
  }
  const value = await fn();
  cache.set(key, { value, exp: Date.now() + CACHE_TTL_MS, hits: 0 });
  return value;
}

export function cacheStats() {
  let entries = 0;
  let hits = 0;
  for (const v of cache.values()) {
    entries++;
    hits += v.hits || 0;
  }
  return { entries, hits, ttlHours: Math.round(CACHE_TTL_MS / 36e5) };
}

async function req(url, opts = {}, ms = 20000) {
  const r = await fetch(url, {
    ...opts,
    headers: { "User-Agent": UA, Accept: "*/*", ...(opts.headers || {}) },
    signal: T(ms),
  });
  return r;
}

export function fixMojibake(s = "") {
  const str = String(s);
  if (!/[ÃÂâð]/.test(str)) return str;
  try {
    const out = Buffer.from(str, "latin1").toString("utf8");
    if (!out.includes("\uFFFD")) return out;
  } catch {}
  return str;
}

export function stripHtml(s = "") {
  return fixMojibake(String(s))
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/\s+/g, " ")
    .trim();
}

export function firstEmail(text = "") {
  const m = String(text).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (!m) return "";
  const bad = /(example|sentry|wixpress|domain\.com|email\.com|yourdomain)/i;
  return bad.test(m[0]) ? "" : m[0];
}

// Approximate FX → USD. Only used to stop "₹50,000" being quoted as "$50,000".
// Refresh occasionally; the app labels every converted number with ≈.
const FX = { USD: 1, GBP: 1.27, EUR: 1.08, INR: 0.012, AUD: 0.66, NZD: 0.6, CAD: 0.73 };
const SYM = { "US$": "USD", "A$": "AUD", "NZ$": "NZD", "C$": "CAD", "$": "USD", "€": "EUR", "£": "GBP", "₹": "INR" };

function detectCurrency(t) {
  if (/₹|\binr\b/i.test(t)) return "INR";
  if (/£|\bgbp\b/i.test(t)) return "GBP";
  if (/€|\beur\b/i.test(t)) return "EUR";
  if (/a\$|\baud\b/i.test(t)) return "AUD";
  if (/nz\$|\bnzd\b/i.test(t)) return "NZD";
  if (/c\$|\bcad\b/i.test(t)) return "CAD";
  return "USD";
}

export function moneyHints(text = "") {
  const t = String(text);
  const fallback = detectCurrency(t);
  const out = [];

  const push = (raw, sym) => {
    if (!raw) return;
    const code = sym ? SYM[sym.toUpperCase()] || SYM[sym] || String(sym).toUpperCase() : fallback;
    const s = String(raw).toLowerCase().replace(/,/g, "");
    const n = s.endsWith("k") ? parseFloat(s) * 1000 : parseFloat(s);
    if (!Number.isFinite(n)) return;
    if (n < 100) return; // "$5" is noise, not a budget
    const usd = Math.round(n * (FX[code] ?? 1));
    if (usd >= 100) out.push(usd);
  };

  // 1. shorthand thousands: "20k", "₹1.5k"
  for (const m of t.matchAll(/([A-Z]{0,2}\$|€|£|₹)?\s?(\d[\d,]*(?:\.\d+)?)\s?k\b/gi)) push(m[2] + "k", m[1]);

  // 2. currency-marked ranges: $250-750 / €2,000–5,000 / ₹50,000-1,00,000
  for (const m of t.matchAll(/([A-Z]{0,2}\$|€|£|₹)\s?(\d[\d,]*(?:\.\d+)?k?)\s?(?:-|–|to)\s?(?:[A-Z]{0,2}\$|€|£|₹)?\s?(\d[\d,]*(?:\.\d+)?k?)/gi)) {
    push(m[2], m[1]);
    push(m[3], m[1]);
  }

  // 3. single marked amounts, symbol or ISO code: $250 / EUR 2,000 / INR 25,000
  for (const m of t.matchAll(/([A-Z]{0,2}\$|€|£|₹|\b(?:usd|gbp|eur|inr|aud|nzd|cad)\b)\s?(\d[\d,]*(?:\.\d+)?k?)/gi)) {
    push(m[2], m[1]);
  }

  // 4. contextual amounts, no marker: "budget 800" → assume the document currency
  for (const m of t.matchAll(/(?:budget|pay|rate|salary|compensation)\D{0,18}(\d[\d,]*(?:\.\d+)?k?)/gi)) push(m[1]);

  return [...new Set(out)].sort((a, b) => a - b).slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* 1. Google Places API (New) — real businesses, phone, website, gap   */
/* ------------------------------------------------------------------ */

export async function searchPlaces({ apiKey, textQuery, regionCode = "US", max = 20, pages = 1 }) {
  const key = `places|${textQuery}|${regionCode}|${max}|${pages}`;
  return cached(key, async () => {
  const out = [];
  let pageToken = "";
  for (let page = 0; page < pages; page++) {
    const body = {
      textQuery,
      maxResultCount: Math.min(max, 20),
      languageCode: "en",
      regionCode,
    };
    if (pageToken) body.pageToken = pageToken;

    const r = await req("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.googleMapsUri,places.businessStatus,places.primaryTypeDisplayName,nextPageToken",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = (await r.text()).slice(0, 300);
      throw new Error(`Google Places ${r.status}: ${err}`);
    }
    const data = await r.json();
    out.push(
      ...(data.places || []).map((p) => ({
        placeId: p.id,
        name: p.displayName?.text || "Unknown business",
        address: p.formattedAddress || "",
        website: p.websiteUri || "",
        phone: p.nationalPhoneNumber || "",
        rating: p.rating ?? null,
        reviews: p.userRatingCount ?? 0,
        mapsUrl: p.googleMapsUri || "",
        category: p.primaryTypeDisplayName?.text || "",
        status: p.businessStatus || "",
      }))
    );
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
    await new Promise((res) => setTimeout(res, 1500)); // token needs a moment to activate
  }
  return out;
  });
}

export function checkPlacesKey(apiKey) {
  return searchPlaces({ apiKey, textQuery: "coffee shop in Austin", max: 1 });
}

/**
 * Look one business up on Google Places by name + city. Used to add a phone
 * number (and rating) to a business we found elsewhere — OpenStreetMap lists
 * plenty of good businesses that simply do not rank on Google.
 */
export async function lookupPlace({ apiKey, name, city, regionCode = "US" }) {
  const q = `${name} ${city || ""}`.trim();
  if (!q) return null;
  return cached(`lookup|${q}|${regionCode}`, async () => {
  const r = await req("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.googleMapsUri,places.websiteUri,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: q, maxResultCount: 3, languageCode: "en", regionCode }),
  });
  if (!r.ok) throw new Error(`Google lookup ${r.status}`);
  const data = await r.json();
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(name);
  const scored = (data.places || []).map((p) => {
    const got = norm(p.displayName?.text || "");
    let score = 0;
    if (got === target) score = 3;
    else if (got.includes(target) || target.includes(got)) score = 2;
    else if (target.slice(0, 8) && got.slice(0, 8) === target.slice(0, 8)) score = 1;
    return { p, score };
  });
  const best = scored.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score === 0) return null;
  const p = best.p;
  return {
    phone: p.nationalPhoneNumber || "",
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? 0,
    mapsUrl: p.googleMapsUri || "",
    website: p.websiteUri || "",
    address: p.formattedAddress || "",
    confidence: best.score,
  };
  });
}

/* ------------------------------------------------------------------ */
/* 1b. OpenStreetMap — free map source, no API key                    */
/*     Nominatim for the bbox, Overpass for the businesses.           */
/* ------------------------------------------------------------------ */

const OSM_UA = "LeadScout/2.0 (local client-finder; contact: local user)";
const geocodeCache = new Map();

export async function geocodeCity(city) {
  const key = city.toLowerCase().trim();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  const r = await req(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
    { headers: { "User-Agent": OSM_UA, Accept: "application/json" } },
    25000
  );
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const data = await r.json();
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit?.boundingbox) throw new Error(`could not geocode "${city}"`);
  const [s, n, w, e] = hit.boundingbox.map(Number);
  const out = { bbox: [s, w, n, e], label: hit.display_name };
  geocodeCache.set(key, out);
  return out;
}

/** tags: array of [key, value] OSM selectors, e.g. [["amenity","dentist"]] */
export async function osmPlaces({ bbox, tags, limit = 60 }) {
  const [s, w, n, e] = bbox;
  const box = `${s},${w},${n},${e}`;
  return cached(`osm|${box}|${JSON.stringify(tags)}|${limit}`, async () => {
  const parts = tags.flatMap(([k, v]) => [`node["${k}"="${v}"](${box});`, `way["${k}"="${v}"](${box});`]);
  // "out tags" is ~40% faster than "out center" and we only need the tags.
  const q = `[out:json][timeout:45];(${parts.join("")});out tags ${limit};`;
  let r = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      r = await req(
        "https://overpass-api.de/api/interpreter",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": OSM_UA },
          body: new URLSearchParams({ data: q }).toString(),
        },
        55000
      );
      if (r.ok) break;
      lastErr = new Error(`Overpass ${r.status}`);
      // 429/5xx on Overpass is usually transient load — back off and retry.
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 2500 * (attempt + 1)));
  }
  if (!r || !r.ok) throw lastErr || new Error("Overpass unavailable");
  const data = await r.json();
  return (data.elements || [])
    .filter((el) => el.tags?.name)
    .map((el) => {
      const t = el.tags || {};
      const addr = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
      return {
        osmId: `${el.type}/${el.id}`,
        name: t.name,
        address: [addr, t["addr:city"], t["addr:postcode"]].filter(Boolean).join(", "),
        website: t.website || t["contact:website"] || "",
        phone: t.phone || t["contact:phone"] || t["phone:mobile"] || "",
        email: t.email || t["contact:email"] || "",
        category: Object.entries(t).find(([k]) => ["amenity", "shop", "office", "leisure", "healthcare", "tourism", "craft"].includes(k))?.[1] || "",
        lat: el.lat ?? el.center?.lat,
        lon: el.lon ?? el.center?.lon,
        mapsUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        tags: t,
      };
    });
  });
}

/* ------------------------------------------------------------------ */
/* 2. Reddit — public JSON search                                     */
/* ------------------------------------------------------------------ */

export async function redditSearch({ query, sub = "forhire", days = 30, limit = 50 }) {
  const url =
    `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json` +
    `?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&t=month&limit=${limit}&raw_json=1`;
  const r = await req(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Reddit r/${sub} ${r.status}`);
  const data = await r.json();
  const cutoff = Date.now() - days * 864e5;
  return (data?.data?.children || [])
    .map((c) => c.data)
    .filter((p) => p && p.created_utc * 1000 >= cutoff && !p.over_18)
    .map((p) => ({
      id: p.id,
      title: p.title || "",
      body: (p.selftext || "").slice(0, 1200),
      url: `https://www.reddit.com${p.permalink}`,
      author: p.author || "",
      created: new Date(p.created_utc * 1000).toISOString(),
      subreddit: p.subreddit,
      score: p.score,
    }));
}

/**
 * Is this person BUYING or SELLING? Every public feed is full of freelancers
 * advertising themselves, which looks like a lead to a keyword search but is
 * the opposite. Selling wins ties: if both signals appear, it is not a lead.
 */
export function isBuyerPost(text = "") {
  const t = String(text).toLowerCase().replace(/\s+/g, " ");
  const sell =
    /(i (am|'m) (a|an) (developer|freelancer|designer|engineer)|i build|i create|i can build|we (build|offer|provide|create)|our (agency|team|studio|company)|hire me|available for (work|freelance|projects)|dm me (for|if you need)|portfolio|services include|we are a (web|digital|software) (agency|studio)|book a call)/;
  if (sell.test(t)) return false;
  const buy =
    /(looking for (a|an|someone|somebody|help)|need (a|an|someone|somebody|help)|hiring|anyone (know|recommend)|who can (build|help|make|develop)|recommend(ations?)? for|searching for|in the market for|budget (of|is|around)|quote|rfp|dm me|reach out|get in touch)/;
  if (!buy.test(t)) return false;
  // "need a developer" is only a lead if they describe the work.
  return t.length > 60;
}

/* ------------------------------------------------------------------ */
/* 2c. Bluesky — public search API, no key, no login                  */
/* ------------------------------------------------------------------ */

export async function blueskySearch({ query, limit = 25, days = 14 }) {
  const url = `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=${limit}&sort=latest`;
  const r = await req(url, { headers: { Accept: "application/json" } }, 25000);
  if (!r.ok) throw new Error(`Bluesky ${r.status}`);
  const data = await r.json();
  const cutoff = Date.now() - days * 864e5;
  return (data.posts || [])
    .filter((p) => p?.record?.text && p?.author?.handle)
    .filter((p) => {
      const t = Date.parse(p.record.createdAt);
      return !Number.isFinite(t) || t >= cutoff;
    })
    .map((p) => {
      const id = String(p.uri).split("/").pop();
      return {
        id,
        text: p.record.text,
        author: p.author.handle,
        created: p.record.createdAt,
        url: `https://bsky.app/profile/${p.author.handle}/post/${id}`,
      };
    });
}

/* ------------------------------------------------------------------ */
/* 2b. Reddit RSS — used when the JSON API blocks the request         */
/* ------------------------------------------------------------------ */

export async function redditRSS({ sub, days = 14, limit = 60 }) {
  const r = await req(`https://www.reddit.com/r/${encodeURIComponent(sub)}/new.rss`, {
    headers: { Accept: "application/atom+xml, application/rss+xml, text/xml" },
  });
  if (!r.ok) throw new Error(`Reddit RSS r/${sub} ${r.status}`);
  const xml = await r.text();
  const cutoff = Date.now() - days * 864e5;
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const title = stripHtml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const link = (e.match(/<link[^>]+href="([^"]+)"/) || [])[1] || "";
    const updated = (e.match(/<updated>([^<]+)<\/updated>/) || [])[1] || "";
    const content = stripHtml((e.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || "");
    if (!link) continue;
    const t = Date.parse(updated);
    if (Number.isFinite(t) && t < cutoff) continue;
    out.push({
      id: ((e.match(/<id>([^<]+)<\/id>/) || [])[1] || link).replace(/^t3_/, ""),
      title,
      body: content.slice(0, 1200),
      url: link,
      author: ((e.match(/<name>([^<]+)<\/name>/) || [])[1] || "").replace(/^\/u\//, ""),
      created: Number.isFinite(t) ? new Date(t).toISOString() : "",
      subreddit: sub,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3. Hacker News — the monthly "Freelancer? Seeking freelancer?" thread */
/*    Only top-level comments that open with SEEKING FREELANCER count:  */
/*    those are the people with budget asking for work. Replies are     */
/*    freelancers pitching each other, which is noise.                   */
/* ------------------------------------------------------------------ */

export async function hnFreelanceThread({ days = 45, threads = 2 } = {}) {
  const r = await req(
    `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent("Freelancer? Seeking freelancer?")}&tags=story&hitsPerPage=10`
  );
  if (!r.ok) throw new Error(`HN Algolia ${r.status}`);
  const data = await r.json();
  const stories = (data.hits || [])
    .filter((h) => /freelancer\?\s*seeking freelancer/i.test(h.title || ""))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, threads);

  const cutoff = Date.now() - days * 864e5;
  const out = [];
  for (const st of stories) {
    try {
      const ir = await req(`https://hn.algolia.com/api/v1/items/${st.objectID}`);
      if (!ir.ok) continue;
      const item = await ir.json();
      for (const c of item.children || []) {
        const raw = c.text || "";
        if (!/^\s*SEEKING FREELANCER/i.test(raw)) continue;
        const created = c.created_at || st.created_at;
        if (Date.parse(created) < cutoff) continue;
        out.push({
          id: String(c.id),
          text: stripHtml(raw).slice(0, 1800),
          author: c.author || "",
          created,
          url: `https://news.ycombinator.com/item?id=${c.id}`,
          storyTitle: st.title || "",
        });
      }
    } catch {
      /* skip one thread, keep the other */
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. RemoteOK — public JSON feed (wired off; kept for future use)     */
/* ------------------------------------------------------------------ */

export async function remoteokJobs({ query }) {
  const r = await req("https://remoteok.com/api", { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`RemoteOK ${r.status}`);
  const data = await r.json();
  const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return (Array.isArray(data) ? data : [])
    .filter((j) => j && j.position && j.url)
    .filter((j) => {
      const hay = `${j.position} ${j.company} ${(j.tags || []).join(" ")} ${j.description || ""}`.toLowerCase();
      return q.some((w) => hay.includes(w));
    })
    .slice(0, 25)
    .map((j) => ({
      id: String(j.id || j.slug),
      title: j.position,
      company: j.company,
      url: j.url,
      created: j.date,
      location: j.location || "Remote",
      salary: j.salary_min || j.salary_max ? `$${j.salary_min || "?"}–$${j.salary_max || "?"}` : "",
      text: stripHtml(j.description || "").slice(0, 900),
      tags: j.tags || [],
    }));
}

/* ------------------------------------------------------------------ */
/* 4b. Freelancer.com public project search — real briefs with budgets */
/*     No key. Public marketplace API. Filtered to recent projects     */
/*     worth more than a token amount.                                 */
/* ------------------------------------------------------------------ */

export async function freelancerProjects({ query, limit = 20, days = 21, minUsd = 150 }) {
  const url =
    "https://www.freelancer.com/api/projects/0.1/projects/active/" +
    `?query=${encodeURIComponent(query)}&limit=${limit}&full_description=true&job_details=true` +
    "&sort=time_updated&reverse_sort=true";
  const r = await req(url, { headers: { Accept: "application/json" } }, 30000);
  if (!r.ok) throw new Error(`Freelancer ${r.status}`);
  const data = await r.json();
  const now = Date.now() / 1000;
  const BAD = /(ethical hacker|hacking|hack into|crack(ed)? (account|password)|keygen|bypass (verification|security)|mass dm|account creator|spam bot|carding|scrape instagram|onlyfans|app review|review expert|review removal|account recovery|play store review|testers wanted)/i;
  const out = [];
  for (const p of data?.result?.projects || []) {
    if (!p.title || !p.seo_url) continue;
    if (BAD.test(`${p.title} ${p.description || ""}`)) continue;
    if (now - (p.time_submitted || 0) > days * 86400) continue;

    // English-only gate: briefs in other languages match keywords but never close.
    const probe = `${p.title} ${(p.description || "").slice(0, 400)}`;
    const accented = (probe.match(/[À-ÿĀ-ž]/g) || []).length;
    const letters = (probe.match(/[A-Za-zÀ-ÿĀ-ž]/g) || []).length || 1;
    if (accented / letters > 0.012) continue;

    const rate = Number(p.currency?.exchange_rate) || 0;
    const lo = Math.round((p.budget?.minimum || 0) * rate);
    const hi = Math.round((p.budget?.maximum || 0) * rate);
    if (!rate || hi < minUsd) continue;
    out.push({
      id: String(p.id),
      title: p.title,
      description: stripHtml(p.description || p.preview_description || "").slice(0, 1200),
      url: `https://www.freelancer.com/projects/${p.seo_url}`,
      created: new Date((p.time_submitted || now) * 1000).toISOString(),
      budgetUsd: [lo, hi],
      currency: p.currency?.code || "USD",
      bids: p.bid_stats?.bid_count ?? 0,
      skills: (p.jobs || []).map((j) => j.name).slice(0, 6),
      country: p.currency?.country || "",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 5. We Work Remotely RSS (public)                                   */
/* ------------------------------------------------------------------ */

export async function wwrJobs() {
  const r = await req("https://weworkremotely.com/categories/remote-programming-jobs.rss");
  if (!r.ok) throw new Error(`WWR ${r.status}`);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.slice(0, 30).map((raw) => {
    const pick = (tag) => {
      const m = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? stripHtml(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : "";
    };
    const link = raw.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || "";
    const parts = pick("title").split(/\s+at\s+/);
    return {
      title: pick("title"),
      company: parts[1] || "WWR listing",
      url: link,
      created: new Date(pick("pubDate") || Date.now()).toISOString(),
      location: pick("region") || "Remote",
      text: pick("description").slice(0, 900),
    };
  });
}

/* ------------------------------------------------------------------ */
/* 6. Serper.dev — Google results incl. linkedin / instagram / x posts */
/* ------------------------------------------------------------------ */

export async function serperSearch({ apiKey, query, gl = "us", num = 10 }) {
  const r = await req(
    "https://google.serper.dev/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ q: query, gl, num }),
    },
    25000
  );
  if (!r.ok) throw new Error(`Serper ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return (data.organic || []).map((o) => ({
    title: o.title || "",
    url: o.link || "",
    snippet: o.snippet || "",
    date: o.date || "",
  }));
}

export function checkSerperKey(apiKey) {
  return serperSearch({ apiKey, query: "test", num: 1 });
}

/* ------------------------------------------------------------------ */
/* 7. Tavily — search API alternative to Serper                       */
/* ------------------------------------------------------------------ */

export async function tavilySearch({ apiKey, query, max = 8, domains = [] }) {
  const body = { query, max_results: max, search_depth: "basic", topic: "general" };
  if (domains.length) body.include_domains = domains;
  const r = await req(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
    30000
  );
  if (!r.ok) throw new Error(`Tavily ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return (data.results || []).map((o) => ({
    title: o.title || "",
    url: o.url || "",
    snippet: o.content || "",
    date: o.published_date || "",
  }));
}

export function checkTavilyKey(apiKey) {
  return tavilySearch({ apiKey, query: "test", max: 1 });
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

export function domainOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isWeakSite(url = "") {
  if (!url) return false;
  const d = domainOf(url).toLowerCase();
  return /(facebook\.com|instagram\.com|linktr\.ee|linktree\.|wixsite\.com|weebly\.com|godaddysites\.com|business\.site|square\.site|sites\.google\.com|wordpress\.com|blogspot\.|tumblr\.com|tiktok\.com)/.test(
    d
  );
}

export function daysAgo(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 864e5));
}
