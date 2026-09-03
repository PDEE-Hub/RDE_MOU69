// engine.js — MOU 69 V1 Score Engine
// Canonical rule (pat-intelligence SKILL.md §2): Linear Interpolation only — never step scoring.
//   result < L1 threshold  -> 1.0000 (floor, never below, never 0)
//   result between Lx/Lx+1 -> interpolate fractionally
//   result >= L5 threshold -> 5.0000 (cap, never extrapolate above 5)
//   null result            -> null ("ยังไม่มีผล" — never treated as Level 1)

function interpolateLevel(value, thresholds, higherIsBetter) {
  if (value === null || value === undefined) return null;
  const t = thresholds;
  const dir = higherIsBetter !== false ? 1 : -1;
  const norm = t.map(x => x * dir);
  const v = value * dir;
  if (v <= norm[0]) return 1.0;
  if (v >= norm[4]) return 5.0;
  for (let i = 0; i < 4; i++) {
    if (v >= norm[i] && v <= norm[i + 1]) {
      const frac = norm[i + 1] === norm[i] ? 1 : (v - norm[i]) / (norm[i + 1] - norm[i]);
      return (i + 1) + frac;
    }
  }
  return 1.0;
}

// Raw Score / Weight / Weighted Value kept separate per V1 brief §8 — never
// re-derive the formula in the UI layer, always go through this function.
//
// `input` means different things per scoringMethod:
//   linear / milestone_pct        -> raw measured value (engine interpolates it)
//   qualitative / evidence /
//   milestone_manual / annual_only (Q1-Q3) -> Level already chosen by a human (engine just carries it through)
//   annual_only (Q4)              -> raw measured value (engine interpolates it — real year-end scoring)
function scoreLeafKPI(kpi, input, quarter) {
  const method = kpi.scoringMethod || 'linear';
  let level = null;
  switch (method) {
    case 'linear':
    case 'milestone_pct':
      level = interpolateLevel(input, kpi.thresholds, kpi.higherIsBetter);
      break;
    case 'annual_only':
      // Flagged business rule (needsConfirmation): only Q4 (or the year-end forecast,
      // which represents the same annual figure) is scored against the annual ceiling;
      // Q1-Q3 carry an admin-entered/seeded placeholder Level.
      level = (quarter === 'q4' || quarter === 'forecast')
        ? interpolateLevel(input, kpi.thresholds, kpi.higherIsBetter)
        : (input === null || input === undefined ? null : Number(input));
      break;
    case 'qualitative':
    case 'evidence':
    case 'milestone_manual':
      // Admin-selected Level, 1.0-5.0, no auto-interpolation (source has no formula for these)
      level = (input === null || input === undefined) ? null : Number(input);
      break;
    default:
      level = interpolateLevel(input, kpi.thresholds, kpi.higherIsBetter);
  }
  const weight = kpi.weight || 0;
  const weightedValue = level === null ? null : level * weight;
  return {
    kpiId: kpi.id,
    rawValue: input,
    level,                 // Raw Score (1.0000-5.0000 or null)
    weight,
    weightedValue,         // Weighted Value = Score x Weight
  };
}

// Composite/parent roll-up per brief §9/§13: weighted average of children's
// own Score (not re-reading raw values), renormalized to the parent's own weight budget.
function scoreParentKPI(parentKpi, childScores) {
  const withData = childScores.filter(c => c.level !== null);
  if (withData.length === 0) return { kpiId: parentKpi.id, level: null, weight: parentKpi.weight, weightedValue: null };
  const childWeightTotal = withData.reduce((s, c) => s + c.weight, 0);
  const weightedSum = withData.reduce((s, c) => s + c.level * c.weight, 0);
  const level = childWeightTotal ? weightedSum / childWeightTotal : null;
  return {
    kpiId: parentKpi.id,
    level,
    weight: parentKpi.weight,
    weightedValue: level === null ? null : level * parentKpi.weight,
  };
}

// Overall MOU score (weight budget = 60 for the 21 KPI leaves, per pat-intelligence
// scale already in production; Enablers combined-score kept separate, see project memory)
function computeOverallScore(leafScores, totalWeightBudget) {
  const withData = leafScores.filter(s => s.level !== null);
  if (withData.length === 0) return null;
  const weightedSum = withData.reduce((s, c) => s + c.weightedValue, 0);
  return weightedSum / totalWeightBudget;
}

if (typeof module !== 'undefined') {
  module.exports = { interpolateLevel, scoreLeafKPI, scoreParentKPI, computeOverallScore };
}
