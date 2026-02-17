/**
 * GET /api/debug
 * Diagnostics endpoint — tests Squiggle API connectivity and returns raw results.
 */
const squiggle = require('../squiggle');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const results = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    tests: {},
  };

  // Test 1: Fetch 2025 games
  try {
    const games = await squiggle.getGames(2025);
    results.tests.games2025 = {
      ok: true,
      count: games.length,
      sample: games.length > 0 ? { id: games[0].id, round: games[0].round, hteam: games[0].hteam, ateam: games[0].ateam } : null,
    };
  } catch (err) {
    results.tests.games2025 = { ok: false, error: err.message };
  }

  // Test 2: Fetch 2025 standings
  try {
    const standings = await squiggle.getStandings(2025);
    results.tests.standings2025 = {
      ok: true,
      count: standings.length,
      sample: standings.length > 0 ? { name: standings[0].name, rank: standings[0].rank } : null,
    };
  } catch (err) {
    results.tests.standings2025 = { ok: false, error: err.message };
  }

  // Test 3: Fetch 2026 games (should be empty)
  try {
    const games = await squiggle.getGames(2026);
    results.tests.games2026 = {
      ok: true,
      count: games.length,
    };
  } catch (err) {
    results.tests.games2026 = { ok: false, error: err.message };
  }

  // Test 4: Fetch teams
  try {
    const teams = await squiggle.getTeams();
    results.tests.teams = {
      ok: true,
      count: teams.length,
    };
  } catch (err) {
    results.tests.teams = { ok: false, error: err.message };
  }

  res.json(results);
};
