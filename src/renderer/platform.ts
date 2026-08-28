const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

export const shortcutModifier = isMac ? '⌘' : 'Ctrl';

export function hasPrimaryModifier(event: KeyboardEvent): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

export function shortcut(key: string): string {
  return isMac ? `${shortcutModifier}${key}` : `${shortcutModifier}+${key}`;
}
