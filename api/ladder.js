/**
 * GET /api/ladder?year=2025
 * AFL ladder from Squiggle.
 * If no year specified, tries current year first, falls back to 2025.
 */
const squiggle = require('../squiggle');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const reqYear = parseInt(req.query.year) || null;
    let year = reqYear || new Date().getFullYear();

    let standings = await squiggle.getStandings(year);

    // If current year has no standings, fall back to 2025
    if (standings.length === 0 && !reqYear) {
      year = 2025;
      standings = await squiggle.getStandings(year);
    }

    res.json({ year, standings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
