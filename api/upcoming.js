/**
 * GET /api/upcoming
 * Returns this round's upcoming matches from Squiggle.
 * No API token needed.
 */
const squiggle = require('../squiggle');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const year     = new Date().getFullYear();
    const upcoming = await squiggle.getUpcoming(year);

    // Also include in-progress and recently completed games for the same round
    const allGames = await squiggle.getGames(year);
    const currentRound = upcoming.length > 0 ? upcoming[0].round : null;
    const roundGames = currentRound
      ? allGames.filter(g => g.round === currentRound)
      : upcoming;

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

    res.json({ year, count: matches.length, matches });

  } catch (err) {
    console.error('[upcoming]', err.message);
    res.status(500).json({ error: err.message });
  }
};
