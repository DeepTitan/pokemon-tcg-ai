import type { MatchReview } from './types.js';

/**
 * JSON decoding loses the sharing between unchanged replay snapshots. Restore
 * exact structural sharing at the archive boundary, before publishing to React.
 * The table is local to this load: it cannot retain a previously opened match.
 * Never use this on the mutable live assembler. Frozen shared nodes prevent a
 * later edit from silently changing other frames that reference the same data.
 */
export function compactStoredReview(review: MatchReview): MatchReview {
  const interned = new Map<string, { node: object; id: number }>();
  const ids = new WeakMap<object, number>();
  function visit(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    let signature = Array.isArray(node) ? 'array:' : 'object:';
    for (const key of Object.keys(node)) {
      const child = visit(node[key]);
      node[key] = child;
      signature += JSON.stringify(key) + ':' + (child !== null && typeof child === 'object'
        ? '@' + ids.get(child) : JSON.stringify(child)) + ',';
    }
    // Full signatures, not hashes: distinct game states cannot collide. Keep
    // property order and array/object identity exactly as they were decoded.
    const existing = interned.get(signature);
    if (existing) return existing.node;
    const id = interned.size;
    ids.set(node, id);
    interned.set(signature, { node, id });
    return Object.freeze(node);
  }
  return visit(review) as MatchReview;
}
