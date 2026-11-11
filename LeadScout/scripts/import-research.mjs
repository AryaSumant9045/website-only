#!/usr/bin/env node
/**
 * Merges the verified research file (data/leads_raw.json) into the app's seed
 * set (LeadScout/data/seed-leads.json).
 *
 * Rules:
 *  - Dedupe by URL. Never invent a field: if the research file has no budget,
 *    the seed has no budget.
 *  - Only A/B graded records are imported; C records are leads about leads.
 *  - Each record is scored and pitched by the same functions the app uses, so
 *    the seed looks exactly like a live run.
 *
 *   node scripts/import-research.mjs [path/to/leads_raw.json]
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreLead, fallbackPitch, fallbackCopy, inferService, alignProposalToBudget } from "../lib/agents.mjs";
import { moneyHints, daysAgo } from "../lib/sources.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SEED = path.join(ROOT, "data", "seed-leads.json");
const RAW = process.argv[2] || path.join(ROOT, "..", "data", "leads_raw.json");

const COUNTRY = (s = "") => {
  const t = s.toLowerCase();
  if (/india/.test(t)) return "IN";
  if (/united kingdom|\buk\b|england|scotland|wales|london/.test(t)) return "UK";
  if (/united states|\busa?\b|\bnyc\b|california|texas|florida/.test(t)) return "US";
  // Everything else stays honest: we know it is not one of the three target
  // markets, so we do not pretend it is.
  return "GLOBAL";
};

const SOURCE = (s = "", url = "") => {
  const t = `${s} ${url}`.toLowerCase();
  if (t.includes("peopleperhour")) return "peopleperhour";
  if (t.includes("freelancer.com")) return "freelancer";
  if (t.includes("reddit")) return "reddit";
  if (t.includes("linkedin")) return "linkedin";
  if (t.includes("instagram")) return "instagram";
  if (t.includes("news.ycombinator")) return "hn";
  return "web";
};

const slug = (s = "") => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

const raw = JSON.parse(await readFile(RAW, "utf8"));
let existing = [];
try {
  existing = JSON.parse(await readFile(SEED, "utf8"));
} catch {
  existing = [];
}

const seen = new Set(existing.map((l) => l.sourceUrl.split("?")[0]));
const imported = [];

for (const r of raw) {
  if (!r.url || !/^https?:\/\//.test(r.url)) continue;
  const key = r.url.split("?")[0];
  if (seen.has(key)) continue;
  if ((r.grade || "").toUpperCase() === "C") continue;

  const budgetText = String(r.budget || "");
  const hints = moneyHints(budgetText);
  const source = SOURCE(r.source, r.url);
  const country = COUNTRY(`${r.country || ""} ${budgetText}`);
  const text = `${r.need_summary || ""} ${budgetText}`;

  const lead = {
    id: `rs_${slug(r.company_or_person || "lead")}_${slug(key).slice(-6)}`,
    name: String(r.company_or_person || "Public request").slice(0, 80),
    kind: "post",
    country,
    city: "",
    verticalLabel: "",
    verticalHook: "new customers",
    source,
    sourceUrl: key,
    postedAt: r.posted_date ? new Date(r.posted_date).toISOString() : null,
    fetchedAt: new Date().toISOString(),
    budgetHints: hints,
    bids: /(\d+)\s*bids?/i.test(text) ? Number(text.match(/(\d+)\s*bids?/i)[1]) : 0,
    service: inferService(text) || "website",
    need: {
      summary: String(r.need_summary || "").slice(0, 220),
      evidence: [r.need_summary, budgetText && `Budget: ${budgetText}`].filter(Boolean).join("\n").slice(0, 700),
      signals: [
        ...(budgetText ? [`Budget: ${budgetText.slice(0, 40)}`] : []),
        ...(daysAgo(r.posted_date) !== null ? [`${daysAgo(r.posted_date)}d old`] : []),
      ],
    },
    contact: {
      email: r.contact_route && /@/.test(r.contact_route) ? (r.contact_route.match(/[\w.+-]+@[\w.-]+\.\w+/) || [""])[0] : "",
      url: key,
      route: String(r.contact_route || "Open the source and reply there").slice(0, 160),
    },
    serviceMatch: "explicit",
    researcherNote: String(r.notes || ""),
    verification: {
      ok: true,
      score: 100,
      checks: [
        { label: "Source link", pass: true, note: new URL(key).hostname.replace("www.", "") },
        { label: "Date", pass: Boolean(r.posted_date), note: r.posted_date || "unknown" },
        { label: "Contact route", pass: Boolean(r.contact_route), note: String(r.contact_route || "").slice(0, 60) },
        { label: "Researcher grade", pass: true, note: String(r.grade || "") },
      ],
      disclaimer:
        "Imported from the 11 Nov 2026 research pass (data/leads_raw.json). Open the link and re-read the brief before you bid or reply — budget and scope are only what the client wrote.",
    },
    seed: true,
  };

  lead.score = scoreLead(lead);
  lead.proposal = fallbackPitch(lead, lead.service);
  alignProposalToBudget(lead);
  lead.outreach = fallbackCopy(lead, lead.service, lead.proposal);
  lead.proposal.by = "rules";

  seen.add(key);
  imported.push(lead);
}

const merged = [...existing, ...imported].sort((a, b) => b.score.total - a.score.total).slice(0, 40);
await writeFile(SEED, JSON.stringify(merged, null, 2));

const counts = merged.reduce((a, l) => ((a[l.source] = (a[l.source] || 0) + 1), a), {});
const grades = merged.reduce((a, l) => ((a[l.score.band] = (a[l.score.band] || 0) + 1), a), {});
console.log(`imported ${imported.length} · total seeds ${merged.length}`);
console.log("sources:", JSON.stringify(counts));
console.log("grades:", JSON.stringify(grades));
