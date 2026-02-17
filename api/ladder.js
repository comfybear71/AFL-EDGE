/**
 * GET /api/ladder
 * Current AFL ladder from Squiggle.
 */
const squiggle = require('../squiggle');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const year     = new Date().getFullYear();
    const standings = await squiggle.getStandings(year);
    res.json({ year, standings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
