import { describe, expect, it } from 'vitest';
import { mcpContentView, PROTECTED_TEXT_NOTICE } from './protected-content.js';

describe('MCP protected-content redaction', () => {
  it('removes protected text, including nested formatting, from AI-visible Markdown', () => {
    const view = mcpContentView(
      '<p>Public context <span data-protected-text="true"><strong>api_</strong><span style="color:red">secret</span></span> remains.</p>',
      'Public context **api_secret** remains.',
    );

    expect(view.protectedTextRedacted).toBe(true);
    expect(view.contentMarkdown).toContain('Public context');
    expect(view.contentMarkdown).toContain(PROTECTED_TEXT_NOTICE);
    expect(view.contentMarkdown).not.toContain('api_');
    expect(view.contentMarkdown).not.toContain('secret');
    expect(view.searchableMarkdown).not.toContain(PROTECTED_TEXT_NOTICE);
  });

  it('returns the saved Markdown unchanged when the page has no protected text', () => {
    const markdown = '## Status\n\nEverything is public.';
    expect(mcpContentView('<h2>Status</h2><p>Everything is public.</p>', markdown)).toEqual({
      contentMarkdown: markdown,
      searchableMarkdown: markdown,
      protectedTextRedacted: false,
    });
  });
});
