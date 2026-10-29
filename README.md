# The Human Layer: live audience companion

One QR code per session. Participants scan once, join once, and stay in one phone page while you run the activities. Responses go to the server and appear on the big-screen page and the organiser dashboard.

## Pages
- `/host` organiser dashboard (password). Create session, QR + join link, open/pause/close/reveal/next/end, live counts (joined / opened / submitted), compare rounds, edit activities (JSON), CSV export, delete.
- `/j/CODE` the phone page (what the QR opens).
- `/screen/CODE?k=KEY` big-screen page. The link with its key is behind "Open big screen" in the dashboard. Open it in a browser tab on the projector laptop and switch to it for reveals.

## Run locally
```
npm install
ORGANISER_PASSWORD=choose-one npm start     # http://localhost:3000/host
npm test                                    # 53 server checks, simulated participants
```

## Deploy (needed for a real room)
Phones must reach a public HTTPS address. Any Node host works (Render, Railway, Fly.io).
- Start command `npm start`. Env: `ORGANISER_PASSWORD` (required), `DATA_DIR` (point at a persistent disk), `PORT` (host sets it).
- Without a persistent disk, data is lost on restart or redeploy. Export the CSV right after the talk.
- Free tiers that sleep: wake it 10 minutes before you go on.
- Run one instance only (state is in memory plus a JSON file).

## How it works
Node http server, Server-Sent Events for live updates, JSON file storage (atomic writes), `qrcode` for the QR. Identity: random participant id in the phone's localStorage plus a 5-character recovery code for another device. A response is keyed by activity + participant, so repeated taps and retries cannot create a second vote. The phone only says "recorded" after the server confirms.

## Privacy
Session privacy is chosen at creation. "Names collected": name and optional organisation are stored and visible to the organiser, and the join screen says so (not anonymous). "Aggregate only": no name asked; answers sit under a random id. The big screen never receives names. No retention automation: delete a session from the dashboard when your policy says to.

## Not tested / limits
- Test 17 (real phones, real projector, real venue wifi) has NOT been done. Do a rehearsal with 5+ real phones on the venue network.
- Not load-tested at about 350 phones. SSE holds one connection per phone; a single small instance should be fine, but verify.
- Not deployed anywhere by me.
- Single organiser password, no accounts. Cookie auth is only safe over HTTPS (hosts provide it).
- If live updates fail: phones reconnect on their own; the dashboard polls every 4s; the big screen shows a red "connection lost" bar. Fallback: hands up, then enter nothing; the CSV still holds everything stored.
- The 60-second countdown is display only; late answers are still accepted. The golden-apple reward is yours to give; the dashboard shows the fastest timed finisher.

## Update: uses and interactivity
- The interest screen now asks "What might you use gamification for?" as an optional pick-any list (employee onboarding, team and management systems, rewards, training and simulations, team building, customer onboarding, customer engagement and loyalty, events, personal and cultural experiences, something else). Never asked or stored for "Not right now". The Leads CSV has a new `uses` column.
- The rating screen now has a second question, "Did you find the experience interactive?" (very, somewhat, not very), stored with the stars and exported in the answers column of the responses CSV. It is required.
- The onboarding form is now three taps: type of organisation, role, and one word for your last first day. (Name and optional organisation are given when joining.) The same form is shown to both groups; only the countdown and the prize note differ.
- The plain-vs-countdown slide now also shows each group's average and fastest finishing time, and one comparison line after Reveal (only when each group has at least 10 people who opened the form).
- Tests: `npm test` now has 58 checks (5 new).

## Expression of interest (final slide)
The last default activity ("interest") runs in the same phone session: choose an option, then optionally email, company, what the system is, and what they might use it for, then a confirmation that says it is an expression of interest, not a booking. See FINAL-DEPLOY-AND-DATA.md, section C, for exactly what each export contains. In short: the **Leads CSV** has one row for everyone who chose an interest option other than "Not right now" (name only in named sessions, organisation type, email, company, interest, uses, problem, time; rows without an email are flagged "no email given: cannot follow up"). Someone who taps "Not right now" is not in the Leads CSV and nothing else they typed is stored; the tap itself appears only in the Responses CSV and the totals. Emails, company names and problem text are never in the Responses or Summary CSV and never reach the big screen; they are in the Leads CSV and the Everything JSON. Use of these contact details beyond replying needs separate permission.

## Big-screen page: live growth
`/screen/CODE?k=KEY` is the page to show instead of the slide for the four live moments (join, join result, pick, pick result). Bars and the answer counter grow as phones submit (counter pops, bars animate, the bar that just moved highlights). Bars scale to the number joined, so a bar's length is "how many of the room", and the % label is the share of those who have answered. Set `showLive:false` on an activity to hide bars until you press Reveal. Test: `node test/live-growth.js` (needs Playwright; simulated phones, not real ones).

## Presenter page: the whole talk in one place
Open `/present/CODE` on the laptop connected to the projector (sign in with the organiser password). It is the full talk: the static slides, the live QR, the live poll bars that grow as phones answer, three scenarios, and the demo, all in one page, so you never leave it.
- Keys: right arrow or Space = next, left arrow = back, O = open the poll, C = close, R = reveal, N = speaker notes, F = full screen, H = hide the control bar.
- Live slides open the matching phone screen on arrival (join opens onboarding; each scenario opens its poll; the ask opens the interest screen; goodbye opens the rating screen). The result slide closes and reveals the onboarding test.
- Demo slide (scenario 3): four steps with the right arrow: the manager adds the job; the system shows its top two with a plain-English reason and you click one; the chosen person sees the offer, their week and workload, and can accept, ask their team lead or talk to HR; then their private progress and where they stand (no names).
- HONEST LABEL: the demo's people and numbers are invented. The matching is a simple rule-based score on working-style traits, and the "why" text is written from that score. It is not an AI model today.
- Test: `node test/present.js` (needs Playwright; simulated phones). Test 17 (real phones, projector, venue wifi) is still NOT done.
- Slide files live in `public/present/slides/`. Fonts load from Google Fonts, so the laptop needs internet (fallback fonts otherwise).

## Update: simple phone screens and data by kind of organisation
- Join asks only for a display name (no organisation name). Onboarding is two taps: kind of organisation (a list: telecom or mobile money, bank or fintech, insurance, software or IT, consulting, government, NGO, education or research, health, retail, energy or industry, media, something else) and role.
- The last screen is one page: tap the parts of your systems (customer-facing, employee-facing, management systems, something else), email, optional company name, optional one-line problem. The company name is asked only here, only if they want to give it.
- Exports: responses, participants and leads carry `organisation_type`; the summary CSV splits every choice by kind of organisation ("choice by Bank or fintech: Efua"). The organiser dashboard shows who is in the room by kind of organisation.
- Phone text is kept to the minimum. Scenario 1 is the bank story (month-end, payroll files failing, one person released).

## Update: taking part, compared with the room
- When you create a session, enter the size of the room (about). You can change it later from the dashboard card "Taking part".
- The dashboard shows joined, joined as a percentage of the room, how many answered at least one thing, and phones connected now.
- The join screen on the big screen and in the presenter shows "joined of about N in the room, X%".
- The onboarding comparison now divides by everyone assigned to each cohort, so the "did not finish" count includes people who never opened the form. Cohorts are filled evenly (the smaller group gets the next person).
