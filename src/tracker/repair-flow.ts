export type RepairUpdateCheck = 'available' | 'current' | 'failed' | 'busy';

export async function runTraceRepair(deps: {
  checkUpdate: () => Promise<RepairUpdateCheck>;
  repair: () => Promise<{ messages: string[] }>;
  status: (message: string) => void;
}): Promise<string> {
  deps.status('Checking for updates…');
  const result = await deps.checkUpdate();
  if (result === 'available') return 'An update is available. Install it below, restart Trace, then try capture again.';
  if (result === 'busy') return 'Finish the update below, then click Fix Trace again.';
  deps.status('Checking capture permissions and retrying uploads…');
  const repaired = await deps.repair();
  return [result === 'failed' ? 'Could not check for updates. Check your connection and try again.' : 'Trace is up to date.', ...repaired.messages].join(' ');
}
