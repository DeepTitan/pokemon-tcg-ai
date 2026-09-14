// Run with Vite, then open /src/tracker/__tests__/archive-scroll.browser.html.
// Real browser layout/scrolling, with a controllable stand-in for the native page API.
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { InfiniteArchiveList } from '../InfiniteArchiveList.js';
import '../tracker.css';

type Page = { count: number; more: boolean };
let finish: ((page: Page) => void) | undefined;
let fail: (() => void) | undefined;
let calls = 0;
let active = 0;
let maxActive = 0;
let setSearch: (value: boolean) => void;
let reset: (count: number) => void;
const delay = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): void { if (!value) throw new Error(message); }
function scroller() { return document.querySelector<HTMLDivElement>('.sessions')!; }
async function nearEnd() {
  const el = scroller();
  el.scrollTop = el.scrollHeight - el.clientHeight - 100;
  el.dispatchEvent(new Event('scroll'));
  await delay();
}
function Fixture() {
  const [count, setCount] = useState(20);
  const [search, searchSetter] = useState(false);
  const [generation, setGeneration] = useState(0);
  setSearch = searchSetter;
  reset = initial => {
    setCount(initial); searchSetter(false); setGeneration(value => value + 1);
    calls = 0; active = 0; maxActive = 0;
  };
  return <aside className="session-rail" style={{ width: 316, height: 640, margin: 24 }}>
    <div className="archive-heading"><strong>Match archive</strong><p>{count} matches loaded</p></div>
    <InfiniteArchiveList key={generation} itemCount={count} hasMore searchActive={search} loadMore={async () => {
      calls++; active++; maxActive = Math.max(maxActive, active);
      try {
        const page = await new Promise<Page>((resolve, reject) => { finish = resolve; fail = () => reject(new Error('offline')); });
        setCount(value => value + page.count);
        return page.more;
      } finally { active--; }
    }}>
      {Array.from({ length: search ? 1 : count }, (_, index) => <button className="session-card" key={index} style={{ display: 'block', textAlign: 'left' }}><strong>Match {index + 1}</strong><p>Archive row · 132px</p></button>)}
    </InfiniteArchiveList>
  </aside>;
}
async function suite(report: (text: string) => void) {
  const passed: string[] = [];
  const pass = (text: string) => { passed.push(text); report(passed.map(name => `PASS ${name}`).join('\n')); };
  try {
    flushSync(() => reset(20));
    await delay();
    assert(calls === 0, 'Must not read the full archive on mount');
    pass('Only load near the end');
    await nearEnd();
    assert(calls === 1, 'Near-end scroll should load one page');
    const top = scroller().scrollTop;
    const originalRow = scroller().children[15];
    for (let i = 0; i < 30; i++) scroller().dispatchEvent(new Event('scroll'));
    await delay();
    assert(calls === 1 && maxActive === 1, 'Rapid scrolling overlapped requests');
    assert(scroller().textContent?.includes('Loading older matches'), 'Missing loading state');
    finish!({ count: 20, more: true }); await delay();
    assert(scroller().scrollTop === top && scroller().children[15] === originalRow, 'Append moved scroll or replaced existing rows');
    pass('Slow requests stay single-flight; append preserves pixels and DOM rows');
    flushSync(() => setSearch(true)); await delay();
    assert(scroller().scrollTop === 0 && calls === 1, 'Search should start at the top and pause paging');
    flushSync(() => setSearch(false)); await delay();
    assert(scroller().scrollTop === top, 'Clearing search lost browsing position');
    pass('Search pauses paging and restores browse position');
    await nearEnd(); fail!(); await delay();
    const failedCalls = calls;
    await nearEnd(); await delay();
    assert(calls === failedCalls && scroller().textContent?.includes('Try again'), 'Failure should stop automatic requests and offer retry');
    scroller().querySelector<HTMLButtonElement>('.archive-pagination button')!.click(); await delay();
    assert(calls === failedCalls + 1, 'Retry did not restart request');
    assert(document.activeElement === scroller(), 'Retry lost keyboard focus');
    finish!({ count: 3, more: false }); await delay();
    await nearEnd();
    assert(calls === failedCalls + 1, 'Exhausted archive requested another page');
    pass('Failure stops retries; explicit retry works; short final page stops');
    flushSync(() => reset(1)); await delay();
    assert(calls === 1, 'Short viewport should fill automatically');
    finish!({ count: 1, more: true }); await delay();
    assert(Number(calls) === 2, 'Underfilled viewport did not request another page');
    finish!({ count: 0, more: false }); await delay();
    assert(Number(calls) === 2, 'Empty page produced a request loop');
    pass('Tall/underfilled viewport fills and an empty page terminates');
    flushSync(() => reset(20)); await delay();
    await nearEnd();
    flushSync(() => setSearch(true));
    finish!({ count: 20, more: true }); await delay();
    assert(calls === 1 && scroller().querySelectorAll('.session-card').length === 1, 'In-flight completion restarted paging or changed search');
    flushSync(() => setSearch(false)); await delay();
    assert(scroller().querySelectorAll('.session-card').length === 40, 'In-flight page was lost during search');
    pass('Search during an in-flight request keeps the page cached');
    flushSync(() => reset(20)); await delay();
    assert(calls === 0, 'New fixture should wait for scrolling');
    const rail = document.querySelector<HTMLElement>('.session-rail')!;
    rail.style.height = '1800px'; await delay();
    assert(calls === 1, 'Resizing a tall archive should trigger prefetch');
    finish!({ count: 20, more: true }); await delay();
    rail.style.height = '640px';
    pass('Window resizing triggers prefetch without a scroll event');
    report(`${passed.map(name => `PASS ${name}`).join('\n')}\nAll 7 browser checks passed.`);
  } catch (error) { report(`${passed.join('\n')}\nFAIL ${String(error)}`); }
}
function App() {
  const [result, setResult] = useState('Ready');
  const [running, setRunning] = useState(false);
  return <div style={{ display: 'flex', color: '#3d4650', fontFamily: 'system-ui' }}><Fixture /><section style={{ padding: 24 }}><h1>Archive scrolling</h1><button disabled={running} onClick={() => { setRunning(true); void suite(setResult).finally(() => setRunning(false)); }}>Run browser checks</button><pre style={{ whiteSpace: 'pre-wrap', maxWidth: 600 }} role="status">{result}</pre></section></div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
