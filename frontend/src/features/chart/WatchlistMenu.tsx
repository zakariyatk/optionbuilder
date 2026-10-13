import { useEffect, useRef, useState } from 'react';
import { confirmDialog } from '../../lib/dialog';
import { activeList, useWatchlist } from '../../store/watchlist';

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      value={value}
      maxLength={40}
      aria-label="Watchlist name"
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value);
        if (e.key === 'Escape') finish(null);
        e.stopPropagation();
      }}
      onBlur={() => finish(value)}
      onClick={(e) => e.stopPropagation()}
      className="w-full min-w-0 rounded border border-[var(--series-blue)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-sm font-semibold outline-none"
    />
  );
}

/**
 * The watchlist's title: a dropdown to switch, add or delete lists. Double-click
 * the name (or use ✎ in the menu) to rename.
 */
export function WatchlistMenu() {
  const { lists, activeId, select, create, rename, removeList } = useWatchlist();
  const active = activeList({ lists, activeId });
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const finishRename = (id: string) => (name: string | null) => {
    if (name !== null) rename(id, name);
    setRenaming(null);
  };

  const remove = async (id: string, name: string) => {
    setOpen(false);
    const ok = await confirmDialog({
      title: 'Are you sure you want to delete?',
      message: `“${name}” and its symbols will be removed.`,
      confirmLabel: 'Yes, Delete',
    });
    if (ok) removeList(id);
  };

  const iconBtn =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]';

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      {renaming === active.id && !open ? (
        <RenameField initial={active.name} onDone={finishRename(active.id)} />
      ) : (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          onDoubleClick={() => {
            setOpen(false);
            setRenaming(active.id);
          }}
          title="Click to switch lists · double-click to rename"
          className="flex max-w-full items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-semibold hover:border-[var(--border)]"
        >
          <span className="truncate">{active.name}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1 shadow-xl">
          <div className="max-h-72 overflow-y-auto">
            {lists.map((l) => (
              <div
                key={l.id}
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 ${l.id === activeId ? 'bg-[var(--surface-sunken)]' : 'hover:bg-[var(--surface-sunken)]'}`}
              >
                {renaming === l.id ? (
                  <RenameField initial={l.name} onDone={finishRename(l.id)} />
                ) : (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={l.id === activeId}
                    onClick={() => {
                      select(l.id);
                      setOpen(false);
                    }}
                    onDoubleClick={() => setRenaming(l.id)}
                    className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left text-sm"
                  >
                    <span className={`truncate ${l.id === activeId ? 'font-semibold text-[var(--series-blue)]' : ''}`}>{l.name}</span>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">{l.symbols.length}</span>
                  </button>
                )}
                {renaming !== l.id && (
                  <>
                    <button type="button" className={iconBtn} aria-label={`Rename ${l.name}`} title="Rename" onClick={() => setRenaming(l.id)}>
                      ✎
                    </button>
                    <button
                      type="button"
                      className={`${iconBtn} hover:!text-[var(--critical)] disabled:opacity-30`}
                      aria-label={`Delete ${l.name}`}
                      title={lists.length > 1 ? 'Delete' : 'You need at least one watchlist'}
                      disabled={lists.length <= 1}
                      onClick={() => void remove(l.id, l.name)}
                    >
                      🗑
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => setRenaming(create())}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-[var(--series-blue)] hover:bg-[var(--surface-sunken)]"
          >
            + Create new watchlist
          </button>
        </div>
      )}
    </div>
  );
}
