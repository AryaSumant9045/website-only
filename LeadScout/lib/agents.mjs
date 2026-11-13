/**
 * LeadScout 2.0 — multi-agent pipeline.
 *
 * Planner → Maps Scout → Demand Scout → Signal Analyst → Strategist →
 * Outreach Writer → Verifier
 *
 * Design rules:
 *  - Every lead is traceable to a URL we fetched. No invented businesses.
 *  - Scoring is deterministic and shown to the user (no black-box "AI score").
 *  - The LLM only writes language (pitch, outreach). It never invents leads.
 */

import {
  searchPlaces,
  lookupPlace,
  geocodeCity,
  osmPlaces,
  redditSearch,
  redditRSS,
  isBuyerPost,
  freelancerProjects,
  serperSearch,
  tavilySearch,
  stripHtml,
  firstEmail,
  moneyHints,
  isWeakSite,
  daysAgo,
  domainOf,
} from "./sources.mjs";
import { promises as dns } from "node:dns";
import { chatJSON } from "./llm.mjs";
import { auditWebsite, auditSummary } from "./audit.mjs";

/* ------------------------------------------------------------------ */
/* catalogs                                                           */
/* ------------------------------------------------------------------ */

export const SERVICES = {
  website: {
    label: "Website",
    deliverable: "a 5–7 page site with a booking button, click-to-call and the local SEO basics wired to Google Business",
    plural: "websites",
    line: "Fast, mobile-first sites that turn searches into phone calls.",
    blurb: "fast, mobile-first site that turns searches into calls",
    demandKw: ["website", "web design", "landing page"],
    siteQuery: ["looking for a web designer", "need a website built"],
    build: "Conversion-focused 5–7 page website with booking/call CTA, Google Business profile cleanup and local SEO basics",
    stack: ["Next.js or Astro", "Tailwind", "Formspree/Cal.com", "Vercel"],
    weeks: [1, 2],
    base: [800, 3000],
  },
  ai_chatbot: {
    label: "AI chatbot",
    deliverable: "a chatbot trained on your services and FAQs, on your site and WhatsApp, that hands leads to your inbox",
    plural: "AI chatbots",
    line: "Chatbots that answer enquiries 24/7 and book appointments.",
    blurb: "answers enquiries 24/7 and books appointments",
    demandKw: ["chatbot", "ai chatbot", "ai assistant"],
    siteQuery: ["looking for chatbot developer", "need ai chatbot for business"],
    build: "RAG chatbot trained on their services/FAQs, WhatsApp + website widget, lead capture into Google Sheets/CRM",
    stack: ["OpenAI/Claude API", "pgvector or Pinecone", "Next.js widget", "WhatsApp Cloud API"],
    weeks: [1, 3],
    base: [1200, 4500],
  },
  ai_agent: {
    label: "AI automation",
    deliverable: "one automated workflow from enquiry to CRM, with a human approval step and a dashboard of what it saved",
    plural: "AI automations",
    line: "Automations that remove the repetitive work you pay staff for.",
    blurb: "automates the repetitive work they pay staff for",
    demandKw: ["automation", "ai agent", "make.com", "zapier", "workflow"],
    siteQuery: ["looking for automation expert", "need ai agent built"],
    build: "One automated workflow (intake → qualify → reply → CRM) with an AI agent + human approval step and a dashboard of what it saved",
    stack: ["n8n/Make", "OpenAI API", "Airtable/Supabase", "Slack alerts"],
    weeks: [1, 3],
    base: [1500, 6000],
  },
  webapp: {
    label: "Web app",
    deliverable: "an MVP app with login, your one core workflow and an admin view",
    plural: "web apps",
    line: "Custom portals and internal tools, scoped to a shippable MVP.",
    blurb: "custom portal or internal tool",
    demandKw: ["web app", "web application", "portal", "saas", "dashboard"],
    siteQuery: ["looking for full stack developer", "need a web app built"],
    build: "MVP web app with auth, one core workflow, admin view and deploy — shipped in 2–3 weeks",
    stack: ["Next.js + TypeScript", "Postgres/Supabase", "Stripe", "Vercel"],
    weeks: [2, 4],
    base: [2500, 9000],
  },
  dashboard: {
    label: "Dashboard / data",
    deliverable: "a live dashboard over your existing data with the five numbers that decide your week",
    plural: "dashboards",
    line: "Live dashboards that turn messy spreadsheets into decisions.",
    blurb: "turns messy spreadsheets into decisions",
    demandKw: ["dashboard", "reporting", "data analysis", "power bi", "looker"],
    siteQuery: ["need a dashboard built", "looking for data analyst freelancer"],
    build: "Live dashboard over their existing sheets/DB with 5 decision metrics, automated refresh and a weekly email digest",
    stack: ["Python/pandas", "Metabase or Next.js charts", "Supabase", "Cron"],
    weeks: [1, 2],
    base: [1200, 4500],
  },
  mobile: {
    label: "Mobile app",
    deliverable: "a cross-platform app with login, three core screens and push notifications",
    plural: "mobile apps",
    line: "iOS and Android apps from one codebase, store-ready.",
    blurb: "iOS/Android app for their customers",
    demandKw: ["mobile app", "ios app", "android app", "react native", "flutter"],
    siteQuery: ["looking for mobile app developer", "need an app built"],
    build: "Cross-platform MVP (React Native/Expo): auth, 3 core screens, push notifications, store submission",
    stack: ["React Native + Expo", "Supabase", "Expo Notifications", "App Store/Play Console"],
    weeks: [3, 6],
    base: [3500, 12000],
  },
  ecommerce: {
    label: "E-commerce store",
    deliverable: "a store with clean product pages, a working checkout and an abandoned-cart email",
    plural: "e-commerce stores",
    line: "Stores that convert and stop leaking sales.",
    blurb: "store that converts and stops leaking sales",
    demandKw: ["shopify", "ecommerce", "woocommerce", "online store"],
    siteQuery: ["need shopify developer", "help with online store"],
    build: "Shopify/headless store build or rebuild: product pages, checkout fixes, speed, abandoned-cart email flow",
    stack: ["Shopify Liquid / Hydrogen", "Klaviyo", "Next.js", "Stripe"],
    weeks: [1, 3],
    base: [1200, 5000],
  },
};

export const VERTICALS = {
  dental: { label: "Dental clinics", term: "dental clinic", hook: "new-patient bookings", osmTags: [["amenity", "dentist"]], pain: "a listing with no site loses patients to the practice next door" },
  medspa: { label: "Med spas", term: "medical spa", hook: "consultation bookings", osmTags: [["amenity", "spa"], ["shop", "beauty"]], pain: "high-ticket treatments need a booking funnel, not a phone number" },
  realestate: { label: "Real estate agencies", term: "real estate agency", hook: "listing enquiries", osmTags: [["office", "estate_agent"]], pain: "buyers filter agents by site quality before the first call" },
  law: { label: "Law firms", term: "law firm", hook: "intake calls", osmTags: [["office", "lawyer"]], pain: "intake is revenue; a slow site leaks signed cases" },
  restaurant: { label: "Restaurants", term: "restaurant", hook: "reservations and online orders", osmTags: [["amenity", "restaurant"]], pain: "maps traffic is captured by aggregators unless they own the booking" },
  gym: { label: "Gyms & studios", term: "gym", hook: "trial signups", osmTags: [["leisure", "fitness_centre"]], pain: "membership growth depends on a one-click trial page" },
  construction: { label: "Contractors", term: "construction company", hook: "quote requests", osmTags: [["office", "construction_company"], ["craft", "builder"]], pain: "quote forms turn 10x more visitors into site visits than phone tags" },
  plumber: { label: "Plumbers & trades", term: "plumber", hook: "emergency call-outs", osmTags: [["craft", "plumber"], ["craft", "electrician"]], pain: "emergency jobs go to whoever answers first online" },
  salon: { label: "Salons & barbers", term: "hair salon", hook: "online bookings", osmTags: [["shop", "hairdresser"], ["shop", "beauty"]], pain: "no-show bookings eat a third of the chair time" },
  vet: { label: "Vets & pet care", term: "veterinary clinic", hook: "appointment bookings", osmTags: [["amenity", "veterinary"]], pain: "pet owners book whoever has an online calendar" },
  photographer: { label: "Photographers", term: "photographer", hook: "booking enquiries", osmTags: [["craft", "photographer"]], pain: "a portfolio that loads in 8s loses the wedding booking" },
  tattoo: { label: "Tattoo & studios", term: "tattoo studio", hook: "deposit bookings", osmTags: [["shop", "tattoo"]], pain: "DMs replace a booking system until they get 200 a week" },
  landscaping: { label: "Landscaping", term: "landscaping company", hook: "seasonal quotes", osmTags: [["craft", "gardener"]], pain: "seasonal demand needs a quote form, not a phone tag" },
  accounting: { label: "Accounting firms", term: "accounting firm", hook: "client onboarding", osmTags: [["office", "accountant"]], pain: "tax-season intake is manual and eats billable hours" },
  auto: { label: "Auto dealers", term: "car dealer", hook: "inventory leads", osmTags: [["shop", "car"]], pain: "inventory that is not indexable is invisible outside the lot" },
  hospitality: { label: "Hotels & stays", term: "hotel", hook: "direct bookings", osmTags: [["tourism", "hotel"]], pain: "OTA commissions are 15–25% of every booking they keep" },
  boutique: { label: "E-commerce brands", term: "boutique store", hook: "repeat purchases", osmTags: [["shop", "clothes"]], pain: "traffic is fine; product pages and support are the leak" },
};

const CITIES = {
  US: ["Austin, TX", "Miami, FL", "Dallas, TX", "Houston, TX", "Los Angeles, CA", "San Diego, CA", "San Francisco, CA", "San Jose, CA", "New York, NY", "Chicago, IL", "Seattle, WA", "Denver, CO", "Atlanta, GA", "Phoenix, AZ", "Boston, MA", "Washington, DC", "Philadelphia, PA", "Nashville, TN", "Charlotte, NC", "Tampa, FL", "Orlando, FL", "Las Vegas, NV", "Minneapolis, MN", "Detroit, MI", "Columbus, OH", "Indianapolis, IN", "Portland, OR", "Sacramento, CA", "Raleigh, NC", "Salt Lake City, UT"],
  UK: ["London", "Manchester", "Birmingham", "Leeds", "Bristol", "Glasgow", "Liverpool", "Sheffield", "Nottingham", "Newcastle", "Edinburgh", "Cardiff", "Belfast", "Coventry", "Leicester", "Brighton", "Southampton", "Reading", "Oxford", "Cambridge"],
  IN: ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Surat", "Jaipur", "Lucknow", "Indore", "Bhopal", "Nagpur", "Nashik", "Vadodara", "Coimbatore", "Kochi", "Thiruvananthapuram", "Chandigarh", "Gurugram", "Noida", "Dehradun", "Ludhiana", "Visakhapatnam", "Mysuru", "Guwahati", "Patna"],
  CA: ["Toronto, ON", "Vancouver, BC", "Calgary, AB", "Ottawa, ON", "Edmonton, AB", "Montreal, QC", "Winnipeg, MB", "Halifax, NS", "Quebec City, QC", "Victoria, BC", "Saskatoon, SK", "Regina, SK"],
  AU: ["Sydney, NSW", "Melbourne, VIC", "Brisbane, QLD", "Perth, WA", "Adelaide, SA", "Gold Coast, QLD", "Canberra, ACT", "Hobart, TAS", "Newcastle, NSW", "Wollongong, NSW", "Sunshine Coast, QLD", "Darwin, NT"],
  NZ: ["Auckland", "Wellington", "Christchurch", "Hamilton", "Tauranga", "Dunedin"],
  IE: ["Dublin", "Cork", "Galway", "Limerick", "Waterford", "Kilkenny"],
  AE: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Al Ain", "Ras Al Khaimah"],
  SG: ["Singapore"],
  SA: ["Riyadh", "Jeddah", "Dammam", "Al Khobar", "Medina"],
  QA: ["Doha", "Al Rayyan", "Lusail", "Al Wakrah"],
  CH: ["Zurich", "Geneva", "Basel", "Bern", "Lausanne", "Lucerne"],
};

/**
 * Markets. `factor` scales the USD base price: a website in Toronto is worth
 * about 0.85x the same site in Austin, a website in Delhi about 0.3x — that is
 * what buyers there actually pay a solo developer, not a currency conversion.
 */
export const MARKETS = {
  US: { label: "United States", flag: "🇺🇸", gl: "us", regionCode: "US", term: "usa", factor: 1, cities: CITIES.US },
  UK: { label: "United Kingdom", flag: "🇬🇧", gl: "uk", regionCode: "GB", term: "uk", factor: 0.9, cities: CITIES.UK },
  CA: { label: "Canada", flag: "🇨🇦", gl: "ca", regionCode: "CA", term: "canada", factor: 0.85, cities: CITIES.CA },
  AU: { label: "Australia", flag: "🇦🇺", gl: "au", regionCode: "AU", term: "australia", factor: 0.85, cities: CITIES.AU },
  NZ: { label: "New Zealand", flag: "🇳🇿", gl: "nz", regionCode: "NZ", term: "new zealand", factor: 0.75, cities: CITIES.NZ },
  IE: { label: "Ireland", flag: "🇮🇪", gl: "ie", regionCode: "IE", term: "ireland", factor: 0.85, cities: CITIES.IE },
  AE: { label: "UAE", flag: "🇦🇪", gl: "ae", regionCode: "AE", term: "dubai", factor: 0.8, cities: CITIES.AE },
  SA: { label: "Saudi Arabia", flag: "🇸🇦", gl: "sa", regionCode: "SA", term: "saudi arabia", factor: 0.9, cities: CITIES.SA },
  QA: { label: "Qatar", flag: "🇶🇦", gl: "qa", regionCode: "QA", term: "qatar", factor: 0.95, cities: CITIES.QA },
  SG: { label: "Singapore", flag: "🇸🇬", gl: "sg", regionCode: "SG", term: "singapore", factor: 0.9, cities: CITIES.SG },
  CH: { label: "Switzerland", flag: "🇨🇭", gl: "ch", regionCode: "CH", term: "switzerland", factor: 1.15, cities: CITIES.CH },
  IN: { label: "India", flag: "🇮🇳", gl: "in", regionCode: "IN", term: "india", factor: 0.3, cities: CITIES.IN },
};


const SCAM = /(unpaid|no pay|free work|work for free|equity only|commission only|revenue share only|telegram only|pay a fee|registration fee|upfront payment)/i;

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

const nowIso = () => new Date().toISOString();
const rid = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

function slug(s = "") {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function inferCountry(text = "", fallback = "US") {
  const t = ` ${text.toLowerCase()} `;
  if (/[₹]|\binr\b|\bindia\b|\bbengaluru\b|\bmumbai\b|\bdelhi\b|\bpune\b|\bhyderabad\b|\bchennai\b/.test(t)) return "IN";
  if (/\buk\b|\blondon\b|\bmanchester\b|\bbirmingham\b|\bleeds\b|\bbristol\b|\bglasgow\b|\b£|\bgbp\b/.test(t)) return "UK";
  if (/\busa\b|\bu\.s\.a?\.?|\bunited states\b|\bnyc\b|\baustin\b|\bmiami\b|\bdallas\b|\bchicago\b|\bseattle\b|\bdenver\b|\batlanta\b|\bcalifornia\b|\btexas\b|\bflorida\b/.test(t)) return "US";
  if (/\bcanada\b|\btoronto\b|\bvancouver\b|\bcalgary\b|\bmontreal\b|\bcad\b/.test(t)) return "CA";
  if (/\baustralia\b|\bsydney\b|\bmelbourne\b|\bbrisbane\b|\bperth\b|\baud\b/.test(t)) return "AU";
  if (/\bnew zealand\b|\bauckland\b|\bwellington\b|\bnzd\b/.test(t)) return "NZ";
  if (/\bireland\b|\bdublin\b|\bcork\b|\bgalway\b/.test(t)) return "IE";
  if (/\buae\b|\bdubai\b|\babu dhabi\b|\bsharjah\b|\baed\b/.test(t)) return "AE";
  if (/\bsingapore\b|\bsgd\b/.test(t)) return "SG";
  return fallback;
}

export function inferService(text = "") {
  const t = String(text).toLowerCase();
  const table = [
    ["mobile", /(mobile app|android|\bios\b|iphone|react native|flutter|app store|play store)/],
    ["ecommerce", /(shopify|woocommerce|ecommerce|e-commerce|online store|product page|checkout)/],
    ["ai_chatbot", /(chatbot|chat bot|\brag\b|knowledge base bot|customer support ai|\bllm\b)/],
    ["ai_agent", /(automation|automate|workflow|ai agent|agentic|make\.com|zapier|n8n|integration)/],
    ["dashboard", /(dashboard|reporting|power bi|looker|analytics|data analysis|scrape|scraping)/],
    ["webapp", /(web app|web application|\bsaas\b|portal|\bcrm\b|internal tool|full stack|full-stack|backend|frontend|\bapi\b|software|platform|management system|application)/],
    ["website", /(website|web site|landing page|web design|redesign|homepage)/],
  ];
  for (const [k, re] of table) if (re.test(t)) return k;
  return null;
}

function priceFor(service, country) {
  const base = SERVICES[service]?.base || SERVICES.website.base;
  const factor = MARKETS[country]?.factor ?? 0.85;
  const round = (n) => (n < 1000 ? Math.round(n / 50) * 50 : Math.round(n / 100) * 100);
  return [round(base[0] * factor), round(base[1] * factor)];
}

/* ------------------------------------------------------------------ */
/* scoring — deterministic, explainable                               */
/* ------------------------------------------------------------------ */

export function scoreLead(lead) {
  const b = { intent: 0, budget: 0, recency: 0, geo: 0, fit: 0, contact: 0 };
  const notes = [];
  const text = `${lead.need?.summary || ""} ${lead.need?.evidence || ""}`.toLowerCase();

  if (lead.source === "google_maps" || lead.source === "osm") {
    const gap = lead.gap?.score ?? 3;
    b.intent = gap >= 14 ? 26 : gap >= 10 ? 20 : 10;
    b.fit = gap >= 14 ? 15 : gap >= 10 ? 11 : 3;
    b.recency = 12;
    const r = lead.reviews || 0;
    b.budget = r >= 200 ? 16 : r >= 50 ? 12 : 8;
    notes.push(gap >= 14 ? "No site on a live listing = buying signal" : gap >= 10 ? "Social-only presence = upgrade signal" : "Has a site, weaker signal");
    notes.push(r >= 50 ? `${r} reviews → budget exists` : "No review count — verify size before quoting");
  } else {
    if (/(looking for|need |needs |hiring|seeking|want to build|help us|budget|quote|rfp)/i.test(text)) b.intent += 18;
    if (/(urgent|asap|this week|immediately|deadline)/i.test(text)) b.intent += 6;
    if (/(mvp|launch|prototype|new site|rebuild)/i.test(text)) b.intent += 5;
    if (lead.source === "freelancer") {
      // A brief with 150 bids is not a warm lead, however good the budget is.
      const bids = lead.bids || 0;
      b.intent -= bids > 120 ? 10 : bids > 60 ? 5 : 0;
      if (bids > 60) notes.push(`${bids} bids already — competitive, bid only with a specific plan`);
    }
    b.intent = clamp(b.intent, 0, 30);

    const money_ = lead.budgetHints || [];
    if (money_.length) {
      const top = Math.max(...money_);
      b.budget = top >= 2000 ? 20 : top >= 800 ? 16 : top >= 300 ? 12 : top >= 100 ? 7 : 4;
      notes.push(`Budget mentioned: ${money(top)}+`);
    } else {
      b.budget = 6;
      notes.push("No budget stated — qualify on the call");
    }

    const d = daysAgo(lead.postedAt);
    b.recency = d === null ? 6 : d <= 2 ? 20 : d <= 7 ? 17 : d <= 14 ? 12 : d <= 30 ? 6 : 0;

    b.fit = lead.serviceMatch === "explicit" ? 12 : 7;
    if (SCAM.test(text)) {
      b.intent = Math.min(b.intent, 6);
      notes.push("⚠ Free-work / low-trust wording detected");
    }
  }

  b.geo = { US: 10, UK: 9, CA: 9, AU: 9, SG: 9, IE: 8, AE: 8, NZ: 8, IN: 4 }[lead.country] ?? 5;
  if (lead.contact?.email) b.contact = 5;
  else if (lead.contact?.phone) b.contact = 5;
  else if (lead.contact?.url) b.contact = 3;
  else b.contact = 1;

  let total = clamp(Math.round(b.intent + b.budget + b.recency + b.geo + b.fit + b.contact), 0, 100);

  // "A" means you can act today: a map lead with no phone and no email is a
  // research task, not a call. Cap it at B so the grade stays honest.
  if ((lead.source === "google_maps" || lead.source === "osm") && !lead.contact?.phone && !lead.contact?.email) {
    total = Math.min(total, 68);
    notes.push("No phone/email on the listing — find the number before calling");
  }

  // Marketplace reality check: on Freelancer/Upwork the bid count decides whether
  // you are seen at all. 500 bids means don't bother, whatever the budget says.
  if (lead.source === "freelancer") {
    const bids = lead.bids || 0;
    if (bids > 200) total = Math.min(total, 55);
    else if (bids > 100) total = Math.min(total, 65);
  }

  const band = total >= 72 ? "A" : total >= 52 ? "B" : "C";
  return { total, band, breakdown: b, notes };
}

/* ------------------------------------------------------------------ */
/* pitch + copy fallbacks (used when no LLM key)                      */
/* ------------------------------------------------------------------ */

export function fallbackPitch(lead, service) {
  const svc = SERVICES[service] || SERVICES.website;
  const [lo, hi] = priceFor(service, lead.country);
  const place = lead.city && !/^remote$/i.test(lead.city) ? lead.city : "";
  const isBiz = lead.kind === "business";
  const why = isBiz
    ? lead.gap?.detail || `${lead.verticalLabel || "These businesses"} in ${place} compete on being findable first.`
    : `They asked for this in public: "${String(lead.need?.summary || "").slice(0, 110)}". ${svc.build.split(",")[0]} answers exactly that ask.`;
  return {
    build: svc.build,
    why,
    stack: svc.stack,
    mvpWeeks: svc.weeks,
    price: [lo, hi],
    upsell:
      service === "website"
        ? "Monthly care plan ($99–$199/mo): hosting, edits, review replies, one new landing page per month."
        : "Monthly retainer ($199–$499/mo): monitoring, prompt/workflow tuning, one new automation per month.",
    milestonePlan: [
      "Day 1–2: 20-min call, audit the current funnel, agree on the one number we move",
      `Day 3–${3 + Math.round((svc.weeks[0] * 7) / 2)}: build the core (${svc.build.split(",")[0]})`,
      "Day before launch: 1 round of revisions, tracking + analytics wired",
      "Launch + 30-min handover, then offer the care plan",
    ],
  };
}

function trimWords(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const at = cut.lastIndexOf(" ");
  return (at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:.\-–—]+$/, "") + "…";
}

function fixAcronyms(s) {
  return String(s)
    .replace(/\bcta\b/gi, "CTA")
    .replace(/\bseo\b/gi, "SEO")
    .replace(/\bcrm\b/gi, "CRM")
    .replace(/\bmvp\b/gi, "MVP")
    .replace(/\bapi\b/gi, "API")
    .replace(/\bai\b/gi, "AI")
    .replace(/\brag\b/gi, "RAG")
    .replace(/\bfaqs\b/gi, "FAQs")
    .replace(/\bui\b/gi, "UI")
    .replace(/\bux\b/gi, "UX");
}

/** Turn any business/record name into something a human would write after "Hi". */
function greetingName(raw) {
  const clean = String(raw || "")
    .replace(/^[\s'"“”]+|[\s'"“”]+$/g, "")
    .split(/\s+[-–—|]\s+|\s*\(\s*|,/)[0]
    .trim();
  return clean || "there";
}

export function fallbackCopy(lead, service, pitch) {
  const svc = SERVICES[service] || SERVICES.website;
  const place = lead.city && !/^remote$/i.test(lead.city) ? lead.city : "";
  const isBiz = lead.kind === "business";
  const price = money(pitch.price[0]) + "–" + money(pitch.price[1]);
  const weeks = pitch.mvpWeeks[0] + "–" + pitch.mvpWeeks[1] + " weeks";
  const what = (svc.deliverable || fixAcronyms(pitch.build.split(",")[0].toLowerCase())).replace(/\.$/, "");
  // Posts rarely expose a real name; "Hi Company Website Build From Scratch" is
  // worse than a plain "Hi there".
  const contactName = isBiz ? greetingName(lead.name) : "there";
  const where = place ? " in " + place : "";
  const niche = (lead.verticalLabel || "local businesses").toLowerCase();

  const pain = lead.gap?.label === "No website"
    ? "no website on the listing, so anyone who wants to book has to call during opening hours"
    : lead.gap?.label
      ? 'the "site" is just ' + lead.gap.label.toLowerCase() + ", with no booking and nothing Google can rank"
      : "enquiries come in but the follow-up is manual";

  // Prefer the client's own first sentence over the listing title: "you need a
  // business website built from scratch" beats "Company Website Build #2".
  const firstSentence = (s) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    const m = t.match(/^.{25,170}?[.!?](\s|$)/);
    return (m ? m[0] : t).trim();
  };
  const ask = trimWords(firstSentence(lead.need?.evidence) || lead.need?.summary || "your project", 95);

  const subjectIdea = {
    website: "a site that takes bookings",
    ai_chatbot: "a 24/7 booking chatbot",
    ai_agent: "less manual admin",
    webapp: "a small internal tool",
    dashboard: "one live dashboard",
    mobile: "a mobile app for your customers",
    ecommerce: "a store that converts",
  }[service] || "a quick idea";

  const emailSubject = isBiz
    ? lead.name + " — " + subjectIdea
    : "Re: " + trimWords(ask, 62);

  const askShort = trimWords(ask, 70);
  const endDot = (s) => (/[.!?…]$/.test(s) ? s : s + ".");

  const emailBody = isBiz
    ? "Hi " + greetingName(lead.name) + " team,\n\n" +
      "I came across " + lead.name + where + " and noticed " + pain + ".\n\n" +
      "I build " + svc.plural + " for " + niche + ". " + svc.line + "\n\n" +
      "For you that means " + what + ", live in " + weeks + " for " + price + " fixed — 50% up front, the rest only when it is live and you are happy with it.\n\n" +
      "Want me to send a 2-page plan (pages, booking flow, timeline) before you decide anything?\n\n— Sumant"
    : "Hi " + contactName + ",\n\n" +
      "Saw your " + (lead.source === "freelancer" || lead.source === "peopleperhour" ? "brief" : "post") + ": " + endDot(ask) + " I build exactly that: " + what + ", normally " + weeks + ", " + price + " fixed.\n\n" +
      "First step is small: a 3-line scope and timeline so you can compare it against other quotes. Want me to send it?\n\n— Sumant";

  const dm = isBiz
    ? "Hi " + contactName + " — came across " + lead.name + where + ". Your listing has " +
      (lead.gap?.label === "No website" ? "no website" : "a social page instead of a site") +
      ", so people can't book online. I build " + svc.plural + " for " + niche + ", " + weeks + ", " + price + " fixed. Want the 2-page plan?"
    : "Saw your " + (lead.source === "freelancer" || lead.source === "peopleperhour" ? "brief" : "post") + ": " + endDot(askShort) + " I can ship " + what + " in " + weeks + " for " + price + " fixed. Want a 3-line scope first?";

  const callScript =
    "Hi, is this " + lead.name + "? I'm Sumant — I build " + svc.plural + " for " + niche + where +
    ". I noticed " + pain + ". I'm not selling a redesign; one question: how many enquiries a week do you lose because someone can't book you online in 20 seconds? ... I can put a short plan and a fixed price in front of you by tomorrow. If it's not a fit, keep the plan.";

  return { emailSubject, emailBody, dm, callScript };
}

export function alignProposalToBudget(lead) {
  const hints = (lead.budgetHints || []).filter((n) => Number.isFinite(n) && n >= 200);
  if (!hints.length || lead.kind !== "post" || !lead.proposal) return lead;
  const lo = Math.min(...hints);
  const hi = Math.max(...hints);
  const [bandLo, bandHi] = lead.proposal.price || [0, 0];

  // A $50k budget does not turn a 5-page website into a $50k website. If the
  // budget is far above what the proposed scope is worth, quote the scope and
  // say why — that reads as judgement, not as a number pulled from the air.
  if (bandHi && hi > bandHi * 1.8) {
    lead.proposal.price = [bandLo, bandHi];
    lead.proposal.priceBasis = `client budget is ${money(hi)} — far above a ${lead.proposal.mvpWeeks?.join("–") || "short"}-week scope; quote a paid pilot first`;
    lead.proposal.scopeWarning = `Their stated budget (${money(lo)}–${money(hi)}) is ${Math.round(hi / bandHi)}x this scope. Either propose a bigger build or treat it as a pricing reference.`;
    return lead;
  }

  const qLo = Math.max(200, Math.round(lo * 0.75));
  const qHi = Math.max(qLo + 200, Math.round(hi * 0.9));
  lead.proposal.price = [qLo, qHi];
  lead.proposal.priceBasis = `quoted against the client's stated budget (${money(lo)}–${money(hi)})`;
  return lead;
}

/* ------------------------------------------------------------------ */
/* the pipeline                                                       */
/* ------------------------------------------------------------------ */

export const AGENTS = [
  { id: "planner", name: "Planner", role: "Turns your offer + market into a search plan" },
  { id: "maps", name: "Maps Scout", role: "Pulls live businesses from Google Places, scores their digital gap" },
  { id: "demand", name: "Demand Scout", role: "Finds people publicly asking for this work" },
  { id: "audit", name: "Site Auditor", role: "Opens each website: HTTP, HTTPS, speed, mobile, email" },
  { id: "analyst", name: "Signal Analyst", role: "Dedupes, grades A/B/C and kills weak leads" },
  { id: "strategist", name: "Strategist", role: "Decides what to build, scope and USD price" },
  { id: "writer", name: "Outreach Writer", role: "Writes the first email, DM and call script" },
  { id: "verifier", name: "Verifier", role: "Checks every link, date and contact before it ships" },
];

export async function runPipeline(input, emit, ctxOuter = {}) {
  const runId = rid();
  const t0 = Date.now();
  const emitSafe = (o) => {
    try {
      emit(o);
    } catch {
      /* client gone */
    }
  };

  // Streaming: as soon as one source finishes, its leads are scored, pitched and
  // pushed to the client. Ids are tracked so later stages upsert instead of
  // duplicating, and dropped leads can be retracted.
  const emittedIds = new Set();
  const emitLead = (lead) => {
    emittedIds.add(lead.id);
    emitSafe({ t: "lead", lead });
  };


  const service = SERVICES[input.service] ? input.service : "website";
  const vertical = VERTICALS[input.vertical] ? input.vertical : "dental";
  const depth = ["fast", "deep", "wide"].includes(input.depth) ? input.depth : "fast";
  const DEPTH = {
    fast: { cities: 2, pages: 2, audit: 8, enrich: 12, cap: 18, days: 14, queries: 2, freelanceDays: 10 },
    deep: { cities: 4, pages: 3, audit: 14, enrich: 20, cap: 30, days: 45, queries: 3, freelanceDays: 21 },
    wide: { cities: 8, pages: 2, audit: 12, enrich: 30, cap: 40, days: 21, queries: 3, freelanceDays: 14 },
  };
  const depthCfg = DEPTH[depth];
  const country = MARKETS[input.country] ? input.country : "US";
  const minReviews = Math.max(0, Number(input.minReviews) || 3);
  const requirePhone = Boolean(input.requirePhone);
  const keys = input.keys || {};
  const llm = keys.llm?.apiKey ? keys.llm : null;

  const ctx = {
    runId,
    service,
    vertical,
    country,
    depth,
    keys,
    llm,
    cities: input.city?.trim()
      ? [input.city.trim()]
      : MARKETS[country].cities.slice(0, depthCfg.cities),
    leads: [],
    warnings: [],
    log: [],
    aborted: false,
    usage: { searches: 0, llmCalls: 0 },
  };

  const agent = (id) => AGENTS.find((a) => a.id === id);
  const start = (id, msg) => emitSafe({ t: "agent", agent: id, name: agent(id)?.name, status: "start", msg });
  const log = (id, msg, level = "log") => {
    ctx.log.push({ id, msg, level, at: nowIso() });
    emitSafe({ t: "agent", agent: id, name: agent(id)?.name, status: level, msg });
  };
  const ok = (id, msg, counts) => emitSafe({ t: "agent", agent: id, name: agent(id)?.name, status: "ok", msg, counts });
  const skip = (id, msg) => emitSafe({ t: "agent", agent: id, name: agent(id)?.name, status: "skip", msg });

  /** Fill score / pitch / outreach for one lead so it can be shown immediately. */
  const finalizeOne = (lead) => {
    const svcId = SERVICES[lead.service] ? lead.service : SERVICES[lead.detectedService] ? lead.detectedService : service;
    lead.service = svcId;
    if (!lead.score) lead.score = scoreLead(lead);
    if (!lead.proposal) {
      lead.proposal = fallbackPitch(lead, svcId);
      alignProposalToBudget(lead);
    }
    if (!lead.outreach) lead.outreach = fallbackCopy(lead, svcId, lead.proposal);
    return lead;
  };

  emitSafe({ t: "run", runId, startedAt: nowIso(), config: { service, vertical, country, cities: ctx.cities, depth } });

  /* ---------------------------------------------------------------- */
  /* 1. PLANNER                                                       */
  /* ---------------------------------------------------------------- */
  start("planner", "Building the search plan");
  const svc = SERVICES[service];
  const vert = VERTICALS[vertical];
  const plan = {
    mapQueries: ctx.cities.map((c) => `${vert.term} in ${c}`),
    demandQueries: [
      ...svc.demandKw.map((k) => `${k} hiring`),
      `${svc.demandKw[0]} freelance`,
    ],
    siteQueries: svc.siteQuery.map((q) => `${q} ${MARKETS[country].term}`),
  };
  log("planner", `Offer: ${svc.label} · Buyer: ${vert.label} · Market: ${country}`);
  log("planner", `${plan.mapQueries.length} map queries, ${plan.demandQueries.length} demand queries, ${plan.siteQueries.length} web queries`);
  ok("planner", "Plan ready", { mapQueries: plan.mapQueries.length, demandQueries: plan.demandQueries.length });

  /* ---------------------------------------------------------------- */
  /* 2. MAPS SCOUT                                                    */
  /* ---------------------------------------------------------------- */
  let useGoogle = Boolean(keys.google);
  start(
    "maps",
    useGoogle
      ? "Scanning OpenStreetMap for no-site businesses (Google adds phones)"
      : "Scanning OpenStreetMap (free mode) for businesses with no site"
  );
  log(
    "maps",
    useGoogle
      ? "Discovery: OpenStreetMap — Google's top results are almost all businesses that already have a site, so it is a poor place to find gaps. Google Places is used to add phone numbers and ratings."
      : "No Google key — using OpenStreetMap + Nominatim (free, no signup). Phone numbers are thinner; a Google key adds them."
  );
  let mapCount = 0;
  // Budget for "has a real site" businesses: we open a few and only keep the
  // broken ones. A site that returns 500 is a better lead than no site at all.
  let auditBudget = depthCfg.audit;

  const osmFor = async (city) => {
    const geo = await geocodeCity(city);
    await sleep(1100); // Nominatim usage policy: max 1 request/second
    const raw = await osmPlaces({ bbox: geo.bbox, tags: vert.osmTags, limit: 60 });
    return raw.map((p) => ({ ...p, src: "osm", reviews: 0, rating: null }));
  };

  for (const city of ctx.cities) {
    if (ctx.aborted) break;
    let places = [];
    try {
      ctx.usage.searches++;
      places = await osmFor(city);
      // Thin OSM coverage (common outside the US/UK) — top up from Google so a
      // small city does not come back empty.
      if (places.length < 5 && keys.google) {
        const osmCount = places.length;
        try {
          const g = await searchPlaces({
            apiKey: keys.google,
            textQuery: `${vert.term} in ${city}`,
            regionCode: MARKETS[country].regionCode,
            max: 20,
            pages: depthCfg.pages,
          });
          places = [...places, ...g.map((p) => ({ ...p, src: "google_maps" }))];
          log("maps", `${city}: OSM had ${osmCount} — added ${g.length} from Google Places`);
        } catch {
          /* keep the OSM results */
        }
      }
    } catch (e) {
      const msg = String(e.message || e);
      if (keys.google) {
        log("maps", `OSM failed for ${city} (${msg.slice(0, 60)}) — using Google Places instead`, "warn");
        try {
          const found = await searchPlaces({
            apiKey: keys.google,
            textQuery: `${vert.term} in ${city}`,
            regionCode: MARKETS[country].regionCode,
            max: 20,
            pages: 1,
          });
          places = found.map((p) => ({ ...p, src: "google_maps" }));
        } catch (e2) {
          ctx.warnings.push(`Maps ${city}: ${e2.message}`);
          log("maps", `${city} failed: ${e2.message}`, "warn");
          continue;
        }
      } else {
        ctx.warnings.push(`Maps ${city}: ${msg}`);
        log("maps", `${city} failed: ${msg}`, "warn");
        continue;
      }
    }

    log("maps", `${city} → ${places.length} candidates`);
    for (const p of places) {
      if (ctx.aborted) break;
      if (p.status === "CLOSED_PERMANENTLY") continue;
      if (p.src === "google_maps" && p.reviews < minReviews) continue;
      if (p.src === "osm" && !p.address && !p.phone && !p.email) continue;

      const weak = isWeakSite(p.website);
      const gapScore = !p.website ? 15 : weak ? 11 : 3;
      if (gapScore <= 3) {
        if (!p.website || auditBudget <= 0) continue;
        auditBudget--;
      }

      const label = !p.website ? "No website" : "Social-only presence";
      const detail =
        p.src === "osm"
          ? `${p.name} is listed on OpenStreetMap in ${city} with no website — anyone who finds them has no way to check prices or book.`
          : !p.website
            ? `Google shows ${p.name} (${p.reviews} reviews, ${p.rating ?? "–"}★) with no website — anyone who wants details leaves and calls a competitor.`
            : `Their "website" is ${domainOf(p.website)} — no owned pages, no booking, no SEO. ${p.reviews} reviews show real demand.`;

      mapCount++;
      const lead = {
        id: `${p.src === "osm" ? "osm" : "gm"}_${String(p.placeId || p.osmId || rid()).replace(/\W/g, "").slice(-10)}`,
        name: p.name,
        kind: "business",
        country,
        city,
        verticalLabel: vert.label,
        verticalHook: vert.hook,
        source: p.src,
        sourceUrl: p.mapsUrl || `https://www.google.com/maps/search/${encodeURIComponent(p.name + " " + city)}`,
        postedAt: null,
        fetchedAt: nowIso(),
        rating: p.rating ?? null,
        reviews: p.reviews || 0,
        category: p.category,
        gap: { score: gapScore, label, detail, website: p.website || "" },
        need: {
          summary: !p.website
            ? `${vert.label} in ${city} with no website — losing ${vert.hook} to competitors`
            : `${vert.label} in ${city} running on ${domainOf(p.website)} — no booking, no SEO`,
          evidence: p.website || (p.src === "osm" ? "OpenStreetMap listing with no website tag" : "Google Business Profile listing"),
          signals: [
            label,
            ...(p.reviews ? [`${p.reviews} Google reviews`] : []),
            ...(p.rating ? [`${p.rating}★ rating`] : []),
            vert.hook,
          ],
        },
        contact: {
          phone: p.phone || "",
          email: p.email || "",
          website: p.website || "",
          address: p.address || "",
          url: p.mapsUrl || "",
          lookup: p.phone ? "" : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.address || city}`)}`,
          route: p.phone ? "Call the listed number (best first touch)" : "No number in the map data — use the lookup link, then call",
        },
        serviceMatch: "implicit",
        auditPending: gapScore <= 3,
      };
      lead.score = scoreLead(lead);
      ctx.leads.push(lead);
    }
  }

  // Push each city's leads the moment that city finishes, so the board fills up
  // while the remaining cities are still being scanned.
  const freshMaps = ctx.leads
    .filter((l) => !emittedIds.has(l.id) && !l.drop)
    .map(finalizeOne)
    .sort((a, b) => b.score.total - a.score.total);
  for (const l of freshMaps.slice(0, 10)) emitLead(l);

  // OSM knows the business, Google knows the phone. Combine the two instead of
  // choosing: OSM finds businesses that do not rank on Google at all.
  const needPhone = ctx.leads.filter((l) => !l.contact?.phone && l.kind === "business").slice(0, depthCfg.enrich);
  if (keys.google && needPhone.length) {
    let enriched = 0;
    for (const lead of needPhone) {
      if (ctx.aborted) break;
      try {
        ctx.usage.searches++;
        const hit = await lookupPlace({
          apiKey: keys.google,
          name: lead.name,
          city: lead.city,
          regionCode: MARKETS[country].regionCode,
        });
        if (hit?.phone && hit.confidence >= 2) {
          lead.contact.phone = hit.phone;
          lead.contact.url = hit.mapsUrl || lead.contact.url;
          lead.rating = hit.rating;
          lead.reviews = hit.reviews || lead.reviews;
          lead.enriched = "google";
          lead.score = scoreLead(lead);
          enriched++;
        }
      } catch (e) {
        ctx.warnings.push(`Google lookup: ${e.message}`);
        break; // key/permission problem — do not hammer the API
      }
      await sleep(120);
    }
    if (enriched) log("maps", `Google lookup added ${enriched} phone numbers`);
  }

  if (requirePhone) {
    const before = ctx.leads.length;
    ctx.leads = ctx.leads.filter((l) => l.kind !== "business" || l.contact?.phone);
    log("maps", `Phone-only filter: ${before - ctx.leads.length} businesses without a number removed`);
  }

  if (mapCount) ok("maps", `${mapCount} businesses with a digital gap`, { leads: mapCount });
  else skip("maps", "No businesses without a site in these cities — try another vertical or city");
  for (const l of ctx.leads) {
    // Re-send after phone enrichment so early cards gain their number.
    if (l.enriched || !emittedIds.has(l.id)) emitLead(finalizeOne(l));
  }
  emitSafe({ t: "progress", leads: ctx.leads.length });
  emitSafe({ t: "progress", leads: ctx.leads.length });

  /* ---------------------------------------------------------------- */
  /* 3. DEMAND SCOUT                                                  */
  /* ---------------------------------------------------------------- */
  start("demand", "Looking for public 'we need this built' posts");
  let demandCount = 0;
  const pushPost = (lead) => {
    if (!lead?.sourceUrl) return;
    const text = `${lead.need?.summary || ""} ${lead.need?.evidence || ""}`;
    const detected = inferService(text);
    lead.detectedService = detected || "";
    lead.serviceMatch = detected === service ? "explicit" : detected ? "other" : "unknown";
    lead.score = scoreLead(lead);
    ctx.leads.push(lead);
    demandCount++;
  };

  let redditDead = false;
  const addReddit = async (sub, query) => {
    if (redditDead) {
      log("demand", `r/${sub} skipped — Reddit is rate-limiting this IP`, "warn");
      return;
    }
    ctx.usage.searches++;
    let posts = [];
    let via = "json";
    try {
      posts = await redditSearch({ query, sub, days: depthCfg.days });
    } catch (jsonErr) {
      // Reddit blocks the JSON API from many networks. Its public RSS feed
      // usually still answers, so fall back before giving up on the subreddit.
      try {
        posts = await redditRSS({ sub, days: depthCfg.days });
        via = "rss";
      } catch (rssErr) {
        if (/429|too many/i.test(rssErr.message)) redditDead = true;
        ctx.warnings.push(`Reddit r/${sub}: ${jsonErr.message} / ${rssErr.message}`);
        log("demand", `r/${sub} blocked (JSON + RSS): ${rssErr.message}`, "warn");
        return;
      }
    }

    try {
      const hiring = posts.filter((p) => /\[?(hiring|looking for|need|seeking)/i.test(p.title) && !/\[?for hire\]?/i.test(p.title));
      log("demand", `r/${sub} (${via}) "${query}" → ${hiring.length} asks`);
      for (const p of hiring.slice(0, 12)) {
        const text = `${p.title}. ${p.body}`;
        pushPost({
          id: `rd_${p.id}`,
          name: `u/${p.author}`,
          kind: "post",
          country: inferCountry(text, country),
          city: "",
          verticalLabel: vert.label,
          verticalHook: vert.hook,
          source: "reddit",
          sourceUrl: p.url,
          postedAt: p.created,
          fetchedAt: nowIso(),
          budgetHints: moneyHints(text),
          serviceMatch: inferService(text) === service ? "explicit" : "adjacent",
          need: {
            summary: p.title.replace(/^\s*\[(hiring|Hiring)\]\s*/, "").slice(0, 160) || "Freelance request",
            evidence: p.body.slice(0, 500),
            signals: ["Public hiring post", `r/${p.subreddit}`, `${daysAgo(p.created)}d old`],
          },
          contact: {
            email: firstEmail(text),
            url: p.url,
            route: firstEmail(text) ? "Email from the post" : `Reply on Reddit (u/${p.author})`,
          },
        });
      }
    } catch (e) {
      ctx.warnings.push(`Reddit r/${sub}: ${e.message}`);
      log("demand", `r/${sub} blocked: ${e.message}`, "warn");
    }
  };
  for (const q of plan.demandQueries.slice(0, depthCfg.queries)) {
    await addReddit("forhire", q);
    if (ctx.aborted) break;
    await sleep(3600); // Reddit rate-limits RSS hard; space the calls out
  }
  if (depth === "deep") await addReddit("freelance_forhire", svc.demandKw[0]);

  try {
    ctx.usage.searches++;
    const projects = await freelancerProjects({
      query: svc.demandKw[0],
      days: depthCfg.freelanceDays,
      minUsd: country === "IN" ? 60 : 200,
    });
    log("demand", `Freelancer.com → ${projects.length} live briefs above budget floor`);
    for (const p of projects.slice(0, 10)) {
      const text = `${p.title}. ${p.description}`;
      pushPost({
        id: `fl_${p.id}`,
        name: p.title.slice(0, 70),
        kind: "post",
        country: ({ GBP: "UK", INR: "IN", AUD: "AU", CAD: "CA", NZD: "NZ", EUR: "IE", SGD: "SG", AED: "AE" }[p.currency] || (p.currency === "USD" ? country : "")),
        city: "Remote",
        verticalLabel: vert.label,
        verticalHook: vert.hook,
        source: "freelancer",
        sourceUrl: p.url,
        postedAt: p.created,
        fetchedAt: nowIso(),
        budgetHints: p.budgetUsd,
        currency: p.currency,
        need: {
          summary: p.title,
          evidence: p.description.slice(0, 500),
          signals: [
            "Live marketplace brief",
            `Budget ≈ ${money(p.budgetUsd[0])}–${money(p.budgetUsd[1])} USD`,
            `${p.bids} bids already`,
            `Priced in ${p.currency}`,
            ...(p.skills || []).slice(0, 2),
          ],
        },
        contact: {
          email: firstEmail(text),
          url: p.url,
          route: `Bid on Freelancer.com — ${p.bids} freelancers already did. Bid low-competition: send a 3-line plan, not a generic pitch`,
        },
      });
    }
  } catch (e) {
    ctx.warnings.push(`Freelancer: ${e.message}`);
    log("demand", `Freelancer blocked: ${e.message}`, "warn");
  }

  // Search-API powered discovery (Serper or Tavily) — the only compliant way
  // to surface LinkedIn / Instagram / X posts: we read public search results,
  // never the logged-in platforms.
  const searchKey = keys.serper || keys.tavily;
  if (!searchKey) {
    skip("demand", "No Serper/Tavily key — social + LinkedIn discovery skipped");
  } else {
    const gl = MARKETS[country].gl;
    const queries = [
      `site:linkedin.com/posts ("looking for" OR "need") (${svc.demandKw.join(" OR ")}) ${MARKETS[country].label}`,
      `site:reddit.com ("looking for" OR "need") (${svc.demandKw.join(" OR ")}) ("budget" OR "$")`,
      `site:x.com OR site:twitter.com ("need a" OR "looking for") (${svc.demandKw[0]}) (DM OR "email me")`,
      `"${vert.term}" ("need a website" OR "need a new website" OR "looking for web designer") ${MARKETS[country].label}`,
    ];
    for (const q of queries.slice(0, depthCfg.queries + 1)) {
      if (ctx.aborted) break;
      try {
        ctx.usage.searches++;
        const results = keys.serper
          ? await serperSearch({ apiKey: keys.serper, query: q, gl, num: 10 })
          : await tavilySearch({ apiKey: keys.tavily, query: q, max: 8 });
        log("demand", `Web: "${q.slice(0, 60)}…" → ${results.length} results`);
        for (const r of results) {
          const text = `${r.title}. ${r.snippet}`;
          // Snippets are short, so the strict filter only applies when there is
          // enough text to judge; otherwise fall back to the loose keywords.
          const looksBuyer = text.length > 60 ? isBuyerPost(text) : /(need|looking|hiring|budget)/i.test(text);
          if (!looksBuyer) continue;
          pushPost({
            id: `web_${slug(r.url).slice(-24)}_${rid()}`,
            name: domainOf(r.url).replace(/\.(com|co|io|org|net|in|uk)$/, "") || "Web lead",
            kind: "post",
            country: inferCountry(text, country),
            city: "",
            verticalLabel: vert.label,
            verticalHook: vert.hook,
            source: r.url.includes("linkedin.com") ? "linkedin" : r.url.includes("instagram.com") ? "instagram" : r.url.includes("x.com") || r.url.includes("twitter.com") ? "x" : r.url.includes("reddit.com") ? "reddit" : "web",
            sourceUrl: r.url,
            postedAt: r.date ? new Date(r.date).toISOString() : null,
            fetchedAt: nowIso(),
            budgetHints: moneyHints(text),
            serviceMatch: inferService(text) === service ? "explicit" : "adjacent",
            need: { summary: r.title.slice(0, 150), evidence: r.snippet.slice(0, 500), signals: ["Public search hit", domainOf(r.url)] },
            contact: { email: firstEmail(r.snippet), url: r.url, route: "Open the post and reply publicly / DM" },
          });
        }
      } catch (e) {
        ctx.warnings.push(`Search API: ${e.message}`);
        log("demand", `Search API failed: ${e.message}`, "warn");
      }
    }
  }
  ok("demand", `${demandCount} public asks found`, { leads: demandCount });
  const freshDemand = ctx.leads
    .filter((l) => !emittedIds.has(l.id) && !l.drop)
    .map(finalizeOne)
    .sort((a, b) => b.score.total - a.score.total);
  for (const l of freshDemand.slice(0, 8)) emitLead(l);
  emitSafe({ t: "progress", leads: ctx.leads.length });

  /* ---------------------------------------------------------------- */
  /* 3b. SITE AUDITOR                                                 */
  /* ---------------------------------------------------------------- */
  start("audit", "Opening each website to see what a visitor actually gets");
  const auditTargets = ctx.leads
    .filter((l) => /^https?:\/\//.test(l.contact?.website || l.gap?.website || ""))
    .sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
    .slice(0, depthCfg.audit);

  let audited = 0;
  let brokenSites = 0;
  let emailsFound = 0;

  for (const lead of auditTargets) {
    if (ctx.aborted) break;
    const url = lead.contact?.website || lead.gap?.website;
    ctx.usage.searches++;
    const a = await auditWebsite(url);
    lead.audit = { ...a, summary: auditSummary(a) };
    audited++;

    // A published email on their own site is a legitimate contact route and
    // the single biggest upgrade to a map lead.
    if (a.emails.length && !lead.contact.email) {
      lead.contact.email = a.emails[0];
      lead.contact.route = `Email ${a.emails[0]} (published on their own site) or call`;
      emailsFound++;
    }

    if (lead.auditPending) {
      if (a.broken) {
        brokenSites++;
        lead.gap = {
          score: (a.hardIssues || []).length ? 14 : 11,
          label: "Broken website",
          detail: `Their site ${a.issues.slice(0, 2).join(" and ")}. ${a.summary}.`,
          website: url,
        };
        lead.need.summary = `${lead.verticalLabel || "Business"} in ${lead.city} with a broken website — ${a.issues[0]}`;
        lead.need.signals = ["Site checked just now", a.summary, ...(a.emails.length ? [`email: ${a.emails[0]}`] : [])];
        lead.score = scoreLead(lead);
        log("audit", `${lead.name}: ${a.issues[0]}`);
      } else {
        lead.drop = true;
        log("audit", `${lead.name}: site is healthy — dropped`);
      }
    } else if (lead.gap) {
      lead.gap.detail = `${lead.gap.detail} Audit: ${a.summary}.`;
      lead.need.signals = [...new Set([...(lead.need.signals || []), a.summary])];
      lead.score = scoreLead(lead);
    }
  }

  if (audited) ok("audit", `${audited} sites opened · ${brokenSites} broken · ${emailsFound} emails found`, { sites: audited, broken: brokenSites });
  for (const l of ctx.leads) if (l.audit && emittedIds.has(l.id)) emitSafe({ t: "lead", lead: l });
  else skip("audit", "No website to check in this set — every lead is a no-site business");
  emitSafe({ t: "progress", leads: ctx.leads.length });

  /* ---------------------------------------------------------------- */
  /* 4. SIGNAL ANALYST                                                */
  /* ---------------------------------------------------------------- */
  start("analyst", "Deduping and grading every lead");
  const seenUrls = new Set();
  const seenKeys = new Set();
  const before = ctx.leads.length;
  const drop = { noUrl: 0, notSoftware: 0, duplicate: 0, country: 0, lowScore: 0, healthySite: 0 };
  let graded = ctx.leads.filter((l) => {
    if (l.drop) {
      drop.healthySite++;
      return false;
    }
    if (!l.sourceUrl) {
      drop.noUrl++;
      return false;
    }

    // Relevance gate: a public post only counts if it is actually a request
    // for software work. This is what keeps full-time job ads out.
    if (l.kind === "post") {
      const hay = `${l.need?.summary || ""} ${l.need?.evidence || ""}`.toLowerCase();
      const softwareAsk =
        /(website|web site|web app|webapp|mobile app|app development|developer|\bdev\b|software|automation|chatbot|\bai\b|\bapi\b|dashboard|shopify|wordpress|landing page|front.?end|back.?end|full.?stack|\bmvp\b|prototype|integration|\bcrm\b|python|react|node|scrape|data pipeline)/.test(
          hay
        );
      if (!softwareAsk) {
        drop.notSoftware++;
        return false;
      }
      if (!l.detectedService) l.detectedService = inferService(hay) || "";
      l.service = l.detectedService || l.service || service;
    }

    const urlKey = l.sourceUrl.split("?")[0];
    const nameKey = `${slug(l.name)}|${slug(l.city || "")}`;
    if (seenUrls.has(urlKey) || (l.kind === "business" && seenKeys.has(nameKey))) {
      drop.duplicate++;
      return false;
    }
    seenUrls.add(urlKey);
    seenKeys.add(nameKey);
    if (l.country !== country && country !== "ALL") {
      // keep cross-border only if it is a strong USD remote ask
      if (!(l.score?.total >= 70 && !["IN"].includes(l.country))) {
        drop.country++;
        return false;
      }
    }
    if (!(l.score && l.score.total >= 42)) {
      drop.lowScore++;
      return false;
    }
    return true;
  });
  graded.sort((a, b) => b.score.total - a.score.total);
  const cap = depthCfg.cap;

  // Source-balanced selection: pure score sorting lets a single map source
  // swallow the whole board. Reserve space for public "we need this built"
  // posts so every run shows both kinds of signal.
  const quota = Math.max(3, Math.ceil(cap * 0.4));
  const used = {};
  const picked = [];
  const rest = [];
  for (const l of graded) {
    const n = used[l.source] || 0;
    if (picked.length < cap && n < quota) {
      picked.push(l);
      used[l.source] = n + 1;
    } else {
      rest.push(l);
    }
  }
  for (const l of rest) {
    if (picked.length >= cap) break;
    picked.push(l);
  }

  // A broken site is a much better call than a generic listing, but it scores
  // below "no site at all" and loses the cap race. Reserve two slots so every
  // run that found one actually shows it.
  const auditedLeads = graded.filter((l) => l.audit && (l.audit.broken || l.gap?.label === "No online booking"));
  for (const l of auditedLeads) {
    if (picked.some((p) => p.id === l.id)) continue;
    const swapAt = picked.map((p) => Boolean(p.audit)).lastIndexOf(false);
    if (swapAt >= 0) picked[swapAt] = l;
    else break;
  }
  const overCap = Math.max(0, graded.length - picked.length);
  graded = picked.sort((a, b) => b.score.total - a.score.total);

  // Streaming correction: anything already shown but filtered out later is
  // retracted from the board instead of silently staying there.
  const keptIds = new Set(graded.map((l) => l.id));
  for (const id of emittedIds) if (!keptIds.has(id)) emitSafe({ t: "lead-remove", id });
  const counts = graded.reduce((acc, l) => ({ ...acc, [l.score.band]: (acc[l.score.band] || 0) + 1 }), {});
  log("analyst", `${before} raw → ${graded.length} kept (A:${counts.A || 0} B:${counts.B || 0} C:${counts.C || 0})`);
  log(
    "analyst",
    `Dropped: ${drop.noUrl} no-link, ${drop.notSoftware} not software work, ${drop.duplicate} duplicates, ${drop.country} wrong market, ${drop.lowScore} weak signal` +
      (drop.healthySite ? `, ${drop.healthySite} healthy sites` : "") +
      (overCap ? `, ${overCap} over cap` : "")
  );
  ok("analyst", `${graded.length} graded leads`, counts);

  /* ---------------------------------------------------------------- */
  /* 5. STRATEGIST                                                    */
  /* ---------------------------------------------------------------- */
  start("strategist", "Choosing the build + price for each lead");
  for (const lead of graded) {
    // A map lead with no website does not need an automation first — it needs a
    // website. Sell the gap you can actually see, not the service you woke up
    // wanting to sell.
    if ((lead.source === "google_maps" || lead.source === "osm") && lead.gap?.score >= 14) {
      lead.service = "website";
    } else if (lead.source === "google_maps" || lead.source === "osm") {
      lead.service = SERVICES[lead.service] ? lead.service : lead.detectedService || service;
    }

    lead.service = SERVICES[lead.service] ? lead.service : service;
    lead.proposal = fallbackPitch(lead, lead.service);
    alignProposalToBudget(lead);
  }

  if (llm) {
    const batch = graded.slice(0, depth === "deep" ? 8 : 5);
    try {
      ctx.usage.llmCalls++;
      const payload = batch.map((l) => ({
        id: l.id,
        business: l.name,
        where: l.city,
        country: l.country,
        source: l.source,
        what_we_know: l.need?.summary,
        evidence: (l.need?.evidence || "").slice(0, 300),
        rating: l.rating,
        reviews: l.reviews,
      }));
      const out = await chatJSON(
        llm,
        `You are a senior freelance solutions architect. For each lead, decide the smallest high-value build that solves the visible pain.
Rules:
- Use ONLY the facts given. Never invent a website, employee count, or budget.
- Price in USD, realistic for a solo developer with a strong portfolio but no agency overhead.
- Keep prices inside this band: ${JSON.stringify(priceFor(service, country))} adjusted per lead.
Return {"leads":[{"id","build","why","stack":["..."],"mvpWeeks":[n,n],"priceUsd":[min,max],"upsell","firstQuestion"}]}`,
        JSON.stringify(payload),
        { maxTokens: 2000 }
      );
      const list = out.leads || out;
      let merged = 0;
      for (const item of Array.isArray(list) ? list : []) {
        const lead = graded.find((l) => l.id === item.id);
        if (!lead) continue;
        lead.proposal = {
          ...lead.proposal,
          build: item.build || lead.proposal.build,
          why: item.why || lead.proposal.why,
          stack: Array.isArray(item.stack) && item.stack.length ? item.stack.slice(0, 6) : lead.proposal.stack,
          mvpWeeks: Array.isArray(item.mvpWeeks) && item.mvpWeeks.length === 2 ? item.mvpWeeks : lead.proposal.mvpWeeks,
          price: Array.isArray(item.priceUsd) && item.priceUsd.length === 2 ? item.priceUsd.map(Number) : lead.proposal.price,
          upsell: item.upsell || lead.proposal.upsell,
          firstQuestion: item.firstQuestion || "",
          by: "llm",
        };
        merged++;
      }
      for (const l of batch) if (l.proposal?.by === "llm") emitSafe({ t: "lead", lead: l });
      log("strategist", `LLM wrote ${merged} tailored pitches`);
    } catch (e) {
      ctx.warnings.push(`LLM strategist: ${e.message}`);
      log("strategist", `LLM failed (${e.message.slice(0, 80)}) — using rule-based pitches`, "warn");
    }
  } else {
    skip("strategist", "No LLM key — rule-based pitches (still specific per vertical + gap)");
  }
  ok("strategist", `Pitch ready for ${graded.length} leads`);

  /* ---------------------------------------------------------------- */
  /* 6. OUTREACH WRITER                                               */
  /* ---------------------------------------------------------------- */
  start("writer", "Writing emails, DMs and call scripts");
  for (const lead of graded) lead.outreach = fallbackCopy(lead, lead.service, lead.proposal);

  if (llm) {
    const batch = graded.slice(0, depth === "deep" ? 6 : 4);
    try {
      ctx.usage.llmCalls++;
      const payload = batch.map((l) => ({
        id: l.id,
        business: l.name,
        contact_name: l.name.startsWith("u/") ? l.name.slice(2) : "",
        where: l.city || l.country,
        pain: l.need?.summary,
        evidence: (l.need?.evidence || "").slice(0, 250),
        build: l.proposal.build,
        price: l.proposal.price,
        source: l.source,
      }));
      const out = await chatJSON(
        llm,
        `You write cold outreach for Sumant, a solo developer in India who builds websites, AI chatbots and automations for small businesses in the US/UK.
Rules:
- Short. Email <= 110 words, DM <= 45 words. No "I hope this finds you well". No buzzwords.
- Lead with a specific observation from the evidence. One concrete outcome. One fixed price. One question.
- Never invent facts, clients, awards, or results. Never promise rankings or revenue.
- Write like a human, plain English, contractions fine.
Return {"leads":[{"id","emailSubject","emailBody","dm","callScript"}]}`,
        JSON.stringify(payload),
        { maxTokens: 2600 }
      );
      const list = out.leads || out;
      let merged = 0;
      for (const item of Array.isArray(list) ? list : []) {
        const lead = graded.find((l) => l.id === item.id);
        if (!lead) continue;
        lead.outreach = {
          emailSubject: item.emailSubject || lead.outreach.emailSubject,
          emailBody: item.emailBody || lead.outreach.emailBody,
          dm: item.dm || lead.outreach.dm,
          callScript: item.callScript || lead.outreach.callScript,
          by: "llm",
        };
        merged++;
      }
      for (const l of batch) if (l.outreach?.by === "llm") emitSafe({ t: "lead", lead: l });
      log("writer", `LLM personalised ${merged} outreach sets`);
    } catch (e) {
      ctx.warnings.push(`LLM writer: ${e.message}`);
      log("writer", "LLM copy failed — template copy kept", "warn");
    }
  }
  ok("writer", "Email + DM + call script for every lead");

  /* ---------------------------------------------------------------- */
  /* 7. VERIFIER                                                      */
  /* ---------------------------------------------------------------- */
  start("verifier", "Checking links, dates and contacts");

  /** Dead domains are the main reason an email bounces. Check the mail server. */
  const emailHasServer = async (email) => {
    const domain = String(email).split("@")[1];
    if (!domain) return false;
    const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
    try {
      const mx = await withTimeout(dns.resolveMx(domain));
      if (Array.isArray(mx) && mx.length) return true;
    } catch {}
    try {
      const a = await withTimeout(dns.resolve4(domain));
      return Array.isArray(a) && a.length > 0;
    } catch {
      return false;
    }
  };

  let mxChecked = 0;
  for (const lead of graded) {
    if (lead.contact?.email && mxChecked < 6) {
      mxChecked++;
      lead.emailValid = await emailHasServer(lead.contact.email);
      if (!lead.emailValid) {
        lead.contact.emailUnverified = lead.contact.email;
        lead.contact.email = "";
        lead.contact.route = `${lead.contact.route} (email domain has no mail server — verify before relying on it)`;
      }
    }
    const digits = String(lead.contact?.phone || "").replace(/\D/g, "");
    lead.phoneValid = digits.length >= 7 ? true : lead.contact?.phone ? false : null;
    if (lead.phoneValid === false) lead.contact.phone = "";
    lead.score = scoreLead(lead);
  }

  let verifiedOk = 0;
  for (const lead of graded) {
    const checks = [
      { label: "Source link", pass: /^https?:\/\//.test(lead.sourceUrl || ""), note: lead.sourceUrl ? domainOf(lead.sourceUrl) : "missing" },
      { label: "Date", pass: Boolean(lead.postedAt), note: lead.postedAt ? `${daysAgo(lead.postedAt)}d ago` : lead.source === "google_maps" ? "live listing (no post date)" : "unknown" },
      { label: "Contact route", pass: Boolean(lead.contact?.phone || lead.contact?.email || lead.contact?.url), note: lead.contact?.route || "" },
      {
        label: "Email delivers",
        pass: lead.emailValid !== false,
        note: lead.emailValid === false ? "domain has no mail server" : lead.contact?.email ? "MX record found" : "no email to check",
      },
      {
        label: "Phone format",
        pass: lead.phoneValid !== false,
        note: lead.phoneValid === false ? "number too short to dial" : lead.contact?.phone || "no phone on file",
      },
      { label: "No free-work flag", pass: !SCAM.test(`${lead.need?.summary} ${lead.need?.evidence}`), note: "" },
    ];
    const passed = checks.filter((c) => c.pass).length;
    lead.verification = {
      ok: passed >= 3,
      score: Math.round((passed / checks.length) * 100),
      checks,
      disclaimer:
        lead.source === "google_maps"
          ? "Business data pulled live from Google Places — confirm the phone/site yourself before calling."
          : "Public post — read the thread before replying; budgets and scope are only what the poster wrote.",
    };
    if (lead.verification.ok) verifiedOk++;
  }
  const dropped = graded.filter((l) => !l.verification.ok);
  ctx.leads = graded.filter((l) => l.verification.ok);
  if (dropped.length) log("verifier", `Dropped ${dropped.length} leads with unverifiable contact/link`, "warn");
  ok("verifier", `${verifiedOk}/${graded.length} leads verified`, { verified: verifiedOk });

  /* ---------------------------------------------------------------- */
  /* ship                                                             */
  /* ---------------------------------------------------------------- */
  const pipelineValueUsd = ctx.leads.reduce((sum, l) => {
    const [lo, hi] = l.proposal.price;
    return sum + Math.round((lo + hi) / 2);
  }, 0);

  const stats = {
    total: ctx.leads.length,
    a: ctx.leads.filter((l) => l.score.band === "A").length,
    b: ctx.leads.filter((l) => l.score.band === "B").length,
    c: ctx.leads.filter((l) => l.score.band === "C").length,
    avgScore: ctx.leads.length ? Math.round(ctx.leads.reduce((s, l) => s + l.score.total, 0) / ctx.leads.length) : 0,
    bySource: ctx.leads.reduce((a, l) => ({ ...a, [l.source]: (a[l.source] || 0) + 1 }), {}),
    pipelineValueUsd,
    searches: ctx.usage.searches,
    llmCalls: ctx.usage.llmCalls,
    ms: Date.now() - t0,
  };

  for (const lead of ctx.leads) emitSafe({ t: "lead", lead });
  emitSafe({ t: "stats", stats });
  emitSafe({
    t: "done",
    runId,
    stats,
    warnings: ctx.warnings,
    mode: { llm: Boolean(llm), maps: Boolean(keys.google), searchApi: Boolean(keys.serper || keys.tavily) },
    finishedAt: nowIso(),
  });

  return { runId, leads: ctx.leads, stats, warnings: ctx.warnings, log: ctx.log };
}
