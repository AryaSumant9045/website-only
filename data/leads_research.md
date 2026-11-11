# Client-demand lead research — run of 2026-11-11

**Deliverable:** `data/leads_raw.json` — 33 leads, all opened and read on this run. No entry is inferred from a search snippet.

---

## 1. How I searched

### Sources that worked

| Source | Route actually used | Volume read | Kept |
|---|---|---|---|
| Reddit r/forhire | `www.reddit.com/r/forhire/new/.rss?limit=100` and `/top/.rss?t=month&limit=100`, then each post's `…/comments/<id>/.rss` for the body | 200 feed entries (2026-10-12 → 2026-11-11), 60 unique flaired `[Hiring]`, 8 full post bodies | 7 |
| Reddit r/Programmers_forhire | `/new/.rss?limit=100` | 100 entries | 1 |
| Reddit r/SaaS, r/startups, r/smallbusiness, r/Entrepreneur, r/webdev, r/SideProject, r/jobbit, r/hiring, r/VancouverStartup | `/new/.rss?limit=100` each | ~1,000 titles | 0 (all supply-side or co-founder/equity asks) |
| Hacker News | Algolia `search_by_date` + `items/50338744` | Nov 2026 "Freelancer? Seeking freelancer?" thread, 16 comments | 0 — see finding below |
| Freelancer.com | `/jobs/<category>/?sort=latest` for ai-agents, ai-app-development, ai-integration, web-application, app-development, website-design, full-stack-development, then each project page | 239 listing cards → 55 project pages opened → 52 parsed | 18 |
| PeoplePerHour | `/freelance-jobs` + technology-programming, artificial-intelligence, web-development, software-development | 57 unique projects (posted_dt, budget, client country, proposal count) | 8 |
| Craigslist (NYC, SF, LA, Chicago, Austin, Seattle — `cpg` + `?query=website` on `ggg`) | HTML is JS-only; item bodies only readable through the `r.jina.ai` reader proxy | ~630 listings across 9 pages | 0 |

### Queries used
- `https://www.reddit.com/r/forhire/new/.rss?limit=100`
- `https://www.reddit.com/r/forhire/top/.rss?t=month&limit=100`
- `https://www.reddit.com/r/<sub>/new/.rss?limit=100` for the 10 subreddits above
- `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=Freelancer?%20Seeking%20freelancer`
- `https://hn.algolia.com/api/v1/items/50338744`
- `https://www.freelancer.com/jobs/{ai-agents,ai-app-development,ai-integration,web-application,app-development,website-design,full-stack-development}/?sort=latest`
- `https://www.peopleperhour.com/freelance-jobs/{technology-programming,artificial-intelligence,technology-programming/web-development,technology-programming/software-development}`
- Craigslist: `{newyork,sfbay,losangeles,chicago,austin,seattle}.craigslist.org/search/cpg` and `/search/ggg?query=website`
- Web search (discovery only): `site:reddit.com "looking for a developer" OR "need a developer" to build app 2026`, `site:reddit.com r/smallbusiness OR r/Entrepreneur "willing to pay" developer website build`

### Sources that were blocked
- **Reddit JSON API** — `www.reddit.com/...json`, `api.reddit.com/...`, `old.reddit.com/...json` all return **HTTP 403** (or a 302 to a "Welcome to Reddit" interstitial) from this network. `.rss` endpoints are open but rate-limit hard: ~2 of every 3 requests returned **429** and needed 3–4 retries with 6–15 s backoff.
- **Reddit search feeds** — `r/forhire/search.rss?q=flair:Hiring` returns **403** every time, so I could not filter by flair server-side. I had to pull whole `/new` and `/top` feeds and filter titles myself. This is why the Reddit sample is time-bounded rather than query-targeted.
- **Upwork** — **403 / Cloudflare** ("Just a moment", Ray ID logged), both direct and through a reader proxy.
- **Craigslist** — search HTML renders empty (`<main>` filled by JS), `?format=rss` returns **403**, and `sapi.craigslist.org` returns **400** (`searchFull parameter batch=… failed check 'is_search_batch_params'` — signed batch required).
- **Indie Hackers, Product Hunt** — **403 Cloudflare**.
- **Bluesky public search API** (`public.api.bsky.app`) — **403**.
- **Web search as a date source** — the engine returns mostly stale/deduped Reddit threads (some from 2024) even with a `week` freshness hint, so I used it only to discover subreddit names, never as evidence of a post's existence or date.

---

## 2. What I found

**33 leads: 28 A, 2 B, 3 C.** By country: UK 9, US 8, unknown 6, India 4, Canada 2, Netherlands 2, Australia 1, Colombia 1. Dates run 2026-10-12 → 2026-11-11; nothing older than 30 days.

Grade definitions were applied as specified: **A** = explicit ask with a stated budget or urgency, **B** = explicit ask with no budget, **C** = weak/inferred. Note that this makes A the *modal* grade here — every marketplace post carries a budget bracket, so **A is not a quality ranking**. Use the bid counts, payment-verified flags and the top-5 list below for quality.

### Findings that matter more than the list

1. **Hacker News had zero client-side demand this month.** The November 2026 "Freelancer? Seeking freelancer?" thread (id 50338744, posted 2026-11-02) contains 15 top-level comments — **all 15 are `SEEKING WORK`**, not one `SEEKING FREELANCER`. This is an empty result, not a failure to look: the October thread (49922572) has 22 comments but is 41 days old and outside the window.
2. **r/forhire's `[Hiring]` flair is mostly not dev work.** The two feeds yielded **60 unique** `[Hiring]`-flaired posts across the month; the overwhelming majority were video editors, UGC creators, VAs, content writers and one-off local tasks. Only 7 were software/AI-relevant.
3. **US supply is genuinely thinner than the brief assumes.** US-specific boards that would carry most US demand (Upwork, LinkedIn, Indeed) are login- or Cloudflare-walled. On the open boards, US clients were ~13% of Freelancer postings and ~7% of PeoplePerHour. The US share above (8) is the ceiling of what was publicly readable, not a sampling choice. Six further leads are country-**unknown** because the Reddit posters did not state a location — Reddit skews US, so the true US count is probably 10–14.
4. **PeoplePerHour is the UK channel, and its budgets are real.** I opened one PpH project page to confirm the listing's `budget` field: it renders as "£2,000 fixed price (negotiable)" with named milestone dates, matching the API value exactly. PpH budgets are trustworthy; its proposal counts are brutal (60–90 on most posts).
5. **Craigslist computer-gigs is a dead channel for dev work.** Across ~630 listings in 6 metros, the boards were dominated by paid research studies, "get paid to post online" and AI-rater spam. The handful of genuine web gigs were sellers advertising themselves ("Website Design & Marketing | $800") or >14 days old. I found nothing that met the 30-day + genuine-ask bar.
6. **"Fix my AI-built app" is now a repeating demand pattern** — two separate leads this run describe a vibe-coded site that needs cleanup and a production rebuild (u/Fatsquirrel666 on r/forhire; the One Bottle Street prototype on PpH). Worth productising.

### What I could NOT verify
- **Country** for 6 leads (all Reddit): posters did not state a location.
- **Final price** on Freelancer.com: those figures are client-selected *brackets*, and the site displays them in a geo-converted currency (a US client's post shows EUR; another shows CAD). Treat them as ranges, not quotes.
- **Whether each post is still open** at your read time: marketplace projects expire (Freelancer runs ~7 days, several expire 2026-11-12 → 11-18), Reddit posts get closed or edited.
- **Credit-worthiness**: Freelancer's `paymentVerified` flag is recorded per lead in `notes`, but "unverified" does not mean "won't pay", and "verified" does not mean "pays well".
- **Contact emails**: none are public. Every route is a Reddit DM/comment or a marketplace proposal form.
- **HN October thread** (22 comments, possibly containing a client ask) — outside the 30-day window, deliberately not mined.

---

## 3. Five strongest leads

1. **AI-Powered Construction Planning Software** — Australian construction firm — **A$10,000–20,000**, payment verified, **0 proposals** when checked on 2026-11-11.
   https://www.freelancer.com/projects/dot-net/powered-construction-planning-software
   *Why:* the best money-to-competition ratio in the entire set. AI-assisted scheduling plus planned-vs-actual cost tracking is a well-bounded build, and being first to bid on a verified-payment client is worth more than any US-labelled lead with 20 bids.

2. **One, Bottle Street — whisky/rum price comparison site** (UK) — **£2,000 fixed, milestone-based**, live by 1 Feb 2027.
   https://www.peopleperhour.com/freelance-jobs/technology-programming/website-development/developer-to-finish-and-launch-a-uk-price-comparison-website-4530400
   *Why:* the most professional brief I read — a working AI-built prototype, named milestones (15 Dec / 15 Jan / 1 Feb), 30/30/40 payment proposal, hosting in the client's name, UK-hours overlap requested. It is a "take this prototype to production" job, which is exactly the AI-era skill premium.

3. **TrueMarch** (US, applied AI / decentralised infra) — **ongoing contract**, full-stack TypeScript/Node/React plus LLM features (RAG, tool use, agents), long-term possible. Only **9 proposals**.
   https://www.freelancer.com/projects/full-stack-development/full-stack-developer-needed-40812681
   *Why:* USD-paying, recurring rather than one-off, US client, and unusually low competition for an AI-engineering brief. Caveat: payment not verified on the profile.

4. **GigResource — responsive UI refinement** (US, payment verified) — **$250–750**, only **2 proposals**.
   https://www.freelancer.com/projects/web-design/gigresource-responsive-design-refinement
   *Why:* cheapest possible proof of the "I only need it polished, not rebuilt" demand, with almost no competition. Low value on its own, but a fast first US review and a likely follow-on.

5. **AI Developer — CV writing / career assessment platform** (UK) — **£15,000**, the largest UK budget found (57 proposals).
   https://www.peopleperhour.com/freelance-jobs/artificial-intelligence/artificial-intelligence-website-development/ai-developer-cv-writing-career-assessment-document-intellig-4529441
   *Why:* real budget, real business, and a document-intelligence scope that maps directly onto LLM pipeline work. Crowded, so it needs a differentiated pitch (show a working CV-parsing demo, not a proposal).

**Runner-up:** **PULP** (independent animation streaming platform, $1,500 fixed, explicitly "No AI") — a clean, honest brief from an organisation with a 50k audience; small money, but the kind of reference client that compounds. https://www.reddit.com/r/forhire/comments/1x4axyt/hiring_fullstack_developer_for_independent/

---

## 4. Practical notes for acting on this

- **Order of attack:** bid the 0–2-proposal Freelancer posts (Construction, GigResource, TrueMarch) *today* — they close within days. Then the PpH £2,000 and £15,000 briefs, which are slower-moving.
- **Reddit leads need speed, not polish:** reply within hours with the specific fix and a price; those threads get 20–60 replies.
- **Re-run cadence:** Reddit `.rss` only exposes the newest 100 posts (~3.5 days for r/forhire), so a weekly pull is required to avoid blind spots. HN's next "Freelancer?" thread lands ~1 Dec 2026; that is the moment to check for `SEEKING FREELANCER` comments.
- **If US volume is the priority**, the blocked channels (Upwork, LinkedIn) are where it lives; this run's ceiling of 8 verified-US leads is a limit of public read access, not of the market.
