// verify_engine.js — cross-check engine.js output against the workbook's own
// precomputed Q1/Q2 scores (ground truth). Run: node verify_engine.js
const { scoreLeafKPI, scoreParentKPI, computeOverallScore } = require('./engine.js');
const MOU_DATA = require('./mou_data.json');

const kpis = MOU_DATA.kpis;
const quarterly = MOU_DATA.quarterly;

let pass = 0, fail = 0, skip = 0;
const EPS = 0.01;

for (const q of ['q1', 'q2']) {
  console.log(`\n=== ${q.toUpperCase()} ===`);
  const leafScores = [];
  for (const [id, kpi] of Object.entries(kpis)) {
    if (!kpi.isLeaf) continue;
    const qd = quarterly[id] && quarterly[id][q];
    if (!qd) { skip++; continue; }
    const humanChosen = ['qualitative', 'evidence', 'milestone_manual'].includes(kpi.scoringMethod)
      || (kpi.scoringMethod === 'annual_only' && q !== 'q4');
    const input = humanChosen ? qd.score : qd.actual;
    if (input === null || input === undefined) { skip++; continue; }
    const computed = scoreLeafKPI(kpi, input, q);
    const expected = qd.score;
    const diff = Math.abs(computed.level - expected);
    leafScores.push(computed);
    if (diff > EPS) {
      fail++;
      console.log(`  FAIL ${id} (${kpi.scoringMethod}): actual=${qd.actual} -> computed=${computed.level?.toFixed(4)} expected=${expected}`);
    } else {
      pass++;
    }
  }

  // parent roll-ups
  for (const [id, kpi] of Object.entries(kpis)) {
    if (kpi.isLeaf) continue;
    const children = Object.values(kpis).filter(k => k.parent === id);
    const childScores = children.map(c => leafScores.find(s => s.kpiId === c.id)).filter(Boolean);
    if (childScores.length === 0) continue;
    const parentScore = scoreParentKPI(kpi, childScores);
    const expected = quarterly[id] && quarterly[id][q] && quarterly[id][q].score;
    if (expected === undefined || expected === null) continue;
    const diff = Math.abs(parentScore.level - expected);
    if (diff > EPS) {
      fail++;
      console.log(`  FAIL parent ${id}: computed=${parentScore.level?.toFixed(4)} expected=${expected}`);
    } else {
      pass++;
      console.log(`  ok parent ${id}: ${parentScore.level.toFixed(4)} (matches source)`);
    }
  }

  const overall = computeOverallScore(leafScores, 60);
  console.log(`  Overall (60-weight budget): ${overall?.toFixed(4)}`);
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped (no data for that quarter)`);
process.exit(fail > 0 ? 1 : 0);
