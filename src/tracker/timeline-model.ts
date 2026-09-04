import type { TrackedTurn, TrackerEvent } from './types.js';
import { presentTurnEvents } from './game-log-copy.js';

export interface TimelineEntry {
  event: TrackerEvent;
  turn: TrackedTurn;
  key: string;
  position: number;
  reviewIndex: number;
}

export interface TimelineGroup {
  key: string;
  label: string;
  actors: string[];
  entries: TimelineEntry[];
}

function turnGroupLabel(turn: TrackedTurn): string {
  return turn.label.split(/\s+·\s+/)[0]?.trim() || turn.label;
}

export function timelineEventKey(reviewIndex: number, event: TrackerEvent): string {
  return `${reviewIndex}:${event.id}`;
}

export function buildTimeline(turns: TrackedTurn[]): { entries: TimelineEntry[]; groups: TimelineGroup[] } {
  const entries = turns.flatMap((turn, reviewIndex) => presentTurnEvents(turn)
    .map((event) => ({
      event,
      turn,
      reviewIndex,
      key: timelineEventKey(reviewIndex, event),
      position: 0,
    })));

  entries.forEach((entry, index) => { entry.position = index + 1; });

  const groups: TimelineGroup[] = [];
  for (const entry of entries) {
    const label = turnGroupLabel(entry.turn);
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { key: `${entry.reviewIndex}:${label}`, label, actors: [], entries: [] };
      groups.push(group);
    }
    if (entry.turn.player && !group.actors.includes(entry.turn.player)) group.actors.push(entry.turn.player);
    group.entries.push(entry);
  }

  return { entries, groups };
}

export function eventKeyForReviewIndex(entries: TimelineEntry[], reviewIndex: number): string | null {
  return [...entries].reverse().find((entry) => entry.reviewIndex <= reviewIndex)?.key || null;
}
