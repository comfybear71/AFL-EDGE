/**
 * GET /api/predict?matchId=xxx
 * Full prediction for a match using Squiggle data.
 * 
 * Also blends in Squiggle's own model tips as a "wisdom of the crowd" 
 * cross-check against our engine's output.
 */
const squiggle = require('../squiggle');
const engine   = require('../predictor');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const matchId = parseInt(req.query.matchId);
  const reqYear = parseInt(req.query.year) || null;
  if (!matchId) {
    return res.status(400).json({ error: 'matchId is required. e.g. /api/predict?matchId=123' });
  }

  try {
    let year = reqYear || new Date().getFullYear();

    // ── 1. Load all data in parallel ─────────────────────────────────────────
    let [allGames, standings] = await Promise.all([
      squiggle.getGames(year),
      squiggle.getStandings(year),
    ]);

    // If current year has no data, fall back to 2025
    if (allGames.length === 0 && !reqYear) {
      year = 2025;
      [allGames, standings] = await Promise.all([
        squiggle.getGames(year),
        squiggle.getStandings(year),
      ]);
    }

    // Find the specific match
    const match = allGames.find(g => g.id === matchId);
    if (!match) {
      return res.status(404).json({ error: `Match ${matchId} not found in ${year} fixture` });
    }

    const hteam = match.hteam;
    const ateam = match.ateam;

    // ── 2. Build team stats from historical games ─────────────────────────────
    const homeStats = squiggle.buildTeamStats(hteam, year, allGames, standings, 6);
    const awayStats = squiggle.buildTeamStats(ateam, year, allGames, standings, 6);

    if (!homeStats || !awayStats) {
      return res.status(422).json({
        error: 'Not enough match history yet — try again after Round 2',
      });
    }

    // ── 3. Head to head ───────────────────────────────────────────────────────
    // Pull last 3 years of H2H data for a better sample
    let h2hGames = [];
    for (let y = year; y >= year - 3; y--) {
      try {
        const yearGames = await squiggle.getCompleted(y);
        h2hGames.push(...yearGames);
      } catch { /* skip years with no data */ }
    }
    h2hGames = h2hGames.slice(-10); // last 10 meetings

    const homeH2H = squiggle.calcH2H(hteam, ateam, h2hGames);
    const awayH2H = squiggle.calcH2H(ateam, hteam, h2hGames);
    homeStats.h2hWins   = homeH2H.wins;
    homeStats.h2hPlayed = homeH2H.played;
    awayStats.h2hWins   = awayH2H.wins;
    awayStats.h2hPlayed = awayH2H.played;

    // ── 4. Venue record ───────────────────────────────────────────────────────
    const homeVenue = squiggle.calcVenueRecord(hteam, match.venue, h2hGames.concat(allGames));
    const awayVenue = squiggle.calcVenueRecord(ateam, match.venue, h2hGames.concat(allGames));
    homeStats.venueWins   = homeVenue.wins;
    homeStats.venuePlayed = homeVenue.played;
    awayStats.venueWins   = awayVenue.wins;
    awayStats.venuePlayed = awayVenue.played;

    // Interstate travel — simple heuristic from team name vs venue state
    homeStats.travellingInterstate = isInterstate(hteam, match.venue);
    awayStats.travellingInterstate = isInterstate(ateam, match.venue);

    // ── 5. Run our prediction engine ──────────────────────────────────────────
    const prediction = engine.predictMatch(homeStats, awayStats, {
      name: match.venue,
      code: match.venue?.substring(0, 4).toUpperCase(),
    });

    // ── 6. Cross-check with Squiggle model tips ───────────────────────────────
    const aggregateTip  = await squiggle.getAggregateTip(year, match.round, hteam, ateam);
    const allModelTips  = await squiggle.getAllTipsForMatch(year, match.round, hteam, ateam);

    // Squiggle hconfidence = % chance home team wins (0-100)
    const squiggleHomeProb = aggregateTip?.hconfidence || null;
    const modelConsensus   = allModelTips.length > 0
      ? Math.round(allModelTips.reduce((s, t) => s + (t.hconfidence || 50), 0) / allModelTips.length)
      : null;

    // ── 7. Blend: 70% our engine, 30% Squiggle aggregate ─────────────────────
    let finalHomeProb = prediction.home.winProbability;
    if (squiggleHomeProb !== null) {
      finalHomeProb = parseFloat(
        (finalHomeProb * 0.70 + squiggleHomeProb * 0.30).toFixed(1)
      );
    }
    const finalAwayProb = parseFloat((100 - finalHomeProb).toFixed(1));

    // Update prediction with blended probability
    prediction.home.winProbability = finalHomeProb;
    prediction.away.winProbability = finalAwayProb;
    prediction.predictedWinner     = finalHomeProb >= 50 ? homeStats.code : awayStats.code;

    // Line assessment
    const margin = prediction.predictedMargin;
    prediction.lineAssessment = {
      predictedWinner: prediction.predictedWinner,
      predictedMargin: margin,
      recommendation: margin > 25
        ? `Strong lean to ${prediction.predictedWinner} — consider handicap bet`
        : margin > 12
        ? `Moderate lean to ${prediction.predictedWinner} — check the line`
        : 'Close game — line bet is risky',
    };

    res.json({
      matchId,
      match: {
        name:      `${hteam} v ${ateam}`,
        hteam,
        ateam,
        round:     match.round,
        roundName: match.roundname,
        date:      match.date,
        venue:     match.venue,
      },
      prediction,
      squiggle: {
        aggregateHomeWinPct: squiggleHomeProb,
        modelConsensusHomeWinPct: modelConsensus,
        modelCount: allModelTips.length,
        tip: aggregateTip?.tip || null,
        margin: aggregateTip?.margin || null,
      },
    });

  } catch (err) {
    console.error('[predict]', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
// Very rough interstate travel check based on team home state vs venue
const HOME_STATES = {
  'Adelaide':      'SA',  'Port Adelaide':  'SA',
  'Melbourne':     'VIC', 'Collingwood':    'VIC',
  'Carlton':       'VIC', 'Essendon':       'VIC',
  'Hawthorn':      'VIC', 'Richmond':       'VIC',
  'St Kilda':      'VIC', 'Western Bulldogs':'VIC',
  'North Melbourne':'VIC','Geelong':         'VIC',
  'Sydney':        'NSW', 'GWS Giants':      'NSW',
  'Brisbane Lions':'QLD', 'Gold Coast':      'QLD',
  'West Coast':    'WA',  'Fremantle':       'WA',
};

const VENUE_STATES = {
  'MCG': 'VIC', 'Marvel Stadium': 'VIC', 'Ikon Park': 'VIC',
  'GMHBA Stadium': 'VIC', 'Adelaide Oval': 'SA',
  'SCG': 'NSW', 'Engie Stadium': 'NSW', 'GIANTS Stadium': 'NSW',
  'Gabba': 'QLD', 'Heritage Bank Stadium': 'QLD', 'People First Stadium': 'QLD',
  'Optus Stadium': 'WA', 'Subiaco': 'WA',
  'Mars Stadium': 'VIC', 'Blundstone Arena': 'TAS',
  'TIO Stadium': 'NT', 'TIO Traeger Park': 'NT',
  'Norwood Oval': 'SA',
};

function isInterstate(teamName, venue) {
  const teamState  = HOME_STATES[teamName];
  const venueState = Object.entries(VENUE_STATES).find(([v]) =>
    venue?.toLowerCase().includes(v.toLowerCase())
  )?.[1];
  if (!teamState || !venueState) return false;
  return teamState !== venueState;
}
