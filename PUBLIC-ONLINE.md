# Put the website online (free)

Admin panel stays private: it only opens on the shop laptop at http://localhost:3000/admin.html.
Customers use the public link for the website and print uploads.

## Option A - Free link, no domain needed (quick, changes each time)
1. Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Terminal 1: `npm start`
3. Terminal 2: `cloudflared tunnel --url http://localhost:3000`
4. It prints https://something.trycloudflare.com - that is your public link.
   The link changes every time you restart cloudflared.

## Option B - Free link that never changes (ngrok static domain)
1. Make a free account at ngrok.com, install ngrok, run `ngrok config add-authtoken <token>`
2. In the ngrok dashboard > Domains, claim your free static domain (e.g. yourname.ngrok-free.app)
3. `npm start`, then `ngrok http --domain=yourname.ngrok-free.app 3000`

## Option C - Your own subdomain, permanent (needs a domain, ~Rs 100-800/yr)
1. Add the domain to a free Cloudflare account (change nameservers).
2. `cloudflared tunnel login`
3. `cloudflared tunnel create gupta-cyber-cafe`
4. `cloudflared tunnel route dns gupta-cyber-cafe print.yourdomain.com`
5. `cloudflared tunnel run --url http://localhost:3000 gupta-cyber-cafe`
6. Windows: `cloudflared service install` to start automatically with the laptop.

The laptop and `npm start` must be on for the website to work.
