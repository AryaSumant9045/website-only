#!/usr/bin/env node
/**
 * Refreshes data/seed-leads.json with real leads pulled live from the public
 * sources. Run it whenever you want a fresh "Load research seeds" set:
 *
 *     node scripts/refresh-seeds.mjs
 *
 * It runs the same pipeline as the app, keeps the strongest leads, dedupes by
 * URL, and writes them in the app's lead shape. Nothing is invented: every
 * record keeps its source URL and timestamp.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "../lib/agents.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "seed-leads.json");

const RUNS = [
  { service: "website", vertical: "dental", country: "US", depth: "deep" },
  { service: "ai_chatbot", vertical: "realestate", country: "US", depth: "fast" },
  { service: "website", vertical: "restaurant", country: "UK", depth: "fast" },
];

console.log("Refreshing seeds from live sources…\n");

const all = [];
for (const cfg of RUNS) {
  process.stdout.write(`  ${cfg.service} / ${cfg.vertical} / ${cfg.country} … `);
  try {
    const res = await runPipeline(
      { ...cfg, keys: {} },
      () => {} // ignore the stream, we only need the result
    );
    console.log(`${res.leads.length} leads`);
    all.push(...res.leads);
  } catch (e) {
    console.log(`failed: ${e.message}`);
  }
}

const seen = new Set();
const picked = [];
for (const l of all.sort((a, b) => b.score.total - a.score.total)) {
  const key = l.sourceUrl.split("?")[0] || l.id;
  if (seen.has(key)) continue;
  seen.add(key);
  picked.push(l);
}

// Keep the mix honest: at most 6 marketplace briefs, at most 10 map leads.
const bySource = {};
const kept = picked.filter((l) => {
  bySource[l.source] = (bySource[l.source] || 0) + 1;
  if (l.source === "freelancer") return bySource[l.source] <= 6;
  if (l.source === "google_maps" || l.source === "osm") return bySource[l.source] <= 10;
  return bySource[l.source] <= 4;
});

const cleaned = kept.map((l) => ({
  id: l.id,
  name: l.name,
  kind: l.kind,
  country: l.country,
  city: l.city,
  verticalLabel: l.verticalLabel,
  verticalHook: l.verticalHook,
  source: l.source,
  sourceUrl: l.sourceUrl,
  postedAt: l.postedAt,
  fetchedAt: l.fetchedAt,
  rating: l.rating,
  reviews: l.reviews,
  gap: l.gap,
  budgetHints: l.budgetHints || [],
  need: l.need,
  contact: l.contact,
  score: l.score,
  service: l.service,
  proposal: l.proposal,
  outreach: l.outreach,
  verification: l.verification,
  seed: true,
}));

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(cleaned, null, 2));

const counts = cleaned.reduce((a, l) => ({ ...a, [l.source]: (a[l.source] || 0) + 1 }), {});
console.log(`\nWrote ${cleaned.length} seeds → ${path.relative(process.cwd(), OUT)}`);
console.log("Sources:", JSON.stringify(counts));
console.log("Grades:", JSON.stringify(cleaned.reduce((a, l) => ({ ...a, [l.score.band]: (a[l.score.band] || 0) + 1 }), {})));
