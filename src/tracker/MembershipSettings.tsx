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
    <p role="status">{!status ? 'Checking your membership…' : notConfigured ? 'Memberships are not available in this build yet.'
      : status.status === 'unavailable' ? 'Couldn’t verify your membership. Check your connection and try again.'
      : status.traceAccess ? status.admin ? 'Owner access' : status.plan === 'supporter' ? 'Supporters Club' : 'Trace membership'
      : status.linked ? 'Choose a membership to use Trace.' : 'Link your Victory Road account to use Trace.'}</p>
    {status?.traceAccess && <p>{status.opponentDecklists ? 'Opponent decklists unlock after the match result is recorded.' : 'Supporters Club adds opponent decklists after each match.'}</p>}
    {link && <div className="membership-link-code"><p>Confirm this code in your browser.</p><strong>{link.userCode}</strong><a href={link.verificationUrl} target="_blank" rel="noreferrer">Open account linking</a></div>}
    {!notConfigured && <div className="membership-actions">
      {status?.linked ? <><button type="button" disabled={busy} onClick={() => void run(openMembershipAccount)}>Manage membership</button><button type="button" disabled={busy} onClick={() => void run(async () => { onChange(await unlinkMembership()); setLink(null); })}>Unlink this device</button></>
        : <button className="primary" type="button" disabled={busy || !status} onClick={() => void run(async () => setLink(await linkMembership()))}>{busy ? 'Opening…' : 'Link account'}</button>}
      <button type="button" disabled={busy} onClick={() => void run(onRefresh)}>Refresh membership</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
