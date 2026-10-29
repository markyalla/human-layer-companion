# Deploy on a DigitalOcean droplet

Ubuntu 24.04, 1 GB, Frankfurt or London. Replace 203.0.113.10 with your droplet IP and use your own passphrase.

1. From your Mac: `scp human-layer-companion-final.zip root@203.0.113.10:/root/`
2. `ssh root@203.0.113.10`
3. `apt update && apt install -y curl unzip ufw && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs`
4. `ufw allow OpenSSH && ufw allow 3000 && ufw --force enable` (use 80 and 443 instead of 3000 if you add Caddy and a domain)
5. `cd /root && unzip human-layer-companion-final.zip && cd human-layer-companion && npm install`
6. Create the service (change the passphrase):
```
cat > /etc/systemd/system/humanlayer.service <<'EOF'
[Unit]
Description=Human Layer
After=network.target
[Service]
WorkingDirectory=/root/human-layer-companion
Environment=ORGANISER_PASSWORD=my-long-passphrase-2026
Environment=DATA_DIR=/root/human-layer-data
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now humanlayer && systemctl status humanlayer
```
7. Check `http://203.0.113.10:3000/health` shows ok, then open `http://203.0.113.10:3000/host` (by IP, never localhost) and create the session.
8. Test that data survives: `systemctl restart humanlayer`, then check your session is still there.
9. Logs: `journalctl -u humanlayer -n 50`. Update: unzip a new version over the folder, then `systemctl restart humanlayer`.
10. Export the CSVs straight after the talk. Destroy the droplet when finished.

Optional HTTPS: point a domain at the droplet, `apt install -y caddy`, put `yourdomain.com { reverse_proxy localhost:3000 }` in /etc/caddy/Caddyfile, `systemctl restart caddy`.
