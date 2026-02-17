/**
 * AFL Edge — Squiggle API Client
 * 
 * Free, no token required.
 * Base URL: https://api.squiggle.com.au/
 * 
 * Available data:
 *   ?q=games        — fixture + results (scores, venue, round)
 *   ?q=standings    — ladder
 *   ?q=tips         — win predictions from multiple models
 *   ?q=teams        — team list with IDs
 *   ?q=sources      — prediction model list
 */

const https = require('https');

const BASE   = 'https://api.squiggle.com.au/';
// Squiggle asks you to identify yourself in the User-Agent
const UA     = 'AFLEdge/1.0 (contact via github)';
const cache  = new Map();

// ─── HTTP ─────────────────────────────────────────────────────────────────────
function squiggleGet(params, ttlSeconds = 300) {
  const qs  = new URLSearchParams({ ...params }).toString();
  const url = `${BASE}?${qs}`;

  const hit = cache.get(url);
  if (hit && Date.now() < hit.exp) return Promise.resolve(hit.data);

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode === 429) {
          return reject(new Error('Squiggle rate limit hit — wait a moment and retry'));
        }
        try {
          const data = JSON.parse(raw);
          cache.set(url, { data, exp: Date.now() + ttlSeconds * 1000 });
          resolve(data);
        } catch (e) {
          reject(new Error(`Squiggle parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ─── TEAMS ────────────────────────────────────────────────────────────────────
/** Returns all 18 AFL teams with id, name, abbrev */
async function getTeams() {
  const data = await squiggleGet({ q: 'teams' }, 86400); // cache 24hrs
  return data.teams || [];
}

// ─── GAMES ────────────────────────────────────────────────────────────────────
/**
 * Get games for a year (and optional round).
 * Each game has: id, year, round, roundname, hteam, ateam, hscore, ascore,
 *               venue, date, complete (0-100%), winnter, is_final
 */
async function getGames(year, round = null) {
  const params = { q: 'games', year };
  if (round !== null) params.round = round;
  const data = await squiggleGet(params, 120);
  return data.games || [];
}

/**
 * Get just upcoming games (complete = 0)
 */
async function getUpcoming(year) {
  const games = await getGames(year);
  return games.filter(g => g.complete === 0);
}

/**
 * Get completed games for a year (complete = 100)
 */
async function getCompleted(year) {
  const games = await getGames(year);
  return games.filter(g => g.complete === 100);
}

/**
 * Get last N completed games for a specific team
 * @param {string} teamName  — e.g. 'Sydney'
 * @param {number} year
 * @param {number} n
 */
async function getTeamRecentGames(teamName, year, n = 8) {
  const completed = await getCompleted(year);
  return completed
    .filter(g => g.hteam === teamName || g.ateam === teamName)
    .slice(-n);
}

// ─── STANDINGS / LADDER ───────────────────────────────────────────────────────
/**
 * Get ladder for a year (and optional round).
 * Each entry: rank, name, wins, losses, draws, played, for, against, percentage
 */
async function getStandings(year, round = null) {
  const params = { q: 'standings', year };
  if (round !== null) params.round = round;
  const data = await squiggleGet(params, 300);
  return data.standings || [];
}

// ─── TIPS (PREDICTIONS) ───────────────────────────────────────────────────────
/**
 * Get tips (predictions) for a round from all models.
 * Each tip: hteam, ateam, hconfidence (0-100), correct, margin, err
 * 
 * hconfidence = probability (0-100) that HOME team wins
 * source = which prediction model made this tip
 */
async function getTips(year, round = null) {
  const params = { q: 'tips', year };
  if (round !== null) params.round = round;
  const data = await squiggleGet(params, 120);
  return data.tips || [];
}

/**
 * Get the AGGREGATE tip for a specific matchup this round.
 * Squiggle source id=8 is the "Aggregate" model — average of all models.
 * Falls back to first available tip if aggregate not found.
 */
async function getAggregateTip(year, round, hteam, ateam) {
  const tips = await getTips(year, round);
  const matchTips = tips.filter(t =>
    t.hteam === hteam && t.ateam === ateam
  );
  // Prefer the aggregate model (sourceid 8)
  return matchTips.find(t => t.sourceid === 8)
    || matchTips.find(t => t.sourceid === 1) // Squiggle's own model
    || matchTips[0]
    || null;
}

/**
 * Get ALL model tips for a match — useful for showing consensus range
 */
async function getAllTipsForMatch(year, round, hteam, ateam) {
  const tips = await getTips(year, round);
  return tips.filter(t => t.hteam === hteam && t.ateam === ateam);
}

// ─── AGGREGATION HELPERS ─────────────────────────────────────────────────────
/**
 * Build the team stats object needed by the prediction engine.
 * Uses Squiggle games + standings data.
 * 
 * @param {string} teamName   — e.g. 'Sydney'
 * @param {number} year
 * @param {Array}  allGames   — pre-fetched completed games
 * @param {Array}  standings  — pre-fetched ladder
 * @param {number} n          — how many recent games to use
 */
function buildTeamStats(teamName, year, allGames, standings, n = 6) {
  const teamGames = allGames
    .filter(g => (g.hteam === teamName || g.ateam === teamName) && g.complete === 100)
    .slice(-n);

  if (teamGames.length === 0) return null;

  const scores    = [];
  const conceded  = [];
  const form      = [];

  for (const g of teamGames) {
    const isHome   = g.hteam === teamName;
    const scored   = isHome ? (g.hscore || 0) : (g.ascore || 0);
    const against  = isHome ? (g.ascore || 0) : (g.hscore || 0);
    scores.push(scored);
    conceded.push(against);
    form.push(scored > against ? 'W' : scored < against ? 'L' : 'D');
  }

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Ladder entry for this team
  const ladderEntry = standings.find(s =>
    s.name === teamName || s.name?.includes(teamName.split(' ')[0])
  );

  return {
    name: teamName,
    code: teamName.substring(0, 3).toUpperCase(),
    recentGames: teamGames.length,
    avgScore:    parseFloat(avg(scores).toFixed(1)),
    avgConceded: parseFloat(avg(conceded).toFixed(1)),
    // Squiggle doesn't have clearances — use scoring margin as proxy
    avgClearances: parseFloat(((avg(scores) - avg(conceded)) / 3 + 34).toFixed(1)),
    form:        form.reverse(), // most recent first
    scoringMargin: parseFloat((avg(scores) - avg(conceded)).toFixed(1)),
    // From ladder
    wins:        ladderEntry?.wins    || 0,
    losses:      ladderEntry?.losses  || 0,
    percentage:  ladderEntry?.percentage || 100,
    rank:        ladderEntry?.rank    || 9,
  };
}

/**
 * Calculate H2H record between two teams from historical games
 */
function calcH2H(teamName, opponentName, allGames) {
  const h2h = allGames.filter(g =>
    (g.hteam === teamName && g.ateam === opponentName) ||
    (g.ateam === teamName && g.hteam === opponentName)
  ).filter(g => g.complete === 100);

  const wins = h2h.filter(g => {
    const isHome = g.hteam === teamName;
    return isHome
      ? (g.hscore || 0) > (g.ascore || 0)
      : (g.ascore || 0) > (g.hscore || 0);
  }).length;

  return { wins, played: h2h.length };
}

/**
 * Calculate venue record for a team at a specific venue
 */
function calcVenueRecord(teamName, venueName, allGames) {
  const venueGames = allGames.filter(g =>
    (g.hteam === teamName || g.ateam === teamName) &&
    g.venue === venueName &&
    g.complete === 100
  );

  const wins = venueGames.filter(g => {
    const isHome = g.hteam === teamName;
    return isHome
      ? (g.hscore || 0) > (g.ascore || 0)
      : (g.ascore || 0) > (g.hscore || 0);
  }).length;

  return { wins, played: venueGames.length };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
  getTeams,
  getGames,
  getUpcoming,
  getCompleted,
  getTeamRecentGames,
  getStandings,
  getTips,
  getAggregateTip,
  getAllTipsForMatch,
  buildTeamStats,
  calcH2H,
  calcVenueRecord,
};
