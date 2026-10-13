import { create } from 'zustand';

/**
 * In-app replacements for window.confirm / window.prompt, rendered by
 * <DialogHost />. Both return a promise, so call sites read like the
 * browser versions: `if (!(await confirmDialog({ … }))) return;`.
 */

export interface ConfirmOptions {
  /** The question, e.g. "Are you sure you want to delete?" */
  title: string;
  /** Optional detail under the question. */
  message?: string;
  /** Label of the confirming button, e.g. "Yes, Delete". */
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface PromptOptions extends ConfirmOptions {
  defaultValue?: string;
  placeholder?: string;
  /** A long, read-only value to show and copy (e.g. a caption). */
  multiline?: boolean;
}

export type DialogRequest =
  | ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: 'prompt'; resolve: (value: string | null) => void } & PromptOptions);

interface DialogState {
  queue: DialogRequest[];
  push: (d: DialogRequest) => void;
  /** Settles the dialog on screen and shows the next one, if any. */
  settle: (value: boolean | string | null) => void;
}

export const useDialogs = create<DialogState>()((set, get) => ({
  queue: [],
  push: (d) => set((s) => ({ queue: [...s.queue, d] })),
  settle: (value) => {
    const [current, ...rest] = get().queue;
    if (!current) return;
    set({ queue: rest });
    if (current.kind === 'confirm') current.resolve(value === true);
    else current.resolve(typeof value === 'string' ? value : null);
  },
}));

export const confirmDialog = (options: ConfirmOptions): Promise<boolean> =>
  new Promise((resolve) => useDialogs.getState().push({ kind: 'confirm', resolve, ...options }));

export const promptDialog = (options: PromptOptions): Promise<string | null> =>
  new Promise((resolve) => useDialogs.getState().push({ kind: 'prompt', resolve, ...options }));
