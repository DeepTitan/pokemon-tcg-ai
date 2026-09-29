import test from 'node:test';
import assert from 'node:assert/strict';
import { baseline, additions, verifyCurrent, verifyStaged } from '../../scripts/verify-trace-apex-routes.mjs';
const versions = { versions: [{ ...baseline.version, isLive: true }] };
function staged() {
  const snapshot = structuredClone(baseline);
  snapshot.routes.splice(-1, 0, ...additions.map(({ route }, index) => ({ ...structuredClone(route), id: `new-${index}`, staged: true, routeType: 'rewrite' })));
  return snapshot;
}
test('route review accepts the observed live baseline and only the planned two additions', () => {
  assert.equal(verifyCurrent(baseline, versions), true);
  assert.equal(verifyStaged(staged()), true);
});
test('changed live version, existing staged work and reordered routes block release review', () => {
  assert.throws(() => verifyCurrent({ ...baseline, version: { id: 'changed' } }, versions));
  assert.throws(() => verifyCurrent(baseline, { versions: [...versions.versions, { id: 'other', isStaging: true }] }));
  const reordered = structuredClone(baseline); reordered.routes.reverse();
  assert.throws(() => verifyCurrent(reordered, versions));
});
test('staged review rejects dropped public routes, modified existing rules and unexpected transforms', () => {
  let changed = staged(); changed.routes.shift(); assert.throws(() => verifyStaged(changed));
  changed = staged(); changed.routes[0].enabled = false; assert.throws(() => verifyStaged(changed));
  changed = staged(); changed.routes[8].route.headers = { 'Access-Control-Allow-Origin': '*' }; assert.throws(() => verifyStaged(changed));
  changed = staged(); changed.routes.push(changed.routes.splice(8, 1)[0]); assert.throws(() => verifyStaged(changed));
});
test('project API destination uses the capture syntax verified on the staged alias', () => {
  const changed = staged();
  const api = changed.routes.find(({ route }) => route.src === '/trace/api/:action*');
  api.route.dest = 'https://victoryroad-lovat.vercel.app/trace/api/:action*';
  assert.throws(() => verifyStaged(changed), /must use the \$1 capture/);
});
