import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  itemCount: number;
  hasMore: boolean;
  searchActive: boolean;
  /** Append one page of summaries; false means the archive is exhausted. */
  loadMore: () => Promise<boolean>;
}

/** Keep the scroller mounted while searching or appending, so rows retain their position. */
export function InfiniteArchiveList(props: Props) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const busy = useRef(false);
  const stopped = useRef(false);
  const failed = useRef(false);
  const appendedAtCount = useRef<number | null>(null);
  const browseTop = useRef(0);
  const check = useRef(() => {});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  useLayoutEffect(() => {
    if (root.current) root.current.scrollTop = props.searchActive ? 0 : browseTop.current;
  }, [props.searchActive]);

  useEffect(() => {
    const element = root.current!;
    let mounted = true;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(maybeLoad);
    };
    async function maybeLoad() {
      const current = latest.current;
      if (!mounted || busy.current || failed.current || stopped.current || current.searchActive || !current.hasMore) return;
      if (appendedAtCount.current === current.itemCount) return;
      // Start a page about one screen before the end, including on tall windows.
      if (!element.clientHeight || element.scrollHeight - element.scrollTop - element.clientHeight > Math.max(600, element.clientHeight)) return;
      busy.current = true;
      setLoading(true);
      try {
        const more = await current.loadMore();
        if (!mounted) return;
        appendedAtCount.current = current.itemCount;
        if (!more) {
          stopped.current = true;
          setExhausted(true);
        }
      } catch {
        if (!mounted) return;
        failed.current = true;
        setError(true);
      } finally {
        busy.current = false;
        if (mounted) {
          setLoading(false);
          // Recheck after React commits the appended rows. This also fills a tall viewport.
          schedule();
        }
      }
    }
    check.current = schedule;
    const onScroll = () => {
      if (!latest.current.searchActive) browseTop.current = element.scrollTop;
      schedule();
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    schedule();
    return () => {
      mounted = false;
      check.current = () => {};
      cancelAnimationFrame(frame);
      resize.disconnect();
      element.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => { check.current(); }, [props.itemCount, props.hasMore, props.searchActive]);

  return <div className="sessions" ref={root} tabIndex={0} role="region" aria-label="Match archive" onKeyDown={event => event.stopPropagation()}>
    {props.children}
    {!props.searchActive && props.itemCount > 0 && <div className="archive-pagination">
      <span role="status" aria-live="polite">
        {error ? 'Older matches couldn’t load.' : loading ? <><i className="archive-loading-dot" aria-hidden="true" />Loading older matches…</> : exhausted || !props.hasMore ? 'All matches loaded' : ''}
      </span>
      {error && <button type="button" onClick={() => {
        root.current?.focus({ preventScroll: true });
        failed.current = false;
        setError(false);
        check.current();
      }}>Try again</button>}
    </div>}
  </div>;
}
