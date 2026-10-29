# Start here: running the companion app

This is a small server, not a file you double-click. It has to be running, and phones must be able to reach it over the internet.

## A. Try it on your own laptop (5 minutes)
1. Install Node.js (the LTS version) from nodejs.org.
2. Unzip this folder. Open a terminal in it.
3. Run:
   - Mac or Linux: `npm install` then `ORGANISER_PASSWORD=pick-a-password npm start`
   - Windows PowerShell: `npm install` then `$env:ORGANISER_PASSWORD="pick-a-password"; npm start`
4. Open http://localhost:3000/host in your browser and sign in with that password.
5. Click create session. You will see the QR code, the join link, "Open big screen" and the buttons to open, close and reveal each activity.
6. The talk page: http://localhost:3000/present/CODE (use the session code shown on the dashboard).

Phones cannot reach "localhost". To test with real phones from your laptop, use a tunnel, for example `npx localtunnel --port 3000` or ngrok (`ngrok http 3000`), then open the dashboard through the public https address it gives you. The QR code is built from the address you opened the dashboard on, so it will then point to the public address.

## B. Put it online for the real room (needed for the day)
Any host that runs Node works (Render, Railway, Fly.io).
- Render: put this folder in a GitHub repo, create a new Web Service from it. `render.yaml` in this folder sets the build and start commands. Add the environment variable ORGANISER_PASSWORD. Without a persistent disk, data is lost when the service restarts, so export the CSVs straight after the talk. Free plans sleep: open the site ten minutes before you go on.
- Run only one copy.
- Use the https address it gives you to open /host. Create the session from that address so the QR code is right.

## C. On the day
- Open the dashboard and the talk page on the laptop that is connected to the projector.
- Test with 5 or more real phones on the venue wifi beforehand. This has NOT been done yet.
