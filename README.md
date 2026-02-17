# 🏉 AFL Edge — Match & Player Prediction Tool

A data-driven AFL prediction app deployed on **Vercel**.  
Uses the Champion Data AFL API + a weighted statistical model to predict match outcomes and player stat lines.

---

## Live URL
Once deployed: `https://afl-edge.vercel.app` (or your custom domain)

---

## Project Structure

```
afl-edge/
├── public/
│   └── index.html          ← The full mobile UI
├── api/
│   ├── health.js           ← GET /api/health
│   ├── upcoming.js         ← GET /api/upcoming
│   ├── predict.js          ← GET /api/predict?matchId=xxx
│   └── players.js          ← GET /api/players?matchId=xxx
├── predictor.js            ← Prediction engine (6-factor weighted model)
├── champion-data.js        ← Champion Data API client
├── vercel.json             ← Vercel routing config
├── package.json
├── .env.example            ← Copy to .env for local testing
└── README.md
```

---

## Deploy to Vercel (Step by Step)

### Step 1 — Push to GitHub
1. Create a new repo at github.com (name it `afl-edge`)
2. Upload all these files (drag & drop on GitHub works fine)
3. Commit

### Step 2 — Connect to Vercel
1. Go to **vercel.com** and sign in (use your GitHub account)
2. Click **Add New Project**
3. Click **Import** next to your `afl-edge` GitHub repo
4. Leave all settings as default — Vercel detects the config automatically
5. Click **Deploy**

### Step 3 — Add your API token
1. In Vercel, go to your project → **Settings** → **Environment Variables**
2. Add a new variable:
   - **Name:** `AFL_API_TOKEN`
   - **Value:** your Champion Data bearer token
   - **Environment:** Production, Preview, Development (tick all three)
3. Click **Save**
4. Go to **Deployments** → click the three dots on your latest deploy → **Redeploy**

That's it — your app is live! 🎉

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/health` | Check server status + token |
| `GET /api/upcoming` | Upcoming matches this round |
| `GET /api/predict?matchId=xxx` | Full prediction for a match |
| `GET /api/players?matchId=xxx` | Player prop predictions |

> Get match IDs from `/api/upcoming` first, then pass them to `/api/predict`

---

## How the Prediction Model Works

Six weighted factors combine into a win probability:

| Factor | Weight |
|---|---|
| Recent Form (last 5 games) | 30% |
| Average Scoring Margin | 20% |
| Head to Head Record | 20% |
| Venue Record | 15% |
| Clearance Differential | 10% |
| Interstate Travel | 5% |

---

## Get Champion Data API Access
Contact: http://servicedesk.championdata.com/

---

## Responsible Gambling
This tool is for informational purposes only.  
**Gambling Help:** 1800 858 858 | www.gamblinghelponline.org.au
