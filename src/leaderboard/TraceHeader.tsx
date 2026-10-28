import React from 'react';
import { LEADERBOARD_HREF } from './profile-route.js';

export default function TraceHeader() {
  return <header className="trace-topbar"><div className="trace-topbar-inner">
    <a className="trace-logo" href="/trace" aria-label="Trace home"><img src="/trace/leaderboard-static/training/assets/trace-mascot.png" alt=""/><span>Trace</span></a>
    <nav className="trace-tabs" aria-label="Main navigation">
      <a href={LEADERBOARD_HREF} aria-current="page">Leaderboard</a>
      <a href="/trace/training">Training</a>
      <a href="/trace#download">Download</a>
      <a href="/trace/account">My account</a>
    </nav>
    <a className="trace-victory" href="https://victoryroad.app" aria-label="Victory Road"><img src="/trace/leaderboard-static/training/assets/victory-road.png" alt="Victory Road"/></a>
  </div></header>;
}
