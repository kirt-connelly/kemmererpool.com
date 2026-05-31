# kemmererpool.com

Official site for the Kemmerer Pool League — Jenkins Music & Vending.

Displays live standings, player stats, and schedules for both the **8-Ball** and **10-Ball** divisions, powered by the [FargoRate LMS](https://fargorate.com) public report API.

---

## How it works

```
Browser → kemmererpool.com/proxy?url=... → Cloudflare Worker → lms.fargorate.com
```

The `_worker.js` file is a Cloudflare Pages Function that proxies requests to FargoRate, adding the CORS headers the browser needs. No API key required — FargoRate's public report endpoints are open.

---

## Deployment (Cloudflare Pages)

### 1. Push this repo to GitHub

```bash
git init
git add .
git commit -m "Initial Kemmerer Pool League site"
git remote add origin https://github.com/kirt-connelly/kemmererpool.com.git
git push -u origin main
```

### 2. Connect to Cloudflare Pages

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Workers & Pages → Create → Pages**
3. Connect to your GitHub repo `kirt-connelly/kemmererpool.com`
4. Build settings:
   - **Framework preset**: None
   - **Build command**: *(leave blank)*
   - **Build output directory**: `/` (root)
5. Click **Save and Deploy**

Cloudflare automatically detects `_worker.js` and deploys it as a Pages Function on the same domain — no extra config needed.

### 3. Add your custom domain

1. In your Cloudflare Pages project → **Custom domains**
2. Add `kemmererpool.com` and `www.kemmererpool.com`
3. Cloudflare will handle DNS automatically since your domain is already on Cloudflare

---

## Division IDs

| Division | ID |
|---|---|
| Kemmerer 8 Ball League 25-26 | `1dc8b2aa-62eb-41a6-a8f6-b379014efe83` |
| Kemmerer Summer 10 Ball 2026 | `c97cf1bf-ff08-44a0-b916-b4520124b3e6` |
| Jenkins League (parent) | `6e402f34-de51-4e68-9e30-aeeb014fb597` |

To add future seasons, update the `DIVISIONS` object in `index.html`.

---

## File structure

```
kemmererpool.com/
├── index.html      ← full single-page app
├── _worker.js      ← Cloudflare Worker proxy (auto-deployed by Pages)
├── _headers        ← security & cache headers
└── README.md
```

---

## Local development

You can preview the site locally but live data won't load (the `/proxy` route only exists on Cloudflare). Open `index.html` directly in a browser — it will show demo data with a notice.

To test the proxy locally, install [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
npm install -g wrangler
wrangler pages dev . --port 8080
```

Then open `http://localhost:8080` — live data will work.

---

Built with ♟ by Kirt Connelly · Powered by FargoRate
