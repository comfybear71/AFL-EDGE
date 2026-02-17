/**
 * AFL Edge — Champion Data API Client
 * 
 * Wraps the Champion Data AFL API (api.afl.championdata.io)
 * Handles auth, caching, rate limiting, and error recovery.
 * 
 * SETUP:
 *   1. Get your API credentials from Champion Data
 *   2. Copy .env.example to .env and fill in your values
 *   3. Run: npm install
 */

const https = require('https');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.afl.championdata.io/v1';

// AFL Premiership constants (from the API)
const AFL_LEAGUE_ID  = 1;
const AFL_LEVEL_ID   = 1;

// ─── SIMPLE IN-MEMORY CACHE ───────────────────────────────────────────────────
// Prevents hammering the API for the same data within a session.
// Key = endpoint URL, Value = { data, expiresAt }
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data, ttlSeconds = 300) {
  cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ─── HTTP REQUEST ─────────────────────────────────────────────────────────────
/**
 * Make an authenticated GET request to the Champion Data API.
 * 
 * @param {string} endpoint  - e.g. '/seasons/2025'
 * @param {number} cacheTTL  - seconds to cache (0 = no cache)
 * @returns {Promise<Object>}
 */
function apiGet(endpoint, cacheTTL = 300) {
  const url = `${BASE_URL}${endpoint}`;

  const cached = getCached(url);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const token = process.env.AFL_API_TOKEN;
    if (!token) {
      reject(new Error('AFL_API_TOKEN not set in .env — see README.md'));
      return;
    }

    const options = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    };

    https.get(url, options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode === 429) {
          reject(new Error('Rate limited by Champion Data API — slow down requests'));
          return;
        }
        if (res.statusCode === 403) {
          reject(new Error('Access forbidden — check your API subscription tier'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`API error ${res.statusCode}: ${raw}`));
          return;
        }
        try {
          const data = JSON.parse(raw);
          if (cacheTTL > 0) setCache(url, data, cacheTTL);
          resolve(data);
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ─── SEASONS ──────────────────────────────────────────────────────────────────
/**
 * Get all available AFL Premiership seasons.
 * Cached for 1 hour — seasons don't change.
 */
async function getSeasons() {
  return apiGet('/seasons', 3600);
}

/**
 * Get details + fixture for a specific season.
 * @param {number} seasonId - e.g. 2025
 */
async function getSeason(seasonId) {
  return apiGet(`/seasons/${seasonId}`, 3600);
}

/**
 * Get the full fixture (all rounds + matches) for a season.
 * @param {number} seasonId
 */
async function getFixture(seasonId) {
  return apiGet(
    `/leagues/${AFL_LEAGUE_ID}/levels/${AFL_LEVEL_ID}/seasons/${seasonId}/fixture`,
    600  // 10 min cache — fixture can update during the week
  );
}

/**
 * Get current season ladder.
 * @param {number} seasonId
 */
async function getLadder(seasonId) {
  return apiGet(
    `/leagues/${AFL_LEAGUE_ID}/levels/${AFL_LEVEL_ID}/seasons/${seasonId}/ladder`,
    300  // 5 min cache
  );
}

// ─── SQUADS ───────────────────────────────────────────────────────────────────
/**
 * Get all squads (teams) for a season.
 * @param {number} seasonId
 */
async function getSquads(seasonId) {
  return apiGet(
    `/leagues/${AFL_LEAGUE_ID}/levels/${AFL_LEVEL_ID}/seasons/${seasonId}/squads`,
    3600
  );
}

/**
 * Get players in a squad for a season.
 * @param {number} seasonId
 * @param {number} squadId
 */
async function getSquadPlayers(seasonId, squadId) {
  return apiGet(
    `/leagues/${AFL_LEAGUE_ID}/levels/${AFL_LEVEL_ID}/seasons/${seasonId}/squads/${squadId}/persons`,
    3600
  );
}

// ─── MATCHES ──────────────────────────────────────────────────────────────────
/**
 * Get match details (scores, status, venue, etc.)
 * @param {number} matchId
 */
async function getMatch(matchId) {
  return apiGet(`/matches/${matchId}`, 60); // 1 min cache (live scores)
}

/**
 * Get player statistics for a match.
 * @param {number} matchId
 * @param {Object} options - { metric, period, zone, team }
 */
async function getMatchPlayerStats(matchId, options = {}) {
  const params = new URLSearchParams();
  if (options.metric) [].concat(options.metric).forEach(m => params.append('metric', m));
  if (options.period) [].concat(options.period).forEach(p => params.append('period', p));
  if (options.zone)   [].concat(options.zone).forEach(z => params.append('zone', z));
  if (options.team)   params.set('team', options.team);

  const qs = params.toString();
  return apiGet(`/matches/${matchId}/statistics/players${qs ? '?' + qs : ''}`, 60);
}

/**
 * Get match score (live or final).
 * @param {number} matchId
 */
async function getMatchScore(matchId) {
  return apiGet(`/matches/${matchId}/score`, 30); // 30s cache for live
}

/**
 * Get shots at goal for a match.
 * @param {number} matchId
 */
async function getMatchShots(matchId) {
  return apiGet(`/matches/${matchId}/shots`, 60);
}

/**
 * Get possession chains for a match.
 * @param {number} matchId
 */
async function getMatchChains(matchId) {
  return apiGet(`/matches/${matchId}/chains`, 120);
}

/**
 * Get venue details for a match.
 * @param {number} matchId
 */
async function getMatchVenue(matchId) {
  return apiGet(`/matches/${matchId}/venue`, 3600);
}

// ─── DATA AGGREGATION ─────────────────────────────────────────────────────────
/**
 * Build the team data object needed by the prediction engine.
 * Pulls last N completed matches for a squad and aggregates stats.
 * 
 * @param {number} squadId
 * @param {number} seasonId
 * @param {Array<Object>} allMatches  - Full fixture data (pre-fetched)
 * @param {number} lastN             - How many recent matches to use
 * @returns {Object} Aggregated team stats ready for predictMatch()
 */
async function buildTeamStats(squadId, seasonId, allMatches, lastN = 6) {
  // Filter to completed matches involving this squad
  const teamMatches = allMatches
    .filter(m =>
      (m.squads?.home?.id === squadId || m.squads?.away?.id === squadId) &&
      m.status?.typeName === 'Completed'
    )
    .slice(-lastN);  // most recent N

  if (teamMatches.length === 0) return null;

  const scores = [];
  const conceded = [];
  const clearances = [];
  const form = [];

  for (const match of teamMatches) {
    const isHome = match.squads?.home?.id === squadId;
    const teamScore = isHome ? match.squads?.home?.score?.points : match.squads?.away?.score?.points;
    const oppScore  = isHome ? match.squads?.away?.score?.points : match.squads?.home?.score?.points;

    scores.push(teamScore || 0);
    conceded.push(oppScore || 0);
    form.push(teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'D');

    // Fetch clearances for this match
    try {
      const stats = await getMatchPlayerStats(match.id, { metric: 'CLEARANCE' });
      const squad = stats.squads?.find(s => s.id === squadId);
      const total = squad?.players?.reduce((sum, p) => {
        const clr = p.statistics?.find(s => s.code === 'CLEARANCE');
        return sum + (clr?.value || 0);
      }, 0) || 0;
      clearances.push(total);
    } catch {
      clearances.push(34); // league average fallback
    }
  }

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    id: squadId,
    seasonId,
    recentMatches: teamMatches.length,
    avgScore: parseFloat(avg(scores).toFixed(1)),
    avgConceded: parseFloat(avg(conceded).toFixed(1)),
    avgClearances: parseFloat(avg(clearances).toFixed(1)),
    form: form.reverse(), // most recent first
    scoringMargin: parseFloat((avg(scores) - avg(conceded)).toFixed(1)),
  };
}

/**
 * Get a player's last N stat values for a given metric.
 * Used to build the statHistory object for predictPlayerStat().
 * 
 * @param {number} personId
 * @param {string} metricCode  - e.g. 'DISPOSAL', 'GOAL'
 * @param {Array<Object>} playerMatches  - Completed matches with stats pre-loaded
 * @returns {Array<number>}  Most recent first
 */
function buildPlayerStatHistory(personId, metricCode, playerMatches) {
  return playerMatches
    .map(match => {
      const allPlayers = [
        ...(match.playerStats?.home || []),
        ...(match.playerStats?.away || []),
      ];
      const player = allPlayers.find(p => p.personId === personId);
      const stat = player?.statistics?.find(s => s.code === metricCode);
      return stat?.value ?? null;
    })
    .filter(v => v !== null)
    .slice(0, 10); // last 10 games
}

// ─── CONVENIENCE: UPCOMING MATCHES ───────────────────────────────────────────
/**
 * Get all upcoming (not yet played) matches for the current round.
 * @param {number} seasonId
 */
async function getUpcomingMatches(seasonId) {
  const fixture = await getFixture(seasonId);
  const upcoming = [];

  for (const phase of fixture.phases || []) {
    for (const round of phase.rounds || []) {
      for (const match of round.matches || []) {
        if (match.status?.typeName === 'Upcoming') {
          upcoming.push({ ...match, roundName: round.name, roundNumber: round.number });
        }
      }
    }
  }

  // Sort by start date
  return upcoming.sort((a, b) =>
    new Date(a.date?.utcMatchStart) - new Date(b.date?.utcMatchStart)
  );
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
module.exports = {
  // Seasons
  getSeasons,
  getSeason,
  getFixture,
  getLadder,

  // Squads
  getSquads,
  getSquadPlayers,

  // Matches
  getMatch,
  getMatchPlayerStats,
  getMatchScore,
  getMatchShots,
  getMatchChains,
  getMatchVenue,

  // Aggregation helpers
  buildTeamStats,
  buildPlayerStatHistory,
  getUpcomingMatches,
};

