# 🏉 AFL Edge — Match Predictor (Free Version)

Powered by the **Squiggle API** — completely free, no token or signup needed.

Live at: `https://your-app.vercel.app` after deployment

---

## What's different about this version

| Feature | This version | Champion Data version |
|---|---|---|
| Cost | **Free** | Paid (contact Champion Data) |
| Token required | **No** | Yes |
| Match scores & fixture | ✅ | ✅ |
| Win predictions | ✅ (16 models) | ✅ |
| Ladder / standings | ✅ | ✅ |
| Player stats (disposals etc.) | ❌ | ✅ |
| Advanced stats (clearances etc.) | ❌ | ✅ |

---

## Deploy to Vercel (2 steps, no config needed)

### Step 1 — Push to GitHub
1. Create a new repo at github.com → call it `afl-edge`
2. Drag and drop all these files into the repo
3. Commit

### Step 2 — Deploy on Vercel
1. Go to **vercel.com** → sign in with GitHub
2. Click **Add New Project** → Import `afl-edge`
3. Click **Deploy** — that's it, no environment variables needed!

Your app will be live in ~30 seconds. 🎉

Every time you push to GitHub, Vercel redeploys automatically.

---

## Project Structure

```
afl-edge/
├── public/
│   └── index.html      ← Mobile UI
├── api/
│   ├── health.js       ← GET /api/health
│   ├── upcoming.js     ← GET /api/upcoming
│   ├── predict.js      ← GET /api/predict?matchId=xxx
│   └── ladder.js       ← GET /api/ladder
├── squiggle.js         ← Squiggle API client
├── predictor.js        ← 6-factor prediction engine
├── vercel.json         ← Routing config
└── package.json
```

---

## How predictions work

Our engine uses **6 weighted factors** from Squiggle data:

| Factor | Weight |
|---|---|
| Recent form (last 5 games) | 30% |
| Average scoring margin | 20% |
| Head to head record (last 3 years) | 20% |
| Venue record | 15% |
| Scoring differential (clearance proxy) | 10% |
| Interstate travel | 5% |

The result is then **blended 70/30 with Squiggle's aggregate model** — an average of 16 expert prediction models — giving you the best of both worlds.

---

## Squiggle API

Built by Max Barry. Free forever. https://api.squiggle.com.au

Please be kind to it — don't hammer it with requests.

---

## Upgrade path

When you're ready for player-level stats (disposals, tackles, goals), upgrade to the Champion Data API version. Contact them at http://servicedesk.championdata.com/

---

## Responsible Gambling
For informational purposes only.
**Gambling Help:** 1800 858 858 | www.gamblinghelponline.org.au
