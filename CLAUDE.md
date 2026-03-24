# CLAUDE.md — AFL Edge

## Project Overview

AFL Edge is a free AFL (Australian Football League) match prediction and season dashboard web app. It uses the **Squiggle API** (free, no token/signup) as its sole data source and deploys as a static + serverless app on **Vercel**.

Live URL: Deployed via Vercel (auto-deploys from GitHub `master` branch).

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Single-page HTML/CSS/JS | `public/index.html` (~3500 lines) — no framework, no build step |
| Backend | Node.js serverless functions | `api/*.js` — Vercel serverless functions (Node >= 18) |
| Data source | Squiggle API | `https://api.squiggle.com.au/` — free, no auth |
| Hosting | Vercel | Auto-detected via `vercel.json` (`outputDirectory: "public"`) |
| Dependencies | None | Zero npm dependencies — pure Node.js `https` module |

## Repository Structure

```
AFL-EDGE/
├── public/
│   └── index.html          ← Entire frontend SPA (HTML + CSS + JS in one file)
├── api/
│   ├── health.js           ← GET /api/health — status check
│   ├── upcoming.js         ← GET /api/upcoming?year=&round= — round fixtures/scores
│   ├── predict.js          ← GET /api/predict?matchId= — full match prediction
│   ├── ladder.js           ← GET /api/ladder?year= — AFL standings
│   ├── compare.js          ← GET /api/compare?team1=&team2=&year= — team comparison
│   └── debug.js            ← GET /api/debug — Squiggle connectivity diagnostics
├── squiggle.js             ← Squiggle API client (HTTP, caching, data helpers)
├── predictor.js            ← 6-factor weighted prediction engine
├── vercel.json             ← Vercel config (output directory only)
├── package.json            ← v2.0.0, zero dependencies, Node >= 18
└── README.md               ← User-facing deploy guide
```

## API Endpoints

| Endpoint | Method | Params | Description |
|---|---|---|---|
| `/api/health` | GET | — | Returns `{ status: 'ok' }` with timestamp |
| `/api/upcoming` | GET | `year`, `round` (optional) | Returns matches for a round. Auto-detects current round if omitted. Falls back to 2025 if current year has no data. |
| `/api/predict` | GET | `matchId` (required), `year` (optional) | Full prediction for a match — our engine blended 70/30 with Squiggle aggregate model |
| `/api/ladder` | GET | `year` (optional) | AFL standings/ladder. Falls back to 2025 if needed. |
| `/api/compare` | GET | `team1`, `team2` (required), `year` (optional) | Head-to-head comparison with win probability (logistic model) |
| `/api/debug` | GET | — | Tests Squiggle API connectivity, returns raw diagnostic data |

All API endpoints set `Access-Control-Allow-Origin: *` for CORS.

## Prediction Engine (`predictor.js`)

Weighted multi-factor model using 6 factors:

| Factor | Weight | Source |
|---|---|---|
| Recent form (last 5-6 games, recency-weighted) | 30% | Squiggle games |
| Head-to-head record (last 10 meetings, 3 years) | 20% | Squiggle games |
| Scoring margin differential | 20% | Squiggle games |
| Venue record / home ground advantage | 15% | Squiggle games |
| Clearance proxy (derived from scoring flow) | 10% | Computed from scores |
| Interstate travel penalty | 5% | Heuristic lookup tables |

The raw engine output is **blended 70% our model / 30% Squiggle aggregate** (average of ~16 expert prediction models) in `api/predict.js`.

Predicted scores use a 60/40 blend of team average score and opponent average conceded, adjusted by probability skew.

## Squiggle API Client (`squiggle.js`)

- Uses native Node.js `https` module (no axios/fetch polyfill)
- In-memory cache (`Map`) with configurable TTL per query type:
  - Teams: 24 hours
  - Games: 2 minutes
  - Standings: 5 minutes
  - Tips: 2 minutes
- User-Agent: `AFLEdge/1.0 (contact via github)`
- Handles rate limiting (HTTP 429) with error propagation
- Helper functions: `buildTeamStats()`, `calcH2H()`, `calcVenueRecord()`

## Frontend (`public/index.html`)

Single HTML file containing all CSS and JavaScript. No build step.

### Views / Tabs

1. **Dashboard** — Hero banner with season stats, round navigator with quick-jump pills, scores ticker for selected round, ladder snapshot (top 8)
2. **Matches** — Tab-based match selector, full prediction display with factor breakdown, form dots, Squiggle model cross-check, line assessment
3. **Ladder** — Full 18-team standings table with rank, W/L/D, percentage, form streak
4. **Stats** — Season-wide team statistics: average scores, margins, best/worst form
5. **Compare** — Head-to-head team comparison with dropdown selectors, win probability bar, H2H history, recent matchups

### UI Features

- Dark theme with CSS custom properties
- Team theme selector (hamburger menu → Settings) — applies club colours across UI
- Season selector dropdown (2023–current year) with arrow navigation
- Round navigation (prev/next arrows + numbered pills)
- Live match indicator
- Mobile-first responsive design with horizontally scrollable nav tabs
- Animations via CSS transitions
- Responsible gambling notice in footer

### Fonts

- Barlow Condensed (headings/logo)
- Barlow (body text)
- Loaded from Google Fonts CDN

## Key Design Decisions

- **Zero dependencies**: No npm packages — reduces maintenance burden and build complexity
- **No build step**: Frontend is a single HTML file, backend is plain CommonJS — Vercel auto-detects
- **Squiggle-only**: Free data source means no API keys, no env vars, no secrets to manage
- **In-memory caching**: Serverless cache resets on cold starts; TTLs keep data fresh enough
- **Fallback year logic**: All endpoints try current year first, fall back to 2025 if no data exists (handles off-season)
- **Interstate travel heuristic**: Lookup tables map team→home state and venue→state; not perfect but covers all standard venues

## Development

### Local Development

```bash
# Install Vercel CLI
npm i -g vercel

# Run locally (no npm install needed — zero deps)
vercel dev
```

The app will be available at `http://localhost:3000`.

### Deployment

Push to GitHub `master` branch → Vercel auto-deploys. No environment variables or secrets needed.

### Testing

No automated test suite. Manual testing via:
- `/api/debug` — Squiggle API connectivity check
- `/api/health` — Basic health check
- Browser testing of all 5 views

## Known Limitations

1. **No player-level stats** — Squiggle doesn't provide disposal counts, tackles, goals by player. Would need Champion Data API (paid) for that.
2. **Clearance proxy is approximate** — Derived from scoring margin, not actual clearance data.
3. **Serverless cold starts** — In-memory cache is lost on cold starts; first request after idle may be slow.
4. **Single HTML file** — At ~3500 lines, the monolithic frontend is hard to maintain. Consider splitting if it grows further.
5. **No automated tests** — All validation is manual.
6. **Interstate travel lookup** — Hardcoded venue/state mappings; new or renamed venues need manual updates.
7. **H2H data limited to 3 years** — `api/predict.js` fetches H2H from year-3 to current year only.

## Git Workflow

- `master` branch is production (auto-deploys to Vercel)
- Feature branches follow pattern `claude/<feature-name>-<id>`
- PRs merge to `master`
