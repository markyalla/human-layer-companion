# Run The Human Layer from your Mac

The Mac runs the server and feeds the projector. The tablet is your controller. Phones join over the same network.

## One-time setup (do this at home, with internet)
1. Install Node: download the LTS installer from nodejs.org and open it. Check in Terminal: `node -v` (needs 18 or higher).
2. Get the app: unzip `human-layer-companion-updated.zip` to your Desktop, or download this repo as a zip from GitHub.
3. In Terminal: `cd ~/Desktop/human-layer-companion` (use your folder name), then `npm install`.

## Every time you run it
1. Join the network the phones will use: your iPhone's Personal Hotspot, or the venue Wi-Fi. The tablet joins the same one.
2. Keep the Mac awake and plugged in. In Terminal:
   `ORGANISER_PASSWORD='your-long-passphrase' caffeinate -dis node server.js`
   Leave this window open. If macOS asks "accept incoming network connections?", choose Allow.
3. Find the Mac's address: in a second Terminal tab run `ipconfig getifaddr en0`. It looks like `192.168.x.x` or `172.20.10.x`. Call it IP.
4. Open `http://IP:3000/health` on your phone (same network). You should see `{"ok":true...}`. If it never loads, this network blocks devices from reaching each other: switch network.
5. On the Mac, open `http://IP:3000/host`. Do not use `localhost`: the QR code copies whatever address you opened. Log in and create the session.
6. Projector: plug in HDMI. System Settings, Displays, set the projector to Extend. Open the projector link from the host dashboard in a browser window, drag it to the projector screen, press Control-Command-F for full screen.
7. Tablet: open `http://IP:3000/present/CODE` (CODE is the session code). This is your controller with notes.
8. Check the QR on the projector with one phone before the room fills.

## During the talk
- Do not close the Terminal window, do not let the Mac sleep, do not change networks.
- If the tablet or projector page is refreshed, it returns to the current slide by itself.

## After the talk
- In the host dashboard, open Export and download the leads CSV and the Everything (JSON) file straight away.
- Then press Control-C in Terminal to stop the server.

## If something fails
- Phones will not load: confirm they are on the same network as the Mac, and re-run step 4.
- QR shows localhost: you opened the host page with localhost. Reopen it with IP.
- Mac went to sleep: wake it; the app keeps its data and everyone reconnects by themselves.
- Still stuck: use the no-app version (hands up, PDF deck).

## Limits
A phone hotspot holds only a handful of devices, and cheap routers struggle past 30 to 60. For 100 people use venue Wi-Fi you have tested, or a proper access point.
