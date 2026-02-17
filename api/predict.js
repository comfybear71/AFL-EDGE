/**
 * GET /api/predict?matchId=216085122
 * Returns full prediction for a given match.
 * 
 * Query params:
 *   matchId  (required) — from the fixture data
 */
const api    = require('../champion-data');
const engine = require('../predictor');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const matchId = parseInt(req.query.matchId);
  if (!matchId) {
    return res.status(400).json({ error: 'matchId query param required. e.g. /api/predict?matchId=216085122' });
  }

  try {
    // ── 1. Get season & fixture ──────────────────────────────────────────────
    const seasons  = await api.getSeasons();
    const seasonId = seasons?.seasons?.[seasons.seasons.length - 1]?.id
      || new Date().getFullYear();

    const [match, venue, fixture] = await Promise.all([
      api.getMatch(matchId),
      api.getMatchVenue(matchId),
      api.getFixture(seasonId),
    ]);

    // Flatten all matches from the fixture
    const allMatches = [];
    for (const phase of fixture.phases || []) {
      for (const round of phase.rounds || []) {
        allMatches.push(...(round.matches || []));
      }
    }

    const homeId = match.home?.id;
    const awayId = match.away?.id;

    // ── 2. Build team stats (last 6 completed games) ─────────────────────────
    const [homeStats, awayStats] = await Promise.all([
      api.buildTeamStats(homeId, seasonId, allMatches, 6),
      api.buildTeamStats(awayId, seasonId, allMatches, 6),
    ]);

    if (!homeStats || !awayStats) {
      return res.status(422).json({
        error: 'Not enough match history yet to generate a prediction',
        hint: 'This usually happens early in the season (round 1-2)',
      });
    }

    // ── 3. Head to head ──────────────────────────────────────────────────────
    const h2hMatches = allMatches.filter(m => {
      const ids = [m.squads?.home?.id, m.squads?.away?.id];
      return ids.includes(homeId) && ids.includes(awayId)
        && m.status?.typeName === 'Completed';
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

    // ── 4. Venue record ──────────────────────────────────────────────────────
    const venueMatches = allMatches.filter(m =>
      m.venue?.id === venue.id && m.status?.typeName === 'Completed'
    );

    const calcVenueRecord = (squadId) => {
      const squadVenueMatches = venueMatches.filter(m =>
        m.squads?.home?.id === squadId || m.squads?.away?.id === squadId
      );
      const wins = squadVenueMatches.filter(m => {
        const isHome = m.squads?.home?.id === squadId;
        return isHome
          ? m.squads.home.score.points > m.squads.away.score.points
          : m.squads.away.score.points > m.squads.home.score.points;
      }).length;
      return { wins, played: squadVenueMatches.length };
    };

    const homeVenue = calcVenueRecord(homeId);
    const awayVenue = calcVenueRecord(awayId);
    homeStats.venueWins   = homeVenue.wins;
    homeStats.venuePlayed = homeVenue.played;
    awayStats.venueWins   = awayVenue.wins;
    awayStats.venuePlayed = awayVenue.played;

    // ── 5. Travel flags ──────────────────────────────────────────────────────
    homeStats.travellingInterstate = venue.home?.interstateTravel || false;
    awayStats.travellingInterstate = venue.away?.interstateTravel || false;

    // ── 6. Team names ────────────────────────────────────────────────────────
    homeStats.name = match.home?.name;
    homeStats.code = match.home?.code;
    awayStats.name = match.away?.name;
    awayStats.code = match.away?.code;

    // ── 7. Run prediction engine ─────────────────────────────────────────────
    const prediction = engine.predictMatch(homeStats, awayStats, {
      id: venue.id, name: venue.name, code: venue.code,
    });

    // ── 8. Line assessment ───────────────────────────────────────────────────
    const margin = prediction.predictedMargin;
    prediction.lineAssessment = {
      predictedWinner: prediction.predictedWinner,
      predictedMargin: margin,
      recommendation: margin > 25
        ? `Strong lean to ${prediction.predictedWinner} — consider handicap`
        : margin > 12
        ? `Moderate lean to ${prediction.predictedWinner} — check the line`
        : 'Close game — line bet is risky',
    };

    res.json({
      matchId,
      match: {
        name:   match.name,
        date:   match.date,
        venue:  { name: venue.name, code: venue.code },
        status: match.status,
      },
      prediction,
    });

  } catch (err) {
    console.error('[predict]', err.message);
    res.status(500).json({ error: err.message });
  }
};
