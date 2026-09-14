# Decklist-based archive identities — September 14, 2026

The archive now chooses its representative Pokémon from each player's captured 60-card starting list. It no longer depends on which Pokémon survived the game, started Active, or happened to reach the discard pile. Browser and native summaries retain those inventories. Old native summaries are upgraded once from their cached reviews using a streaming reader, without reconstructing or modifying replay state.

## Full local audit

A stable copy of the local application's database and WAL was audited; the original database was not opened or modified. All 112 saved games were included, covering 224 player sides. There are complete inventories for 214 sides (107 games), 96 distinct full lists, and 75 Pokémon compositions after combining cosmetic print counts. Every referenced card resolved in the installed catalog.

- **214/214 available deck sides match the reviewed display labels.**
- **90 actual display labels change** from the previous algorithm (including two previously unknown sides). The baseline resolves old card IDs through the same catalog as the UI, so cosmetic ID/name differences are not counted as corrections.
- **Four close selections are resolved by the user-approved frequency tiebreak:** three Elgyem/Wellspring control lists and one equal Starmie/Froslass list. The icons are Elgyem and Mega Starmie ex, respectively; no unresolved ties remain in this corpus.
- **Five games / ten sides have no complete starting inventory.** Their board-based fallback remains available; no missing list was fabricated.

This is a regression result on reviewed recorded decks, not an independent accuracy estimate or a guarantee for every future deck. Basic Box uses Ogerpon as its consistent single-icon convention even though it has multiple attackers. New unreviewed lists, missing metadata and label mismatches are surfaced by the audit rather than silently certified.

[Every game and both sides](../data/experiments/deck-identity-audit-20260914.md) · [Machine-readable rankings and reasons](../data/experiments/deck-identity-audit-20260914.json)

## Selection rules

1. Validate the explicit starting inventory and resolve exact card printings.
2. Combine cosmetic variants with the same mechanics; keep different attacks/abilities separate even when the printed name matches.
3. Count the Pokémon and its evolution line. Downweight pre-evolutions and specific support abilities; never treat all ex cards or all high-HP Pokémon as the centerpiece.
4. Recognize printed attack/ability signatures and deck combinations. Examples: Vengeful Anchor plus Hide 'n' Sneak; Crustle's wall plus its evolution line; Slowking plus Academy at Night; Mewtwo powered by Spidops; Festival Lead with Thwackey and Festival Grounds; Ogerpon with Wild Growth or a Basic Box package.
5. When two recognized centerpiece candidates are within 150 base-score points, prefer the one appearing in fewer decks in our recorded distribution. The baseline counts each Pokémon name once per player deck, merges cosmetic prints, and weights repeated games by their recorded occurrences. Surprisal is `log2((214 + 1) / (appearances + 1))`; higher is more unusual. This only breaks close centerpiece ties, so a rare support card cannot win through rarity. Missing, zero or equal frequencies leave the tie unresolved.
6. Rank deterministically, retain the baseline version, frequencies, reason and runner-up candidates, and distinguish recognized, ambiguous, fallback, incomplete and unavailable results. These labels are evidence categories, not calibrated probabilities.
7. Prefer a resolved decklist candidate in the archive; use the legacy board fallback only when no decklist candidate is available.

The classifier has no access to turns, attacks used in the game, wins, prizes, player identity or hidden-zone state. Decklist metadata is for the archive and is not injected into the gameplay/reconstruction engine.

## Reviewed representative counts

| Representative | Recorded sides |
|---|---:|
| Dragapult ex | 102 |
| Alakazam | 44 |
| Teal Mask Ogerpon ex | 18 |
| Dhelmise | 8 |
| N's Zoroark ex | 7 |
| Mega Lucario ex | 5 |
| Crustle | 4 |
| Mega Sharpedo ex | 3 |
| Elgyem | 3 |
| Team Rocket's Mewtwo ex | 2 |
| Marnie's Grimmsnarl ex | 2 |
| Team Rocket's Honchkrow | 2 |
| Steven's Metagross ex | 2 |
| Seaking | 1 |
| Mega Absol ex | 1 |
| Mega Gardevoir ex | 1 |
| Slowking | 1 |
| Dipplin | 1 |
| Mega Venusaur ex | 1 |
| Cynthia's Garchomp ex | 1 |
| Mega Lopunny ex | 1 |
| Mega Darkrai ex | 1 |
| Mega Excadrill ex | 1 |
| Mega Froslass ex | 1 |
| Mega Starmie ex | 1 |

## Evidence used for edge cases

- Pokémon's own [Pitch Black card overview](https://www.pokemon.com/us/features/check-out-the-top-five-cards-from-mega-evolution-pitch-black) identifies Dhelmise as the attacker supported by Hide 'n' Sneak Pokémon.
- [Tournament lists containing Kangaskhan](https://www.limitlesstcg.com/cards/MEP/25/decklists) distinguish Crustle, Slowking, Ogerpon Box and Kangaskhan decks, supporting contextual treatment of Run Errand.
- The [Basic Box list](https://limitlesstcg.com/decks/list/28126) and [deck overview](https://limitlesstcg.com/decks) support the Ogerpon/Clefairy convention rather than automatically choosing four-copy Kangaskhan.
- [Starmie/Froslass lists](https://limitlesstcg.com/decks/list/26578) support retaining Starmie as the display convention while acknowledging the dual line.
- [Excadrill tournament card counts](https://play.limitlesstcg.com/tournament/6a58f606cc68177ec6c56a6c/metagame/mega-excadrill-ex/cards) support treating Metagross as part of that deck's package rather than selecting it solely for evolution depth.

The exact local card definitions and complete Trainer/energy packages were also inspected. The user approved choosing the most surprising credible centerpiece relative to our normal deck distribution. The measured counts are Elgyem 5/214 versus Wellspring 18/214, and Mega Starmie 1/214 versus Mega Froslass 2/214. These are local recorded frequencies, not global metagame estimates. The hardcoded Elgyem score bonus was removed; changing the frequency baseline reverses the tie decisions in tests.

The baseline is checked in as `src/tracker/deck-frequency-baseline.ts`, generated by `node --import tsx scripts/build-deck-frequency-baseline.ts` from the reviewed corpus, with its source hash. It is intentionally versioned and refreshed explicitly so archive pagination or one new game cannot silently change historical icons. Refresh it and rerun the full audit when expanding the reviewed corpus.

## Validation and rerunning

Passed: 96 full-list regression cases, cosmetic/mechanical variants, reversed deck/catalog ordering, absent/partial lists, missing metadata, unseen-card fallback, frequency-driven tie reversals, equal/missing frequency handling, rare-support exclusion, both-player isolation, board-state independence, browser summary retention, the complete tracker suite, focused TypeScript checking, native storage tests, and the tracker production build.

```sh
npm run tracker:test-decks
npm run tracker:audit-decks -- --database '/Users/theisaiahw/Library/Application Support/com.isaiahw.matchlens/trace.sqlite3' --output data/experiments/deck-identity-audit.json
```

Running the audit without `--database` checks the checked-in anonymized 96-list regression corpus. The live audit exits nonzero for unreviewed lists, mismatched labels, or incomplete card metadata. A new list should be reviewed with its printed actions and Trainer/energy package before adding an expectation; do not auto-label it from the algorithm's output.

Release preparation and validation are recorded in [the release record](DECK_IDENTITY_RELEASE_20260914.md).
