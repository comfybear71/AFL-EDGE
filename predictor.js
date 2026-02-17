/**
 * AFL Edge — Prediction Engine v2.0 (2026 Season)
 *
 * Weighted multi-factor model that blends:
 *   - Recent form (last 5-6 games, recency-weighted)
 *   - Head-to-head record (last 10 meetings)
 *   - Scoring margin differential
 *   - Venue record / home ground advantage
 *   - Clearance proxy (scoring flow)
 *   - Interstate travel penalty
 *
 * Final output is blended 70/30 with Squiggle's aggregate model
 * in the API layer (api/predict.js).
 */

const WEIGHTS = {
  recentForm:     0.30,
  h2h:            0.20,
  scoringMargin:  0.20,
  venue:          0.15,
  clearance:      0.10,
  travel:         0.05,
};

// ── Core prediction ─────────────────────────────────────────────────────────

function predictMatch(homeStats, awayStats, venue) {
  const factors = [];

  // 1. Recent Form — recency-weighted W/L/D
  const homeForm = calcFormScore(homeStats.form || []);
  const awayForm = calcFormScore(awayStats.form || []);
  factors.push({
    name: 'Recent Form',
    weight: WEIGHTS.recentForm,
    homeEdge: normalize(homeForm, awayForm),
    awayEdge: normalize(awayForm, homeForm),
    advantage: homeForm >= awayForm
      ? homeStats.code : awayStats.code,
  });

  // 2. Head to Head
  const homeH2HRate = homeStats.h2hPlayed > 0
    ? homeStats.h2hWins / homeStats.h2hPlayed : 0.5;
  const awayH2HRate = awayStats.h2hPlayed > 0
    ? awayStats.h2hWins / awayStats.h2hPlayed : 0.5;
  factors.push({
    name: 'Head to Head',
    weight: WEIGHTS.h2h,
    homeEdge: normalize(homeH2HRate, awayH2HRate),
    awayEdge: normalize(awayH2HRate, homeH2HRate),
    advantage: homeH2HRate >= awayH2HRate
      ? homeStats.code : awayStats.code,
  });

  // 3. Scoring Margin
  const homeMargin = homeStats.scoringMargin || 0;
  const awayMargin = awayStats.scoringMargin || 0;
  factors.push({
    name: 'Avg Score Diff',
    weight: WEIGHTS.scoringMargin,
    homeEdge: normalize(mapMargin(homeMargin), mapMargin(awayMargin)),
    awayEdge: normalize(mapMargin(awayMargin), mapMargin(homeMargin)),
    advantage: homeMargin >= awayMargin
      ? homeStats.code : awayStats.code,
  });

  // 4. Venue Record
  const homeVenueRate = homeStats.venuePlayed > 0
    ? homeStats.venueWins / homeStats.venuePlayed : 0.5;
  const awayVenueRate = awayStats.venuePlayed > 0
    ? awayStats.venueWins / awayStats.venuePlayed : 0.5;
  factors.push({
    name: 'Venue Record',
    weight: WEIGHTS.venue,
    homeEdge: normalize(homeVenueRate, awayVenueRate),
    awayEdge: normalize(awayVenueRate, homeVenueRate),
    advantage: homeVenueRate >= awayVenueRate
      ? homeStats.code : awayStats.code,
  });

  // 5. Clearance Proxy (from scoring flow)
  const homeClear = homeStats.avgClearances || 34;
  const awayClear = awayStats.avgClearances || 34;
  factors.push({
    name: 'Clearance Diff',
    weight: WEIGHTS.clearance,
    homeEdge: normalize(homeClear, awayClear),
    awayEdge: normalize(awayClear, homeClear),
    advantage: homeClear >= awayClear
      ? homeStats.code : awayStats.code,
  });

  // 6. Interstate Travel
  const homeTravelPenalty = homeStats.travellingInterstate ? 0.42 : 0.58;
  const awayTravelPenalty = awayStats.travellingInterstate ? 0.42 : 0.58;
  factors.push({
    name: 'Interstate Travel',
    weight: WEIGHTS.travel,
    homeEdge: homeTravelPenalty,
    awayEdge: awayTravelPenalty,
    advantage: homeTravelPenalty >= awayTravelPenalty
      ? homeStats.code : awayStats.code,
  });

  // ── Weighted sum ──────────────────────────────────────────────────────────
  let homeProb = 0;
  let awayProb = 0;
  for (const f of factors) {
    homeProb += f.homeEdge * f.weight;
    awayProb += f.awayEdge * f.weight;
  }

  // Normalise to 100%
  const total = homeProb + awayProb;
  homeProb = parseFloat(((homeProb / total) * 100).toFixed(1));
  awayProb = parseFloat((100 - homeProb).toFixed(1));

  // ── Predicted scores ──────────────────────────────────────────────────────
  const avgGameTotal = 160; // rough AFL average total score
  const homeAvg = homeStats.avgScore || 80;
  const awayAvg = awayStats.avgScore || 80;
  const homeConceded = homeStats.avgConceded || 80;
  const awayConceded = awayStats.avgConceded || 80;

  // Blend team average score with opponent conceded average
  let homePredScore = Math.round((homeAvg * 0.6 + awayConceded * 0.4));
  let awayPredScore = Math.round((awayAvg * 0.6 + homeConceded * 0.4));

  // Adjust for probability skew
  const probRatio = homeProb / 50;
  homePredScore = Math.round(homePredScore * (0.85 + probRatio * 0.15));
  awayPredScore = Math.round(awayPredScore * (0.85 + (awayProb / 50) * 0.15));

  const predictedMargin = Math.abs(homePredScore - awayPredScore);

  // ── Confidence ────────────────────────────────────────────────────────────
  const maxProb = Math.max(homeProb, awayProb);
  const confidence = maxProb >= 70
    ? { level: 'high', label: 'HIGH CONF', color: 'green' }
    : maxProb >= 58
    ? { level: 'medium', label: 'MED CONF', color: 'yellow' }
    : { level: 'low', label: 'LOW CONF', color: 'red' };

  return {
    home: {
      team: homeStats,
      winProbability: homeProb,
      predictedScore: homePredScore,
    },
    away: {
      team: awayStats,
      winProbability: awayProb,
      predictedScore: awayPredScore,
    },
    predictedWinner: homeProb >= awayProb ? homeStats.code : awayStats.code,
    predictedMargin,
    confidence,
    keyFactors: factors,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recency-weighted form score.
 * Most recent game = weight 5, second = 4, etc.
 */
function calcFormScore(form) {
  if (!form || form.length === 0) return 0.5;
  let score = 0;
  let weight = 0;
  for (let i = 0; i < form.length; i++) {
    const w = form.length - i; // most recent first
    weight += w;
    if (form[i] === 'W') score += w;
    else if (form[i] === 'D') score += w * 0.5;
  }
  return weight > 0 ? score / weight : 0.5;
}

/**
 * Normalize a vs b into 0-1 range (a's edge)
 */
function normalize(a, b) {
  if (a + b === 0) return 0.5;
  return a / (a + b);
}

/**
 * Map a scoring margin (can be negative) to a 0-1 scale
 */
function mapMargin(margin) {
  // Clamp to +-60 and map to 0-1
  const clamped = Math.max(-60, Math.min(60, margin));
  return (clamped + 60) / 120;
}

module.exports = { predictMatch };
