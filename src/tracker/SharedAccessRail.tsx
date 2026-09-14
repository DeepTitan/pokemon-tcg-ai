import { ArrowUpRight } from '@phosphor-icons/react/ArrowUpRight';
import { CaretLeft } from '@phosphor-icons/react/CaretLeft';
import { CaretRight } from '@phosphor-icons/react/CaretRight';
import { DiscordLogo } from '@phosphor-icons/react/DiscordLogo';
import { TRACE_DISCORD_URL } from './shared-access.js';

export function SharedAccessRail({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <aside className={`shared-access-rail ${open ? 'is-open' : 'is-collapsed'}`} aria-label="Record with Trace">
    <div className="shared-access-brand-row">
      {open && <a className="shared-access-brand" href="/trace" aria-label="Learn about Trace">
        <img src="/tracker-assets/trace-mascot.png" alt="" width="56" height="62" />
        <span><strong>Trace</strong><small>Shared replay</small></span>
      </a>}
      <button className="shared-access-toggle" type="button" onClick={onToggle}
        aria-expanded={open} aria-controls="shared-access-content"
        aria-label={open ? 'Collapse Trace access panel' : 'Expand Trace access panel'}
        title={open ? 'More room for the match' : 'Record your games with Trace'}>
        {open ? <CaretLeft size={18} /> : <><img src="/tracker-assets/trace-mascot.png" alt="" width="32" height="36" /><CaretRight size={15} /></>}
      </button>
    </div>
    <div id="shared-access-content" className="shared-access-content" hidden={!open}>
      <div className="shared-access-invitation">
        <h2>Want to record your games like this?</h2>
        <p>Revisit the tricky spots.<br />Find the line with friends.</p>
        <a className="shared-access-discord" href={TRACE_DISCORD_URL} target="_blank" rel="noopener noreferrer">
          <DiscordLogo size={23} weight="fill" aria-hidden="true" /><span>Join the Discord</span><ArrowUpRight size={16} aria-hidden="true" />
        </a>
        <p className="shared-access-note">Join the server and ask for <strong>Trace access.</strong></p>
      </div>
      <footer className="shared-access-footer">
        <div className="shared-access-shortcuts" aria-label="Replay keyboard shortcuts">
          <span><span aria-label="Left and right arrow keys"><kbd>←</kbd><kbd>→</kbd></span>Step through the match</span>
          <span><span aria-label="Up and down arrow keys"><kbd>↑</kbd><kbd>↓</kbd></span>Jump to key moments</span>
        </div>
        <a href="/trace">About Trace <ArrowUpRight size={14} aria-hidden="true" /></a>
      </footer>
    </div>
  </aside>;
}
