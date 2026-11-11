#!/usr/bin/env node
/**
 * LeadScout 2.0 server — zero dependencies.
 *
 *   node server.mjs            → http://127.0.0.1:8787
 *   PORT=9000 node server.mjs
 *
 * Routes
 *   GET  /                     the app
 *   GET  /api/health           version + which keys the server sees
 *   GET  /api/catalog          services / verticals / cities for the UI
 *   GET  /api/seed             real public leads collected during research
 *   POST /api/test-keys        validate Google Places / Serper / Tavily / LLM
 *   POST /api/run              run the agent pipeline, NDJSON stream back
 *
 * Keys sent from the browser live in memory for one request only. Nothing is
 * written to disk by this server.
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPipeline, SERVICES, VERTICALS, MARKETS, scoreLead, fallbackPitch, fallbackCopy, alignProposalToBudget, inferService } from "./lib/agents.mjs";
import { checkPlacesKey, checkSerperKey, checkTavilyKey, moneyHints, firstEmail, domainOf, cacheStats } from "./lib/sources.mjs";
import { checkLLM } from "./lib/llm.mjs";
import { chat } from "./lib/llm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data");
const PORT = Number(process.env.PORT) || 8787;
const VERSION = "2.0.0";

/* ------------------------------------------------------------------ */
/* tiny .env loader — looks in the project and one level above it      */
/* ------------------------------------------------------------------ */

function loadEnvFile(file) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && !process.env[m[1]]) process.env[m[1]] = v;
  }
}

for (const dir of [__dirname, path.join(__dirname, "..")]) {
  loadEnvFile(path.join(dir, ".env.local"));
  loadEnvFile(path.join(dir, ".env"));
}

// People name these differently; accept the common spellings.
const pick = (...names) => names.map((n) => process.env[n]).find((v) => v && v.trim());
process.env.GOOGLE_PLACES_KEY = pick("GOOGLE_PLACES_KEY", "GOOGLE_PLACE_API_KEY", "GOOGLE_MAPS_API_KEY", "GOOGLE_API_KEY", "GOOGLE_PLACES_API_KEY") || "";
process.env.SERPER_KEY = pick("SERPER_KEY", "SERPER_API_KEY") || "";
process.env.TAVILY_KEY = pick("TAVILY_KEY", "TAVILY_API_KEY") || "";
process.env.LLM_API_KEY = pick("LLM_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY") || "";
process.env.LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
process.env.LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";

const CITIES = Object.fromEntries(Object.entries(MARKETS).map(([k, v]) => [k, v.cities]));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(s),
    "Cache-Control": "no-store",
  });
  res.end(s);
}

async function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, "index.html")) {
    return json(res, 403, { error: "forbidden" });
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Content-Length": buf.length,
      "Cache-Control": "no-cache",
    });
    res.end(buf);
  } catch {
    // SPA fallback
    try {
      const buf = await readFile(path.join(PUBLIC, "index.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"], "Content-Length": buf.length });
      res.end(buf);
    } catch {
      json(res, 404, { error: "not found" });
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const route = url.pathname;

  // Same-origin app; no CORS headers needed. Explicitly refuse cross-origin POSTs.
  if (req.method === "POST" && req.headers.origin) {
    const okOrigin = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin);
    if (!okOrigin) return json(res, 403, { error: "cross-origin requests are not allowed" });
  }

  try {
    if (route === "/api/health") {
      return json(res, 200, {
        version: VERSION,
        ok: true,
        serverKeys: {
          googlePlaces: Boolean(process.env.GOOGLE_PLACES_KEY),
          googlePlacesKeyHint: process.env.GOOGLE_PLACES_KEY ? `…${process.env.GOOGLE_PLACES_KEY.slice(-4)}` : "",
          serper: Boolean(process.env.SERPER_KEY),
          tavily: Boolean(process.env.TAVILY_KEY),
          llm: Boolean(process.env.LLM_API_KEY),
        },
        node: process.version,
        cache: cacheStats(),
      });
    }

    if (route === "/api/catalog") {
      return json(res, 200, {
        services: Object.entries(SERVICES).map(([id, s]) => ({ id, label: s.label, blurb: s.blurb })),
        verticals: Object.entries(VERTICALS).map(([id, v]) => ({ id, label: v.label, hook: v.hook, pain: v.pain, term: v.term })),
        markets: Object.entries(MARKETS).map(([id, m]) => ({ id, label: m.label, flag: m.flag, factor: m.factor, cities: m.cities })),
        cities: CITIES,
      });
    }

    if (route === "/api/seed") {
      try {
        const raw = await readFile(path.join(DATA, "seed-leads.json"), "utf8");
        return json(res, 200, { leads: JSON.parse(raw) });
      } catch {
        return json(res, 200, { leads: [] });
      }
    }

    if (route === "/api/import" && req.method === "POST") {
      const b = await readBody(req);
      const text = String(b.text || "").trim();
      if (text.length < 30) return json(res, 400, { error: "Paste at least a couple of sentences from the post." });

      const url = /^https?:\/\//i.test(String(b.url || "")) ? String(b.url).trim() : "";
      const country = MARKETS[b.country] ? b.country : "US";
      const detected = inferService(text);
      const service = SERVICES[detected] ? detected : SERVICES[b.service] ? b.service : "website";
      const firstLine = text.split(/\n/).map((s) => s.trim()).filter(Boolean)[0] || text;
      const vertical = VERTICALS[b.vertical] ? VERTICALS[b.vertical] : null;

      const lead = {
        id: "imp_" + Math.random().toString(36).slice(2, 9),
        name: String(b.name || "").trim() || (url ? domainOf(url) : firstLine.slice(0, 60)),
        kind: "post",
        country,
        city: String(b.city || "").trim(),
        verticalLabel: vertical?.label || "",
        verticalHook: vertical?.hook || "",
        source: String(b.platform || "manual").toLowerCase().replace(/[^a-z0-9_]/g, "") || "manual",
        sourceUrl: url,
        postedAt: new Date().toISOString(),
        fetchedAt: new Date().toISOString(),
        budgetHints: moneyHints(text),
        serviceMatch: "explicit",
        need: {
          summary: firstLine.slice(0, 160),
          evidence: text.slice(0, 900),
          signals: ["You pasted this", url ? domainOf(url) : "no link"],
        },
        contact: {
          email: firstEmail(text),
          url,
          route: firstEmail(text) ? `Email ${firstEmail(text)} (from the post)` : "Reply where you found it",
        },
      };
      lead.score = scoreLead(lead);
      lead.service = service;
      lead.proposal = fallbackPitch(lead, service);
      alignProposalToBudget(lead);
      lead.outreach = fallbackCopy(lead, service, lead.proposal);
      lead.verification = {
        ok: true,
        score: url ? 90 : 70,
        checks: [
          { label: "Source link", pass: Boolean(url), note: url ? domainOf(url) : "you pasted the text, not a link" },
          { label: "Text captured", pass: true, note: `${text.length} characters` },
          { label: "Contact route", pass: Boolean(lead.contact.email || url), note: lead.contact.route },
        ],
        disclaimer:
          "You pasted this yourself. Re-read the original before sending — budget and scope are only what the poster wrote.",
      };
      return json(res, 200, { lead });
    }

    if (route === "/api/test-model" && req.method === "POST") {
      const body = await readBody(req);
      const { baseUrl, apiKey, model, maxOutput } = body || {};
      if (!baseUrl || !model) return json(res, 400, { ok: false, error: "baseUrl and model are required" });
      const started = Date.now();
      try {
        const reply = await chat(
          { baseUrl, apiKey, model },
          [{ role: "user", content: "Reply with the single word: ok" }],
          { maxTokens: Math.min(Number(maxOutput) || 16, 64), timeout: 30000 }
        );
        return json(res, 200, {
          ok: true,
          ms: Date.now() - started,
          model,
          reply: String(reply).slice(0, 80),
        });
      } catch (e) {
        const msg = String(e.message || e).slice(0, 300);
        let hint = "";
        if (/401|authentication|invalid.*(api )?key/i.test(msg)) {
          hint =
            "This key is not valid for this endpoint. Keys are per-provider: a DeepSeek platform key only works on api.deepseek.com, an OpenRouter key only on openrouter.ai/api/v1, an NVIDIA key only on integrate.api.nvidia.com. Match Base URL to wherever the key was created.";
        } else if (/404|model.*(not.*(exist|found)|does not exist)|invalid model/i.test(msg)) {
          hint =
            "The endpoint answered, but this Model ID does not exist there. DeepSeek official: deepseek-flash or deepseek-v4-pro. OpenRouter: deepseek/deepseek-v4.1-flash. NVIDIA NIM: deepseek-ai/deepseek-v4.1-flash.";
        } else if (/enotfound|getaddrinfo|fetch failed/i.test(msg)) {
          hint = "Base URL host could not be reached. Check the spelling and that it ends with /v1.";
        }
        return json(res, 200, { ok: false, ms: Date.now() - started, error: msg, hint });
      }
    }

    if (route === "/api/test-keys" && req.method === "POST") {
      const body = await readBody(req);
      const k = body.keys || {};
      // Browser keys win; otherwise use whatever the server loaded from .env.local
      const g = k.google || process.env.GOOGLE_PLACES_KEY;
      const s = k.serper || process.env.SERPER_KEY;
      const t = k.tavily || process.env.TAVILY_KEY;
      const l = k.llm?.apiKey
        ? k.llm
        : process.env.LLM_API_KEY
          ? { apiKey: process.env.LLM_API_KEY, baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL }
          : null;
      const tests = [];
      const run = async (name, fn) => {
        if (!fn) {
          tests.push({ name, status: "missing", detail: "no key" });
          return;
        }
        try {
          const out = await fn();
          tests.push({ name, status: "ok", detail: typeof out === "string" ? out : `${(out || []).length} results` });
        } catch (e) {
          let detail = String(e.message || e).slice(0, 220);
          if (name === "Google Places") {
            if (/API_KEY_HTTP_REFERRER_BLOCKED|Requests from referer/i.test(detail)) {
              detail =
                "Key is restricted to websites (HTTP referrers) and server requests send no referer. Google Cloud → Credentials → this key → Application restrictions → None (or IP addresses). Then wait ~2 min and retry.";
            } else if (/API_KEY_SERVICE_BLOCKED|SERVICE_DISABLED/.test(detail)) {
              detail =
                "Places API (New) is not enabled for this key's project, or billing is off. Enable it: Google Cloud → APIs & Services → Enable APIs → \"Places API (New)\".";
            } else if (/API_KEY_INVALID|API key not valid/.test(detail)) {
              detail = "Key is not valid — check for a missing character or stray quotes/spaces in .env.local.";
            }
          }
          tests.push({ name, status: "error", detail });
        }
      };
      await Promise.all([
        run("Google Places", g ? () => checkPlacesKey(g) : null),
        run("Serper", s ? () => checkSerperKey(s) : null),
        run("Tavily", t ? () => checkTavilyKey(t) : null),
        run("LLM", l?.apiKey ? () => checkLLM(l) : null),
      ]);
      return json(res, 200, { tests });
    }

    if (route === "/api/run" && req.method === "POST") {
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        return json(res, 400, { error: String(e.message) });
      }
      if (!body || typeof body !== "object") return json(res, 400, { error: "bad request" });

      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      });
      res.flushHeaders?.();

      const emitter = (obj) => {
        if (res.writableEnded) return;
        try {
          res.write(JSON.stringify(obj) + "\n");
        } catch {
          /* client disconnected */
        }
      };

      let closed = false;
      const onClose = () => {
        closed = true;
      };
      req.on("close", onClose);

      try {
        await runPipeline(
          {
            service: body.service,
            vertical: body.vertical,
            country: body.country,
            city: body.city,
            depth: body.depth,
            minReviews: body.minReviews,
            requirePhone: body.requirePhone,
            keys: {
              google: body.keys?.google || process.env.GOOGLE_PLACES_KEY || "",
              serper: body.keys?.serper || process.env.SERPER_KEY || "",
              tavily: body.keys?.tavily || process.env.TAVILY_KEY || "",
              llm: body.keys?.llm?.apiKey
                ? body.keys.llm
                : process.env.LLM_API_KEY
                  ? {
                      apiKey: process.env.LLM_API_KEY,
                      baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
                      model: process.env.LLM_MODEL || "gpt-4o-mini",
                    }
                  : null,
            },
          },
          emitter,
          { isClosed: () => closed }
        );
      } catch (e) {
        emitter({ t: "fatal", msg: String(e.message || e) });
      } finally {
        res.end();
      }
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      if (route.startsWith("/api/")) return json(res, 404, { error: "unknown endpoint" });
      return serveStatic(req, res, route);
    }
    return json(res, 405, { error: "method not allowed" });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: String(e.message || e) });
    else res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  LeadScout ${VERSION}\n  → http://127.0.0.1:${PORT}\n`);
  console.log(`  Sources: Google Places (key), Reddit, Hacker News, RemoteOK, WWR, Serper/Tavily (key)`);
  console.log(`  Keys: add in Settings (browser only) or export GOOGLE_PLACES_KEY / SERPER_KEY / LLM_API_KEY\n`);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is busy. Try: PORT=${PORT + 1} node server.mjs\n`);
    process.exit(1);
  }
  throw e;
});
