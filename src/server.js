
/**
 * AFL Edge — Express Server
 * 
 * REST API that the frontend calls.
 * Bridges Champion Data API + Prediction Engine.
 * 
 * Endpoints:
 *   GET /api/matches/upcoming        → upcoming matches this round
 *   GET /api/matches/:id/prediction  → full prediction for a match
 *   GET /api/players/:id/props       → player prop predictions
 *   GET /api/ladder/:seasonId        → current ladder
 */

require('dotenv').config();

const express = require('express');
const path    = require('path');
const api     = require('./api/champion-data');
const engine  = require('./engine/predictor');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'))); // serve the HTML UI

// CORS for local dev
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// ─── CURRENT SEASON HELPER ───────────────────────────────────────────────────
// Automatically detect the current AFL season year
async function getCurrentSeasonId() {
  if (process.env.AFL_SEASON_ID) return parseInt(process.env.AFL_SEASON_ID);
  const seasons = await api.getSeasons();
  const latest = seasons?.seasons?.[seasons.seasons.length - 1];
  return latest?.id || new Date().getFullYear();
}

// ─── ERROR WRAPPER ────────────────────────────────────────────────────────────
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Quick health check — also verifies API token is set.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    tokenSet: !!process.env.AFL_API_TOKEN,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/matches/upcoming
 * Returns all upcoming matches with basic team info.
 */
app.get('/api/matches/upcoming', asyncHandler(async (req, res) => {
  const seasonId = await getCurrentSeasonId();
  const matches  = await api.getUpcomingMatches(seasonId);
  res.json({ seasonId, count: matches.length, matches });
}));

/**
 * GET /api/matches/:matchId/prediction
 * Returns full prediction: win prob, predicted score, key factors, player props.
 * 
 * This is the main endpoint the UI calls when a match tab is tapped.
 */
app.get('/api/matches/:matchId/prediction', asyncHandler(async (req, res) => {
  const matchId  = parseInt(req.params.matchId);
  const seasonId = await getCurrentSeasonId();

  // 1. Get match details
  const match   = await api.getMatch(matchId);
  const venue   = await api.getMatchVenue(matchId);
  const fixture = await api.getFixture(seasonId);

  // Flatten all matches for stat building
  const allMatches = [];
  for (const phase of fixture.phases || []) {
    for (const round of phase.rounds || []) {
      allMatches.push(...(round.matches || []));
    }
  }

  const homeId = match.home?.id;
  const awayId = match.away?.id;

  // 2. Build aggregated team stats (last 6 completed games)
  const [homeStats, awayStats] = await Promise.all([
    api.buildTeamStats(homeId, seasonId, allMatches, 6),
    api.buildTeamStats(awayId, seasonId, allMatches, 6),
  ]);

  if (!homeStats || !awayStats) {
    return res.status(422).json({ error: 'Not enough match history to generate prediction' });
  }

  // 3. Head to head record
  const h2hMatches = allMatches.filter(m => {
    const ids = [m.squads?.home?.id, m.squads?.away?.id];
    return ids.includes(homeId) && ids.includes(awayId) && m.status?.typeName === 'Completed';
  });

  homeStats.h2hWins   = h2hMatches.filter(m => {
    const isHome = m.squads?.home?.id === homeId;
    return isHome
      ? m.squads.home.score.points > m.squads.away.score.points
      : m.squads.away.score.points > m.squads.home.score.points;
  }).length;
  homeStats.h2hPlayed = h2hMatches.length;
  awayStats.h2hWins   = h2hMatches.length - homeStats.h2hWins;
  awayStats.h2hPlayed = h2hMatches.length;

  // 4. Venue record
  const venueId = venue.id;
  const venueMatches = allMatches.filter(m =>
    m.venue?.id === venueId && m.status?.typeName === 'Completed'
  );
  const homeVenueMatches = venueMatches.filter(m =>
    m.squads?.home?.id === homeId || m.squads?.away?.id === homeId
  );
  homeStats.venueWins   = homeVenueMatches.filter(m => {
    const isHome = m.squads?.home?.id === homeId;
    return isHome
      ? m.squads.home.score.points > m.squads.away.score.points
      : m.squads.away.score.points > m.squads.home.score.points;
  }).length;
  homeStats.venuePlayed = homeVenueMatches.length;

  // Away team venue record
  const awayVenueMatches = venueMatches.filter(m =>
    m.squads?.home?.id === awayId || m.squads?.away?.id === awayId
  );
  awayStats.venueWins   = awayVenueMatches.filter(m => {
    const isHome = m.squads?.home?.id === awayId;
    return isHome
      ? m.squads.home.score.points > m.squads.away.score.points
      : m.squads.away.score.points > m.squads.home.score.points;
  }).length;
  awayStats.venuePlayed = awayVenueMatches.length;

  // Travel flag
  homeStats.travellingInterstate = venue.home?.interstateTravel || false;
  awayStats.travellingInterstate = venue.away?.interstateTravel || false;

  // Add team name/code
  homeStats.name = match.home?.name;
  homeStats.code = match.home?.code;
  awayStats.name = match.away?.name;
  awayStats.code = match.away?.code;

  // 5. Run prediction engine
  const prediction = engine.predictMatch(homeStats, awayStats, {
    id: venue.id,
    name: venue.name,
    code: venue.code,
  });

  // 6. Add line market value assessment
  prediction.lineAssessment = assessLineBet(prediction);

  res.json({
    matchId,
    match: {
      name: match.name,
      date: match.date,
      venue: { name: venue.name, code: venue.code },
      status: match.status,
    },
    prediction,
  });
}));

/**
 * GET /api/matches/:matchId/players
 * Returns top player prop predictions for a match.
 */
app.get('/api/matches/:matchId/players', asyncHandler(async (req, res) => {
  const matchId  = parseInt(req.params.matchId);
  const seasonId = await getCurrentSeasonId();
  const match    = await api.getMatch(matchId);
  const fixture  = await api.getFixture(seasonId);

  const allMatches = [];
  for (const phase of fixture.phases || []) {
    for (const round of phase.rounds || []) {
      allMatches.push(...(round.matches || []));
    }
  }

  // Get players for both squads
  const homeId = match.home?.id;
  const awayId = match.away?.id;

  const [homePlayers, awayPlayers] = await Promise.all([
    api.getSquadPlayers(seasonId, homeId),
    api.getSquadPlayers(seasonId, awayId),
  ]);

  const allPlayers = [
    ...(homePlayers.players || []).map(p => ({ ...p, squadId: homeId, squadCode: match.home?.code })),
    ...(awayPlayers.players || []).map(p => ({ ...p, squadId: awayId, squadCode: match.away?.code })),
  ];

  // Get historical stats for key players (limit to avoid rate limits)
  const completedMatches = allMatches
    .filter(m => m.status?.typeName === 'Completed')
    .slice(-10);

  // Load player stats for recent matches
  const matchStatsCache = {};
  for (const m of completedMatches) {
    try {
      const stats = await api.getMatchPlayerStats(m.id, {
        metric: ['DISPOSAL', 'GOAL', 'TACKLE', 'MARK'],
      });
      matchStatsCache[m.id] = stats;
    } catch { /* skip failed matches */ }
  }

  // Build predictions for key stat types
  const propPredictions = [];
  const statCodes = ['DISPOSAL', 'GOAL', 'TACKLE', 'MARK'];

  for (const player of allPlayers.slice(0, 30)) { // top 30 players
    for (const statCode of statCodes) {
      const history = api.buildPlayerStatHistory(
        player.personId,
        statCode,
        completedMatches.map(m => ({
          ...m,
          playerStats: {
            home: matchStatsCache[m.id]?.squads?.find(s => s.id === m.squads?.home?.id)?.players || [],
            away: matchStatsCache[m.id]?.squads?.find(s => s.id === m.squads?.away?.id)?.players || [],
          }
        }))
      );

      if (history.length >= 3) {
        const pred = engine.predictPlayerStat(
          { ...player, statHistory: { [statCode]: history } },
          {}, // opponent defensive stats — add later once we have team-level conceded data
          statCode
        );
        if (pred) propPredictions.push({ ...pred, squad: player.squadCode });
      }
    }
  }

  // Group by stat type, sort by predicted value
  const grouped = {};
  for (const pred of propPredictions) {
    if (!grouped[pred.statCode]) grouped[pred.statCode] = [];
    grouped[pred.statCode].push(pred);
  }
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => b.predicted - a.predicted);
    grouped[key] = grouped[key].slice(0, 5); // top 5 per stat
  }

  res.json({ matchId, playerProps: grouped });
}));

/**
 * GET /api/ladder/:seasonId
 * Returns current ladder.
 */
app.get('/api/ladder/:seasonId', asyncHandler(async (req, res) => {
  const ladder = await api.getLadder(parseInt(req.params.seasonId));
  res.json(ladder);
}));

// ─── HELPERS ──────────────────────────────────────────────────────────────────
/**
 * Assess whether the line bet has value based on predicted margin.
 * "Value" = when predicted margin differs meaningfully from the bookmaker line.
 */
function assessLineBet(prediction) {
  const margin = prediction.predictedMargin;
  const favCode = prediction.predictedWinner;

  return {
    predictedWinner: favCode,
    predictedMargin: margin,
    // Note: line values come from the bookmaker (not this API)
    // Wire up to a odds API to get live line values
    recommendation: margin > 25
      ? `Strong lean to ${favCode} — consider handicap bet`
      : margin > 12
      ? `Moderate lean to ${favCode} — check the line`
      : 'Close game — line bet is risky',
  };
}

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(`[AFL Edge] Error: ${err.message}`);
  res.status(500).json({
    error: err.message,
    hint: err.message.includes('AFL_API_TOKEN')
      ? 'Add your Champion Data token to the .env file'
      : 'Check the server logs for details',
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏉 AFL Edge running at http://localhost:${PORT}`);
  console.log(`   API token: ${process.env.AFL_API_TOKEN ? '✅ set' : '❌ missing — add to .env'}`);
  console.log(`   Season:    ${process.env.AFL_SEASON_ID || 'auto-detect'}\n`);
});

module.exports = app;
