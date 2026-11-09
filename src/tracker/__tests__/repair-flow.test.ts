import assert from 'node:assert/strict';
import { runTraceRepair, type RepairUpdateCheck } from '../repair-flow.js';

for (const update of ['available', 'busy'] as const) {
  const message = await runTraceRepair({ checkUpdate: async () => update, repair: async () => { throw new Error('Must not change capture during update'); }, status: () => {} });
  assert.match(message, /update/i);
}
for (const update of ['current', 'failed'] as RepairUpdateCheck[]) {
  const steps: string[] = [];
  const message = await runTraceRepair({ checkUpdate: async () => update, repair: async () => { steps.push('repair'); return { messages: ['Capture is ready.', '2 uploads still pending.'] }; }, status: value => { steps.push(value); } });
  assert.equal(steps.at(-1), 'repair');
  assert.match(message, /2 uploads still pending/);
  assert.match(message, update === 'failed' ? /Could not check for updates/ : /up to date/);
}
await assert.rejects(runTraceRepair({ checkUpdate: async () => 'current', repair: async () => { throw new Error('Finish your game and quit TCG Live'); }, status: () => {} }), /Finish your game/);
console.log('repair flow: update handoff, offline checks, pending uploads, and safe refusal pass');
