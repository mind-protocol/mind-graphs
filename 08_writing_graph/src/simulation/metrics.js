export function gini(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  let weighted = 0;
  for (let index = 0; index < sorted.length; index += 1) weighted += (index + 1) * sorted[index];
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

export function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function decileCoverage(needTotals, servedTotals, incomeRanks) {
  const needs = Array(10).fill(0);
  const served = Array(10).fill(0);
  for (let index = 0; index < needTotals.length; index += 1) {
    const decile = Math.min(9, Math.floor(incomeRanks[index] * 10));
    needs[decile] += needTotals[index];
    served[decile] += servedTotals[index];
  }
  return needs.map((need, index) => ({ decile: index + 1, coverageRate: round(need ? served[index] / need : 1) }));
}
