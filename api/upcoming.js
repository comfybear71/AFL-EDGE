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

    // Shape the data nicely for the frontend
    const matches = upcoming.map(g => ({
      id:         g.id,
      round:      g.round,
      roundName:  g.roundname,
      date:       g.date,
      venue:      g.venue,
      hteam:      g.hteam,
      ateam:      g.ateam,
      hteamid:    g.hteamid,
      ateamid:    g.ateamid,
      timezone:   g.tz,
    }));

    res.json({ year, count: matches.length, matches });

  } catch (err) {
    console.error('[upcoming]', err.message);
    res.status(500).json({ error: err.message });
  }
};
