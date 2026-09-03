import sanitizeHtml from 'sanitize-html';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export const PROTECTED_TEXT_NOTICE = '[Protected text hidden by Noteleaf]';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.use(gfm);

export interface McpContentView {
  contentMarkdown: string;
  searchableMarkdown: string;
  protectedTextRedacted: boolean;
}

export function mcpContentView(contentHtml: string, fallbackMarkdown: string): McpContentView {
  if (!contentHtml.toLowerCase().includes('data-protected-text')) {
    return { contentMarkdown: fallbackMarkdown, searchableMarkdown: fallbackMarkdown, protectedTextRedacted: false };
  }

  let protectedTextRedacted = false;
  const redactedHtml = sanitizeHtml(contentHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'table', 'thead', 'tbody', 'tr', 'th', 'td']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      span: ['data-protected-text'],
      img: ['src', 'alt', 'title'],
      code: ['class'],
    },
    exclusiveFilter: (frame) => {
      const protectedElement = frame.tag === 'span' && frame.attribs['data-protected-text'] === 'true';
      if (protectedElement) protectedTextRedacted = true;
      return protectedElement;
    },
  });

  if (!protectedTextRedacted) {
    return { contentMarkdown: fallbackMarkdown, searchableMarkdown: fallbackMarkdown, protectedTextRedacted: false };
  }

  const searchableMarkdown = turndown.turndown(redactedHtml).trim();
  return {
    contentMarkdown: [searchableMarkdown, `> ${PROTECTED_TEXT_NOTICE}`].filter(Boolean).join('\n\n'),
    searchableMarkdown,
    protectedTextRedacted: true,
  };
}
