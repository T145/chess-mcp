export interface BrandMark {
  id: string;
  src: string;
}

/**
 * The single mark shared by the favicon, navbar and docs. The SVG embeds the
 * keyed queen PNG; the tile, arm, board and spark are vector.
 */
export const BRAND_MARK: BrandMark = {
  id: 'mark-queen',
  src: '/marks/mark-queen.svg'
};

