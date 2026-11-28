import { lichessAnalysisUrl } from '../../../src/shared/openings';
import type { OpeningInfo } from '../../../src/shared/protocol';

interface OpeningLabelProps {
  opening: OpeningInfo;
  /** FEN of the position to explore; enables the link on the ECO code. */
  fen?: string | null;
  className?: string;
}

const CODE_CLASS = 'font-mono text-[10px]';
const LINK_CLASS = [
  CODE_CLASS,
  'rounded text-muted underline decoration-dotted decoration-1 underline-offset-2',
  'transition-colors hover:text-accent-strong hover:decoration-solid',
  'focus-visible:text-accent-strong focus-visible:outline-none focus-visible:ring-1',
  'focus-visible:ring-accent'
].join(' ');

/**
 * Opening name plus its ECO code. The code is a discreet link to the Lichess
 * analysis board (its opening explorer shares this app's dataset); without a FEN
 * the code stays plain text.
 */
export function OpeningLabel({ opening, fen = null, className = '' }: OpeningLabelProps) {
  return (
    <span className={className}>
      <span className="font-semibold text-ink">{opening.name}</span>{' '}
      {fen ? (
        <a
          href={lichessAnalysisUrl(fen)}
          target="_blank"
          rel="noopener noreferrer"
          title={`${opening.eco} — explore this position on Lichess`}
          aria-label={`Open ${opening.eco} in the Lichess opening explorer`}
          className={LINK_CLASS}
        >
          {opening.eco}
        </a>
      ) : (
        <span className={`${CODE_CLASS} text-muted`}>{opening.eco}</span>
      )}
    </span>
  );
}
