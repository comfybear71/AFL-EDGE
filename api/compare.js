/**
 * GET /api/compare?team1=Sydney&team2=Collingwood&year=2025
 * Compare two teams: season stats, H2H record, and win probability.
 */
const squiggle = require('../squiggle');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const team1Name = req.query.team1;
  const team2Name = req.query.team2;
  const reqYear = parseInt(req.query.year) || null;

  if (!team1Name || !team2Name) {
    return res.status(400).json({ error: 'team1 and team2 are required' });
  }

  try {
    let year = reqYear || new Date().getFullYear();

    let [allGames, standings] = await Promise.all([
      squiggle.getGames(year),
      squiggle.getStandings(year),
    ]);

    // Fall back to 2025 if current year has no data
    if (allGames.length === 0 && !reqYear) {
      year = 2025;
      [allGames, standings] = await Promise.all([
        squiggle.getGames(year),
        squiggle.getStandings(year),
      ]);
    }

    const completed = allGames.filter(g => g.complete === 100);

    // Build stats for each team
    const stats1 = squiggle.buildTeamStats(team1Name, year, allGames, standings, 6);
    const stats2 = squiggle.buildTeamStats(team2Name, year, allGames, standings, 6);

    if (!stats1 || !stats2) {
      return res.status(422).json({
        error: 'Not enough match data yet for one or both teams',
      });
    }

    // Head-to-head from this season
    const seasonH2H = squiggle.calcH2H(team1Name, team2Name, completed);

    // Historical H2H (last 4 years)
    let historicalGames = [...completed];
    for (let y = year - 1; y >= year - 3; y--) {
      try {
        const yearGames = await squiggle.getCompleted(y);
        historicalGames.push(...yearGames);
      } catch { /* skip */ }
    }
    const allTimeH2H1 = squiggle.calcH2H(team1Name, team2Name, historicalGames);
    const allTimeH2H2 = squiggle.calcH2H(team2Name, team1Name, historicalGames);

    // Recent matchups between the two teams (last 6)
    const recentMatchups = historicalGames
      .filter(g =>
        ((g.hteam === team1Name && g.ateam === team2Name) ||
         (g.hteam === team2Name && g.ateam === team1Name)) &&
        g.complete === 100
      )
      .slice(-6)
      .map(g => ({
        year: g.year,
        round: g.round,
        venue: g.venue,
        date: g.date,
        hteam: g.hteam,
        ateam: g.ateam,
        hscore: g.hscore,
        ascore: g.ascore,
        winner: (g.hscore || 0) > (g.ascore || 0) ? g.hteam :
                (g.ascore || 0) > (g.hscore || 0) ? g.ateam : 'Draw',
      }));

    // Win probability estimate based on stats differential
    const rankDiff = stats2.rank - stats1.rank; // positive = team1 ranked higher
    const pctDiff = stats1.percentage - stats2.percentage;
    const marginDiff = stats1.scoringMargin - stats2.scoringMargin;
    const formScore1 = stats1.form.filter(f => f === 'W').length;
    const formScore2 = stats2.form.filter(f => f === 'W').length;
    const formDiff = formScore1 - formScore2;
    const h2hAdv = allTimeH2H1.played > 0
      ? (allTimeH2H1.wins / allTimeH2H1.played - 0.5) * 100
      : 0;

    // Weighted composite score
    const composite = (
      rankDiff * 2.5 +
      pctDiff * 0.15 +
      marginDiff * 0.8 +
      formDiff * 3 +
      h2hAdv * 0.3
    );

    // Convert to probability using logistic function
    const team1WinProb = Math.round(100 / (1 + Math.exp(-composite * 0.08)));
    const team2WinProb = 100 - team1WinProb;

    res.json({
      year,
      team1: {
        name: team1Name,
        rank: stats1.rank,
        wins: stats1.wins,
        losses: stats1.losses,
        percentage: stats1.percentage,
        avgScore: stats1.avgScore,
        avgConceded: stats1.avgConceded,
        scoringMargin: stats1.scoringMargin,
        form: stats1.form,
        winProbability: team1WinProb,
      },
      team2: {
        name: team2Name,
        rank: stats2.rank,
        wins: stats2.wins,
        losses: stats2.losses,
        percentage: stats2.percentage,
        avgScore: stats2.avgScore,
        avgConceded: stats2.avgConceded,
        scoringMargin: stats2.scoringMargin,
        form: stats2.form,
        winProbability: team2WinProb,
      },
      h2h: {
        season: {
          team1Wins: seasonH2H.wins,
          played: seasonH2H.played,
        },
        historical: {
          team1Wins: allTimeH2H1.wins,
          team2Wins: allTimeH2H2.wins,
          played: allTimeH2H1.played,
          years: `${year - 3}-${year}`,
        },
      },
      recentMatchups,
    });

  } catch (err) {
    console.error('[compare]', err.message);
    res.status(500).json({ error: err.message });
  }
};
