# Deck identity release — September 14, 2026

Release prepared on production main `52111d0d89078e6044f0696d99b3f87f15b25e6b`, including the concurrently shipped decklist polish and copy changes.

Archive icons now use each player's captured starting decklist, printed card mechanics and evolution investment. Close centerpiece ties favor the Pokémon appearing in fewer recorded decks; this picks Elgyem and Mega Starmie without relying on HP or a special Elgyem score bonus. A versioned 214-deck frequency baseline keeps existing icons stable.

Native and browser summaries retain decklists. Existing native summaries stream the decklists field from cached reviews once. Cache updates happen after the archive read cursor closes and compare the original summary before writing, so concurrent capture cannot be overwritten. Missing or damaged old lists retain the board fallback.

Validation on this production checkout: complete tracker suite, release suite, focused frontend/audit TypeScript check, tracker production build, and native library tests (32 passed, one existing ignored test). The full 112-game audit matches all 214 available deck sides across 96 exact lists, with four frequency tiebreaks and no unresolved ties. Five games lack full starting inventories. See [the audit](DECK_IDENTITY_AUDIT_20260914.md).

Publishing uses the existing signed Windows and notarized macOS release workflow. The final release URL and workflow result are recorded in the task after publication.
