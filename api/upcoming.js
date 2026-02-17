/**
 * GET /api/upcoming
 * Returns all upcoming matches for the current round.
 */
const api = require('../champion-data');

module.exports = async (req, res) => {
  // CORS headers so the frontend can call this
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const seasons = await api.getSeasons();
    const seasonId = seasons?.seasons?.[seasons.seasons.length - 1]?.id
      || new Date().getFullYear();

    const matches = await api.getUpcomingMatches(seasonId);

    res.json({ seasonId, count: matches.length, matches });

  } catch (err) {
    console.error('[upcoming]', err.message);
    res.status(500).json({
      error: err.message,
      hint: err.message.includes('AFL_API_TOKEN')
        ? 'Add AFL_API_TOKEN in Vercel → Settings → Environment Variables'
        : 'Check Vercel function logs for details',
    });
  }
};

