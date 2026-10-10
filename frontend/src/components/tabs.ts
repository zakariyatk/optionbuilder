export type TabId = 'builder' | 'chain' | 'report';

export const TABS: { id: TabId; label: string }[] = [
  { id: 'builder', label: 'Strategy Builder' },
  { id: 'chain', label: 'Option Chain' },
  { id: 'report', label: 'Daily Report' },
];
