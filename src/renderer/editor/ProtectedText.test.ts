import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { rangeTouchesProtectedText, transactionTouchesProtectedText } from './ProtectedText.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
  },
  marks: {
    protectedText: {},
    bold: {},
  },
});

function protectedDocument() {
  const protectedText = schema.mark('protectedText');
  return schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('before '),
      schema.text('secret', [protectedText]),
      schema.text(' after'),
    ]),
  ]);
}

describe('protected text transaction guard', () => {
  it('detects replacements and insertions inside protected text', () => {
    const state = EditorState.create({ doc: protectedDocument() });
    expect(transactionTouchesProtectedText(state.tr.delete(9, 11))).toBe(true);
    expect(transactionTouchesProtectedText(state.tr.insertText('x', 10))).toBe(true);
  });

  it('allows typing directly outside protected text', () => {
    const doc = protectedDocument();
    const state = EditorState.create({ doc });
    expect(rangeTouchesProtectedText(doc, 8, 8)).toBe(false);
    expect(rangeTouchesProtectedText(doc, 14, 14)).toBe(false);
    expect(transactionTouchesProtectedText(state.tr.insertText('x', 8))).toBe(false);
    expect(transactionTouchesProtectedText(state.tr.insertText('x', 14))).toBe(false);
  });

  it('blocks formatting changes that overlap protected text', () => {
    const state = EditorState.create({ doc: protectedDocument() });
    const transaction = state.tr.addMark(8, 14, schema.mark('bold'));
    expect(transactionTouchesProtectedText(transaction)).toBe(true);
  });

  it('allows selection-only transactions so protected text remains copyable', () => {
    const state = EditorState.create({ doc: protectedDocument() });
    const transaction = state.tr.setSelection(TextSelection.create(state.doc, 8, 14));
    expect(transactionTouchesProtectedText(transaction)).toBe(false);
  });
});
