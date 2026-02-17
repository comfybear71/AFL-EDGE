/**
 * GET /api/players?matchId=216085122
 * Returns player prop predictions for both squads in a match.
 */
const api    = require('../champion-data');
const engine = require('../predictor');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const matchId = parseInt(req.query.matchId);
  if (!matchId) {
    return res.status(400).json({ error: 'matchId query param required' });
  }

  try {
    const seasons  = await api.getSeasons();
    const seasonId = seasons?.seasons?.[seasons.seasons.length - 1]?.id
      || new Date().getFullYear();

    const [match, fixture] = await Promise.all([
      api.getMatch(matchId),
      api.getFixture(seasonId),
    ]);

    const allMatches = [];
    for (const phase of fixture.phases || []) {
      for (const round of phase.rounds || []) {
        allMatches.push(...(round.matches || []));
      }
    }

    const homeId = match.home?.id;
    const awayId = match.away?.id;

    const [homePlayers, awayPlayers] = await Promise.all([
      api.getSquadPlayers(seasonId, homeId),
      api.getSquadPlayers(seasonId, awayId),
    ]);

    const allPlayers = [
      ...(homePlayers.players || []).map(p => ({ ...p, squadCode: match.home?.code })),
      ...(awayPlayers.players  || []).map(p => ({ ...p, squadCode: match.away?.code })),
    ];

    // Get last 10 completed matches with player stats
    const completedMatches = allMatches
      .filter(m => m.status?.typeName === 'Completed')
      .slice(-10);

    const matchStatsCache = {};
    for (const m of completedMatches) {
      try {
        const stats = await api.getMatchPlayerStats(m.id, {
          metric: ['DISPOSAL', 'GOAL', 'TACKLE', 'MARK'],
        });
        matchStatsCache[m.id] = stats;
      } catch { /* skip */ }
    }

    const statCodes = ['DISPOSAL', 'GOAL', 'TACKLE', 'MARK'];
    const propPredictions = [];

    for (const player of allPlayers.slice(0, 30)) {
      for (const statCode of statCodes) {
        const history = api.buildPlayerStatHistory(
          player.personId,
          statCode,
          completedMatches.map(m => ({
            ...m,
            playerStats: {
              home: matchStatsCache[m.id]?.squads?.find(s => s.id === m.squads?.home?.id)?.players || [],
              away: matchStatsCache[m.id]?.squads?.find(s => s.id === m.squads?.away?.id)?.players || [],
            },
          }))
        );

        if (history.length >= 3) {
          const pred = engine.predictPlayerStat(
            { ...player, statHistory: { [statCode]: history } },
            {},
            statCode
          );
          if (pred) propPredictions.push({ ...pred, squad: player.squadCode });
        }
      }
    }

    // Group by stat, top 5 each
    const grouped = {};
    for (const pred of propPredictions) {
      if (!grouped[pred.statCode]) grouped[pred.statCode] = [];
      grouped[pred.statCode].push(pred);
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => b.predicted - a.predicted);
      grouped[key] = grouped[key].slice(0, 5);
    }

    res.json({ matchId, playerProps: grouped });

  } catch (err) {
    console.error('[players]', err.message);
    res.status(500).json({ error: err.message });
  }
};
