import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export async function markdownToEditorHtml(markdown: string): Promise<string> {
  const unsafe = await marked.parse(markdown, { async: false });
  return sanitizeHtml(String(unsafe), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'table', 'thead', 'tbody', 'tr', 'th', 'td']),
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'], code: ['class'] },
    allowedSchemes: ['http', 'https', 'data', 'notes'],
  });
}
