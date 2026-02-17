/**
 * GET /api/upcoming?year=2025&round=10
 * Returns matches for a round from Squiggle.
 * If no year/round specified, tries current year first, falls back to 2025.
 * No API token needed.
 */
const squiggle = require('../squiggle');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const reqYear  = parseInt(req.query.year) || null;
    const reqRound = parseInt(req.query.round) || null;

    let year = reqYear || new Date().getFullYear();
    let allGames = await squiggle.getGames(year);

    // If current year has no games, fall back to 2025
    if (allGames.length === 0 && !reqYear) {
      year = 2025;
      allGames = await squiggle.getGames(year);
    }

    let roundGames;

    if (reqRound) {
      // Specific round requested
      roundGames = allGames.filter(g => g.round === reqRound);
    } else {
      // Auto-detect: find the latest round that has games
      const upcoming = allGames.filter(g => g.complete === 0);
      if (upcoming.length > 0) {
        // There are upcoming games — use that round
        const currentRound = upcoming[0].round;
        roundGames = allGames.filter(g => g.round === currentRound);
      } else {
        // No upcoming games — show the last completed round
        const completedRounds = [...new Set(allGames.filter(g => g.complete === 100).map(g => g.round))];
        const lastRound = completedRounds.length > 0 ? Math.max(...completedRounds) : 1;
        roundGames = allGames.filter(g => g.round === lastRound);
      }
    }

    // Get total rounds available for this season
    const allRounds = [...new Set(allGames.map(g => g.round))].sort((a, b) => a - b);

    // Shape the data nicely for the frontend
    const matches = roundGames.map(g => ({
      id:         g.id,
      round:      g.round,
      roundName:  g.roundname,
      date:       g.date,
      venue:      g.venue,
      hteam:      g.hteam,
      ateam:      g.ateam,
      hteamid:    g.hteamid,
      ateamid:    g.ateamid,
      hscore:     g.hscore,
      ascore:     g.ascore,
      complete:   g.complete || 0,
      timezone:   g.tz,
    }));

    res.json({
      year,
      round: matches.length > 0 ? matches[0].round : null,
      totalRounds: allRounds.length,
      availableRounds: allRounds,
      count: matches.length,
      matches,
    });

  } catch (err) {
    console.error('[upcoming]', err.message);
    res.status(500).json({ error: err.message });
  }
};
