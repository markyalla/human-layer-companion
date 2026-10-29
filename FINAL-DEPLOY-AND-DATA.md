# FINAL: put the companion online (Railway), log in, and get your data

"ADDRESS" below means the web address Railway gives you, like https://something.up.railway.app

## A. Deploy (about 30-45 minutes the first time)
1. Unzip human-layer-companion-updated.zip. Open a terminal INSIDE the human-layer-companion folder (the one containing server.js and package.json). Do not upload the zip itself.
2. Make a Railway account and add a payment method.
3. `npm install -g @railway/cli`   then   `railway login`
4. `railway init`   (new project, any name)
5. `railway up`   (uploads the folder; Railway installs the one dependency and starts it)
6. In the Railway dashboard, open the service:
   - Variables: add `ORGANISER_PASSWORD` = a long password (4+ random words is good). Add `DATA_DIR` = `/data`.
   - Volumes: add a volume, mount path `/data`.
   - Networking: Generate Domain. That is ADDRESS.
7. Redeploy once (Deployments, Redeploy) so the variables and volume are used.
8. Check: open ADDRESS in a browser. You should see "The Human Layer. Scan the QR code on the screen to join." Then open ADDRESS/host and sign in.

## B. The login system (one password, three screens)
- ONE password: ORGANISER_PASSWORD. There is no username and no email.
- ADDRESS/host : the organiser dashboard. Enter the password.
- ADDRESS/present/CODE : your tablet. Enter the same password. This one has your notes and buttons.
- ADDRESS/show/CODE?k=KEY : the projector. No password; the long KEY in the link is the key. Get it from the "Projector link" button on the tablet. Do not post or show it.
- Phones: no login. They scan the QR, type a name, and stay on the page. A 5-character recovery code on their screen lets them continue on another phone.
- You stay signed in for 24 hours on a device. To sign out everywhere or if the password is exposed: change ORGANISER_PASSWORD in Railway and redeploy; every device is signed out.
- There is no limit on wrong password tries, so use a long password and never reuse one.
- CODE = the short code of the session you create on the host page.
- IMPORTANT: always open the tablet and projector pages through ADDRESS (not localhost). The QR code on the join slide is built from the address you opened.

## C. What is collected, what the room sees, and getting ALL your data afterwards

### What people are told on their phones (the exact wording)
- Join screen, named session: "We record your answers. Only the organiser sees your name and answers. The big screen shows totals, and your name only if you win a prize." They tick "OK, I understand." before they can join.
- Join screen, aggregate session: "No name needed. We record your answers without your name. The room sees totals only."
- Last screen: "Only the organiser sees your email and what you write. We use them only to reply about these consultations. Please leave out confidential details. We choose the ten problems we most want to solve. This is interest, not a booking."
- Nothing here promises how long data is kept. Decide that yourself (see "Keeping it safe") and say it aloud if asked.

### What is collected, and where it can be seen
| Data | Collected | Big screen | Who can export it |
|---|---|---|---|
| Display name | named sessions only | only a prize winner's name, after you press R | host only |
| Organisation type, role | yes (onboarding taps) | totals only | host only |
| Cohort (plain or game), timings | yes | totals and counts only | host only |
| Vote, and the reason chosen | yes | totals only; reasons never shown by person | host only |
| Email, company, what the system is, uses | only if the person fills them in | never | host only (Leads CSV and Everything JSON) |
| Free-text comment on the last screen | optional | never | host only |
I checked this with test data: names, emails, company, problem text and comments never appeared in what the big screen or another person's phone receives, and every export refuses anyone who is not signed in.

### The exports (ADDRESS/host, your session, Export card), exactly
- **Leads CSV**: one row for every person who chose an interest option **other than "Not right now"**. Columns: session, display name (named sessions only), organisation type, email, company, interest, uses, problem, time, note. If they chose an option but left no email, they still get a row, with the note "no email given: cannot follow up". **Someone who taps "Not right now" is NOT in the Leads CSV, and nothing else they typed is saved.** Their tap shows up only in the Responses CSV (choice "notnow", no contact details) and in the totals.
- **Responses CSV**: every answer: onboarding, the vote and the reason chosen, ratings, comments, seconds taken, cohort. It never contains emails, company names or problem text.
- **Participants CSV**: who joined, cohort, when, how many things they opened and answered.
- **Summary CSV**: the totals and the cohort comparison, split by organisation type. No names or emails.
- **Everything (JSON)**: all of the above in raw form, including emails, company and problem text, plus the two golden-apple winners and everyone who got the bank vote right, in order. This is the most sensitive file: keep it private.
- **Check the Leads file**: after downloading, open it. The number of rows should equal the interest answers on the host page ("Choices (of N submitted)") minus the "Not right now" count.

### Keeping it safe (your decisions, not the app's)
- Exports contain names and emails. Store them in one private place, not in a shared folder.
- Suggested routine: after you have exported and checked the files, press "Delete this session" on the host page so personal data no longer sits on the server. Keep only the files you need to follow up, and delete leads you cannot use after a period you choose.
- Ghana's Data Protection Act (Act 843) applies to what you collect. I am not a lawyer: have one check the wording above and your retention plan before the event.

## C2. The hosting volume must persist (test it once, right after deploy)
1. Create a throwaway session on the host page, and join it with one phone.
2. In the Railway dashboard, restart the service (or Redeploy).
3. Reload ADDRESS/host. The throwaway session and its participant must still be there.
4. If they are gone, the volume is not mounted at /data or DATA_DIR is not set to /data. Fix that before the event; without it, a restart wipes everything.
5. Then delete the throwaway session. Do not redeploy or restart during the event.

## C3. Straight after the talk (5 minutes, in this order)
1. Leave the session open for about two minutes for late taps.
2. ADDRESS/host, your session, Export: download Leads, Responses, Participants, Summary and Everything.
3. Open the Leads file and check the row count: submitted minus "Not right now" on the host page (see above).
4. Copy all five files to two places (your laptop, and a private cloud folder or an email to yourself).
5. Only then decide about "Delete this session". Follow up with the leads within 48 hours.

## D. 30-minute check before you go on
1. ADDRESS/host: sign in, create the real session (privacy "named" if you want winner names). Leave "Taking part" blank if you do not know the room size.
2. Tablet: open ADDRESS/present/CODE, sign in, tap Projector link, copy it.
3. Projector laptop: open the projector link, double-click once (full screen and sound), press the right arrow on the tablet: the reel should play with sound.
4. One phone on mobile data: scan the QR, join, confirm the join count rises on the projector.
5. Press O/C/R on the tablet once on the vote slide to see the bars move. Then end the test: if you used the real session, create a fresh one.

## E. If the app fails: use the BACKUP-PACK (separate zip)
Slides PDF, both videos, the notes and the plan. Vote with a show of hands. Collect interest with your email or a form (see BACKUP-PLAN.md).
