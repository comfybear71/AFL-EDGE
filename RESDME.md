# 🏉 AFL Edge — Match & Player Prediction Tool

A data-driven AFL prediction app that uses historical statistics to forecast match outcomes, predicted scores, and player stat lines. Powered by the **Champion Data AFL API**.

---

## What It Does

- **Match Predictions** — Win probability, predicted final score, confidence tier
- **Key Factors** — Clearance differential, H2H record, venue history, form, travel
- **Player Props** — Predicted disposals, goals, tackles, and marks per player
- **Visual UI** — Mobile-first dark-themed interface (no app store needed)

---

## Project Structure

```
afl-edge/
├── public/
│   └── index.html          ← The UI (open this in a browser)
├── src/
│   ├── server.js           ← Express server + REST API endpoints
│   ├── api/
│   │   └── champion-data.js  ← Champion Data API client (all endpoints)
│   └── engine/
│       └── predictor.js    ← Core prediction model
├── tests/
│   └── predictor.test.js   ← 33 unit tests (run with: npm test)
├── .env.example            ← Copy to .env and add your API token
├── package.json
└── README.md
```

---

## Quick Start

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/afl-edge.git
cd afl-edge
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up your API token
```bash
cp .env.example .env
```
Then open `.env` and paste in your Champion Data bearer token:
```
AFL_API_TOKEN=your_token_here
```
> **Get API access:** Contact Champion Data at http://servicedesk.championdata.com/

### 4. Run the server
```bash
npm start
```
Then open **http://localhost:3000** in your browser.

### 5. Or just open the UI without the server
```bash
npm run preview
```
This opens `public/index.html` directly — useful for UI development without needing the API.

---

## Running Tests
```bash
npm test
```
Should show **33 passed, 0 failed**.

---

## How the Prediction Model Works

The engine uses a **weighted factor model** — each factor gets a score from 0–1, then they're combined using these weights:

| Factor | Weight | Why |
|---|---|---|
| Recent Form (last 5 games) | 30% | Strongest short-term indicator |
| Average Scoring Margin | 20% | Reflects overall team quality |
| Head to Head Record | 20% | Historical matchup advantage |
| Venue Record | 15% | Ground familiarity matters in AFL |
| Clearance Differential | 10% | Best in-game predictor of scoring |
| Interstate Travel | 5% | Away travel penalises performance |

### Win Probability
Calculated by normalising the two teams' composite scores:
```
homeProb = homeScore / (homeScore + awayScore)
```

### Predicted Score
Uses each team's average attack score vs the opponent's average defensive conceded score, then leans the result based on win probability.

### Player Props
Weighted average of last 5 games (most recent weighted heavier), adjusted for opponent's defensive average against that stat type. Confidence tier (HIGH/MED/LOW) based on the standard deviation of recent performances.

---

## API Endpoints

Once the server is running:

| Endpoint | Description |
|---|---|
| `GET /api/health` | Check server + API token status |
| `GET /api/matches/upcoming` | All upcoming matches this round |
| `GET /api/matches/:id/prediction` | Full prediction for a match |
| `GET /api/matches/:id/players` | Player prop predictions |
| `GET /api/ladder/:seasonId` | Current season ladder |

---

## Connecting Live Odds

The UI shows bookmaker odds for comparison. To wire in live odds automatically, you can add any of these to `src/api/`:
- **Betfair Exchange API** (has an AFL feed)
- **SportsBet / TAB** (scraping only — check their T&Cs)
- **The Odds API** (https://the-odds-api.com) — free tier available

---

## Roadmap

- [ ] Wire all match tabs to live API data
- [ ] Add season-long player performance charts
- [ ] Same Game Multi builder (combine predictions into a multi)
- [ ] Push notifications for high-confidence picks
- [ ] AFLW support (Champion Data already has this data)

---

## Important Note

This tool is for **informational and entertainment purposes only**. Predictions are based on historical statistics and do not guarantee future results. Please gamble responsibly.

**Gambling Help:** 1800 858 858 | www.gamblinghelponline.org.au

---

## License

MIT

