// Amounts arrive as integer paisa. Show NPR with Nepali grouping, for example NPR 1,00,000.00.
export function formatNPR(paisa) {
  const rupees = Number(paisa || 0) / 100;
  return `NPR ${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
