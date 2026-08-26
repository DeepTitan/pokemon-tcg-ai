import assert from 'node:assert/strict';
import { bumpVersion, readMarker, stripMarkers } from './trace-release-checkpoint.mjs';

assert.equal(readMarker('ship it [PATCH]'), 'PATCH');
assert.equal(readMarker('[minor] add cloud backup'), 'MINOR');
assert.equal(readMarker('[PATCH] also [MAJOR]'), 'MAJOR');
assert.equal(readMarker('ordinary commit'), null);
assert.equal(bumpVersion('0.1.17', 'PATCH'), '0.1.18');
assert.equal(bumpVersion('0.1.17', 'MINOR'), '0.2.0');
assert.equal(bumpVersion('0.1.17', 'MAJOR'), '1.0.0');
assert.equal(stripMarkers('[PATCH] ship updater'), 'ship updater');
console.log('Trace release checkpoint tests passed.');
