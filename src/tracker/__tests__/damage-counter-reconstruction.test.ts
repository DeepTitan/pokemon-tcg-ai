import assert from 'node:assert/strict';
import { LiveReviewAssembler } from '../live-operation-reducer.js';
import type { CapturedOperation, CardInfo, MatchReview } from '../types.js';

const catalog = new Map<string, CardInfo>([
  ['torchic', { id: 'torchic', name: 'Torchic', hp: 70, category: 1, cardType: 'R' }],
  ['dreepy', { id: 'dreepy', name: 'Dreepy', hp: 70, category: 1, cardType: 'P' }],
]);
const packet = (index: number, operation: object): CapturedOperation => ({
  receivedAt: `${index}.000Z`, socketHost: 'test', globalMessageType: 'PlayerMessage',
  gameId: 'damage-game', matchId: 'damage-match', accountId: 'p1', messageType: 1,
  messageIndex: index, operationId: `op-${index}`, operation: { operationNumber: index, ...operation },
});
function seed(counters = 1) {
  const assembler = new LiveReviewAssembler(catalog);
  const review = assembler.ingest(packet(1, { matchStarted: true, updatedEntities: [
    { entityID: 'p1', ownerPlayerId: 'p1', currentPos: 3, userName: 'Isaiah' },
    { entityID: 'p2', ownerPlayerId: 'p2', currentPos: 4, userName: 'Opponent' },
    { entityID: 'source', ownerPlayerId: 'p2', currentGamePos: 14, cardSourceID: 'torchic', damageCounters: counters },
    { entityID: 'target', ownerPlayerId: 'p1', currentGamePos: 15, cardSourceID: 'dreepy', damageCounters: 1 },
  ] }))!;
  return { assembler, review, original: JSON.stringify(review.turns) };
}
const move = (id: string, previous: number, next: number | undefined, extra: object = {}) => ({
  $type: 'MatchLogic.MoveDCModification, MatchLogic', actionModificationID: id, isFinal: true,
  modifiedDCEntities: [
    { cardAddress: { entityID: 'source', pos: 14 }, previousDC: previous, ...(next === undefined ? {} : { newDC: next }) },
    { cardAddress: { entityID: 'target', pos: 15 }, previousDC: 1, newDC: 1 + previous - (next ?? 0) },
  ],
  // This is the sparse wrapped shape captured from Live when zero is omitted.
  UpdatedEntities: { $values: [{ entityID: 'source', curPos: 14, isCard: true }] },
  ...extra,
});
function assertDamage(review: MatchReview, source: number, target: number) {
  const turn = review.turns.at(-1)!;
  assert.equal(turn.snapshot.players.Opponent.bench[0].damage, source * 10, 'Source damage');
  assert.equal(turn.snapshot.players.Isaiah.active!.damage, target * 10, 'Recipient damage');
  const canonical = turn.canonical!;
  for (const [name, damage] of [['Opponent', source], ['Isaiah', target]] as const) {
    const player = canonical.state.players[canonical.playerNames.indexOf(name)];
    const pokemon = name === 'Opponent' ? player.bench[0] : player.active!;
    assert.equal(pokemon.damageCounters, damage, 'Canonical counters agree with board');
    assert.equal(pokemon.currentHp, 70 - damage * 10, 'HP agrees with counters');
  }
}

for (const [previous, next] of [[1, undefined], [3, 0], [5, 2]] as const) {
  const { assembler, review, original } = seed(previous);
  const beforeLength = review.turns.length;
  const update = packet(2, { actionModifications: [move('transfer', previous, next)] });
  const result = assembler.ingest(update)!;
  assertDamage(result, next ?? 0, 1 + previous - (next ?? 0));
  assert.ok(result.turns.at(-1)!.events.some(event => event.facts?.some(fact => fact.label === 'Damage counters' && fact.targetEntityId === 'source')), 'Counter facts retain the captured source identity');
  assert.equal(JSON.stringify(result.turns.slice(0, beforeLength)), original, 'Earlier frames stay immutable');
  assembler.ingest(update);
  assertDamage(result, next ?? 0, 1 + previous - (next ?? 0));
  const later = assembler.ingest(packet(3, { updatedEntities: [{ entityID: 'source', currentGamePos: 14 }] }))!;
  assertDamage(later, next ?? 0, 1 + previous - (next ?? 0));
}

{
  const { assembler } = seed();
  const pending = assembler.ingest(packet(2, { actionModifications: [move('preview', 1, undefined, { isFinal: false })] }))!;
  assertDamage(pending, 1, 1);
  const incomplete = assembler.ingest(packet(3, { actionModifications: [move('address-only', 1, undefined, {
    modifiedDCEntities: [{ cardAddress: { entityID: 'source', pos: 14 } }],
  })] }))!;
  assertDamage(incomplete, 1, 1);
}

for (const direct of [false, true]) {
  const { assembler } = seed();
  const explicit = { entityID: 'source', damageCounters: 2 };
  const result = assembler.ingest(packet(2, {
    actionModifications: [move('transfer', 1, undefined), ...(!direct ? [{
      $type: 'MatchLogic.ApplyDamageModification, MatchLogic', actionModificationID: 'later-damage',
      isFinal: true, UpdatedEntities: { $values: [explicit] },
    }] : [])],
    ...(direct ? { updatedEntities: [explicit] } : {}),
  }))!;
  assertDamage(result, 2, 2);
}

{
  const { assembler } = seed();
  const result = assembler.ingest(packet(2, { actionModifications: [{
    $type: 'MatchLogic.MoveDCModification, MatchLogic', actionModificationID: 'pascal-case', IsFinal: true,
    ModifiedDCEntities: [{ CardAddress: { EntityID: 'source', pos: 14 }, PreviousDC: 1 }],
  }] }))!;
  assertDamage(result, 0, 1);
}

const heal = (id: string, amount: number, extra: object = {}) => ({
  $type: 'MatchLogic.HealModification, MatchLogic', actionModificationID: id, isFinal: true,
  appliedHealDeltas: [{ cardAddress: { entityID: 'source', pos: 14 }, healAmount: amount }],
  UpdatedEntities: { $values: [{ entityID: 'source', curPos: 14, isCard: true }] }, ...extra,
});
for (const [amount, expected] of [[10, 2], [30, 0], [90, 0]] as const) {
  const { assembler } = seed(3);
  const result = assembler.ingest(packet(2, { actionModifications: [heal('heal', amount)] }))!;
  assertDamage(result, expected, 1);
}
{
  const { assembler } = seed(3);
  assertDamage(assembler.ingest(packet(2, { actionModifications: [heal('pending', 30, { isFinal: false })] }))!, 3, 1);
  assertDamage(assembler.ingest(packet(3, { actionModifications: [heal('first', 10), heal('second', 20)] }))!, 0, 1);
}

{
  const { assembler } = seed();
  assembler.ingest(packet(2, { updatedEntities: [{ entityID: 'copy', ownerPlayerId: 'p2', currentGamePos: 14, cardSourceID: 'torchic', damageCounters: 1 }] }));
  const result = assembler.ingest(packet(3, { actionModifications: [move('both-copies', 1, 0, {
    modifiedDCEntities: ['source', 'copy'].map(entityID => ({ cardAddress: { entityID, pos: 14 }, previousDC: 1 })),
  })] }))!;
  const targets = new Set(result.turns.at(-1)!.events.flatMap(event => event.facts || [])
    .filter(fact => fact.label === 'Damage counters').map(fact => fact.targetEntityId));
  assert.deepEqual([...targets].sort(), ['copy', 'source'], 'Same-name, same-amount facts keep both physical targets');
}
console.log('Damage counter reconstruction tests passed');
