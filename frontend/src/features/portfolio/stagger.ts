import type { CSSProperties } from 'react';

/** Stagger index for the `.pf-rise` / `.pf-row` / `.pf-slice` / `.pf-bar` animations (see index.css). */
export const stagger = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;
