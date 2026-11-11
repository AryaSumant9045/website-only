/* LeadScout 2.0 — front-end controller */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mid = (p) => (Array.isArray(p) && p.length === 2 ? Math.round((Number(p[0]) + Number(p[1])) / 2) : 0);
const usd = (n) => "$" + Math.round(n || 0).toLocaleString("en-US");
const usdCompact = (n) => {
  const v = Math.round(n || 0);
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1e4) return "$" + Math.round(v / 1e3) + "k";
  return usd(v);
};

const AGENTS = ["planner", "maps", "demand", "audit", "analyst", "strategist", "writer", "verifier"];
const AGENT_NAMES = {
  planner: "Planner",
  maps: "Maps Scout",
  demand: "Demand Scout",
  audit: "Site Auditor",
  analyst: "Signal Analyst",
  strategist: "Strategist",
  writer: "Outreach Writer",
  verifier: "Verifier",
};
const STATUSES = ["new", "contacted", "replied", "won", "lost"];
const STATUS_LABEL = { new: "New", contacted: "Contacted", replied: "Replied", won: "Won", lost: "Lost" };

const LS = { keys: "ls2.keys", status: "ls2.status", saved: "ls2.saved", cfg: "ls2.cfg", models: "ls2.models", opened: "ls2.opened", opts: "ls2.opts", filters: "ls2.filters" };
const load = (k, d) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v ?? d;
  } catch {
    return d;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

const S = {
  catalog: { services: [], verticals: [], cities: { US: [], UK: [], IN: [] } },
  cfg: load(LS.cfg, { service: "website", vertical: "dental", country: "US", city: "", depth: "fast" }),
  keys: load(LS.keys, { google: "", serper: "", tavily: "" }),
  models: load(LS.models, []),
  opened: load(LS.opened, {}),
  opts: load(LS.opts, { requirePhone: false, minReviews: 3, skipSeen: true }),
  filters: load(LS.filters, null),
  editingModel: null,
  leads: [],
  saved: load(LS.saved, {}),
  status: load(LS.status, {}),
  stats: null,
  running: false,
  tab: "run",
  agentState: {},
};

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    const r = await fetch("/api/catalog");
    S.catalog = await r.json();
  } catch {
    toast("Server not reachable — start it with: node server.mjs");
    return;
  }
  renderChips();
  renderCountry();
  renderFind();
  $("#optPhone").checked = Boolean(S.opts.requirePhone);
  $("#optSkipSeen").checked = S.opts.skipSeen !== false;
  $("#optReviews").value = String(S.opts.minReviews ?? 3);
  applyFilters(S.filters);
  bindNav();
  bindControls();
  bindFilters();
  bindSettings();

  // Migrate a single LLM key saved by the old settings screen.
  const legacy = S.keys?.llm;
  if (!S.models.length && legacy?.apiKey) {
    S.models.push({
      id: "m_imported",
      provider: "custom",
      displayName: "Imported key",
      model: legacy.model || "gpt-4o-mini",
      baseUrl: legacy.baseUrl || "https://api.openai.com/v1",
      apiKey: legacy.apiKey,
      protocol: "openai",
      contextWindow: 200000,
      maxOutput: 32000,
      isDefault: true,
    });
    persistModels();
  }
  renderModels();

  $("#cityInput").value = S.cfg.city || "";
  paintKeyDots();
  renderSavedCount();
  renderKanban();
  const params = new URLSearchParams(location.search);
  if (params.get("demo")) {
    await loadSeeds();
    const raw = params.get("open");
    if (raw !== null) {
      const idx = Number(raw);
      if (Number.isInteger(idx) && S.leads[idx]) openDrawer(S.leads[idx]);
    }
    return;
  }
  if (Object.keys(S.saved).length) {
    S.tab = "saved";
    $$("#boardTabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === "saved"));
    showResults();
  }
  if (location.hash) activateView(location.hash.replace("#", ""));
}

/* ------------------------------------------------------------------ */
/* where to look — platform search launcher                           */
/* ------------------------------------------------------------------ */

const NEED_PHRASES = {
  website: { bool: '"need a website" OR "website redesign" OR "looking for web designer"', short: "website" },
  ai_chatbot: { bool: '"need a chatbot" OR "AI chatbot" OR "customer support bot"', short: "chatbot" },
  ai_agent: { bool: '"automate" OR "AI agent" OR "workflow automation"', short: "automation" },
  webapp: { bool: '"web app" OR "internal tool" OR "build an MVP"', short: "web app" },
  dashboard: { bool: '"dashboard" OR "reporting" OR "data analysis"', short: "dashboard" },
  mobile: { bool: '"mobile app" OR "iOS app" OR "Android app"', short: "mobile app" },
  ecommerce: { bool: '"Shopify" OR "online store" OR "ecommerce site"', short: "shopify" },
};

const SEARCH_ENGINES = {
  x: (q) => `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`,
  linkedin: (q) => `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(q)}&datePosted=%22past-week%22`,
  upwork: (q) => `https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(q)}&sort=recency`,
  reddit: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}&sort=new&t=week`,
  instagram: (q) => `https://www.instagram.com/explore/tags/${encodeURIComponent(q)}/`,
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
};

function queryContext() {
  const svc = S.cfg.service;
  const vert = (S.catalog.verticals || []).find((v) => v.id === S.cfg.vertical);
  const mkt = (S.catalog.markets || []).find((m) => m.id === S.cfg.country);
  return {
    need: NEED_PHRASES[svc] || NEED_PHRASES.website,
    term: (vert?.term || "business").toLowerCase(),
    label: (vert?.label || "businesses").toLowerCase(),
    place: S.cfg.city?.trim() || mkt?.label || "United States",
    tag: ((vert?.term || "business").toLowerCase().replace(/[^a-z]/g, "") || "business"),
  };
}

function buildFindCards(c = queryContext()) {
  const noFreelancers = '-("for hire" OR "freelancer" OR "I am a developer")';
  return [
    {
      id: "x",
      label: "X — live posts",
      query: `(${c.need.bool}) (${c.term}) (DM OR email OR "reach out") -filter:replies ${noFreelancers}`,
    },
    {
      id: "linkedin",
      label: "LinkedIn — posts this week",
      query: `${c.term} ${c.need.short} need help`,
    },
    {
      id: "upwork",
      label: "Upwork — newest jobs",
      query: `${c.term} ${c.need.short}`,
    },
    {
      id: "reddit",
      label: "Reddit — asks with a budget",
      query: `site:reddit.com (${c.need.bool}) ("budget" OR "$") ${noFreelancers}`,
    },
    {
      id: "instagram",
      label: "Instagram — hashtag scan",
      query: c.tag,
      url: `https://www.instagram.com/explore/tags/${encodeURIComponent(c.tag)}/`,
      copyText: `site:instagram.com ${c.term} ("need a" OR "looking for") ${c.need.short}`,
    },
    {
      id: "google",
      label: "Google — indexed posts",
      query: `(${c.need.bool}) (${c.term}) (${c.place}) ("budget" OR "paid") ${noFreelancers}`,
    },
  ];
}

function renderFind() {
  const grid = $("#findGrid");
  if (!grid) return;
  const cards = buildFindCards();
  grid.innerHTML = cards
    .map(
      (c) => `<div class="find-card ${S.opened[c.id] ? "opened" : ""}" data-id="${c.id}">
        <div class="fc-head"><span class="fc-badge ${c.id}">${c.id}</span><span class="fc-label">${h(c.label)}</span></div>
        <div class="fc-query">${h(c.query)}</div>
        <div class="fc-actions">
          <button class="mini acid" data-act="open">Open ↗</button>
          <button class="mini" data-act="copy">Copy query</button>
        </div>
      </div>`
    )
    .join("");

  $$(".find-card", grid).forEach((card) => {
    const c = cards.find((x) => x.id === card.dataset.id);
    card.querySelector('[data-act="open"]').addEventListener("click", () => {
      const url = c.url || SEARCH_ENGINES[c.id](c.query);
      window.open(url, "_blank", "noopener");
      S.opened[c.id] = Date.now();
      save(LS.opened, S.opened);
      card.classList.add("opened");
      toast(`${c.id} search opened — post mile to Paste karo`);
    });
    card.querySelector('[data-act="copy"]').addEventListener("click", () => {
      copy(c.copyText || c.query, "Query copied");
    });
  });
}

/* ------------------------------------------------------------------ */
/* chips + controls                                                   */
/* ------------------------------------------------------------------ */

function renderChips() {
  $("#serviceChips").innerHTML = S.catalog.services
    .map((s) => `<button class="chip ${S.cfg.service === s.id ? "active" : ""}" data-service="${s.id}" title="${h(s.blurb)}">${h(s.label)}</button>`)
    .join("");
  $("#verticalChips").innerHTML = S.catalog.verticals
    .map((v) => `<button class="chip ${S.cfg.vertical === v.id ? "active" : ""}" data-vertical="${v.id}" title="${h(v.pain)}">${h(v.label)}</button>`)
    .join("");
  $$("#serviceChips .chip").forEach((b) =>
    b.addEventListener("click", () => {
      S.cfg.service = b.dataset.service;
      renderChips();
      renderFind();
      persistCfg();
    })
  );
  $$("#verticalChips .chip").forEach((b) =>
    b.addEventListener("click", () => {
      S.cfg.vertical = b.dataset.vertical;
      renderChips();
      renderFind();
      persistCfg();
    })
  );
}

function renderCountry() {
  const markets = S.catalog.markets || [];
  const SHORT = { US: "USA", UK: "UK", NZ: "NZ", AE: "UAE" };
  const box = $("#countryChips");
  if (!box) return;
  box.innerHTML = markets
    .map(
      (m) =>
        `<button class="chip ${S.cfg.country === m.id ? "active" : ""}" data-c="${m.id}" title="${h(m.label)} — budget factor ${Math.round(
          m.factor * 100
        )}% of US">${m.flag} ${h(SHORT[m.id] || m.label)}</button>`
    )
    .join("");
  $$("#countryChips .chip").forEach((b) =>
    b.addEventListener("click", () => {
      S.cfg.country = b.dataset.c;
      renderCountry();
      renderFind();
      persistCfg();
    })
  );
  const cur = markets.find((m) => m.id === S.cfg.country);
  if (cur) $("#cityInput").placeholder = `City (optional) — e.g. ${cur.cities[0]}`;
}

function persistCfg() {
  save(LS.cfg, S.cfg);
}

function bindControls() {
  $$(".seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.depth === S.cfg.depth);
    b.onclick = () => {
      S.cfg.depth = b.dataset.depth;
      $$(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      persistCfg();
    };
  });

  $("#cityInput").addEventListener("input", (e) => {
    S.cfg.city = e.target.value;
    renderFind();
    persistCfg();
  });
  $("#cityInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !S.running) startRun();
  });

  $("#runBtn").addEventListener("click", startRun);
  $("#optPhone").addEventListener("change", syncOpts);
  $("#optSkipSeen").addEventListener("change", syncOpts);
  $("#optReviews").addEventListener("change", syncOpts);
  $("#pasteBtn").addEventListener("click", openImportModal);
  $("#pasteFromFind").addEventListener("click", openImportModal);
  $("#copyAllQueries").addEventListener("click", () =>
    copy(
      buildFindCards()
        .map((c) => `${c.id}: ${c.query}`)
        .join("\n\n"),
      "All queries copied"
    )
  );
  $("#iText").addEventListener("input", updateImportCount);
  $("#importClose").onclick = closeImportModal;
  $("#importCancel").onclick = closeImportModal;
  $("#importBackdrop").onclick = closeImportModal;
  $("#importSave").onclick = submitImport;
  $("#seedBtn").addEventListener("click", loadSeeds);
  $("#exportBtn").addEventListener("click", () => exportCsv(visibleLeads()));
  $("#exportAllBtn").addEventListener("click", () => exportCsv(allSavedLeads()));

  $$("#boardTabs button").forEach((b) => {
    b.onclick = () => {
      S.tab = b.dataset.tab;
      $$("#boardTabs button").forEach((x) => x.classList.toggle("active", x === b));
      renderGrid();
    };
  });
}

function activateView(v) {
  if (!["scout", "pipeline", "settings"].includes(v)) v = "scout";
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === `view-${v}`));
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === v));
  if (v === "pipeline") renderKanban();
  window.scrollTo({ top: 0 });
}

function bindNav() {
  $$("[data-view]").forEach((b) => {
    b.addEventListener("click", () => {
      const v = b.dataset.view;
      history.replaceState(null, "", v === "scout" ? location.pathname + location.search : `#${v}`);
      activateView(v);
    });
  });
  window.addEventListener("hashchange", () => activateView(location.hash.replace("#", "") || "scout"));
}

function bindFilters() {
  const controls = ["#searchInput", "#bandFilter", "#sourceFilter", "#scoreFilter", "#sinceFilter", "#sortSel", "#fCallable", "#fNoSite"];
  controls.forEach((sel) => {
    const el = $(sel);
    el.addEventListener("input", onFilterChange);
    el.addEventListener("change", onFilterChange);
  });
  $("#clearFilters").onclick = resetFilters;
}

function onFilterChange() {
  save(LS.filters, readFilters());
  renderGrid();
}

/* ------------------------------------------------------------------ */
/* run                                                                */
/* ------------------------------------------------------------------ */

function setAgent(id, status, msg, counts) {
  const prev = S.agentState[id] || {};
  S.agentState[id] = { status, msg: msg || prev.msg, counts: counts || prev.counts };
  const el = $(`.agent-step[data-agent="${id}"]`);
  if (!el) return;
  el.className = `agent-step ${status}`;
  const sub = el.querySelector(".sub");
  if (msg) sub.textContent = msg;
  const count = el.querySelector(".count");
  if (counts && typeof counts.leads === "number") count.textContent = counts.leads;
  else if (counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total) count.textContent = total;
  }
}

function renderAgentRail() {
  $("#agentPanel").hidden = false;
  $("#agentRail").innerHTML = AGENTS.map(
    (id) => `<div class="agent-step" data-agent="${id}">
      <div class="name"><span class="bullet"></span>${AGENT_NAMES[id]}<span class="count"></span></div>
      <div class="sub">queued</div>
    </div>`
  ).join("");
  $("#console").innerHTML = "";
}

function logLine(agent, msg, level = "log") {
  const c = $("#console");
  const line = document.createElement("div");
  line.className = `ln ${level}`;
  line.innerHTML = `<span class="who">${h(AGENT_NAMES[agent] || agent)}</span><span class="msg">${h(msg)}</span>`;
  c.appendChild(line);
  c.scrollTop = c.scrollHeight;
  while (c.children.length > 260) c.removeChild(c.firstChild);
}

async function startRun() {
  if (S.running) return;
  S.running = true;
  S.leads = [];
  S.stats = null;
  S.skipped = 0;
  S.agentState = {};
  S.tab = "run";
  $$("#boardTabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === "run"));

  const btn = $("#runBtn");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Agents running…";

  $("#results").hidden = true;
  $("#emptyHero").hidden = true;
  renderAgentRail();

  const payload = {
    service: S.cfg.service,
    vertical: S.cfg.vertical,
    country: S.cfg.country,
    city: S.cfg.city,
    depth: S.cfg.depth,
    minReviews: S.opts.minReviews,
    requirePhone: S.opts.requirePhone,
    keys: {
      google: S.keys.google,
      serper: S.keys.serper,
      tavily: S.keys.tavily,
      llm: defaultModel()?.apiKey
        ? { apiKey: defaultModel().apiKey, baseUrl: defaultModel().baseUrl, model: defaultModel().model }
        : null,
    },
  };

  const t0 = Date.now();
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {}
      }
    }
    if (buf.trim()) {
      try {
        handleEvent(JSON.parse(buf));
      } catch {}
    }
  } catch (e) {
    logLine("planner", `Run failed: ${e.message}`, "warn");
    toast("Run failed — is the server still up?");
  } finally {
    S.running = false;
    btn.disabled = false;
    btn.querySelector("span").textContent = "Run agents";
    if (S.skipped) logLine("analyst", `${S.skipped} leads pehle se saved the — skip kiye ("Naye sirf" off karo to dekhne ke liye)`, "log");
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (S.leads.length) logLine("verifier", `Run finished in ${secs}s · ${S.leads.length} leads saved`, "done");
    else {
      logLine("verifier", "No leads passed verification. Try another market or add a key.", "warn");
      if (!Object.keys(S.saved).length) {
        $("#emptyHero").hidden = false;
        $("#emptyHero").querySelector("h3").textContent = "Nothing passed verification";
        $("#emptyHero").querySelector("p").innerHTML =
          "That market came back empty. Try a bigger city, a different vertical, or add a Google Places key — it returns phone numbers, which is what turns a listing into a call.";
      }
    }
    showResults();
  }
}

function handleEvent(ev) {
  if (ev.t === "agent") {
    const map = { start: "running", ok: "done", warn: "warn", skip: "skip", log: S.agentState[ev.agent]?.status || "running" };
    setAgent(ev.agent, map[ev.status] || "running", ev.msg, ev.counts);
    logLine(ev.agent, ev.msg, ev.status === "warn" ? "warn" : ev.status === "ok" ? "done" : "log");
  } else if (ev.t === "lead") {
    upsertLead(ev.lead);
  } else if (ev.t === "lead-remove") {
    removeLead(ev.id);
  } else if (ev.t === "stats") {
    S.stats = ev.stats;
    renderKpis();
  } else if (ev.t === "done") {
    logLine("verifier", `Done · ${ev.stats.total} leads · ${usd(ev.stats.pipelineValueUsd)} pipeline`, "done");
    (ev.warnings || []).forEach((w) => logLine("demand", w, "warn"));
  } else if (ev.t === "fatal") {
    logLine("planner", ev.msg, "warn");
  }
}

/* ------------------------------------------------------------------ */
/* results                                                            */
/* ------------------------------------------------------------------ */

let renderTimer = null;

/** Coalesce the stream: many leads can land within a second. */
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    if ($("#results").hidden) showResults();
    else {
      renderKpis();
      renderGrid();
    }
    renderSavedCount();
  }, 320);
}

/** Leads stream in per source, and later stages update the same id. */
function upsertLead(lead) {
  const i = S.leads.findIndex((l) => l.id === lead.id);
  if (i >= 0) {
    S.leads[i] = lead;
  } else if (S.opts.skipSeen && S.saved[lead.id]) {
    // Seen in an earlier run: keep the stored copy fresh, but do not fill this
    // run's board with businesses the user already has.
    S.saved[lead.id] = lead;
    save(LS.saved, S.saved);
    S.skipped = (S.skipped || 0) + 1;
    return;
  } else {
    S.leads.unshift(lead);
  }
  S.saved[lead.id] = lead;
  save(LS.saved, S.saved);
  scheduleRender();
}

function removeLead(id) {
  S.leads = S.leads.filter((l) => l.id !== id);
  delete S.saved[id];
  save(LS.saved, S.saved);
  scheduleRender();
}

function showResults({ silent } = {}) {
  const has = S.leads.length || Object.keys(S.saved).length;
  if (!has) return;
  document.body.classList.add("results-mode");
  $("#results").hidden = false;
  $("#emptyHero").hidden = true;
  if (!silent) renderKpis();
  renderSources();
  renderGrid();
}

function allSavedLeads() {
  return Object.values(S.saved);
}

function baseLeads() {
  return S.tab === "run" ? S.leads : allSavedLeads();
}

function syncOpts() {
  S.opts = {
    requirePhone: $("#optPhone").checked,
    minReviews: Number($("#optReviews").value) || 0,
    skipSeen: $("#optSkipSeen").checked,
  };
  save(LS.opts, S.opts);
}

function readFilters() {
  return {
    q: $("#searchInput").value,
    band: $("#bandFilter").value,
    source: $("#sourceFilter").value,
    score: $("#scoreFilter").value,
    since: $("#sinceFilter").value,
    sort: $("#sortSel").value,
    callable: $("#fCallable").checked,
    noSite: $("#fNoSite").checked,
  };
}

function applyFilters(f) {
  if (!f) return;
  $("#searchInput").value = f.q || "";
  $("#bandFilter").value = f.band || "";
  $("#scoreFilter").value = f.score || "0";
  $("#sinceFilter").value = f.since || "0";
  $("#sortSel").value = f.sort || "score";
  $("#fCallable").checked = Boolean(f.callable);
  $("#fNoSite").checked = Boolean(f.noSite);
}

function resetFilters() {
  $("#searchInput").value = "";
  $("#bandFilter").value = "";
  $("#scoreFilter").value = "0";
  $("#sinceFilter").value = "0";
  $("#sortSel").value = "score";
  $("#fCallable").checked = false;
  $("#fNoSite").checked = false;
  save(LS.filters, readFilters());
  renderGrid();
}

function visibleLeads() {
  let list = baseLeads().slice();
  const q = $("#searchInput").value.trim().toLowerCase();
  const band = $("#bandFilter").value;
  const src = $("#sourceFilter").value;
  const minScore = Number($("#scoreFilter").value) || 0;
  const sinceDays = Number($("#sinceFilter").value) || 0;
  const callable = $("#fCallable").checked;
  const noSite = $("#fNoSite").checked;
  if (q) {
    list = list.filter((l) =>
      `${l.name} ${l.city} ${l.country} ${l.need?.summary} ${l.proposal?.build} ${l.verticalLabel}`.toLowerCase().includes(q)
    );
  }
  if (band) list = list.filter((l) => l.score?.band === band);
  if (src) list = list.filter((l) => l.source === src);
  if (minScore) list = list.filter((l) => (l.score?.total || 0) >= minScore);
  if (sinceDays) list = list.filter((l) => (l.postedAt ? daysAgo(l.postedAt) <= sinceDays : true));
  if (callable) list = list.filter((l) => l.contact?.phone || l.contact?.email);
  if (noSite) list = list.filter((l) => l.gap?.label === "No website" || (l.kind === "business" && !l.contact?.website));
  const sort = $("#sortSel").value;
  if (sort === "score") list.sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0));
  if (sort === "recent") list.sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0));
  if (sort === "value") list.sort((a, b) => mid(b.proposal?.price) - mid(a.proposal?.price));
  return list;
}

function renderSources() {
  const sel = $("#sourceFilter");
  const cur = sel.value;
  const sources = [...new Set(baseLeads().map((l) => l.source))].sort();
  sel.innerHTML = `<option value="">All sources</option>` + sources.map((s) => `<option value="${s}">${s.replace("google_maps", "Google Maps")}</option>`).join("");
  sel.value = sources.includes(cur) ? cur : "";
}

function renderKpis() {
  const leads = baseLeads();
  if (!leads.length) {
    $("#kpis").innerHTML = "";
    return;
  }
  const a = leads.filter((l) => l.score?.band === "A").length;
  const avg = Math.round(leads.reduce((s, l) => s + (l.score?.total || 0), 0) / leads.length);
  const value = leads.reduce((s, l) => s + mid(l.proposal?.price), 0);
  const avgDeal = Math.round(value / leads.length);
  const withPhone = leads.filter((l) => l.contact?.phone || l.contact?.email).length;
  $("#kpis").innerHTML = `
    <div class="kpi"><b>${leads.length}</b><span>leads kept</span></div>
    <div class="kpi acid"><b>${a}</b><span>grade A · call today</span></div>
    <div class="kpi"><b>${avg}</b><span>avg score / 100</span></div>
    <div class="kpi cyan"><b>${usd(avgDeal)}</b><span>average deal size</span></div>`;
  $("#headPipeline").textContent = usdCompact(value);
  void withPhone;
}

function ring(total, band) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, total) / 100);
  return `<div class="ring"><svg viewBox="0 0 38 38"><circle class="track" cx="19" cy="19" r="${r}"></circle>
    <circle class="val" cx="19" cy="19" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle></svg><b>${total}</b></div>`;
}

function sourceLabel(s) {
  return { google_maps: "Google Maps", osm: "OpenStreetMap", freelancer: "Freelancer", hn: "Hacker News", x: "X", remoteok: "RemoteOK", wwr: "WWR", linkedin: "LinkedIn", instagram: "Instagram", reddit: "Reddit", web: "Web" }[s] || s;
}

function flag(c) {
  return { US: "🇺🇸", UK: "🇬🇧", IN: "🇮🇳", CA: "🇨🇦", AU: "🇦🇺", NZ: "🇳🇿", IE: "🇮🇪", AE: "🇦🇪", SG: "🇸🇬" }[c] || "🌐";
}

function renderGrid() {
  const list = visibleLeads();
  const grid = $("#leadGrid");
  $("#countLabel").textContent = `${list.length}/${baseLeads().length} shown`;
  $("#emptyState").hidden = list.length > 0;
  grid.innerHTML = list
    .map((l) => {
      const band = l.score?.band || "C";
      const price = l.proposal?.price || [0, 0];
      return `<article class="lead-card band-${band}" data-id="${h(l.id)}">
        <div class="lead-top">
          <div>
            <div class="lead-name">${h(l.name)}</div>
            <div class="lead-meta">
              <span class="pill src-${h(l.source)}">${h(sourceLabel(l.source))}</span>
              <span>${flag(l.country)} ${h(l.city || l.country)}</span>
              ${l.verticalLabel ? `<span class="sep">·</span><span>${h(l.verticalLabel)}</span>` : ""}
            </div>
          </div>
          ${ring(l.score?.total || 0, band)}
        </div>
        <p class="lead-need">${h(l.need?.summary || "")}</p>
        <div class="signals">${[...(l.audit ? [l.audit.summary] : []), ...(l.need?.signals || [])]
          .slice(0, 4)
          .map((s) => `<span class="signal">${h(s)}</span>`)
          .join("")}</div>
        <div class="lead-build">
          <span>${h((l.proposal?.build || "").slice(0, 58))}…</span>
          <b>${usd(price[0])}–${usd(price[1])}</b>
        </div>
        <div class="lead-actions">
          <button class="mini acid" data-act="open">Pitch &amp; contact</button>
          <button class="mini" data-act="dm">Copy DM</button>
          <button class="mini" data-act="source">Source ↗</button>
        </div>
      </article>`;
    })
    .join("");

  $$(".lead-card", grid).forEach((card) => {
    const lead = list.find((l) => l.id === card.dataset.id);
    card.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "dm") {
        e.stopPropagation();
        copy(lead.outreach?.dm || "", "DM copied");
        return;
      }
      if (act === "source") {
        e.stopPropagation();
        window.open(lead.sourceUrl, "_blank", "noopener");
        return;
      }
      openDrawer(lead);
    });
  });
}

/* ------------------------------------------------------------------ */
/* drawer                                                             */
/* ------------------------------------------------------------------ */

let drawerLead = null;
let drawerTab = "email";

function openDrawer(lead) {
  drawerLead = lead;
  drawerTab = "email";
  const dw = $("#drawer");
  dw.hidden = false;
  $("#drawerBackdrop").hidden = false;
  renderDrawer();
}

function closeDrawer() {
  $("#drawer").hidden = true;
  $("#drawerBackdrop").hidden = true;
  drawerLead = null;
}

function renderDrawer() {
  const l = drawerLead;
  if (!l) return;
  const p = l.proposal || {};
  const price = p.price || [0, 0];
  const status = S.status[l.id] || "new";
  const c = l.contact || {};
  const ver = l.verification || { checks: [] };
  const ev = l.need?.evidence || "";
  const showEvidence = ev && ev.slice(0, 90).trim() !== String(l.need?.summary || "").slice(0, 90).trim();
  const copyTarget = { email: l.outreach?.emailBody || "", dm: l.outreach?.dm || "", call: l.outreach?.callScript || "" };

  $("#drawer").innerHTML = `
  <div class="dw-head">
    <div>
      <div class="dw-name">${h(l.name)}</div>
      <div class="dw-meta">
        <span class="pill src-${h(l.source)}">${h(sourceLabel(l.source))}</span>
        <span>${flag(l.country)} ${h(l.city || l.country)}</span>
        ${l.verticalLabel ? `<span>${h(l.verticalLabel)}</span>` : ""}
        <span>· score ${l.score?.total} (${l.score?.band})</span>
      </div>
    </div>
    <button class="dw-close" id="dwClose">✕</button>
  </div>

  <div class="dw-section">
    <div class="dw-label">The signal <span class="mono">${l.postedAt ? `${daysAgo(l.postedAt)}d ago` : "live listing"}</span></div>
    <div class="dw-box">${h(l.need?.summary || "")}</div>
    ${showEvidence ? `<div class="dw-box quote" style="margin-top:8px">${h(ev).slice(0, 700)}</div>` : ""}
    <div class="signals" style="margin-top:8px">${(l.need?.signals || []).map((s) => `<span class="signal">${h(s)}</span>`).join("")}</div>
  </div>

  ${
    l.audit
      ? `<div class="dw-section">
    <div class="dw-label">Website check <span class="mono">${l.audit.error ? "could not load" : l.audit.broken ? "problems found" : "healthy"}</span></div>
    <div class="dw-grid2">
      <div class="dw-kv"><b>${l.audit.status || "—"}</b>HTTP status</div>
      <div class="dw-kv"><b>${l.audit.https ? "Yes" : "No"}</b>HTTPS</div>
      <div class="dw-kv"><b>${((l.audit.ms || 0) / 1000).toFixed(1)}s</b>load time</div>
      <div class="dw-kv"><b>${l.audit.kb || 0} KB</b>page weight</div>
      <div class="dw-kv"><b>${l.audit.mobile === null ? "—" : l.audit.mobile ? "Yes" : "No"}</b>mobile viewport</div>
      <div class="dw-kv"><b>${h(l.audit.platform || "—")}</b>platform</div>
    </div>
    ${(l.audit.issues || []).length ? `<div class="dw-box quote" style="margin-top:8px">${l.audit.issues.map((i) => `• ${h(i)}`).join("<br>")}</div>` : ""}
    ${(l.audit.emails || []).length ? `<div class="mono" style="margin-top:6px">emails on site: ${l.audit.emails.map((e) => h(e)).join(", ")}</div>` : ""}
  </div>`
      : ""
  }

  <div class="dw-section">
    <div class="dw-label">What to build <span class="mono">${p.by === "llm" ? "tailored by LLM" : "rule-based"}</span></div>
    <div class="dw-box">${h(p.build || "")}</div>
    <div class="dw-grid2" style="margin-top:10px">
      <div class="dw-kv"><b>${usd(price[0])}–${usd(price[1])}</b>fixed price (USD)</div>
      <div class="dw-kv"><b>${(p.mvpWeeks || [1, 2])[0]}–${(p.mvpWeeks || [1, 2])[1]} weeks</b>to ship</div>
    </div>
    ${p.why ? `<p class="hint" style="margin-top:10px">${h(p.why)}</p>` : ""}
    <div class="signals" style="margin-top:8px">${(p.stack || []).map((s) => `<span class="signal">${h(s)}</span>`).join("")}</div>
    ${p.upsell ? `<p class="hint" style="margin-top:10px"><b style="color:var(--muted)">Retainer:</b> ${h(p.upsell)}</p>` : ""}
  </div>

  <div class="dw-section">
    <div class="dw-label">Outreach</div>
    <div class="tabbar">
      <button data-dtab="email" class="${drawerTab === "email" ? "active" : ""}">Email</button>
      <button data-dtab="dm" class="${drawerTab === "dm" ? "active" : ""}">DM</button>
      <button data-dtab="call" class="${drawerTab === "call" ? "active" : ""}">Call script</button>
    </div>
    ${
      drawerTab === "email"
        ? `<div class="mono" style="margin-bottom:6px">Subject: ${h(l.outreach?.emailSubject || "")}</div><div class="copybox">${h(l.outreach?.emailBody || "")}</div>`
        : drawerTab === "dm"
          ? `<div class="copybox">${h(l.outreach?.dm || "")}</div>`
          : `<div class="copybox">${h(l.outreach?.callScript || "")}</div>`
    }
    <div class="dw-actions">
      <button class="btn subtle sm" id="dwCopy">Copy ${drawerTab}</button>
      <button class="btn subtle sm" id="dwMail">Open mail app</button>
      <button class="btn subtle sm" id="dwSource">Open source ↗</button>
    </div>
  </div>

  <div class="dw-section">
    <div class="dw-label">Contact route</div>
    <div class="dw-box">
      ${c.phone ? `<div>📞 <a href="tel:${h(c.phone)}">${h(c.phone)}</a></div>` : ""}
      ${c.email ? `<div>✉️ <a href="mailto:${h(c.email)}">${h(c.email)}</a></div>` : ""}
      ${c.website ? `<div>🌐 <a href="${h(c.website)}" target="_blank" rel="noopener">${h(c.website.replace(/^https?:\/\//, ""))}</a></div>` : ""}
      ${c.lookup ? `<div>🔎 <a href="${h(c.lookup)}" target="_blank" rel="noopener">Find phone &amp; hours →</a></div>` : ""}
      ${c.address ? `<div style="color:var(--dim)">📍 ${h(c.address)}</div>` : ""}
      <div style="color:var(--muted);margin-top:6px">${h(c.route || "")}</div>
    </div>
  </div>

  <div class="dw-section">
    <div class="dw-label">Verification <span class="mono">${ver.score || 0}%</span></div>
    ${(ver.checks || [])
      .map(
        (chk) => `<div class="check ${chk.pass ? "pass" : "fail"}"><span class="ic">${chk.pass ? "✓" : "!"}</span><span>${h(chk.label)}${chk.note ? ` — <span style="color:var(--dim)">${h(chk.note)}</span>` : ""}</span></div>`
      )
      .join("")}
    <p class="hint" style="margin-top:8px">${h(ver.disclaimer || "")}</p>
    ${l.researcherNote ? `<div class="dw-box quote" style="margin-top:10px"><span class="mono" style="display:block;margin-bottom:4px">Researcher note — not the client's words</span>${h(l.researcherNote).slice(0, 500)}</div>` : ""}
  </div>

  <div class="dw-section">
    <div class="dw-label">Pipeline status</div>
    <div class="row">
      <select class="status-select" id="dwStatus">
        ${STATUSES.map((s) => `<option value="${s}" ${s === status ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}
      </select>
      <span class="mono">${h(l.sourceUrl).slice(0, 46)}</span>
    </div>
  </div>`;

  $("#dwClose").onclick = closeDrawer;
  $$("[data-dtab]").forEach((b) => {
    b.onclick = () => {
      drawerTab = b.dataset.dtab;
      renderDrawer();
    };
  });
  $("#dwCopy").onclick = () => copy(copyTarget[drawerTab] || "", "Copied");
  $("#dwSource").onclick = () => window.open(l.sourceUrl, "_blank", "noopener");
  $("#dwMail").onclick = () => {
    const to = l.contact?.email || "";
    const subject = encodeURIComponent(l.outreach?.emailSubject || "");
    const body = encodeURIComponent(l.outreach?.emailBody || copyTarget.email);
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };
  $("#dwStatus").onchange = (e) => {
    setStatus(l.id, e.target.value);
    renderKanban();
  };
}

function daysAgo(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 864e5));
}

/* ------------------------------------------------------------------ */
/* pipeline                                                           */
/* ------------------------------------------------------------------ */

function setStatus(id, status) {
  S.status[id] = status;
  save(LS.status, S.status);
  if (S.saved[id]) S.saved[id].status = status;
  renderSavedCount();
  toast(`${STATUS_LABEL[status]} · saved`);
}

function renderSavedCount() {
  const n = Object.keys(S.saved).length;
  $("#savedCount").textContent = n;
  const active = allSavedLeads().filter((l) => ["contacted", "replied"].includes(S.status[l.id] || "new")).length;
  const badge = $("#navPipeCount");
  badge.hidden = active === 0;
  badge.textContent = active;
}

function renderKanban() {
  const leads = allSavedLeads();
  const by = { new: [], contacted: [], replied: [], won: [], lost: [] };
  for (const l of leads) (by[S.status[l.id] || "new"] || by.new).push(l);
  const value = (arr) => arr.reduce((s, l) => s + mid(l.proposal?.price), 0);

  $("#kanban").innerHTML = STATUSES.map(
    (st) => `<div class="col" data-status="${st}">
      <div class="col-head"><span>${STATUS_LABEL[st]}</span><b>${by[st].length} · ${usd(value(by[st]))}</b></div>
      ${by[st]
        .sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0))
        .map(
          (l) => `<div class="kcard" draggable="true" data-id="${h(l.id)}">
            <div class="n">${h(l.name)}</div>
            <div class="m">${flag(l.country)} ${h(l.city || l.country)} · ${h(sourceLabel(l.source))} · ${l.score?.band}</div>
            <div class="v">${usd(l.proposal?.price?.[0] || 0)}–${usd(l.proposal?.price?.[1] || 0)}</div>
          </div>`
        )
        .join("") || `<div class="col-empty">Drop leads here</div>`}
    </div>`
  ).join("");

  $$(".kcard").forEach((card) => {
    const lead = S.saved[card.dataset.id];
    card.addEventListener("click", () => lead && openDrawer(lead));
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", card.dataset.id);
      e.dataTransfer.effectAllowed = "move";
    });
  });

  $$(".col").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drag");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drag"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drag");
      const id = e.dataTransfer.getData("text/plain");
      if (!id) return;
      setStatus(id, col.dataset.status);
      renderKanban();
    });
  });
}

/* ------------------------------------------------------------------ */
/* settings — models & API                                            */
/* ------------------------------------------------------------------ */

const PROVIDERS = [
  { id: "custom", label: "Custom", baseUrl: "", model: "" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "o4-mini"], keyPrefix: ["sk-proj-", "sk-svcacct-"] },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-v4.1-flash", models: ["deepseek/deepseek-v4.1-flash", "openai/gpt-4o-mini", "anthropic/claude-3.7-sonnet"], keyPrefix: ["sk-or-v1-"] },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"], keyPrefix: ["gsk_"] },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", models: ["deepseek-flash", "deepseek-v4-pro"], keyPrefix: ["sk-"] },
  { id: "nvidia", label: "NVIDIA NIM (free tier)", baseUrl: "https://integrate.api.nvidia.com/v1", model: "deepseek-ai/deepseek-v4.1-flash", models: ["deepseek-ai/deepseek-v4.1-flash"], keyPrefix: ["nvapi-"] },
  { id: "together", label: "Together", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"] },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1", models: ["llama3.1", "qwen2.5", "mistral"] },
];

const models = () => S.models || [];
const defaultModel = () => models().find((m) => m.isDefault) || models()[0] || null;
const persistModels = () => save(LS.models, S.models);

function renderModels() {
  const el = $("#modelList");
  const list = models();
  $("#noModels").hidden = list.length > 0;
  el.innerHTML = list
    .map(
      (m) => `<div class="model-card ${m.isDefault ? "is-default" : ""}" data-id="${h(m.id)}">
        <div class="mc-icon">◈</div>
        <div class="mc-main">
          <b>${h(m.displayName || m.model)}</b>${m.isDefault ? `<span class="badge-default">default</span>` : ""}
          <span class="mc-sub">${h(m.model)} · ${h(m.baseUrl)}</span>
        </div>
        <div class="mc-actions">
          ${m.isDefault ? "" : `<button class="mini" data-act="default">Set default</button>`}
          <button class="mini" data-act="edit">Edit</button>
          <button class="mini" data-act="del">Delete</button>
        </div>
      </div>`
    )
    .join("");
  $$(".model-card [data-act]", el).forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.closest(".model-card").dataset.id;
      if (b.dataset.act === "edit") openModelModal(id);
      if (b.dataset.act === "del") deleteModel(id);
      if (b.dataset.act === "default") setDefaultModel(id);
    })
  );
}

function setDefaultModel(id) {
  S.models = models().map((m) => ({ ...m, isDefault: m.id === id }));
  persistModels();
  renderModels();
  paintKeyDots();
  toast("Default model set");
}

function deleteModel(id) {
  const wasDefault = models().find((m) => m.id === id)?.isDefault;
  S.models = models().filter((m) => m.id !== id);
  if (wasDefault && S.models.length) S.models[0].isDefault = true;
  persistModels();
  renderModels();
  paintKeyDots();
  toast("Model removed");
}

function setTestState(state, msg) {
  const dot = $("#mDot");
  const text = $("#mTestMsg");
  dot.className = "test-dot" + (state === "ok" ? " ok" : state === "err" ? " err" : state === "busy" ? " busy" : "");
  text.className = "test-msg" + (state === "ok" ? " ok" : state === "err" ? " err" : "");
  text.textContent = msg;
}

function openModelModal(id) {
  S.editingModel = id || null;
  const m = id ? models().find((x) => x.id === id) : null;
  $("#modelTitle").textContent = m ? "Edit model" : "Add model";
  $("#mAdd").textContent = m ? "Save" : "Add";
  $("#mProvider").innerHTML = PROVIDERS.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  $("#mProvider").value = m?.provider || "custom";
  $("#mModel").value = m?.model || "";
  $("#mName").value = m?.displayName || "";
  $("#mKey").value = m?.apiKey || "";
  $("#mKey").type = "password";
  $("#mBase").value = m?.baseUrl || "";
  $("#mContext").value = m?.contextWindow || 200000;
  $("#mMax").value = m?.maxOutput || 32000;
  applyProviderDefaults(false);
  setTestState("idle", "Sends a real request using the current config to verify the endpoint.");
  $("#mHint").hidden = true;
  setBaseNote("");
  checkBaseMismatch();
  $("#modelModal").hidden = false;
  $("#modelBackdrop").hidden = false;
  setTimeout(() => $("#mModel").focus(), 60);
}

function closeModelModal() {
  $("#modelModal").hidden = true;
  $("#modelBackdrop").hidden = true;
  S.editingModel = null;
}

function applyProviderDefaults(force) {
  const p = PROVIDERS.find((x) => x.id === $("#mProvider").value);
  if (!p) return;
  $("#mSuggest").innerHTML = (p.models || []).map((x) => `<option value="${h(x)}"></option>`).join("");
  if (p.baseUrl && (force || !$("#mBase").value.trim())) $("#mBase").value = p.baseUrl;
  if (p.model && (force || !$("#mModel").value.trim())) $("#mModel").value = p.model;
  if (p.id !== "custom" && (force || !$("#mName").value.trim())) $("#mName").value = p.label;
}

function setBaseNote(msg, tone = "info") {
  const el = $("#mBaseNote");
  el.hidden = !msg;
  el.textContent = msg || "";
  el.className = "form-note" + (tone === "warn" ? " warn" : "");
}

function detectProviderFromKey(raw) {
  const k = String(raw || "").trim();
  if (!k) return null;
  if (k.startsWith("sk-or-v1-")) return "openrouter";
  if (k.startsWith("nvapi-")) return "nvidia";
  if (k.startsWith("gsk_")) return "groq";
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("sk-proj-") || k.startsWith("sk-svcacct-")) return "openai";
  return null;
}

/** Warn when the key's provider and the Base URL disagree — the #1 cause of 401s. */
function checkBaseMismatch() {
  const p = PROVIDERS.find((x) => x.id === $("#mProvider").value);
  const base = $("#mBase").value.trim();
  if (!base) return setBaseNote("");
  try {
    const got = new URL(base).host;
    if (p?.baseUrl) {
      const want = new URL(p.baseUrl).host;
      if (got !== want) {
        return setBaseNote(`${p.label} ka base URL ${want} hai. Key usi provider ki honi chahiye, warna 401 aayega.`, "warn");
      }
    }
    const model = $("#mModel").value.trim();
    if (model.includes("/") && ["deepseek", "openai", "groq", "ollama"].includes(p?.id)) {
      return setBaseNote(`"${model}" prefix wala model ID ${p.label} ke official API par nahi hota — ye OpenRouter ya NVIDIA jaisa gateway lagta hai.`, "warn");
    }
    setBaseNote("");
  } catch {
    setBaseNote("Base URL valid URL nahi lag raha.", "warn");
  }
}

function onKeyPasted() {
  const p = detectProviderFromKey($("#mKey").value);
  if (!p) return;
  if (p === "anthropic") {
    return setBaseNote("Ye Anthropic key lagti hai. Anthropic API OpenAI-compatible nahi hai, is tool mein use nahi hogi.", "warn");
  }
  const preset = PROVIDERS.find((x) => x.id === p);
  if (!preset) return;
  if ($("#mProvider").value !== p) {
    $("#mProvider").value = p;
    applyProviderDefaults(true);
    setBaseNote(`${preset.label} key detect hui — provider aur Base URL set kar diya.`);
  }
}

function readModelForm() {
  return {
    provider: $("#mProvider").value,
    model: $("#mModel").value.trim(),
    displayName: $("#mName").value.trim(),
    baseUrl: $("#mBase").value.trim().replace(/\/+$/, ""),
    apiKey: $("#mKey").value.trim(),
    protocol: $("#mProtocol").value,
    contextWindow: Number($("#mContext").value) || 200000,
    maxOutput: Number($("#mMax").value) || 32000,
  };
}

async function testModelConfig() {
  const cfg = readModelForm();
  if (!cfg.model) return setTestState("err", "Model ID chahiye — e.g. gpt-4o-mini");
  if (!/^https?:\/\//.test(cfg.baseUrl)) return setTestState("err", "Base URL http(s):// se shuru hona chahiye");
  setTestState("busy", "Sending a real request to the endpoint…");
  const t0 = Date.now();
  try {
    const r = await fetch("/api/test-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    const d = await r.json();
    if (d.ok) {
      $("#mHint").hidden = true;
      setTestState("ok", `Connected in ${d.ms || Date.now() - t0}ms · replied "${d.reply || "ok"}"`);
    } else {
      setTestState("err", d.error || "Connection failed");
      const hintEl = $("#mHint");
      hintEl.hidden = !d.hint;
      hintEl.textContent = d.hint || "";
    }
  } catch (e) {
    setTestState("err", "Request failed: " + e.message);
  }
}

function saveModel() {
  const cfg = readModelForm();
  if (!cfg.model) return setTestState("err", "Model ID chahiye — e.g. gpt-4o-mini");
  if (!/^https?:\/\//.test(cfg.baseUrl)) return setTestState("err", "Base URL http(s):// se shuru hona chahiye");
  if (S.editingModel) {
    S.models = models().map((m) => (m.id === S.editingModel ? { ...m, ...cfg } : m));
  } else {
    const isFirst = models().length === 0;
    S.models = [...models(), { ...cfg, id: "m_" + Math.random().toString(36).slice(2, 8), isDefault: isFirst }];
  }
  persistModels();
  renderModels();
  paintKeyDots();
  const edited = Boolean(S.editingModel);
  closeModelModal();
  toast(edited ? "Model updated" : "Model added");
}

function bindSettings() {
  $("#keyGoogle").value = S.keys.google || "";
  $("#keySerper").value = S.keys.serper || "";
  $("#keyTavily").value = S.keys.tavily || "";
  ["#keyGoogle", "#keySerper", "#keyTavily"].forEach((sel) => $(sel).addEventListener("change", collectKeys));

  $("#addModelBtn").onclick = () => openModelModal();
  $("#modelClose").onclick = closeModelModal;
  $("#mCancel").onclick = closeModelModal;
  $("#modelBackdrop").onclick = closeModelModal;
  $("#mAdd").onclick = saveModel;
  $("#mTest").onclick = testModelConfig;
  $("#mProvider").onchange = () => {
    applyProviderDefaults(true);
    checkBaseMismatch();
  };
  $("#mBase").addEventListener("change", checkBaseMismatch);
  $("#mModel").addEventListener("change", checkBaseMismatch);
  $("#mKey").addEventListener("change", onKeyPasted);
  $("#mEye").onclick = () => {
    const i = $("#mKey");
    i.type = i.type === "password" ? "text" : "password";
  };

  $("#testKeys").onclick = async () => {
    collectKeys();
    const box = $("#testResults");
    const dm = defaultModel();
    box.innerHTML = `<div class="tr"><span class="st">…</span><span class="d">Calling each provider…</span></div>`;
    try {
      const r = await fetch("/api/test-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: {
            ...S.keys,
            llm: dm?.apiKey ? { apiKey: dm.apiKey, baseUrl: dm.baseUrl, model: dm.model } : null,
          },
        }),
      });
      const data = await r.json();
      box.innerHTML = data.tests
        .map((t) => `<div class="tr ${t.status}"><span class="st">${t.status}</span><span class="d"><b>${h(t.name)}</b> · ${h(t.detail)}</span></div>`)
        .join("");
      paintKeyDots();
    } catch (e) {
      box.innerHTML = `<div class="tr error"><span class="st">error</span><span class="d">${h(e.message)}</span></div>`;
    }
  };

  $("#clearKeys").onclick = () => {
    S.keys = { google: "", serper: "", tavily: "" };
    S.models = [];
    save(LS.keys, S.keys);
    persistModels();
    bindSettings();
    renderModels();
    paintKeyDots();
    $("#testResults").innerHTML = "";
    toast("Keys and models cleared from this browser");
  };
}

function collectKeys() {
  S.keys = {
    google: $("#keyGoogle").value.trim(),
    serper: $("#keySerper").value.trim(),
    tavily: $("#keyTavily").value.trim(),
  };
  save(LS.keys, S.keys);
  paintKeyDots();
}

function paintKeyDots() {
  const on = { google: !!S.keys.google, search: !!(S.keys.serper || S.keys.tavily), llm: !!defaultModel()?.apiKey };
  $$("#keyMini .dot").forEach((d) => d.classList.toggle("on", !!on[d.dataset.k]));
}

function openImportModal() {
  const markets = S.catalog.markets || [];
  $("#iText").value = "";
  $("#iCount").hidden = true;
  $("#iUrl").value = "";
  $("#iName").value = "";
  $("#iPlatform").value = "";
  $("#iCountry").innerHTML = markets.map((m) => `<option value="${m.id}">${m.flag} ${h(m.label)}</option>`).join("");
  $("#iCountry").value = S.cfg.country || "US";
  $("#iError").hidden = true;
  $("#importModal").hidden = false;
  $("#importBackdrop").hidden = false;
  setTimeout(() => $("#iText").focus(), 60);
}

function closeImportModal() {
  $("#importModal").hidden = true;
  $("#importBackdrop").hidden = true;
}

function importParts() {
  return $("#iText")
    .value.split(/^\s*-{3,}\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30)
    .slice(0, 10);
}

function updateImportCount() {
  const n = importParts().length;
  const el = $("#iCount");
  el.textContent = n > 1 ? `${n} posts detected — ek saath ${n} leads ban jayenge` : "";
  el.hidden = n <= 1;
}

async function submitImport() {
  const err = $("#iError");
  const parts = importParts();
  if (!parts.length) {
    err.hidden = false;
    err.textContent = "Post ka thoda zyada text paste karo (kam se kam do line).";
    return;
  }

  $("#importSave").disabled = true;
  const base = {
    url: $("#iUrl").value.trim(),
    name: $("#iName").value.trim(),
    platform: $("#iPlatform").value.trim(),
    country: $("#iCountry").value,
    service: S.cfg.service,
    vertical: S.cfg.vertical,
  };

  const added = [];
  try {
    for (const [i, text] of parts.entries()) {
      const r = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Link/name only apply to the first post; the rest carry their own text.
        body: JSON.stringify({ ...base, url: i === 0 ? base.url : "", name: i === 0 ? base.name : "", text }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Import failed");
      added.push(data.lead);
    }

    S.leads = [...added, ...S.leads];
    for (const lead of added) S.saved[lead.id] = lead;
    save(LS.saved, S.saved);
    S.tab = "run";
    $$("#boardTabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === "run"));
    renderSavedCount();
    showResults();
    closeImportModal();
    toast(added.length > 1 ? `${added.length} leads added` : `Lead added · ${added[0].score.band} (${added[0].score.total})`);
    openDrawer(added[0]);
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
  } finally {
    $("#importSave").disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* seeds + export                                                     */
/* ------------------------------------------------------------------ */

async function loadSeeds() {
  try {
    const r = await fetch("/api/seed");
    const { leads } = await r.json();
    if (!leads?.length) return toast("No seed file found (data/seed-leads.json)");
    const normalized = leads.map(normalizeSeed);
    S.leads = normalized.slice();
    for (const l of normalized) S.saved[l.id] = l;
    save(LS.saved, S.saved);
    S.tab = "run";
    $$("#boardTabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === "run"));
    renderSavedCount();
    showResults();
    toast(`${normalized.length} research leads loaded`);
  } catch (e) {
    toast("Could not load seeds: " + e.message);
  }
}

function normalizeSeed(l) {
  const price = l.proposal?.price || [800, 3000];
  const total = l.score?.total ?? 55;
  return {
    id: l.id || "seed_" + Math.random().toString(36).slice(2, 9),
    name: l.name || "Unknown",
    kind: l.kind || "post",
    country: l.country || "US",
    city: l.city || "",
    verticalLabel: l.verticalLabel || "Business",
    verticalHook: l.verticalHook || "new customers",
    source: l.source || "web",
    sourceUrl: l.sourceUrl || "",
    postedAt: l.postedAt || null,
    fetchedAt: l.fetchedAt || new Date().toISOString(),
    budgetHints: l.budgetHints || [],
    need: l.need || { summary: "", evidence: "", signals: [] },
    contact: l.contact || {},
    score: { total, band: l.score?.band || (total >= 72 ? "A" : total >= 52 ? "B" : "C"), breakdown: l.score?.breakdown || {}, notes: l.score?.notes || [] },
    service: l.service || "website",
    proposal: {
      build: l.proposal?.build || "",
      why: l.proposal?.why || "",
      stack: l.proposal?.stack || [],
      mvpWeeks: l.proposal?.mvpWeeks || [1, 2],
      price,
      upsell: l.proposal?.upsell || "",
      by: l.proposal?.by || "seed",
    },
    outreach: {
      emailSubject: l.outreach?.emailSubject || "",
      emailBody: l.outreach?.emailBody || "",
      dm: l.outreach?.dm || "",
      callScript: l.outreach?.callScript || "",
    },
    verification: l.verification || {
      ok: true,
      score: 80,
      checks: [
        { label: "Source link", pass: /^https?:\/\//.test(l.sourceUrl || ""), note: "" },
        { label: "Date", pass: !!l.postedAt, note: "" },
        { label: "Contact route", pass: !!(l.contact?.email || l.contact?.url || l.contact?.phone), note: "" },
      ],
      disclaimer: "Research seed — open the link and re-read the original post before contacting.",
    },
  };
}

function exportCsv(rows) {
  if (!rows?.length) return toast("Nothing to export yet");
  const cols = [
    ["name", (l) => l.name],
    ["grade", (l) => l.score?.band],
    ["score", (l) => l.score?.total],
    ["country", (l) => l.country],
    ["city", (l) => l.city],
    ["source", (l) => sourceLabel(l.source)],
    ["need", (l) => l.need?.summary],
    ["build", (l) => l.proposal?.build],
    ["price_low_usd", (l) => l.proposal?.price?.[0]],
    ["price_high_usd", (l) => l.proposal?.price?.[1]],
    ["phone", (l) => l.contact?.phone],
    ["email", (l) => l.contact?.email],
    ["website", (l) => l.contact?.website],
    ["source_url", (l) => l.sourceUrl],
    ["posted_at", (l) => l.postedAt],
    ["status", (l) => S.status[l.id] || "new"],
  ];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
  const csv = [cols.map((c) => c[0]).join(","), ...rows.map((l) => cols.map((c) => esc(c[1](l))).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leadscout-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`${rows.length} leads exported`);
}

/* ------------------------------------------------------------------ */
/* misc                                                               */
/* ------------------------------------------------------------------ */

async function copy(text, msg = "Copied") {
  if (!text) return toast("Nothing to copy");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(msg);
}

let toastTimer;
function toast(msg) {
  const wrap = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  wrap.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

$("#drawerBackdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

boot();
