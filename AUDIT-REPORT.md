# The Human Layer: Full-Stack Audit

Everything below ran on this machine: loopback network, headless Chromium (phone-sized emulation), synthetic data, isolated ports and temp data folders. Nothing ran on a real phone, the venue Wi-Fi, Railway, or a projector. Label key: **VERIFIED** = I ran it; **INFERRED** = reasoned from code; **UNTESTED** = needs the procedure in section F.

## A. Verdict: READY WITH CONDITIONS
The software is in good shape. The conditions are all things only you can test (real devices, Railway volume, sound). Section H lists them.

## B. System map
- `server.js` (one Node process, one dependency `qrcode`): JSON database in `DATA_DIR/db.json` (atomic write, flushed on stop), live updates by SSE.
- Four surfaces: `/host` (organiser dashboard, password), `/present/CODE` (your tablet: slides, notes, controls), `/show/CODE?k=KEY` (projector: no controls, no notes, no names or answers until revealed), `/j/CODE` (phones, via QR).
- Data flow: phone → API → memory + db.json → SSE to tablet, projector and phones. Exports (leads, responses, participants, summary, everything) are organiser-only.
- Deck: Slides artifact (version 217) + PDF + `present/deck/*.jpg/mp4/notes.json`. The tablet runs its own copy of the deck inside the app.

## C. End-to-end test matrix
| Stage | Check | Result | Evidence |
|---|---|---|---|
| A Setup | Server starts, session created, QR renders | PASS | acceptance, browser |
| A | QR decodes back to the exact join link at 180/260/420 px | PASS | a11y-qr (jsQR on screenshots) |
| A | Scanning the QR with a real phone camera, at room distance | NOT TESTED | procedure F1 |
| B Opening video | File served with range requests | PASS | present |
| B | H.264 playback and audio on tablet/projector | NOT TESTED (headless Chromium cannot decode H.264) | F2 |
| C/D Join, consent | Consent required; join with and without email; recovery code; neighbour-help join | PASS | acceptance, neighbour |
| D | Join cap 2000; 60 KB body limit; wrong recovery codes throttled | PASS | load, security |
| E Voting | Open, vote, duplicate (idempotent, first answer kept), closed (409), bad option (400) | PASS | acceptance |
| E | Cohort assignment balanced; plain cohort sees no gamification | PASS | prizes, acceptance |
| E | Projector shows no names/answers until reveal; winners only after reveal | PASS | privacy, show, prizes |
| F Presenter | Slide, step and overlay sync to projector; 14-slide order; notes host-only | PASS | present, show, ten |
| F | Tablet refresh resumes on the current slide | PASS after fix (was FAIL) | recovery |
| G Game Plan demo | Film file present (720p, ~6 MB); green-slide layout | PASS (layout) / NOT TESTED (playback) | ten |
| H Feedback, leads | Leads CSV excludes "Not right now"; spreadsheet formulas defused; JSON export | PASS | acceptance, security |
| I Close | Close activity, export, shutdown flush | PASS | recovery |
| Failure | Phone refresh: still joined, no second vote offered | PASS | recovery |
| Failure | Server down: phone shows "Connection lost"; clears by itself on return | PASS | recovery |
| Failure | Clean restart and hard kill: people, votes, open activity, slide all kept | PASS (hard kill loses at most the last ~150 ms) | recovery |
| Failure | Phone, projector and tablet reconnect without being touched | PASS | recovery |
| Failure | Disk will not save: server keeps running, `/health` shows `saveError`, clears by itself | PASS after fix (was a crash risk) | recovery |
| Capacity | Up to the 2000 join cap, with SSE streams, on loopback | PASS (local only) | load |
| Security | Host auth, login and recovery throttling, headers, no private data in public streams | PASS | security, privacy |
| Accessibility | Labels on all fields, tap targets 40 px+, 16 px fields, zoom not blocked | PASS after fix | a11y-qr |
| Real network, real devices, Railway, volume | NOT TESTED | F |

Suites run in this session, all passing: acceptance (63), present, show, ten, prizes, privacy, security, recovery, browser, neighbour, live-growth, a11y-qr. Run them all with `npm run test:all` (the a11y-qr audit helper needs packages kept in the scratchpad, so it is not in that script).

## D. Defect register
| ID | Sev | Defect | Status |
|---|---|---|---|
| D1 | P1 | Refreshing the tablet sent the presenter back to slide 1 while the projector stayed put | FIXED + test |
| D2 | P1 | A failed disk write (full or unwritable volume) would have thrown inside a timer and could end the process mid-session | FIXED + test: keeps serving from memory, retries every 3 s, `/health` reports `saveError` |
| D3 | P2 | Login and recovery-code guessing were unlimited | FIXED + test (10 login tries and 20 recovery tries per 10 minutes per address; behind a proxy this uses the last forwarded address) |
| D4 | P2 | A participant could type `=...` into a text box and have a spreadsheet run it when you open the CSV | FIXED + test |
| D5 | P3 | No `nosniff` or `no-referrer` headers | FIXED |
| D6 | P3 | Consent row tap height 28 px | FIXED (44 px) |
| D7 | P3 | Guide wrongly said "Not right now" appears in the leads CSV | FIXED earlier |
Test-side corrections (not product defects): duplicate-vote expectation, an offline simulation that did not cut an open stream, a loose text selector.

## E. Fixes completed
D1–D7 above. Backups: `server.pre-audit.js`, `present.pre-audit.html` in the companion folder. No voting rule, consent requirement, or product claim was changed.

## F. Live rehearsal checklist (your side)
1. **Railway**: deploy, attach a volume at the data path, set `ORGANISER_PASSWORD` and `DATA_DIR`. Create a session, join with your own phone, redeploy, confirm the session and your join survive. If not, the volume is wrong; stop here.
2. **Tablet and projector**: open `/present/CODE` on the tablet and `/show/CODE?k=KEY` on the projector. Press play on the opening video and the film on both; check sound through the room speakers, and that fullscreen does not drop the controller.
3. **Phones**: scan the projected QR from the back row with an iPhone and an Android phone. Join, vote, refresh once.
4. **Venue network**: on the venue Wi-Fi and on mobile data, join from 5+ phones at once. If the Wi-Fi blocks you, that is the failure the no-app plan covers.
5. **Full dry run** with a timer and 3–5 friends, including one deliberate wrong password, one refresh of the tablet mid-talk, and one export at the end.
6. Open the exported CSVs in your spreadsheet app and check names and emails look right.
7. Do step 1's redeploy test again the evening before; do not redeploy on the day.

## G. Contingency plan
- **Phones will not load**: say "No problem" and use the no-app version: hands up for the vote on each slide, the tablet notes already carry the story; the PDF deck and BACKUP-PACK have every slide.
- **Projector view dies**: refresh it; it returns to the current slide by itself (tested). If the projector is gone, mirror the PDF.
- **Tablet refreshes or sleeps**: reopen the link; it resumes on the same slide (tested). Turn auto-lock off beforehand.
- **Server restarts**: everything is kept; phones reconnect on their own (tested on loopback).
- **Disk problem**: `/health` shows `saveError`. Export from the host dashboard immediately.
- **Run over time**: the 10-minute order comes to about 9:15; cut the "pickr" explanation first, not the vote.
- **Video will not play**: speak over the green slide; the notes carry the same story.

## H. Go / no-go conditions
GO if: F1 (redeploy keeps data), F2 (video and sound), and F3 (QR from the back row, both phone types) all pass, and you have the PDF and BACKUP-PACK on the tablet.
NO-GO for the app (keep the talk, use the no-app version) if: the volume does not persist, or the venue network blocks phones and you cannot offer mobile data.

## Weakest assumptions
1. **INFERRED**: the venue network lets 50+ phones hold open SSE connections. Some Wi-Fi with client isolation or proxies drops them; I cannot test that from here.
2. **INFERRED**: the Railway volume path matches `DATA_DIR`. Local restart tests prove the code, not your deployment.
3. **UNTESTED**: H.264 playback and room audio.
4. Capacity numbers are loopback only; real phones over a shared access point will be slower.
5. Legal and retention questions (consent wording, how long you keep emails, client names in the deck) are yours to confirm; the code enforces consent but cannot judge it.

## Capture
- **Decided**: build stays frozen apart from the fixes above; verdict READY WITH CONDITIONS.
- **Open**: Railway volume test; real-device, sound and venue tests; client-name permissions; the "Half of you will see a countdown" line; retention plan.
- **Next**: do F1 first (it blocks everything else), then F2–F3, then one full timed dry run.
