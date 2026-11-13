# LeadScout 2.0 — multi-agent client finder

Client dhoondhne ka tool, tumhare liye banaya: **8 agents** chalte hain, result mein tumhe
lead + "kya banana hai" + USD price + pehla message milta hai. Zero dependencies — sirf
Node chahiye.

```bash
cd LeadScout
node server.mjs
# browser: http://127.0.0.1:8787
```

Pehli baar khologe to **"Load research seeds"** dabao — 11 Nov 2026 ke research se 40 real
leads already loaded hain (Freelancer, PeoplePerHour, Reddit, OpenStreetMap), har ek ke
saath asli link aur date.

---

## Agents kaam kaise karte hain

| Agent | Kaam |
|---|---|
| **Planner** | Tumhara offer + market dekh kar search plan banata hai |
| **Maps Scout** | OpenStreetMap se **no-website businesses** dhoondta hai, phir Google Places se unka **phone + rating** add karta hai. (Google ke top-20 results mein ~100% businesses ke paas site hoti hai — isliye discovery OSM se, phone Google se.) |
| **Demand Scout** | Public "mujhe ye banwana hai" posts: Reddit (JSON → RSS fallback), Freelancer.com API, Serper/Tavily se LinkedIn/Instagram/X results |
| **Site Auditor** | Har website kholta hai — HTTP status, HTTPS, load time, page size, mobile viewport, platform — aur uski site se **email** nikalta hai |
| **Signal Analyst** | Duplicate hatata hai, relevance check karta hai, A/B/C grade deta hai |
| **Strategist** | Decide karta hai kya banana hai, kitne hafte, USD price (client ka budget diya ho to usi ke hisaab se) |
| **Outreach Writer** | Email + DM + call script likhta hai |
| **Verifier** | Har lead ka link, date aur contact check karta hai; jhoothi lead drop |

Grade ka matlab:

- **A** = aaj hi contact kar sakte ho (phone/email ya live brief)
- **B** = warm, pehle thoda research karo
- **C** = dekh lo, par bhaav mat do

Score black box nahi hai — har card ke andar breakdown dikhta hai (intent / budget / recency /
market / fit / contactability).

---

## Keys: kya chahiye, kya nahi

**Zero keys par bhi chalta hai** — OpenStreetMap + Freelancer API + Reddit (tumhare ghar ke
internet se) + templates. Bas pitches thodi generic hoti hain.

| Key | Kya khulta hai | Cost |
|---|---|---|
| **Google Places** | Maps Scout ka full version — phone number, rating, review count | ~$0.032 per call; ek Balanced run = 2–4 calls |
| **Serper.dev** | LinkedIn / Instagram / X ke **public posts** search results ke through | 2,500 free credits, phir ~$0.001/search |
| **Tavily** | Serper ka alternative (jo bhi key ho, wahi use hoti hai) | free tier available |
| **LLM** (OpenAI / OpenRouter / Groq / DeepSeek / Ollama) | Pitch + outreach tumhare jaise likhe hue | ~$0.01 per run on gpt-4o-mini |

**Apna custom model add karna:** Settings → **Models & API** → **+ Add model** → Provider (Custom ya preset),
Model ID, Base URL, API key → **Connectivity test** (real request bhej kar check karta hai) → **Add**.
Ek se zyada model save kar sakte ho; jo **default** hai wahi run mein use hoga.

Keys **sirf tumhare browser mein** rehti hain (localStorage), har run par local server ko
jaati hain, disk par nahi likhi jaati. Settings → **Test keys** se ek-ek key check kar lo.

Google key banate waqt usko **Places API (New)** tak restrict karo aur daily quota laga do.

---

## Markets (sab USD mein)

12 markets. Sab quote **USD** mein, chahe client AUD/AED/CHF mein budget de.

| Market | Factor | Cities |
|---|---|---|
| 🇺🇸 USA | 100% | 30 — Austin, Miami, Dallas, Houston, LA, San Diego, SF, San Jose, NYC, Chicago, Seattle, Denver, Atlanta, Phoenix, Boston, DC, Philadelphia, Nashville, Charlotte, Tampa, Orlando, Las Vegas, Minneapolis, Detroit, Columbus, Indianapolis, Portland, Sacramento, Raleigh, Salt Lake City |
| 🇬🇧 UK | 90% | 20 — London, Manchester, Birmingham, Leeds, Bristol, Glasgow, Liverpool, Sheffield, Nottingham, Newcastle, Edinburgh, Cardiff, Belfast, Coventry, Leicester, Brighton, Southampton, Reading, Oxford, Cambridge |
| 🇮🇳 India | 30% | 28 — Mumbai, Delhi, Bengaluru, Hyderabad, Chennai, Kolkata, Pune, Ahmedabad, Surat, Jaipur, Lucknow, **Indore**, Bhopal, Nagpur, Nashik, Vadodara, Coimbatore, Kochi, Thiruvananthapuram, Chandigarh, Gurugram, Noida, Dehradun, Ludhiana, Visakhapatnam, Mysuru, Guwahati, Patna |
| 🇨🇦 Canada | 85% | 12 — Toronto, Vancouver, Calgary, Ottawa, Edmonton, Montreal, Winnipeg, Halifax, Quebec City, Victoria, Saskatoon, Regina |
| 🇦🇺 Australia | 85% | 12 — Sydney, Melbourne, Brisbane, Perth, Adelaide, Gold Coast, Canberra, Hobart, Newcastle, Wollongong, Sunshine Coast, Darwin |
| 🇦🇪 UAE | 80% | 6 — Dubai, Abu Dhabi, Sharjah, Ajman, Al Ain, Ras Al Khaimah |
| 🇸🇦 Saudi Arabia | 90% | 5 — Riyadh, Jeddah, Dammam, Al Khobar, Medina |
| 🇶🇦 Qatar | 95% | 4 — Doha, Al Rayyan, Lusail, Al Wakrah |
| 🇨🇭 Switzerland | 115% | 6 — Zurich, Geneva, Basel, Bern, Lausanne, Lucerne |
| 🇸🇬 Singapore | 90% | Singapore |
| 🇮🇪 Ireland | 85% | 6 — Dublin, Cork, Galway, Limerick, Waterford, Kilkenny |
| 🇳🇿 New Zealand | 75% | 6 — Auckland, Wellington, Christchurch, Hamilton, Tauranga, Dunedin |

**Depth modes:** Balanced (2 cities · 18 leads) · Deep (4 · 30) · **Wide (8 · 40)**.

**Adaptive discovery:** OSM pehle (no-site businesses wahan milte hain). Agar kisi city mein OSM thin ho
(<5 results — India mein common), to us city ke liye Google Places se top-up hota hai.

## Where to look (platform launcher)

Scout tab mein **"Where to look right now"** panel — tumhare service + market se 6 queries banati hai:
**X, LinkedIn, Upwork, Reddit, Instagram, Google**. **Open** dabao → tumhare apne logged-in browser
mein wahi search khul jayegi (live posts, latest jobs). Post pasand aaye → **Paste what you found** se
lead bana do. Isme koi automation nahi — tumhara account safe, ToS clean.

Queries mein `-("for hire" OR "freelancer")` filter hai, taaki doosre developers ke ads na aayein.

## Contact validity (jhoothi lead nahi)

Har lead publish hone se pehle:

- **Email MX check** — `contact@domain.com` ka mail server DNS se check hota hai. Server nahi hai to
  email hata di jaati hai aur note lag jata hai (bounce-proof).
- **Phone format** — kam se kam 7 digits, warna number drop.
- **Buyer vs seller filter** — "I build websites, DM me" wale posts reject; sirf "looking for /
  need / hiring / budget" wale aate hain.
- **Source link + date + contact** — teen mein se kam se kam 3 checks pass hone par hi lead verified.

*Bluesky bhi test kiya (free public API): 25 posts mein 16 "buyer" nikle par asli client ~0 —
sellers aur jokes. Isliye source add nahi kiya; filter hi rakha.*

## Live streaming (end ka wait nahi)

Har platform ka scan khatam hote hi uske leads board par aane lagte hain:

- **Maps Scout** → jis city ka scan khatam, uske cards turant (pehla lead ~70s par)
- **Demand Scout** → Reddit/Freelancer ke asks usi waqt
- **Site Auditor** → site check hone par wahi card update hota hai (HTTP, speed, mobile, email)
- **Analyst** → jo lead filter mein nahi bachi, wo board se hat jaati hai

Cards **upsert** hote hain (same id), isliye ek card dheere-dheere poora hota hai — pehle naam +
problem, phir phone, phir score/pitch. Koi duplicate nahi banta.

## Repeat runs (har run begin se, par bekar repeat nahi)

Har Run naya scan hai — purana data reuse nahi hota, kyunki clients aate-jaate rehte hain.
Par teen cheezein bachti hain:

1. **6-hour cache** — same city + vertical dobara scan karne par Overpass/Google/audit ka jawab
   cache se aata hai. Test: **cold run 184s → warm run 13s**.
   Band karna ho to `CACHE_TTL_MS=0 node server.mjs`, ya server restart.
2. **"Naye sirf" toggle (default ON)** — jo lead pehle save ho chuki hai wo is run ke board par
   nahi aati (sirf andar update hoti hai). Purani bhi dekhni ho to toggle OFF.
3. **Pipeline + status** yaad rehte hain — isliye "Contacted" wala lead dobara New nahi dikhta.

Cache stats: `curl -s localhost:8787/api/health`.

## Filters & options

**Run se pehle** (build box mein):
- **Phone zaroori** — sirf woh businesses jinka number mil gaya (call karne ke liye)
- **Reviews** — 3+ / 20+ / 100+ Google reviews (chhote ya bandh businesses hatane ke liye)

**Results par** (filter bar): **Callable** (phone ya email hai), **No site** (website hi nahi hai),
**grade** (A/B/C), **source**, **score** (60+/75+), **age** (24h/7d/30d), **sort**, **Reset**.
Right side mein `12/18 shown` dikhta hai. Saare filters browser mein yaad rehte hain.

**17 verticals** — dental, medspa, real estate, law, restaurant, gym, contractors, **plumbers & trades**,
**salons**, **vets**, **photographers**, **tattoo**, **landscaping**, accounting, auto, hotels, e-commerce.

## Compliance (ye important hai)

- Tool sirf **public endpoints** padhta hai: Google Places API, OpenStreetMap, Reddit JSON,
  Freelancer public API, aur search APIs.
- **LinkedIn/Instagram/X par login nahi hota, profile scrape nahi hoti.** Wahan se sirf wahi
  posts aati hain jo Google ne public index kiya hai — search API ke through.
- **Bulk DM/email nahi bhejta.** Message tum copy karke khud bhejte ho. Isi wajah se tumhara
  account zinda rahega.
- Har lead ke saath source link hota hai. Bhejne se pehle woh link kholo aur padho — budget
  aur scope wahi hai jo client ne khud likha hai, usse zyada kuch nahi.

---

## Pehle 60 minute ka plan (paisa jaldi chahiye to)

1. **Load research seeds** → 40 leads, score se sorted. Top 5 **A** leads kholo.
2. Har A lead ka **Source ↗** dabao, brief padho, phir **Copy DM** ya **Copy email**.
3. Freelancer/PeoplePerHour wale briefs par bid karo — generic "I can do it" nahi, unke brief
   ka ek specific point uthao + 3-line scope + fixed price. `Pitch & contact` mein sab ready hai.
4. OSM/Google Maps wale businesses ko **call** karo (phone ho to). Script drawer mein hai. Din
   mein 15–20 calls = 2–4 conversations. Ye marketplace se faster hai kyunki wahan competition
   kam hai.
5. Jise bhej diya, usko **Pipeline** mein drag karke *Contacted* karo. 3 din baad follow-up.

**Sach baat:** koi tool client guarantee nahi karta. Ye tool research ka 2–3 ghante ka kaam
5 minute mein karta hai — par message tumhe bhejna hai, aur follow-up bhi.

---

## Free mode vs paid mode

| | Free (no keys) | + Google Places | + Serper | + LLM |
|---|---|---|---|---|
| Real businesses with gaps | OSM (phone kam) | ✅ phone + reviews | — | — |
| Public briefs | Freelancer API | — | + LinkedIn/IG/X results | — |
| Reddit | ✅ (ghar ke IP se) | — | — | — |
| Pitch quality | rules | rules | rules | tailored |
| Time per run | 40–90 s | 20–40 s | +10 s | +15 s |

Reddit **cloud/datacenter IP se block** karta hai (403). Tumhare ghar ke internet se chalega;
agar phir bhi 403 aaye to Serper key laga do — wahi kaam search results se ho jayega.

---

## Files

```
LeadScout/
├── server.mjs              # zero-dep server: static + /api/run (NDJSON stream)
├── lib/
│   ├── agents.mjs          # 7 agents, scoring, pricing, outreach templates
│   ├── sources.mjs         # Google Places, OSM, Reddit, Freelancer, Serper, Tavily
│   └── llm.mjs             # OpenAI-compatible client
├── public/                 # index.html, app.js, styles.css (koi build step nahi)
├── data/seed-leads.json    # 40 verified leads (11 Nov 2026 research)
├── briefs/                 # roz ka action sheet (markdown)
├── scripts/
│   ├── brief.mjs           # aaj ka action sheet: run → link check → markdown
│   ├── refresh-seeds.mjs   # live sources se seeds dobara banao
│   ├── import-research.mjs # research JSON ko seeds mein merge karo
│   ├── shot.mjs            # dev: CDP screenshot
│   └── probe.mjs           # dev: rendered state + console errors check
├── legacy/                 # purana Python v1 (reference ke liye)
└── ../data/leads_research.md  # research method + findings
```

## Roz subah ka brief

```bash
node scripts/brief.mjs          # 3 markets (US, CA, AU), ~4 min → briefs/YYYY-MM-DD.md
node scripts/brief.mjs --quick  # 2 markets, faster
```

Ye 4 markets scan karta hai, har source link **HTTP check** karta hai, phir do lanes mein
markdown banata hai: **Lane 1 = jinko call karna hai** (number saath mein), **Lane 2 = jinko
likhna hai** (public brief). Har lead ke saath ready-to-paste email aur price hota hai.
Ek hi source+vertical se maximum 2 leads aate hain, taaki 9 identical accountants poori
list na bhar dein.


Server-side keys bhi de sakte ho (browser mein rakhne ki zarurat nahi). Server `.env.local` khud padhta hai —
project folder mein ya ek level upar (dono jagah dekhta hai):

```bash
# ClientFinder/.env.local  ya  LeadScout/.env.local
GOOGLE_PLACES_KEY=AIza...          # GOOGLE_PLACE_API_KEY / GOOGLE_MAPS_API_KEY bhi chalte hain
SERPER_KEY=...
TAVILY_KEY=...
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

Phir `node server.mjs` — Settings mein kuch daalne ki zarurat nahi.

⚠️ **Google key ki restriction:** key agar *HTTP referrers* par restricted hai to browser mein chalegi par
server se **403 `API_KEY_HTTP_REFERRER_BLOCKED`** aayega. Fix: Google Cloud → Credentials → key →
**Application restrictions → None** (ya **IP addresses** → apna public IP). Saath mein **API restrictions →
Places API (New)** aur daily quota 200 rakho.

---

## Deploy (hosting)

**Vercel par ye app nahi chalegi** — aur wajah 404 nahi hai:
1. Runs **60–180 second** lete hain (scan + audit + Google lookups) aur result **NDJSON stream** hota hai.
   Vercel Hobby functions 10s (max 60s) par timeout karte hain — run beech mein mar jayega.
2. `/api/*` endpoints ek **persistent Node process** chahte hain; serverless par in-memory cache
   aur streaming dono kaam nahi karte.
3. Sirf `public/` static deploy karne se UI khulega par har button fail hoga ("Server not reachable"),
   kyunki saara kaam backend karta hai.

**Sahi host:** koi bhi Node/Docker host — Render, Railway, Fly.io, ya apna VPS.

### Render (free, 3 clicks)

1. Render → **New → Blueprint** → repo `website-only` chuno (root mein `render.yaml` hai).
2. Dashboard mein `GOOGLE_PLACES_KEY` daalo (secret, repo mein nahi).
3. Deploy hone par `APP_PASSWORD` generate hota hai — usse copy karo.
4. URL kholo → browser username `leadscout`, password wahi generated.

### Docker (kahin bhi)

```bash
docker build -t leadscout .
docker run -p 8787:8787 \
  -e APP_PASSWORD=choose-a-password \
  -e GOOGLE_PLACES_KEY=AIza... \
  leadscout
```

⚠️ **Public URL par bina `APP_PASSWORD` mat chhodo** — warna koi bhi tumhari Google key se
API calls kar sakta hai. Auth on hone par `/api/health` public rehta hai (uptime checks ke liye),
baaki sab 401.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Port 8787 is busy` | `PORT=8788 node server.mjs` |
| Maps Scout slow / "Overpass 502" | Overpass free server busy hota hai — retry khud lagta hai; key laga do to Google fast hai |
| Reddit 403 | Ghar ka internet use karo, ya Serper key |
| "No leads passed verification" | Bada city ya doosra vertical try karo |
| Results purane lag rahe | `node scripts/refresh-seeds.mjs` |
