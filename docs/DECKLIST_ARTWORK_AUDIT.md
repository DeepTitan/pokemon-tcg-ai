# Decklist artwork audit

Local archive audit: 112 matches, 214 captured lists. All captured lists have 60 cards and resolved identities. Five matches have no starting inventory. 182 lists have complete local artwork; 32 reference missing local art.

All 64 missing-local-art fallback URLs were checked: 42 returned valid PNGs; 22 returned HTTP 404. This is not missing captured card data.

The decklist now always displays card names. Exhausted image fallbacks render a clearly labeled metadata tile rather than a misleading hidden card back. The printing ID and quantity are preserved.

After user authorization to use Limitless, all 22 failures have verified image fallbacks. Six internal cosmetic variants use explicitly labeled alternate artwork with matching gameplay text; the other 16 map to their exact public printing. Local captured artwork remains preferred. No match data was modified.

Verification: all 64 fallback URLs returned PNG bytes with card-sized dimensions. All 214 captured lists remain valid. Full tracker tests, frontend build, and diff checks pass. Browser QA rendered eight representative cards successfully, including both missing Pokémon from the reported screenshot and the alternate-art label.

The six alternate-art mappings are svalt_155 → TWM/95, svalt_166 → JTG/116, mealt_3 → MEG/1, smalt_154 → UNB/182, swshalt_102 → BRS/132, and sve_17_ph → SVE/1. These do not claim to reproduce the captured cosmetic finish. Exact special-variant artwork remains unavailable from the checked providers.

Source: each printing is available at `https://limitlesstcg.com/cards/{set}/{number}`; image URLs come from that provider's card-image CDN. Basic Grass Energy uses the existing public image catalog. Mappings live in `src/tracker/card-art.ts` and fallback behavior has regression coverage in `src/tracker/__tests__/card-art.test.ts`.

## Originally broken printings (now covered)

- svalt_155: Munkidori
- me3_106: Mega Skarmory ex
- me3_21: Mega Starmie ex
- sve_17_ph: Basic {G} Energy
- me2-5_275: Mega Froslass ex
- me2-5_193: Mega Signal
- me2-5_47: Mega Froslass ex
- me2-5_214_ph: Urbain
- me2-5_272: Mega Meganium ex
- me2-5_293: Surfer
- mealt_3: Bulbasaur
- me2-5_209: Team Rocket's Transceiver
- me5_103: Mega Excadrill ex
- smalt_154: Pokégear 3.0
- me2-5_162: Team Rocket's Kangaskhan ex
- mebsp_31: N's Zekrom
- svalt_166: N's Reshiram
- svbsp_115: Thwackey
- sm11-5_64: Pokémon Center Lady
- svbsp_203: Team Rocket's Wobbuffet
- me2-5_207: Team Rocket's Petrel
- swshalt_102: Boss's Orders
