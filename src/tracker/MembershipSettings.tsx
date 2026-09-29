import { useEffect, useState } from 'react';
import type { MembershipLink, MembershipStatus } from './types.js';
import { linkMembership, openMembershipAccount, unlinkMembership } from './tauri.js';

export function MembershipSettings({ status, onRefresh, onChange }: {
  status: MembershipStatus | null; onRefresh: () => Promise<void>; onChange: (status: MembershipStatus) => void;
}) {
  const [link, setLink] = useState<MembershipLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (status?.linked) setLink(null); }, [status?.linked]);
  useEffect(() => {
    if (!link) return;
    const timer = window.setInterval(() => { if (Date.parse(link.expiresAt) <= Date.now()) { setLink(null); setError('That code expired. Link your account again.'); } else void onRefresh(); }, 4000);
    return () => window.clearInterval(timer);
  }, [link, onRefresh]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const notConfigured = status?.status === 'not_configured';
  return <section className="membership-settings" aria-labelledby="membership-title">
    <div><h3 id="membership-title">Your account</h3>{status?.email && <p>{status.email}</p>}</div>
    <p role="status">{!status ? 'Free · checking your account…' : notConfigured ? 'Free · memberships are not available in this build yet.'
      : status.status === 'unavailable' ? 'Free features are ready. Couldn’t verify paid extras; try refreshing your account.'
      : status.traceAccess ? status.admin ? 'Owner access' : status.plan === 'supporter' ? 'Supporters Club' : 'Trace Pro'
      : 'Trace Free'}</p>
    <p>Recording, leaderboards and your last 7 days of replays are free.</p>
    {status?.capabilities?.fullHistory
      ? <p>Full replay history and unlimited sharing are included.</p>
      : <><p>Share 1 new replay every 7 days. Trace Pro adds full history and unlimited sharing.</p><p>Older matches stay saved. Upgrade to replay them anytime.</p></>}
    {link && <div className="membership-link-code"><p>Confirm this code in your browser.</p><strong>{link.userCode}</strong><a href={link.verificationUrl} target="_blank" rel="noreferrer">Open account linking</a></div>}
    {!notConfigured && <div className="membership-actions">
      {status?.linked ? <><button type="button" disabled={busy} onClick={() => void run(openMembershipAccount)}>Manage membership</button><button type="button" disabled={busy} onClick={() => void run(async () => { onChange(await unlinkMembership()); setLink(null); })}>Unlink this device</button></>
        : <button className="primary" type="button" disabled={busy || !status} onClick={() => void run(async () => setLink(await linkMembership()))}>{busy ? 'Opening…' : 'Link account'}</button>}
      {!status?.linked && <button type="button" disabled={busy} onClick={() => void run(openMembershipAccount)}>View plans</button>}
      <button type="button" disabled={busy} onClick={() => void run(onRefresh)}>Refresh account</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
