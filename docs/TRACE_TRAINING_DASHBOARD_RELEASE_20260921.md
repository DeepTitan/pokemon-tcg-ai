# Trace training dashboard release — September 21, 2026

## Public pages

- Training: https://victoryroad.app/trace/training
- Leaderboard: https://victoryroad.app/trace/leaderboard
- Ratings explanation: https://victoryroad.app/trace/leaderboard#method

The selected cream/navy dashboard includes steps/second, estimated time to the
next checkpoint, fixed-100M comparisons, available previous-model comparisons,
and simulated-game counts beneath checkpoint labels. The same three navigation
tabs and Victory Road logo appear on training, leaderboard, player profiles and
the ratings explanation. Mobile keeps all three tabs visible.

## Deployment boundary

This release uses the existing isolated Trace website checkout and Vercel project
`victoryroad`; it does not upload the dirty root training checkout. The existing
`victoryroad-lovat.vercel.app` alias is the upstream for the apex project's Trace
rewrites. No apex project or training process changes are required.

The new independent AWS stack `trace-training-dashboard` publishes a sanitized
projection every five minutes in us-east-2. The publisher verifies the existing
report/plan/commit evidence before inclusion. Private game logs, model files,
source paths and credentials are not public. The bucket remains private; the
read-only API can read just the published summary object. The Vercel proxy has
no AWS credentials and cannot control training. The first manual publication
at 20:46:10 UTC and subsequent scheduled publication at 20:50:14 UTC both
contained 15 verified checkpoints, proving updates continue without a laptop.

Public feed: https://bh36pzgdea.execute-api.us-east-2.amazonaws.com/status
Backend package: `deployments/training-dashboard/20260921-v1.zip` in the existing
training bucket. Backend source and deployment notes live in the root checkout's
`infrastructure/training-dashboard/` directory.

The website's training rewrite targets the extensionless static directory because
Vercel `cleanUrls` removes `.html` endpoints from rewrite resolution. Staging
caught and corrected a 404 before the stable public alias was promoted.

## Validation

- 66 website/API tests passed, including public feed, share pages, renderer and
  the new training proxy; three profile-route tests and existing projection and
  social metadata checks passed.
- Scoped strict TypeScript check and both production Vite builds passed.
- Three AWS projection/feed tests and the existing 11 local dashboard checks passed.
- Local integrated preview used the real public AWS feed. Training, leaderboard,
  profiles, ratings navigation and active tabs passed. Desktop and 390px mobile
  screenshots showed loaded assets, readable tabs and no page overflow.
- Protected staged deployment was checked through the authenticated Vercel CLI.

## Rollback

Previous stable Trace deployment:
`https://victoryroad-iit2qo1mw-deeptitan-6729s-projects.vercel.app`
(`dpl_C3A8EG9x4JHhPtKYqx4CbXArooS5`). Promote that deployment to revert the website.
The metrics publisher is independent: disable its EventBridge rule to suspend
publication, without changing or stopping training.

## Released and verified

Promoted deployment `dpl_EnSC4qAt1ipU6Wknka15BNpJ23Za`:
`https://victoryroad-21zv8a4aa-deeptitan-6729s-projects.vercel.app`.
Public apex checks returned 200 for training, its live JSON feed, leaderboard,
player profile, JavaScript and logo. The existing apex homepage stayed intact.
The public feed advanced again at 20:55:14 UTC with 15 verified checkpoints.
Production browser checks confirmed loaded results, 797 steps/s, an estimated
1h19m to the 160M checkpoint, all three navigation links and the ratings page.
The dashboard was left open at its permanent public URL. No new production
browser errors or broken images were observed.
