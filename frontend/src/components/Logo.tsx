/**
 * The Option Builder mark: an "A" with rising candles and a violet trend arrow,
 * on a rounded tile. Colours come from --logo-tile, --logo-ink and --logo-accent
 * in styles/index.css; the arrow is outlined in the tile colour so it reads
 * cleanly where it crosses the "A". public/favicon.svg is the same drawing.
 */
export function Logo({ size = 36, className = '' }: { size?: number; className?: string }) {
  const tile = { fill: 'var(--logo-tile)' };
  const ink = { fill: 'var(--logo-ink)' };
  const accent = { fill: 'var(--logo-accent)', stroke: 'var(--logo-tile)' };
  // Candle wicks turn to mush at small sizes, so they only show from 48px up.
  const wicks = size >= 48;
  return (
    <svg width={size} height={size} viewBox="162 157 928 935" className={`shrink-0 ${className}`} aria-hidden="true">
      <rect x="162" y="157" width="928" height="935" rx="220" style={tile} />
      <g style={ink}>
        <path d="M578,322 C600,285 658,285 680,322 L790,527 L706,612 L626,472 L520,655 C440,738 360,805 286,866 C276,873 266,866 272,856 Z" />
        <path d="M276,903 L382,816 L382,918 C382,926 376,932 368,932 L286,932 C266,932 262,914 276,903 Z" />
        <rect x="410" y="793" width="55" height="140" rx="9" />
        <rect x="573" y="679" width="55" height="156" rx="9" />
        {wicks && <rect x="430" y="770" width="12" height="30" rx="5" />}
        {wicks && <rect x="593" y="654" width="13" height="30" rx="5" />}
        <path d="M828,606 L982,888 C996,912 984,932 958,932 L842,932 C822,932 808,924 800,910 L724,768 C712,744 716,722 732,704 Z" />
      </g>
      <g style={accent} strokeWidth="14" strokeLinejoin="round" paintOrder="stroke">
        <rect x="488" y="739" width="63" height="138" rx="9" stroke="none" />
        {wicks && <rect x="513" y="713" width="13" height="30" rx="5" stroke="none" />}
        <path d="M482,710 L604,584 C610,578 618,578 624,584 L692,648 L832,516 L852,540 L702,704 C694,712 684,712 678,704 L606,622 Z" />
        <path d="M806,488 L900,458 C910,455 916,462 913,472 L894,560 C891,570 882,572 876,566 Z" />
      </g>
    </svg>
  );
}
