import type { NotesApi } from '../shared/types';

declare global {
  interface Window {
    notes: NotesApi;
  }
}

export {};
