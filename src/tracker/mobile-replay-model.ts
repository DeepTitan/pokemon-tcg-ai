import type { TrackedTurn } from './types.js';

export interface ReviewChapter { label: string; players: string[]; first: number; last: number }

/** Use the recording's turn boundaries, with an explicit participants label.
 * A handoff frame may already carry the next number while retaining the previous
 * actor, so guessing a separate player turn from it creates spurious chapters. */
export function buildReviewChapters(turns: readonly TrackedTurn[]): ReviewChapter[] {
  const chapters: ReviewChapter[] = [];
  turns.forEach((turn, index) => {
    const label = turn.label.split(/\s+·\s+/)[0]?.trim() || turn.label;
    let chapter = chapters[chapters.length - 1];
    if (chapter?.label !== label) {
      chapter = { label, players: [], first: index, last: index };
      chapters.push(chapter);
    }
    chapter.last = index;
    if (turn.player && !chapter.players.includes(turn.player)) chapter.players.push(turn.player);
  });
  return chapters;
}

/** Expanded benches must stay inspectable, with five empty slots at setup. */
export function reviewBenchSlots<T>(bench: readonly T[]): (T | null)[] {
  return [...bench, ...Array.from({ length: Math.max(0, 5 - bench.length) }, () => null)];
}
