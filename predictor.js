/**
 * AFL Edge — Prediction Engine
 * 
 * Uses weighted historical averages + contextual factors to predict:
 *  - Match winner & win probability
 *  - Predicted final score
 *  - Player stat lines (disposals, goals, tackles, marks)
 * 
 * Data source: Champion Data AFL API
 */

// ─── WEIGHTS ────────────────────────────────────────────────────────────────
// How much each factor contributes to the final win probability.
// Total must equal 1.0
const WEIGHTS = {
  recentForm:       0.30,   // Last 5 game W/L record
  headToHead:       0.20,   // H2H record (last 10 meetings)
  avgScoreDiff:     0.20,   // Average scoring margin (last 6 games)
  venueRecord:      0.15,   // Win % at this specific venue
  clearanceDiff:    0.10,   // Clearance differential (strong AFL predictor)
  interstateTravel: 0.05,   // Away travel penalty
};

// ─── FORM SCORING ────────────────────────────────────────────────────────────
/**
 * Convert a W/L array into a 0–1 score.
 * More recent games are weighted heavier (recency bias).
 * 
 * @param {Array<'W'|'L'|'D'>} form - e.g. ['L','W','W','L','W']
 * @returns {number} 0.0 to 1.0
 */
function calcFormScore(form) {
  if (!form || form.length === 0) return 0.5;

  const recencyWeights = [0.35, 0.25, 0.20, 0.12, 0.08]; // most recent first
  let score = 0;
  let totalWeight = 0;

  form.forEach((result, i) => {
    const w = recencyWeights[i] || 0.05;
    score += (result === 'W' ? 1 : result === 'D' ? 0.5 : 0) * w;
    totalWeight += w;
  });

  return score / totalWeight;
}

// ─── HEAD TO HEAD ─────────────────────────────────────────────────────────────
/**
 * @param {number} wins   - How many times team won vs this opponent (last 10)
 * @param {number} total  - Total matches played (usually 10)
 * @returns {number} 0.0 to 1.0
 */
function calcH2HScore(wins, total) {
  if (!total) return 0.5;
  return wins / total;
}

// ─── VENUE RECORD ────────────────────────────────────────────────────────────
/**
 * @param {number} venueWins
 * @param {number} venuePlayed
 * @returns {number} 0.0 to 1.0
 */
function calcVenueScore(venueWins, venuePlayed) {
  if (!venuePlayed) return 0.5;
  // Regress toward 0.5 if small sample
  const confidence = Math.min(venuePlayed / 10, 1);
  const raw = venueWins / venuePlayed;
  return raw * confidence + 0.5 * (1 - confidence);
}

// ─── CLEARANCE DIFFERENTIAL ──────────────────────────────────────────────────
/**
 * Convert clearance differential to a probability boost.
 * ~8 clearance diff historically ≈ 15-18 point margin.
 * 
 * @param {number} diff - positive = team A advantage
 * @returns {number} 0.0 to 1.0
 */
function calcClearanceScore(diff) {
  // Sigmoid-ish: clamp to ±15, map to 0–1
  const clamped = Math.max(-15, Math.min(15, diff));
  return (clamped + 15) / 30;
}

// ─── INTERSTATE TRAVEL ───────────────────────────────────────────────────────
/**
 * @param {boolean} homeTeamTravelling
 * @param {boolean} awayTeamTravelling
 * @returns {number} adjustment for home team (positive = home advantage)
 */
function calcTravelScore(homeTeamTravelling, awayTeamTravelling) {
  if (homeTeamTravelling && !awayTeamTravelling) return 0.35; // home disadvantaged
  if (!homeTeamTravelling && awayTeamTravelling) return 0.65; // home advantaged
  return 0.5; // neutral
}

// ─── SCORE PREDICTION ────────────────────────────────────────────────────────
/**
 * Predict final scores from average scoring + win probability lean.
 * 
 * @param {number} homeAvgScore  - Team's average points scored last 6 games
 * @param {number} awayAvgScore
 * @param {number} homeAvgConceded
 * @param {number} awayAvgConceded
 * @param {number} homeWinProb    - 0 to 1
 * @returns {{ home: number, away: number }}
 */
function predictScore(homeAvgScore, awayAvgScore, homeAvgConceded, awayAvgConceded, homeWinProb) {
  // Base score = average of team's attack vs opponent's defence
  let homeBase = (homeAvgScore + awayAvgConceded) / 2;
  let awayBase = (awayAvgScore + homeAvgConceded) / 2;

  // Adjust by win probability lean
  const leanFactor = (homeWinProb - 0.5) * 20; // ±10 points at most
  homeBase += leanFactor;
  awayBase -= leanFactor;

  return {
    home: Math.round(Math.max(40, homeBase)),
    away: Math.round(Math.max(40, awayBase)),
  };
}

// ─── CONFIDENCE TIER ─────────────────────────────────────────────────────────
function getConfidenceTier(probability) {
  const p = Math.max(probability, 1 - probability); // always use dominant side
  if (p >= 0.72) return { label: 'HIGH CONF', color: 'green' };
  if (p >= 0.60) return { label: 'MED CONF',  color: 'yellow' };
  return           { label: 'LOW CONF',  color: 'red' };
}

// ─── MAIN MATCH PREDICTOR ────────────────────────────────────────────────────
/**
 * Full match prediction. Call this with data from the Champion Data API.
 * 
 * @param {Object} homeTeam
 * @param {Object} awayTeam
 * @param {Object} venue
 * @returns {Object} Full prediction result
 * 
 * Example input:
 * homeTeam = {
 *   id: 10, name: 'Sydney Swans', code: 'SYD',
 *   form: ['L','W','W','L','W'],          // last 5, most recent first
 *   h2hWins: 7, h2hPlayed: 10,
 *   venueWins: 7, venuePlayed: 9,
 *   avgScore: 96.2, avgConceded: 74.8,
 *   avgClearances: 38.4,
 *   travellingInterstate: false
 * }
 */
function predictMatch(homeTeam, awayTeam, venue) {
  // ── Score each factor ──
  const scores = {
    recentForm: {
      home: calcFormScore(homeTeam.form),
      away: calcFormScore(awayTeam.form),
    },
    headToHead: {
      home: calcH2HScore(homeTeam.h2hWins, homeTeam.h2hPlayed),
      away: calcH2HScore(awayTeam.h2hWins, awayTeam.h2hPlayed),
    },
    avgScoreDiff: {
      home: normaliseStat(homeTeam.avgScore - homeTeam.avgConceded, -40, 40),
      away: normaliseStat(awayTeam.avgScore - awayTeam.avgConceded, -40, 40),
    },
    venueRecord: {
      home: calcVenueScore(homeTeam.venueWins, homeTeam.venuePlayed),
      away: calcVenueScore(awayTeam.venueWins, awayTeam.venuePlayed),
    },
    clearanceDiff: {
      home: calcClearanceScore(homeTeam.avgClearances - awayTeam.avgClearances),
      away: calcClearanceScore(awayTeam.avgClearances - homeTeam.avgClearances),
    },
    interstateTravel: {
      home: calcTravelScore(homeTeam.travellingInterstate, awayTeam.travellingInterstate),
      away: calcTravelScore(awayTeam.travellingInterstate, homeTeam.travellingInterstate),
    },
  };

  // ── Weighted composite score ──
  let homeTotal = 0;
  let awayTotal = 0;

  for (const [key, weight] of Object.entries(WEIGHTS)) {
    homeTotal += scores[key].home * weight;
    awayTotal += scores[key].away * weight;
  }

  // Normalise to probability (softmax-ish)
  const homeWinProb = homeTotal / (homeTotal + awayTotal);
  const awayWinProb = 1 - homeWinProb;

  // ── Predicted score ──
  const predicted = predictScore(
    homeTeam.avgScore,
    awayTeam.avgScore,
    homeTeam.avgConceded,
    awayTeam.avgConceded,
    homeWinProb
  );

  // ── Key factors for display ──
  const keyFactors = buildKeyFactors(homeTeam, awayTeam, scores);

  return {
    home: {
      team: homeTeam,
      winProbability: parseFloat((homeWinProb * 100).toFixed(1)),
      predictedScore: predicted.home,
    },
    away: {
      team: awayTeam,
      winProbability: parseFloat((awayWinProb * 100).toFixed(1)),
      predictedScore: predicted.away,
    },
    venue,
    confidence: getConfidenceTier(homeWinProb),
    keyFactors,
    scores, // raw factor breakdown (useful for debugging / display)
    predictedMargin: Math.abs(predicted.home - predicted.away),
    predictedWinner: homeWinProb >= 0.5 ? homeTeam.code : awayTeam.code,
  };
}

// ─── PLAYER PROP PREDICTOR ───────────────────────────────────────────────────
/**
 * Predict a player's stat line for the upcoming game.
 * 
 * @param {Object} player - from Champion Data /matches/{id}/statistics/players
 * @param {Object} opponent - squad object
 * @param {string} statCode - e.g. 'DISPOSAL', 'GOAL', 'TACKLE', 'MARK'
 * @returns {Object} prediction
 */
function predictPlayerStat(player, opponent, statCode) {
  const history = player.statHistory?.[statCode] || [];
  if (history.length === 0) return null;

  // Weighted average — last 3 games heavier
  const weights = [0.35, 0.25, 0.20, 0.12, 0.08];
  let weightedSum = 0;
  let totalW = 0;

  history.slice(0, 5).forEach((val, i) => {
    const w = weights[i] || 0.05;
    weightedSum += val * w;
    totalW += w;
  });

  const weightedAvg = weightedSum / totalW;
  const seasonAvg = history.reduce((a, b) => a + b, 0) / history.length;

  // Opponent defensive adjustment
  const defAdj = opponent.avgStatConceded?.[statCode]
    ? opponent.avgStatConceded[statCode] / 25  // normalise around league avg
    : 1.0;

  const predicted = weightedAvg * (0.85 + defAdj * 0.15);

  const variability = stdDev(history.slice(0, 5));
  const confidence = variability < 4 ? 'HIGH' : variability < 8 ? 'MED' : 'LOW';

  return {
    player: player.fullname,
    code: player.code,
    statCode,
    predicted: parseFloat(predicted.toFixed(1)),
    weightedAvg: parseFloat(weightedAvg.toFixed(1)),
    seasonAvg: parseFloat(seasonAvg.toFixed(1)),
    confidence,
    last5: history.slice(0, 5),
    trendDirection: history[0] > seasonAvg ? 'up' : history[0] < seasonAvg ? 'down' : 'flat',
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function normaliseStat(value, min, max) {
  return (Math.max(min, Math.min(max, value)) - min) / (max - min);
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length);
}

function buildKeyFactors(homeTeam, awayTeam, scores) {
  return [
    {
      name: 'Recent Form (Last 5)',
      homeEdge: scores.recentForm.home,
      awayEdge: scores.recentForm.away,
      weight: WEIGHTS.recentForm,
      advantage: scores.recentForm.home > scores.recentForm.away ? homeTeam.code : awayTeam.code,
    },
    {
      name: 'Head to Head Record',
      homeEdge: scores.headToHead.home,
      awayEdge: scores.headToHead.away,
      weight: WEIGHTS.headToHead,
      advantage: scores.headToHead.home > scores.headToHead.away ? homeTeam.code : awayTeam.code,
    },
    {
      name: 'Scoring Margin',
      homeEdge: scores.avgScoreDiff.home,
      awayEdge: scores.avgScoreDiff.away,
      weight: WEIGHTS.avgScoreDiff,
      advantage: scores.avgScoreDiff.home > scores.avgScoreDiff.away ? homeTeam.code : awayTeam.code,
    },
    {
      name: 'Venue Record',
      homeEdge: scores.venueRecord.home,
      awayEdge: scores.venueRecord.away,
      weight: WEIGHTS.venueRecord,
      advantage: scores.venueRecord.home > scores.venueRecord.away ? homeTeam.code : awayTeam.code,
    },
    {
      name: 'Clearance Differential',
      homeEdge: scores.clearanceDiff.home,
      awayEdge: scores.clearanceDiff.away,
      weight: WEIGHTS.clearanceDiff,
      advantage: scores.clearanceDiff.home > scores.clearanceDiff.away ? homeTeam.code : awayTeam.code,
    },
    {
      name: 'Interstate Travel',
      homeEdge: scores.interstateTravel.home,
      awayEdge: scores.interstateTravel.away,
      weight: WEIGHTS.interstateTravel,
      advantage: scores.interstateTravel.home > scores.interstateTravel.away ? homeTeam.code : awayTeam.code,
    },
  ];
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────
module.exports = {
  predictMatch,
  predictPlayerStat,
  calcFormScore,
  calcH2HScore,
  calcVenueScore,
  WEIGHTS,
};
