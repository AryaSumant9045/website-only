import json, re

fl = {r['title'].strip(): r for r in json.load(open('/tmp/fl_projects.json'))}
pph = {r['title'].strip(): r for r in json.load(open('/tmp/pph_projects.json'))}

def F(title):
    r = fl[title.strip()]
    return r['url'], r['posted']

def P(title):
    r = pph[title.strip()]
    return r['url'], r['posted'][:10]

leads = []

def add(**kw):
    leads.append(kw)

# ---------------- REDDIT (body verified via post .rss) ----------------
add(company_or_person="iCon Studio TX (indie game studio)", source="Reddit r/forhire [Hiring]",
    url="https://www.reddit.com/r/forhire/comments/1xr7v8o/hiring_remote_gamemaker_programmer_and_a_sound/",
    posted_date="2026-11-08", country="United States",
    need_summary="Second GameMaker programmer for indie RTS roguelite 'They're Gonna Get In' to implement finished art assets; must already know GameMaker.",
    budget="$15/hr, 2-month contract at 20 hrs/month (rises to $25/hr if publisher funding lands)",
    contact_route="Reddit DM to poster / comment on post", grade="A",
    notes="Explicit rate + hours + contract length. Studio name and game page given in post. Small hours (~40h total) so low value, but low competition.")

add(company_or_person="Unnamed operator of a German-language pet-supplies classifieds marketplace", source="Reddit r/forhire [Hiring]",
    url="https://www.reddit.com/r/forhire/comments/1xr0gdt/hiring_senior_developer_pentester_for_whitebox/",
    posted_date="2026-11-08", country="Unknown",
    need_summary="Senior dev to review a TypeScript monorepo (Next.js 16.4, Hono/oRPC, Postgres 18, React Native) and run a white-box security assessment to OWASP ASVS 5.0 L2 / MASVS before public launch.",
    budget="Not stated in post",
    contact_route="Reddit DM / reply on post", grade="B",
    notes="Very specific tech stack and deliverable (report + acceptance verdict). Security-review work rather than build work, but a real paid engagement for someone senior in TS/Next.")

add(company_or_person="Wayne Citadel (security tooling startup)", source="Reddit r/forhire [HIRING]",
    url="https://www.reddit.com/r/forhire/comments/1xqoczo/hiring_cybersecurity_devs/",
    posted_date="2026-11-08", country="Unknown",
    need_summary="Two security devs to build a Terraform/OpenTofu pull-request security reviewer (deterministic analyzer + LLM explanation layer, GitHub Actions, SARIF output).",
    budget="None - post says 'still dont have budget tho, to be clear right away'",
    contact_route="Reddit DM / reply on post", grade="C",
    notes="Interesting AI+security scope but explicitly unfunded at time of posting. Watch for later budget; not billable now.")

add(company_or_person="riftavo.com (job board for consultants), u/Throwaway7362636", source="Reddit r/Programmers_forhire",
    url="https://www.reddit.com/r/Programmers_forhire/comments/1xshxdg/help_for_my_site/",
    posted_date="2026-11-10", country="Unknown",
    need_summary="Owner of a consultant-leads job board wants help building new features and asks developers to message with proposed improvements and their rates.",
    budget="None stated - asks applicants to quote rates",
    contact_route="Reddit DM to u/Throwaway7362636", grade="C",
    notes="Weak but genuine: an inbound ask for rates on an existing live site. Good cold-open candidate, tiny budget likely.")

add(company_or_person="SoundPlus / Graphikrafts (free Android music streaming app)", source="Reddit r/forhire [HIRING]",
    url="https://www.reddit.com/r/forhire/comments/1xogb6x/hiring_uiux_designer_or_designer_developer_to/",
    posted_date="2026-11-05", country="Unknown",
    need_summary="Redesign the SoundPlus landing page and Android app UI (home, player, queue, equaliser, library, search) with a Figma design system; optional follow-on rebuild of the buggy PHP site and Android app.",
    budget="$700 for design; development quoted separately",
    contact_route="Reddit DM to poster / comment", grade="A",
    notes="Explicit budget and a live product URL (music.graphikrafts.com). Design-led, but the optional 'design + develop' package is the higher-value path. Country not stated in post.")

add(company_or_person="PULP (independent animation org, ~50k Instagram followers)", source="Reddit r/forhire [Hiring]",
    url="https://www.reddit.com/r/forhire/comments/1x4axyt/hiring_fullstack_developer_for_independent/",
    posted_date="2026-10-12", country="Unknown",
    need_summary="Full-stack developer to build v1 of an independent animation streaming platform: branded responsive site, curated homepage/browse, on-demand playback, clean maintainable architecture.",
    budget="$1,500 fixed",
    contact_route="Reddit DM to poster / comment", grade="A",
    notes="Posted exactly 30 days ago - at the edge of the recency window. Explicitly says 'No AI'. Small budget but a real organisation with an audience and a public brief.")

add(company_or_person="u/Fatsquirrel666 (ChatGPT/vibe-coded site owner)", source="Reddit r/forhire [HIRING]",
    url="https://www.reddit.com/r/forhire/comments/1xp9pdj/hiring_i_vibecoded_a_website_on_chatgpt_now_i/",
    posted_date="2026-11-06", country="Unknown",
    need_summary="Fix and polish an AI-generated website: smoother transitions, less lag, cleaner code; owner says 'name your price'.",
    budget="$15/hr stated, 'not looking to invest hundreds'",
    contact_route="Reddit DM to u/Fatsquirrel666", grade="C",
    notes="Very low budget and vague scope, but it is the 'fix my AI-built app' demand pattern that recurs constantly - useful as a template for a productised fix-up offer rather than a one-off lead.")

# ---------------- FREELANCER.COM (project page opened; date/country/budget from page data) ----------------
us = [
 ("Full-Stack AI Developer Needed","TrueMarch (applied AI / decentralised infra co.)",
  "Ongoing contract work on full-stack TypeScript/Node/React apps plus LLM features (RAG, tool use, agent workflows) and AI evaluation; long-term possible.",
  "€250-750 (posted bracket; client is US-based, site displayed EUR)","A",
  "9 proposals only - unusually low for this category. Client payment NOT verified."),
 ("AI-Driven eCommerce Design Workflow","Unnamed eCommerce operator (US)",
  "Build/configure an AI workflow that turns sketches, mood boards or copy into polished on-brand eCommerce page designs, with a simple front-end for prompts and uploads.",
  "$250-750","A","20 proposals. Payment verified. Generative-design tooling, not a plain website build."),
 ("Forum & Chat Backend Development","Unnamed (has finished front-end, US)",
  "Server-side build for a forum + real-time chat product: accounts/profiles, public and private chat, moderator dashboard with bans/deletes, Cloudflare integration.",
  "$250-750","A","20 proposals; client payment unverified. Front-end already exists, so scope is backend-only."),
 ("Website Refresh & Local SEO","Local services business (US)",
  "Refresh an existing site (layout, copy, technical) and do local SEO - on-page, metadata, schema, Google Business - to surface in map pack and local organic results.",
  "$250-750","A","20 proposals, payment verified. More SEO/CMS than app work but fits a web-dev offer."),
 ("GigResource Responsive UI Design Refinement","GigResource (US)",
  "Polish an existing web app UI without redesigning: sidebar states/icons, responsive layouts across mobile/tablet/laptop, consistent design system.",
  "$250-750","A","Only 2 proposals at time of check, payment verified - best competition/quality ratio found on this board."),
 ("Portfolio Website Upgrade for FX Artist","Independent practical-effects artist (props, prosthetics, makeup for film), US",
  "Build a professional portfolio site for a film FX artist to present services and work; current self-made portfolio is not presentable enough.",
  "$250-750 (site displayed CAD)","A","20 proposals, payment unverified. Client says 'willing to hear different quotes'. Solo-artist budget, fast decision likely."),
]
for t, who, need, bud, grade, note in us:
    u, d = F(t)
    add(company_or_person=who, source="Freelancer.com (public project page)", url=u, posted_date=d,
        country="United States", need_summary=need, budget=bud,
        contact_route="Bid on the Freelancer.com project page (free account)", grade=grade, notes=note)

uk = [
 ("NEED A EXPERT WHO CAN BUILD A CASINO AND PUBLISH ON PLAY STORE AND MAKE OUR CASINO COMPANY MORE CONNECT TOWARDS OTHER CASINO ",
  "Licensed UK gambling operator",
  "End-to-end Android real-money casino app: architecture, build, compliance prep, Google Play submission and regional rollout wherever they hold licences.",
  "$3,000-5,000","A",
  "Payment NOT verified and 20 proposals. Gambling/Play-policy compliance is the hard part; high risk, high budget."),
 ("Full-Stack Web Developer Required – Modern Website Development & Platform Integration","UK company (unnamed in public text)",
  "Build/refine a responsive marketing platform, implement front-end functionality, integrate backend services, own delivery across desktop/tablet/mobile.",
  "£750-1,500","A",
  "Only 5 proposals, payment verified - one of the cleanest UK briefs in this set."),
 ("Custom Pool Cue Design Website","UK custom cue maker",
  "E-commerce site with a live 3D cue configurator (colours, wrap, length, weight, tip, engraving, uploaded graphics) that renders in real time and checks out.",
  "£250-750","A",
  "20 proposals, payment unverified. Genuinely interesting 3D/web build; bracket likely too low for full 3D configurator."),
 ("AI-Driven Daily Brief Integration","UK back-office team (unnamed)",
  "Wire AI into email, calendar, meeting notes and task lists to produce a daily brief, summarise and prioritise incoming mail, and draft replies to common emails.",
  "£250-750","A","20 proposals, payment unverified. Classic AI-automation retainer entry point."),
]
for t, who, need, bud, grade, note in uk:
    u, d = F(t)
    add(company_or_person=who, source="Freelancer.com (public project page)", url=u, posted_date=d,
        country="United Kingdom", need_summary=need, budget=bud,
        contact_route="Bid on the Freelancer.com project page (free account)", grade=grade, notes=note)

india = [
 ("Build AI Operations Intelligence SaaS","Indian enterprise buyer (ORBIT project)",
  "Build 'ORBIT': SaaS control plane connecting business apps, monitoring processes, detecting anomalies, finding root causes and recommending/executing corrective actions.",
  "min ₹50,00,000 (INR 5,000,000+, ~$55k+)","A",
  "Payment verified, 9 proposals. Large enterprise scope - realistic only as a team/phase-1 proposal."),
 ("LiveKit Voice Auto-Troubleshooting Agent","India-based internal IT team",
  "LiveKit voice agent that opens a remote session to a Windows/macOS machine, diagnoses issues in plain language, asks yes/no confirmation and applies an approved fix; modular script library.",
  "₹75,000-150,000","A","20 proposals, payment verified. Well-specified AI voice + remote-support build."),
 ("Design & Development of an Enterprise-Grade Autonomous AI Business Operating System","India-based buyer (unnamed)",
  "Agentic 'autonomous business engine' replacing trigger-based automation: agents that handle changing information, API failures and context-dependent decisions.",
  "₹500,000-1,000,000","A","20 proposals, payment verified. Buzzword-heavy brief; scope will need heavy narrowing before quoting."),
]
for t, who, need, bud, grade, note in india:
    u, d = F(t)
    add(company_or_person=who, source="Freelancer.com (public project page)", url=u, posted_date=d,
        country="India", need_summary=need, budget=bud,
        contact_route="Bid on the Freelancer.com project page (free account)", grade=grade, notes=note)

other = [
 ("AI-Powered Construction Planning Software","Australian construction firm","AI-assisted construction project and schedule planning software with planned-vs-actual cost tracking and a management UI.","$10,000-20,000 AUD","A","Zero proposals at time of check and payment verified - strongest budget-to-competition ratio in the whole dataset."),
 ("Senior Full-Stack App Reliability Review","JobStoq (field-service app for electrical contractors), Canada","Review and harden a live TypeScript/React/Node/Postgres app (Drizzle, Clerk, pnpm monorepo on Replit) for reliability before wider rollout.","$750-1,500 CAD","A","16 proposals, payment verified. Audit-then-fix work; good foot-in-the-door with a real product."),
 ("Revamp AI Coding Interface Usability","Exosuited.com, Canada","Rework the front-end of a downloadable AI coding-enhancement app - code editor and overall coding UX - improving usability without a rebuild.","$3,000-5,000","A","20 proposals, payment verified. Client names the product and asks applicants to try it first."),
 ("AI Smile Design Platform Build","Netherlands dental-tech founder","AI dental smile-design platform: upload face/intra-oral photos, detect lips/teeth/gingiva, generate photorealistic simulation, then interactive refinement of tooth shape/size/colour.","$250-750","A","20 proposals, payment verified. CV/GAN-heavy; bracket looks far below the real effort."),
 ("Deploy Three Claude AI Agents","Colombia-based buyer","Deploy three Claude-based agents against an AWS database. Four-word brief.","$5,000-10,000","B","20 proposals, payment verified, but description is 'Claude. AWS database. 3 agents' - scope unknown until you talk to them."),
]
for t, who, need, bud, grade, note in other:
    u, d = F(t)
    cc = {"AI-Powered Construction Planning Software":"Australia","Senior Full-Stack App Reliability Review":"Canada","Revamp AI Coding Interface Usability":"Canada","AI Smile Design Platform Build":"Netherlands","Deploy Three Claude AI Agents":"Colombia"}[t]
    add(company_or_person=who, source="Freelancer.com (public project page)", url=u, posted_date=d,
        country=cc, need_summary=need, budget=bud,
        contact_route="Bid on the Freelancer.com project page (free account)", grade=grade, notes=note)

# ---------------- PEOPLEPERHOUR (listing data + page text verified) ----------------
pp = [
 ("Developer to finish and launch a UK price comparison website","'One, Bottle Street' - whisky/rum price comparison startup, UK",
  "Turn an AI-built prototype into a production price-comparison site for whisky and rum: retailer feed importer, search, bottle pages, hosting handover.",
  "£2,000 fixed (negotiable), milestone payments","A",
  "Deadline-driven: live by 1 Feb 2027 with milestones 15 Dec / 15 Jan. 72 proposals but the brief is unusually specific - a strong, well-scoped UK lead."),
 ("AI Developer - CV Writing, Career Assessment & Document Intellig","UK career-services business",
  "Build the AI processing layer for a CV-writing/career-consultancy platform: analyse candidate documents, generate CVs, assess against roles, LinkedIn optimisation.",
  "£15,000","A","Largest UK budget in the set (57 proposals). Wants an experienced AI developer or small team - good fit for an agent/CV-pipeline specialist."),
 ("Website design for bed manufacturer","UK bed manufacturer (30 staff, trade supplier going direct-to-consumer)",
  "High-end e-commerce store for a bed manufacturer moving into online retail, plus accompanying SEO work.",
  "£500","A","89 proposals - very crowded. But buyer is an established 30-person business, which usually means a real budget conversation."),
 ("Mobile App Designer & Developer – Full Matrimonial App Build","UK matrimonial app founders",
  "Full iOS + Android matrimonial app build from concept: design, development and working app delivery.",
  "£400","A","52 proposals and the bracket is low for a two-platform app; expect scope negotiation. Good example of UK small-business app demand."),
 ("Complete & Launch Existing WoodMart WooCommerce Website","UK e-commerce owner",
  "Finish and launch an existing WoodMart/WooCommerce/WPBakery site: complete content, configure ecommerce, refine design. Wants immediate availability.",
  "£264","A","74 proposals. 'Immediate availability' = urgency signal; small but fast WordPress/Woo job."),
 ("Develop a user-friendly, comprehensive website for ADR Property Management","ADR Property Management (US)",
  "Website for a 700+ unit property portfolio: listings with images/availability/pricing, cart to order storage units online, secure customer portal.",
  "£88 (displayed GBP)","A","52 proposals and a very low bracket for portal + cart work - realistic only as a phased quote. Included because US demand for portal work is rare on PpH."),
 ("Claude MCP + Apollo.io + Salesforce Lead Automation","India-based B2B operator",
  "Configure the native Apollo.io connector inside Claude.ai and pipe Apollo research/lead data into Salesforce; platform configuration, no from-scratch build.",
  "£70","A","19 proposals. Small, sharply-defined AI-automation job - exactly the kind of quick win a solo dev can deliver in a day or two."),
 ("PHP website to manage transfers - hotel own shuttle bus","Netherlands hotel group",
  "Extend an existing PHP shuttle-bus booking/admin site: rename/add properties, keep super-user and per-hotel permission logic.",
  "€120","A","Only 7 proposals. Tiny maintenance job with a repeat client likely (4th property joins April 2027)."),
]
for t, who, need, bud, grade, note in pp:
    u, d = P(t)
    cc = {"Develop a user-friendly, comprehensive website for ADR Property Management":"United States",
          "Claude MCP + Apollo.io + Salesforce Lead Automation":"India",
          "PHP website to manage transfers - hotel own shuttle bus":"Netherlands"}.get(t,"United Kingdom")
    add(company_or_person=who, source="PeoplePerHour (public project page)", url=u, posted_date=d,
        country=cc, need_summary=need, budget=bud,
        contact_route="Submit a proposal on the PeoplePerHour project page (free account)", grade=grade, notes=note)

ORDER = {"United States":0,"United Kingdom":1,"India":2}
leads.sort(key=lambda l: l['posted_date'], reverse=True)
leads.sort(key=lambda l: ORDER.get(l['country'], 3 if l['country']!='Unknown' else 4))

json.dump(leads, open('/Users/aryasumant/Desktop/ClientFinder/data/leads_raw.json','w'), indent=2, ensure_ascii=False)

from collections import Counter
print("TOTAL", len(leads))
print("grades", Counter(l['grade'] for l in leads))
print("countries", Counter(l['country'] for l in leads).most_common())
print("sources", Counter(l['source'] for l in leads))
bad=[l for l in leads if not l['url'].startswith('http') or not l['posted_date']]
print("bad", bad)
