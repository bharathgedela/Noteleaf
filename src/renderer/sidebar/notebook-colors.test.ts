import { describe, expect, it } from 'vitest';
import { assignNotebookColors, NOTEBOOK_COLORS } from './notebook-colors';

describe('assignNotebookColors', () => {
  it('resolves preferred-color collisions', () => {
    const colors = assignNotebookColors(['a', 'i']);
    expect(colors.get('a')).not.toBe(colors.get('i'));
  });

  it('uses every palette color before repeating', () => {
    const ids = Array.from({ length: NOTEBOOK_COLORS.length }, (_, index) => `notebook-${index}`);
    expect(new Set(assignNotebookColors(ids).values())).toHaveLength(NOTEBOOK_COLORS.length);
  });

  it('is deterministic for the same ordered notebooks', () => {
    const ids = ['natural-retreats', 'kb', 'personal', 'archive'];
    expect([...assignNotebookColors(ids)]).toEqual([...assignNotebookColors(ids)]);
  });
});
