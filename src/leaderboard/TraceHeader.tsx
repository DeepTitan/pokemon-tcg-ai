import React from 'react';
import { LEADERBOARD_HREF } from './profile-route.js';
import '../../landing/training/header.css';

export default function TraceHeader({method = false}: {method?: boolean}) {
  return <header className="trace-topbar"><div className="trace-topbar-inner">
    <a className="trace-logo" href={LEADERBOARD_HREF} aria-label="Trace leaderboard"><img src="/trace/leaderboard-static/training/assets/trace-mascot.png" alt=""/><span>Trace</span></a>
    <nav className="trace-tabs" aria-label="Main navigation">
      <a href={LEADERBOARD_HREF} aria-current={!method ? 'page' : undefined}>Leaderboard</a>
      <a href="/trace/training">Training</a>
      <a href={`${LEADERBOARD_HREF}#method`} aria-current={method ? 'page' : undefined}>How ratings work</a>
    </nav>
    <a className="trace-victory" href="https://victoryroad.app" aria-label="Victory Road"><img src="/trace/leaderboard-static/training/assets/victory-road.png" alt="Victory Road"/></a>
  </div></header>;
}
