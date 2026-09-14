import type { CapturedDecklist, CardInfo } from './types.js';

// PTCGL deckImportData_0.0 (2026-09-14): external abbreviation -> internal set.
// Keep this explicit: passing an unknown internal set through silently imports the wrong list.
const SET_PAIRS = `BLW:BW1 PLB:BW10 LTR:BW11 LTR-RC:BW11R EPO:BW2 NVI:BW3 NXD:BW4 DEX:BW5 DRX:BW6 BCR:BW7 PLS:BW8 PLF:BW9 PR-BLW:BWBSP BWALT:BWALT Energy:EC DET:GUM
SUM:SM1 UNB:SM10 UNM:SM11 HIF:SM11-5 CEC:SM12 GRI:SM2 BUS:SM3 SLG:SM3-5 CIN:SM4 UPR:SM5 FLI:SM6 CES:SM7 DRM:SM7-5 LOT:SM8 TEU:SM9 PR-SM:SMBSP SMALT:SMALT
SSH:SWSH1 RCL:SWSH2 DAA:SWSH3 CPA:SWSH3-5 BRS:SWSH9 BRS-TG:SWSH9A ASR:SWSH10 ASR-TG:SWSH10A PGO:SWSH10-5 LOR:SWSH11 LOR-TG:SWSH11A SIT:SWSH12 SIT-TG:SWSH12A CRZ:SWSH12-5 CRZ-GG:SWSH12-5A FST:SWSH8 CEL:SWSH7-5 CEL-CC:SWSH7-5R EVS:SWSH7 CRE:SWSH6 BST:SWSH5 SHF:SWSH4-5 VIV:SWSH4 PR-SW:SWSHBSP SWSHALT:SWSHALT
KSS:XY0 XY:XY1 FCO:XY10 STS:XY11 EVO:XY12 FLF:XY2 FFI:XY3 PHF:XY4 PRC:XY5 ROS:XY6 AOR:XY7 BKT:XY8 BKP:XY9 GEN:XY9-5 GEN-RC:XY9-5R PR-XY:XYBSP XYALT:XYALT
PR-SV:SVBSP SVALT:SVALT SVE:SVE SVI:SV1 PAL:SV2 OBF:SV3 MEW:SV3-5 PAR:SV4 PAF:SV4-5 TEF:SV5 TWM:SV6 SFA:SV6-5 SCR:SV7 SSP:SV8 PRE:SV8-5 JTG:SV9 DRI:SV10 WHT:RSV10-5 BLK:ZSV10-5
MEE:MEE MEALT:MEALT MEP:MEBSP MEG:ME1 PFL:ME2 ASC:ME2-5 POR:ME3 CRI:ME4 PBL:ME5`;
const importSets = new Map(SET_PAIRS.split(/\s+/).map(pair => {
  const [external, internal] = pair.split(':');
  return [internal.toLowerCase(), external];
}));

export type DecklistExport = { text: string; error?: never } | { text?: never; error: string };

/** Export the captured starting inventory, never the current/reconstructed deck zone.
 * This validates completeness/importability, not current tournament-format legality.
 * Cosmetic finishes normalize to the same numbered printing (the importer's stable identity).
 */
export function exportDecklist(deck: CapturedDecklist | undefined, catalog: ReadonlyMap<string, CardInfo>): DecklistExport {
  if (!deck || deck.source !== 'match-start' || deck.total !== 60 || !deck.cards.length
    || deck.cards.some(c => !Number.isInteger(c.count) || c.count < 1 || c.count > 60)
    || deck.cards.reduce((sum, c) => sum + c.count, 0) !== 60
    || new Set(deck.cards.map(c => c.cardId.toLowerCase())).size !== deck.cards.length) {
    return { error: 'A complete 60-card starting list is needed to copy.' };
  }
  const groups = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  for (const entry of deck.cards) {
    const card = catalog.get(entry.cardId) || catalog.get(entry.cardId.toLowerCase());
    const identity = /^([a-z0-9-]+)_(\d+)(?:_(?:ph|sph))?$/i.exec(entry.cardId);
    const set = identity && importSets.get(identity[1].toLowerCase());
    const name = card?.name?.replace(/\s+/g, ' ').trim();
    if (!card || !name || name.toLowerCase() === entry.cardId.toLowerCase()
      || ![1, 2, 3].includes(card.category ?? 0) || !identity || !set) {
      return { error: 'Some card details are unavailable. Copy will be ready when all cards are identified.' };
    }
    const line = `${name} ${set} ${Number(identity[2])}`;
    const group = groups[card.category! - 1];
    group.set(line, (group.get(line) || 0) + entry.count);
  }
  // Native PTCGL headers count distinct entries, not copies. Total Cards counts copies.
  const sections = groups.map((group, index) => `${['Pokémon', 'Trainer', 'Energy'][index]}: ${group.size}\n${
    [...group].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([line, count]) => `${count} ${line}`).join('\n')}`);
  return { text: `${sections.join('\n\n')}\n\nTotal Cards: 60\n` };
}
