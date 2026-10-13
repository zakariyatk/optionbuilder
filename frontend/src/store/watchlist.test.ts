import { beforeEach, describe, expect, it } from 'vitest';
import { activeList, nextListName, useWatchlist } from './watchlist';

const state = () => useWatchlist.getState();

describe('watchlists', () => {
  beforeEach(() => useWatchlist.setState({ lists: [{ id: 'a', name: 'Watchlist', symbols: ['NIFTY'] }], activeId: 'a' }));

  it('names new lists with the lowest free number', () => {
    expect(nextListName([{ id: '1', name: 'Watchlist 1', symbols: [] }, { id: '2', name: 'Watchlist 3', symbols: [] }])).toBe('Watchlist 2');
  });

  it('creates, switches and keeps symbols per list', () => {
    const id = state().create();
    expect(state().activeId).toBe(id);
    expect(activeList(state()).name).toBe('Watchlist 1');
    state().add('TCS');
    state().select('a');
    expect(activeList(state()).symbols).toEqual(['NIFTY']);
    expect(state().lists.find((l) => l.id === id)!.symbols).toEqual(['TCS']);
  });

  it('renames with trimmed, non-empty names', () => {
    state().rename('a', '  Banks   & NBFCs ');
    expect(activeList(state()).name).toBe('Banks & NBFCs');
    state().rename('a', '   ');
    expect(activeList(state()).name).toBe('Banks & NBFCs');
  });

  it('deletes lists but always keeps one, moving off a deleted active list', () => {
    const id = state().create();
    state().removeList(id);
    expect(state().lists).toHaveLength(1);
    expect(state().activeId).toBe('a');
    state().removeList('a');
    expect(state().lists).toHaveLength(1);
  });
});
