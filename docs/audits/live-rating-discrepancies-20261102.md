# Audit of 16 PTCG Live rating discrepancies

Audited November 2, 2026. Read-only investigation; no outcome or rating rules changed.

Compared the original 1,297 snapshot pairs (within one hour) against all 2,440 cloud match-index entries. Downloaded relevant archived reviews for the endpoints and intervening records. The original 1,281/1,297 comparison was not a verified consecutive-match sample. Absence from this archive does not prove no other game was played.

**Updated result after inspecting historical object versions:** five gaps reconcile through excluded client-close losses, and the JakePTCG/rayuma gap now reconciles exactly using recovered starting ratings plus the final confirmed result. A second JakePTCG gap is numerically accounted for by a recovered Sophia_0623 loss, although the intervening SaintMomboom result remains unconfirmed. One Flor2nce gap fits an unfinished loss; two other recorder gaps and six opponent gaps remain unresolved. No evidence supports a formula change or a claim of 100% verified coverage.

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
| JakePTCG | Oct 07 14:10 | -14 | -29 | Recovered an older Sophia_0623 version: Jake 1743 vs 1701. Final confirmed loss predicts −15 to 1728 exactly. The initial loss predicts 1757 → 1743, also exact. Intervening SaintMomboom has a Quit action but no confirmed winner; its rating effect cannot be independently established. Two other intervening wins lack ratings/mode evidence. |
| JakePTCG | Oct 07 19:53 | +10 | -2 | RESOLVED: older rayuma version contains 1664 vs 1703. Final confirmed loss predicts −12. Full chain 1654 → 1664 → 1652 matches exactly. The final upload dropped both starting ratings. |
| sugapon | Oct 13 12:53 | -14 | -3 | Only two opponent observations; no intervening archive. Residual +11 remains unexplained. |
| JESPOSAN | Oct 13 21:02 | +12 | +11 | Only two opponent observations; no intervening archive. Residual −1 remains unexplained. Do not treat this as proven rounding error. |
| Arachiino | Oct 29 14:36 | -12 | +0 | Only two opponent observations; no intervening archive. Residual +12 remains unexplained. |
| panther_1988 | Oct 31 21:09 | +11 | -3 | Opponent observed by two different recorders. No intervening archive. Residual −14 remains unexplained. |

## Reproducibility and limits

Endpoint match IDs and minimal review evidence are saved in `live-rating-discrepancies-20261102.json`. No device IDs, object keys, decklists, or raw game logs are included. Source objects were read from the production archive; no writes were performed.

Next evidence needed: independent result/mode evidence for the SaintMomboom sequence, missing games or raw captures for the other eight gaps, and independent result evidence for the unfinished Flor2nce game. A next rating that fits an inferred result corroborates the model but is not independent proof of that result.

## Historical-version investigation

- Checked version inventories for all seven recorder devices represented by the 16 cases and read all nine older revisions of the relevant archived matches.
- Found historical starting ratings removed from the current rayuma and Sophia_0623 reviews. Earlier revisions have no winner; final revisions have explicit loss results but omit the ratings. These complementary fields belong to the same match IDs and participants. No conflicting historical rating pair was found for either match.
- Production Lambda `put_match` stores each submitted review as a replacement object. Its DynamoDB update explicitly removes summary fields omitted by the new upload (`MATCH_SUMMARY_FIELDS`). Thus an upload with missing ratings erases the current ratings. This verifies the server-side replacement mechanism, not the precise client-side reason the later upload omitted them.
- Nested-field searches found no hidden Elo/rating fields in the four current missing-rating Jake reviews. The cloud reviews have empty raw logs; they do not retain the original network-operation stream.
- Checked all 16 payload objects outside the current match-index keys: 15 are shared-review wrappers and one is an end-to-end test. None provides a missing game for these windows.
- Flor2nce's device has 175 object versions, all current, and no delete markers; there is no older cloud revision to recover for its two cases. TwelvePeers' relevant endpoint objects also have no older revisions. Its device has no delete markers.
- Inspected 859 locally retained network operations for the four banban3200/Kaerukun_57 endpoint matches. Their competitive Elo values agree with the exported values; no additional Elo value appeared in those captures. This checks extraction for those endpoints, not the opponents' unobserved intervening games.

### Remaining recorder gaps

1. **Flor2nce vs Hirono427:** final stored action is End turn, with no winner. Observed 1625 vs 1586; a loss predicts 1611. The next record starts at 1611, but that alone does not independently prove the outcome.
2. **Flor2nce after MoG:** confirmed win from 1611 vs 1610 predicts 1623. Nicolasero starts at 1636. Missing +13. The first game's recorded duration is 228 seconds, leaving approximately 2m51s before the next capture starts. A quick intervening game is possible but unrecorded; a capture defect is also not ruled out.
3. **TwelvePeers after Glider-Pirot:** confirmed win from 1621 vs 1606 predicts 1632; SethFlashFire starts at 1618. Missing −14. Recorded duration 312 seconds leaves approximately 12m13s before the next capture starts. No stored intervening match found.
4. **JakePTCG/SaintMomboom segment:** the later Sophia starting rating is 1743, equal to the SaintMomboom starting rating. A captured Quit action is insufficient to assign a rating loss; no EndGame winner is saved. The total original −29 discrepancy is accounted for by the confirmed −14 and recovered −15 losses, but every intervening game's mode/outcome is not established.

### Remaining opponent gaps

| Opponent | Predicted after first observed game | Next observed rating | Unexplained difference |
|---|---:|---:|---:|
| banban3200 | 1753 | 1777 | +24 |
| Kaerukun_57 | 1854 | 1863 | +9 |
| sugapon | 1649 | 1660 | +11 |
| JESPOSAN | 1611 | 1610 | −1 |
| Arachiino | 1694 | 1706 | +12 |
| panther_1988 | 1812 | 1798 | −14 |

These are successive observations of opponents, not verified consecutive games played by them. Do not label them formula failures or silently count them as successful predictions. The one-point JESPOSAN gap is still unresolved; no verified rounding correction has been found.
