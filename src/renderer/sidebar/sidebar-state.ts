export const COLLAPSED_SIDEBAR_ITEMS_KEY = 'noteleaf.sidebar.collapsed-items.v1';

export function parseCollapsedSidebarItems(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

export function serializeCollapsedSidebarItems(items: Set<string>): string {
  return JSON.stringify([...items]);
}
