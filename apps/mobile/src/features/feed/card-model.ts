import type { Kind } from '../../theme/tokens';
import type { MessageKey } from '../../i18n/core';

export type DifficultyBand = 'easy' | 'medium' | 'hard';
/** `difficulty` is 0..1 (content_items.difficulty). Null = unknown → no label rather than a guess. */
export function difficultyBand(d: number | null | undefined): DifficultyBand | null {
  if (d == null || !Number.isFinite(d)) return null;
  return d < 0.34 ? 'easy' : d < 0.67 ? 'medium' : 'hard';
}
export const difficultyKey = (b: DifficultyBand): MessageKey => `feed.difficulty.${b}`;

export const kindLabelKey = (kind: Kind, format?: string | null): MessageKey =>
  format === 'challenge'
    ? 'feed.format.challenge'
    : kind === 'other'
      ? 'feed.format.other'
      : `feed.format.${kind}`;

/** Position within a content list for the screen-reader label ("3 of 10"). */
export const positionLabel = (index: number, total: number) => `${index + 1} / ${total}`;
