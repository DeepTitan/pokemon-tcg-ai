# Audit of 16 PTCG Live rating discrepancies

Audited November 2, 2026. Read-only investigation; no outcome or rating rules changed.

Compared the original 1,297 snapshot pairs (within one hour) against all 2,440 cloud match-index entries. Downloaded relevant archived reviews for the endpoints and intervening records. The original 1,281/1,297 comparison was not a verified consecutive-match sample. Absence from this archive does not prove no other game was played.

**Result:** five discrepancies fully reconcile through excluded client-close losses. One additional gap fits a loss in an unfinished record exactly, but its outcome is not independently confirmed. Two gaps contain intervening records with missing ratings. Eight gaps have no intervening record in this archive (six are opponent observations). No evidence supports a formula change or a claim of 100% verified coverage.

| Player | First match (Central) | Predicted change | Observed change | Evidence |
|---|---|---:|---:|---|
| banban3200 | Sep 08 00:37 | -13 | +11 | Only two opponent observations; no intervening archive. Residual +24 remains unexplained. |
| Tswizz | Sep 09 12:21 | +12 | -1 | Excluded client-close loss vs Bababryant: 1601 → 1613 → 1600. Both steps match exactly. |
| Kaerukun_57 | Sep 14 00:31 | +12 | +21 | Only two opponent observations; no intervening archive. Residual +9 remains unexplained. |
| Flor2nce | Sep 15 13:41 | -13 | -27 | Unfinished record vs Hirono427 starts at 1625. 1638 → 1625 matches; a loss vs 1586 predicts 1611 exactly. Loss is inferred from ratings, not independently confirmed. |
| Flor2nce | Sep 15 14:27 | +12 | +25 | No intervening archive found. Predicted 1623; next observed 1636. Residual +13 remains unexplained. |
| TwelvePeers | Sep 22 08:42 | -14 | -27 | Excluded client-close loss vs TVHenry010798: 1697 → 1683 → 1670. Both steps match exactly. |
| TwelvePeers | Sep 22 13:11 | -13 | -26 | Excluded client-close loss vs DenDen: 1763 → 1750 → 1737. Both steps match exactly. |
| TwelvePeers | Sep 23 18:00 | -14 | -27 | Excluded client-close loss vs Vincent_TCGO: 1565 → 1551 → 1538. Both steps match exactly. |
| TwelvePeers | Oct 02 16:16 | +12 | -2 | Excluded client-close loss vs PokeMasterShack: 1598 → 1610 → 1596. Both steps match exactly. |
| TwelvePeers | Oct 07 13:55 | +11 | -3 | No intervening archive found. Predicted 1632; next observed 1618. Residual −14 remains unexplained. |
| JakePTCG | Oct 07 14:10 | -14 | -29 | Four intervening records: wins vs OffDaChain3173 and PokeSophi090815, loss vs Sophia_0623 (all missing ratings), plus unfinished SaintMomboom match at 1743 vs 1787. First step 1757 → 1743 matches. Remaining sequence cannot be calculated from available ratings. |
| JakePTCG | Oct 07 19:53 | +10 | -2 | Intervening confirmed loss vs rayuma has no ratings. First win predicts 1664; next observed 1652. Missing loss could explain −12, but cannot verify without opponent rating. |
| sugapon | Oct 13 12:53 | -14 | -3 | Only two opponent observations; no intervening archive. Residual +11 remains unexplained. |
| JESPOSAN | Oct 13 21:02 | +12 | +11 | Only two opponent observations; no intervening archive. Residual −1 remains unexplained. Do not treat this as proven rounding error. |
| Arachiino | Oct 29 14:36 | -12 | +0 | Only two opponent observations; no intervening archive. Residual +12 remains unexplained. |
| panther_1988 | Oct 31 21:09 | +11 | -3 | Opponent observed by two different recorders. No intervening archive. Residual −14 remains unexplained. |

## Reproducibility and limits

Endpoint match IDs and minimal review evidence are saved in `live-rating-discrepancies-20261102.json`. No device IDs, object keys, decklists, or raw game logs are included. Source objects were read from the production archive; no writes were performed.

Next evidence needed: missing opponent ratings for the two JakePTCG sequences, missing games for the other eight gaps, and independent result evidence for the unfinished Flor2nce game. A next rating that fits an inferred result corroborates the model but is not independent proof of that result.
