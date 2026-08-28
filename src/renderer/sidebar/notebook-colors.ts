export const NOTEBOOK_COLORS = ['#087f5b', '#2563eb', '#7c3aed', '#d97706', '#0891b2', '#db2777', '#16a34a', '#dc5a34'] as const;

function preferredColorIndex(id: string): number {
  const hash = [...id].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 7);
  return hash % NOTEBOOK_COLORS.length;
}

export function assignNotebookColors(ids: string[]): Map<string, string> {
  const assignments = new Map<string, string>();
  let used = new Set<number>();

  ids.forEach((id, position) => {
    if (position > 0 && position % NOTEBOOK_COLORS.length === 0) used = new Set<number>();
    let colorIndex = preferredColorIndex(id);
    while (used.has(colorIndex)) colorIndex = (colorIndex + 1) % NOTEBOOK_COLORS.length;
    used.add(colorIndex);
    assignments.set(id, NOTEBOOK_COLORS[colorIndex]);
  });

  return assignments;
}
