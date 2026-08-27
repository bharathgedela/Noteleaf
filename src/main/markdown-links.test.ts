import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveMarkdownLink } from './markdown-links.js';

describe('resolveMarkdownLink', () => {
  const source = resolve('docs', 'guides', 'Call Guide.md');

  it('resolves relative Markdown links beside the current document', () => {
    expect(resolveMarkdownLink(source, './AWS%20platform.md#architecture')).toBe(join(dirname(source), 'AWS platform.md'));
    expect(resolveMarkdownLink(source, '../Core.md')).toBe(resolve(dirname(source), '../Core.md'));
  });

  it('accepts absolute file URLs for Markdown documents', () => {
    const target = resolve('docs', 'Architecture.markdown');
    expect(resolveMarkdownLink(source, pathToFileURL(target).toString())).toBe(target);
  });

  it('rejects web links, same-document anchors, and non-Markdown files', () => {
    expect(resolveMarkdownLink(source, 'https://example.com/guide.md')).toBeNull();
    expect(resolveMarkdownLink(source, '#reference-documents')).toBeNull();
    expect(resolveMarkdownLink(source, './diagram.png')).toBeNull();
  });
});
