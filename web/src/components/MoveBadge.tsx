import { useState } from 'react';

import type { MoveQuality } from '../../../src/shared/protocol';
import { badgeUrl, QUALITY_STYLES } from '../lib/review';

interface MoveBadgeProps {
  quality: MoveQuality;
  /** Rendered size (px or CSS length). The source SVG is 18×18. */
  size?: number | string;
  className?: string;
}

/**
 * Chess.com's move-review badge, served from the locally mirrored `/badges`
 * assets. If an image cannot load, the original review glyph is shown instead,
 * so the review stays readable even with an incomplete deployment.
 */
export function MoveBadge({ quality, size = 16, className = '' }: MoveBadgeProps) {
  const url = badgeUrl(quality);
  const style = QUALITY_STYLES[quality];
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const pixels = typeof size === 'number' ? size : null;

  if (failedUrl === url) {
    return (
      <span
        aria-hidden="true"
        title={style.label}
        className={`inline-flex shrink-0 items-center justify-center font-bold leading-none ${style.className} ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: pixels === null ? '0.8em' : Math.max(9, pixels * 0.8)
        }}
      >
        {style.symbol || (
          <span
            className="block rounded-full bg-current"
            style={{ width: '35%', height: '35%' }}
          />
        )}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={style.label}
      title={style.label}
      {...(pixels === null ? {} : { width: pixels, height: pixels })}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      className={`inline-block shrink-0 select-none ${className}`}
      onError={() => setFailedUrl(url)}
    />
  );
}
