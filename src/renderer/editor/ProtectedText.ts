import { Mark, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';

const protectedTextGuardKey = new PluginKey('protectedTextGuard');

export interface ProtectedTextOptions {
  onBlocked: () => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    protectedText: {
      protectText: () => ReturnType;
      unprotectText: () => ReturnType;
    };
  }
}

function protectedRanges(doc: ProseMirrorNode, markName: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  doc.descendants((node, position) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === markName)) {
      ranges.push({ from: position, to: position + node.nodeSize });
    }
  });
  return ranges;
}

export function rangeTouchesProtectedText(doc: ProseMirrorNode, from: number, to: number, markName = 'protectedText'): boolean {
  const ranges = protectedRanges(doc, markName);
  if (from !== to) return ranges.some((range) => range.from < to && range.to > from);

  // An insertion is inside protected content only when protected text exists on
  // both sides. This deliberately permits typing immediately before or after it.
  const protectedBefore = ranges.some((range) => range.from < from && range.to >= from);
  const protectedAfter = ranges.some((range) => range.from <= from && range.to > from);
  return protectedBefore && protectedAfter;
}

export function transactionTouchesProtectedText(transaction: Transaction, markName = 'protectedText'): boolean {
  if (!transaction.docChanged || transaction.getMeta(protectedTextGuardKey)) return false;

  return transaction.steps.some((step, index) => {
    const docBeforeStep = transaction.docs[index];
    let mappedChange = false;
    let touchesProtectedText = false;

    step.getMap().forEach((oldStart, oldEnd) => {
      mappedChange = true;
      if (rangeTouchesProtectedText(docBeforeStep, oldStart, oldEnd, markName)) touchesProtectedText = true;
    });
    if (touchesProtectedText) return true;

    // Mark-only steps have an empty StepMap, so inspect their serialized range.
    const json = step.toJSON() as { from?: unknown; to?: unknown };
    return !mappedChange
      && typeof json.from === 'number'
      && typeof json.to === 'number'
      && rangeTouchesProtectedText(docBeforeStep, json.from, json.to, markName);
  });
}

export const ProtectedText = Mark.create<ProtectedTextOptions>({
  name: 'protectedText',
  inclusive: false,
  excludes: '',

  addOptions() {
    return { onBlocked: () => undefined };
  },

  parseHTML() {
    return [{ tag: 'span[data-protected-text="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-protected-text': 'true',
      title: 'Protected text — copy is allowed; unprotect to edit',
    }), 0];
  },

  addCommands() {
    return {
      protectText: () => ({ state, dispatch }) => {
        const { from, to, empty } = state.selection;
        if (empty) return false;
        const transaction = state.tr
          .addMark(from, to, this.type.create())
          .setMeta(protectedTextGuardKey, true);
        dispatch?.(transaction);
        return true;
      },
      unprotectText: () => ({ state, dispatch }) => {
        const { from, to, empty } = state.selection;
        if (empty) return false;
        const transaction = state.tr
          .removeMark(from, to, this.type)
          .setMeta(protectedTextGuardKey, true);
        dispatch?.(transaction);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: protectedTextGuardKey,
      filterTransaction: (transaction) => {
        const blocked = transactionTouchesProtectedText(transaction, this.name);
        if (blocked) this.options.onBlocked();
        return !blocked;
      },
    })];
  },
});
