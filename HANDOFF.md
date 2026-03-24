# HANDOFF.md — AFL Edge

## Current State (as of 2026-03-24)

The app is **fully functional and deployed on Vercel**. It serves as an AFL match prediction dashboard powered by the free Squiggle API.

### What's Working

- All 6 API endpoints operational (`health`, `upcoming`, `predict`, `ladder`, `compare`, `debug`)
- 5-view frontend SPA: Dashboard, Matches, Ladder, Stats, Compare
- 6-factor prediction engine blended 70/30 with Squiggle aggregate model
- Season navigation (2023–current year) with automatic fallback to 2025
- Round-by-round browsing with auto-detection of current round
- Team theme selector (club colours applied across UI)
- Mobile-responsive design with scrollable nav tabs
- Hamburger menu for settings
- Live match indicator
- CORS enabled on all API endpoints

### Architecture Summary

```
Browser (index.html SPA)
   ↓ fetch()
Vercel Serverless Functions (api/*.js)
   ↓ https.get()
Squiggle API (api.squiggle.com.au)
```

- **Zero npm dependencies** — no `node_modules`, no build step
- **No environment variables or secrets** — Squiggle API is free/open
- **Single HTML frontend** — all CSS + JS inlined in `public/index.html` (~3500 lines)
- **In-memory caching** in `squiggle.js` with TTLs (2min–24hr depending on query type)

## Recent Changes (Chronological)

Based on git history (oldest → newest):

1. **Initial upload** — Champion Data version with API token requirement
2. **Full rewrite to Squiggle API** — Removed Champion Data dependency, deleted `.env.example`, rebuilt as free/tokenless app
3. **2026 season dashboard** — Complete frontend rebuild with dark theme, 5 views, prediction engine v2.0
4. **Season selector + round navigator** — Added 2023–2025 historical data browsing
5. **API error diagnostics** — Added `/api/debug` endpoint, fixed silent data loading failures
6. **Vercel 404 fix** — Switched from legacy `builds`/`routes` config to auto-detection (`outputDirectory` only in `vercel.json`)
7. **Season navigation arrows** — Prev/next year buttons on hero banner
8. **Team comparison feature** — New `/api/compare` endpoint + Compare view with win probability
9. **Mobile scrollable nav tabs** — Horizontal scroll for nav on small screens
10. **Hamburger menu + team theme selector** — Settings panel with club colour theming

## Known Issues

1. **Monolithic frontend** — `public/index.html` is ~3500 lines of HTML/CSS/JS in one file. Manageable now but will become painful if more features are added.
2. **No automated tests** — All testing is manual via `/api/debug`, `/api/health`, and browser.
3. **Clearance data is synthetic** — Squiggle doesn't provide clearance stats; the engine uses a formula derived from scoring margins as a proxy (`(avgScore - avgConceded) / 3 + 34`).
4. **Interstate travel is heuristic** — Hardcoded lookup tables in `api/predict.js` (`HOME_STATES`, `VENUE_STATES`). New/renamed venues won't be detected automatically.
5. **Cache lost on cold starts** — Vercel serverless functions lose in-memory cache when they scale down. First request after idle hits Squiggle directly.
6. **Year fallback logic duplicated** — Each API endpoint independently implements "try current year, fall back to 2025" logic. Could be centralized.
7. **No offline/error recovery in frontend** — If Squiggle API is down, the UI shows an error state but there's no retry mechanism or cached fallback.
8. **Comment in `upcoming.js` says `year=2025`** — The `@param` docstring references 2025 but the endpoint dynamically selects the year.

## Next Steps / Potential Improvements

### High Priority
- **Add basic tests** — Even simple endpoint smoke tests would catch regressions
- **Centralize year-fallback logic** — Extract the "try current year, fall back" pattern into a shared helper in `squiggle.js`
- **Update venue lookup tables** — Verify all 2026 season venues are in `VENUE_STATES` (stadiums get renamed frequently in Australia)

### Medium Priority
- **Split frontend** — Extract CSS and JS from `index.html` into separate files (`style.css`, `app.js`) for maintainability
- **Add loading skeletons** — Replace blank states with skeleton loaders for better UX during API calls
- **Error retry in frontend** — Add a "Retry" button or automatic retry with backoff when API calls fail
- **PWA support** — Add a service worker and manifest for offline capability and home screen install

### Low Priority / Future
- **Champion Data integration** — For player-level stats (disposals, tackles, goals). Requires paid API access.
- **Historical prediction accuracy tracking** — Compare predictions to actual results, display accuracy rate
- **Notifications** — Push notifications for upcoming matches or live score updates
- **Dark/light theme toggle** — Currently dark-only

## File-by-File Reference

| File | Purpose | Key Details |
|---|---|---|
| `public/index.html` | Entire frontend SPA | ~3500 lines. 5 views: Dashboard, Matches, Ladder, Stats, Compare. Dark theme. Team theming. |
| `api/health.js` | Health check | Returns `{ status: 'ok' }`. No external calls. |
| `api/upcoming.js` | Round fixtures | Auto-detects current round. Returns match list with scores. |
| `api/predict.js` | Match prediction | Core feature. Builds team stats, runs 6-factor engine, blends with Squiggle tips. Contains `HOME_STATES`/`VENUE_STATES` lookup tables. |
| `api/ladder.js` | Standings | Simple passthrough to Squiggle standings data. |
| `api/compare.js` | Team comparison | Logistic regression win probability from composite score (rank, percentage, margin, form, H2H). Historical H2H over 4 years. |
| `api/debug.js` | Diagnostics | Tests Squiggle API for games, standings, teams. Returns pass/fail for each. |
| `squiggle.js` | API client | HTTP client with in-memory cache. Data aggregation helpers (`buildTeamStats`, `calcH2H`, `calcVenueRecord`). |
| `predictor.js` | Prediction engine | 6 weighted factors normalized to probabilities. Predicted scores. Confidence levels (high/medium/low). |
| `vercel.json` | Vercel config | Minimal — only sets `outputDirectory: "public"`. |
| `package.json` | Project metadata | v2.0.0. Zero dependencies. Node >= 18. |

## Environment Requirements

- **Node.js >= 18** (for Vercel serverless runtime)
- **No npm install needed** — zero dependencies
- **No environment variables** — Squiggle API is free and open
- **Vercel account** — for deployment (free tier works fine)
