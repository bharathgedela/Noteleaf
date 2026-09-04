import { describe, expect, it } from 'vitest';
import { parseCollapsedSidebarItems, serializeCollapsedSidebarItems } from './sidebar-state';

describe('sidebar expansion state', () => {
  it('round-trips collapsed notebook and section ids', () => {
    const collapsed = new Set(['notebook-1', 'section-2']);
    expect(parseCollapsedSidebarItems(serializeCollapsedSidebarItems(collapsed))).toEqual(collapsed);
  });

  it('ignores missing, malformed, and non-string values', () => {
    expect(parseCollapsedSidebarItems(null)).toEqual(new Set());
    expect(parseCollapsedSidebarItems('{broken')).toEqual(new Set());
    expect(parseCollapsedSidebarItems(JSON.stringify(['section-1', 42, '', null]))).toEqual(new Set(['section-1']));
  });
});
