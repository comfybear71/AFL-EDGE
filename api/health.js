/**
 * GET /api/health
 */
module.exports = (req, res) => {
  res.json({
    status: 'ok',
    dataSource: 'Squiggle API (free, no token needed)',
    timestamp: new Date().toISOString(),
  });
};
