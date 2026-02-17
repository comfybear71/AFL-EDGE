/**
 * GET /api/health
 * Quick check that the server is running and token is set.
 */
module.exports = (req, res) => {
  res.json({
    status: 'ok',
    tokenSet: !!process.env.AFL_API_TOKEN,
    timestamp: new Date().toISOString(),
  });
};
