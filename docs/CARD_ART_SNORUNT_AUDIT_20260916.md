# Snorunt desktop artwork audit — September 16, 2026

The reported missing Snorunt was captured correctly. Its public fallback used an unsupported internal set ID and returned HTTP 404. The exact public printing returned HTTP 200. A broader public-catalog audit found the same fallback gap in other recent sets.

## Desktop behavior

`src-tauri/src/cards.rs` reads exact card artwork from already-cached Unity bundles and writes it to Trace's artwork cache. If that artwork is absent, `src/tracker/card-art.ts` supplies a public image URL. `PlayerDecklist.tsx` displays an artwork-unavailable placeholder after the public request fails. The website has additional bundled artwork, including `me2-5_46` and `me2-5_227`, so website availability does not establish availability on a desktop without those native cached images.

The patch retains exact native artwork first and preserves captured card IDs. It adds the four verified printing aliases below and six verified ordinary-set mappings. Recognized finish suffixes (`ph`, `sph`, `mph`, and numeric variants) use the verified printing; unrecognized suffixes retain the existing generic fallback without acquiring a verified alias. Alternate-art namespaces keep explicit per-card aliases because their internal numbers do not identify public collector numbers.

## Verified aliases

| Captured ID | Provider printing | Evidence | Label |
| --- | --- | --- | --- |
| `svalt_103` | `PAR/37` | [Provider page](https://limitlesstcg.com/cards/PAR/37): Water Snorunt, 60 HP, Ice Shard, W, 10+, +30 against Fighting, Metal weakness, retreat 1. Complete mechanics also match bundled `sv4_37` metadata. | Alternate artwork; the captured internal variant's exact cosmetic art is not asserted. |
| `me2-5_46` | `ASC/46` | [Provider page](https://limitlesstcg.com/cards/ASC/46): Water Snorunt, 70 HP, Chilly, W, 10, Metal weakness, retreat 1. Set and collector number match. | Exact printing. |
| `me2-5_227` | `ASC/227` | [Provider page](https://limitlesstcg.com/cards/ASC/227): same printed mechanics as #46, distinct art rare printing and collector number. | Exact printing. |
| `xy9-5r_7` | `GEN/RC7` | [Provider page](https://limitlesstcg.com/cards/GEN/RC7): Water Snorunt, 50 HP, Icy Snow, C, 10, Metal weakness, retreat 1. Existing decklist export maps `XY9-5R` to `GEN-RC`. | Exact Radiant Collection printing. |

All four mapped CDN URLs returned HTTP 200 with `Content-Type: image/png` in read-only HEAD checks on September 16:

- [PAR 37 image](https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/PAR/PAR_037_R_EN_LG.png)
- [ASC 46 image](https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/ASC/ASC_046_R_EN_LG.png)
- [ASC 227 image](https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/ASC/ASC_227_R_EN_LG.png)
- [GEN RC7 image](https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/GEN/GEN_RC7_R_EN_LG.png)

## All catalog Snorunt printings

The bundled printed catalog contains 27 Snorunt records, covering 15 distinct base IDs. Finishes listed together resolve to the same public URL. Statuses below were checked before adding the ASC and GEN aliases; the `svalt_103` alias was already present in the working patch.

| IDs | Checked public image | HTTP status |
| --- | --- | --- |
| `bw10_21`, `_ph` | [bw10/21](https://images.pokemontcg.io/bw10/21.png) | 200 |
| `me2-5_46`, `_ph`, `_ph2` | [me2pt5/46](https://images.pokemontcg.io/me2pt5/46.png) | 404; exact ASC alias added |
| `me2-5_227` | [me2pt5/227](https://images.pokemontcg.io/me2pt5/227.png) | 404; exact ASC alias added |
| `sm11_37`, `_ph` | [sm11/37](https://images.pokemontcg.io/sm11/37.png) | 200 |
| `sm12_47`, `_ph` | [sm12/47](https://images.pokemontcg.io/sm12/47.png) | 200 |
| `sm2_31`, `_ph` | [sm2/31](https://images.pokemontcg.io/sm2/31.png) | 200 |
| `sv4_37`, `_ph` | [sv4/37](https://images.pokemontcg.io/sv4/37.png) | 200 |
| `sv4_188` | [sv4/188](https://images.pokemontcg.io/sv4/188.png) | 200 |
| `sv6_51`, `_ph` | [sv6/51](https://images.pokemontcg.io/sv6/51.png) | 200 |
| `svalt_103` | [mapped PAR/37](https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/PAR/PAR_037_R_EN_LG.png) | 200 using the verified alternate alias |
| `swsh12-5_34`, `_ph` | [swsh12pt5/34](https://images.pokemontcg.io/swsh12pt5/34.png) | 200 |
| `swsh12_41`, `_ph` | [swsh12/41](https://images.pokemontcg.io/swsh12/41.png) | 200 |
| `swsh6_35`, `_ph` | [swsh6/35](https://images.pokemontcg.io/swsh6/35.png) | 200 |
| `swsh9_34`, `_ph` | [swsh9/34](https://images.pokemontcg.io/swsh9/34.png) | 200 |
| `xy9-5r_7` | [xy9-5r/7](https://images.pokemontcg.io/xy9-5r/7.png) | 404; exact GEN/RC7 alias added |

## Broader recent-set finding

A bounded sample checked the first unaliased printing from each `me*` set. These are sample results, not a claim that every card in a set has the same availability:

| ID | Generic image URL path | HTTP status |
| --- | --- | --- |
| `me1_1` | `images.pokemontcg.io/me1/1.png` | 200 |
| `me2_1` | `images.pokemontcg.io/me2/1.png` | 200 |
| `me2-5_1` | `images.pokemontcg.io/me2pt5/1.png` | 404 |
| `me3_1` | `images.pokemontcg.io/me3/1.png` | 404 |
| `me4_1` | `images.pokemontcg.io/me4/1.png` | 404 |
| `me5_1` | `images.pokemontcg.io/me5/1.png` | 404 |
| `mealt_1` | `images.pokemontcg.io/mealt/1.png` | 404 |
| `mebsp_1` | `images.pokemontcg.io/mebsp/1.png` | 404 |
| `mee_1` | `images.pokemontcg.io/mee/1.png` | 404 |

The generic public provider is not complete for current internal set IDs. Missing local artwork can therefore affect additional recent cards. Ordinary-set mappings now route directly to the verified public catalog:

| Internal set | Public set | Catalog evidence |
| --- | --- | --- |
| `me2-5` | `ASC` | [Ascended Heroes complete set](https://limitlesstcg.com/cards/ASC?display=list): 295/295 collector numbers and names match. |
| `me3` | `POR` | [Perfect Order complete set](https://limitlesstcg.com/cards/POR?display=list): 124/124 match after normalizing energy symbols. |
| `me4` | `CRI` | [Chaos Rising complete set](https://limitlesstcg.com/cards/CRI?display=list): all 122 collector numbers and names match bundled metadata, normalizing apostrophes and energy symbols. |
| `mee` | `MEE` | [Mega Evolution Energy complete set](https://limitlesstcg.com/cards/MEE): all eight collector numbers and energy types match; all eight public images returned HTTP 200. |
| `rsv10-5` | `WHT` | [White Flare complete set](https://limitlesstcg.com/cards/WHT?display=list): 173/173 match. |
| `zsv10-5` | `BLK` | [Black Bolt complete set](https://limitlesstcg.com/cards/BLK?display=list): 172/172 match. |

Across the six public sets, all 894 canonical collector numbers match the bundled metadata. The regression audit also covers all 1,838 metadata records including finish variants. This establishes the set identity mapping; it does not assert that every remote image was downloaded or will always be available.

The new set mappings require complete positive collector numbers and recognized finishes. They do not guess alternate-art namespace numbers or choose an arbitrary same-name card. Public regular artwork can omit a foil finish; exact cached art still wins. Unknown sets and unavailable provider images retain the existing terminal placeholder.

## Validation

`node --import tsx src/tracker/__tests__/card-art.test.ts` checks the metadata evidence, exact printing distinction, known finish aliases, alternate labels, native-art precedence, unknown suffix behavior, captured-ID preservation, and bounded fallback failure. The tracker regression suite, release checks, and production frontend build pass. Tests use offline fixtures; no Pokémon client was launched and no live match was started. Public set catalogs were compared locally; the private decklists are not included in this repository.
