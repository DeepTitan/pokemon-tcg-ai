import * as fs from 'node:fs';
import * as path from 'node:path';

interface LocalCardAction {
  kind: string;
  name: string;
  text: string;
  cost: string;
  damage: string;
}

export interface LocalCardInfo {
  id: string;
  name: string;
  hp?: number;
  cardType?: string;
  category?: number;
  setCode?: string;
  number?: string;
  imageDataUrl?: string;
  format?: string;
  retreat?: number;
  weaknessType?: string;
  weaknessAmount?: string;
  resistanceType?: string;
  resistanceAmount?: string;
  evolvesFrom?: string;
  rulesText?: string;
  actions: LocalCardAction[];
}

type Cell = string | number | undefined;

class TableReader {
  private offset = 0;

  constructor(private readonly bytes: Buffer) {}

  private take(count: number): Buffer {
    const end = this.offset + count;
    if (end > this.bytes.length) throw new Error('truncated card table');
    const value = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  u8(): number { return this.take(1).readUInt8(0); }
  i32(): number { return this.take(4).readInt32LE(0); }
  u32(): number { return this.take(4).readUInt32LE(0); }
  i64(): number { return Number(this.take(8).readBigInt64LE(0)); }

  string(): string {
    let length = 0;
    let shift = 0;
    while (true) {
      const byte = this.u8();
      length |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw new Error('invalid card table string length');
    }
    return this.take(length).toString('utf8');
  }

  cell(typeName: string): Cell {
    if (this.u8() !== 0) return undefined;
    if (typeName === 'System.String') return this.string();
    if (typeName === 'System.Int32') return this.i32();
    if (typeName === 'System.UInt32') return this.u32();
    if (typeName === 'System.Int64') return this.i64();
    if (typeName === 'System.Byte') return this.u8();
    if (typeName === 'System.Boolean') { this.take(1); return undefined; }
    if (typeName === 'System.Double') { this.take(8); return undefined; }
    throw new Error(`unsupported card table value type: ${typeName}`);
  }
}

const USEFUL_COLUMNS = new Set([
  'cardID', 'LocalizedCardName', 'EN Card Name', 'EN Format',
  'EN Attack Name', 'EN Attack Name 2', 'EN Attack Name 3', 'EN Attack Name 4',
  'EN Attack Text', 'EN Attack Text 2', 'EN Attack Text 3', 'EN Attack Text 4',
  'EN Cost', 'EN Cost 2', 'EN Cost 3', 'EN Cost 4',
  'Damage', 'Damage 2', 'Damage 3', 'Damage 4', 'HP', 'Retreat', 'EN Type',
  'EN Weakness Type', 'Weakness Amount', 'EN Resistance Type', 'Resistance Amount',
  'EN Evolves From', 'category', 'setCode', 'EN Card #',
]);

function stringCell(row: Map<string, Cell>, name: string): string | undefined {
  const value = row.get(name);
  return typeof value === 'string' && value ? value : undefined;
}

function numberCell(row: Map<string, Cell>, name: string): number | undefined {
  const value = row.get(name);
  return typeof value === 'number' ? value : undefined;
}

function plainCardText(raw: string): string {
  return raw
    .replace(/<sprite[^>]*name=['"]?([^'"\s>]+)[^>]*>/gi, (_, name: string) => name.charAt(0).toUpperCase() + name.slice(1))
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function parseTable(bytes: Buffer, wanted?: Set<string>): LocalCardInfo[] {
  const reader = new TableReader(bytes.subarray(1));
  reader.string();
  const columnCount = reader.i32();
  if (columnCount < 0 || columnCount > 256) throw new Error('invalid card table column count');
  const columns = Array.from({ length: columnCount }, () => [reader.string(), reader.string()] as const);
  const rowCount = reader.i32();
  if (rowCount < 0 || rowCount > 100_000) throw new Error('invalid card table row count');
  const cards: LocalCardInfo[] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = new Map<string, Cell>();
    for (const [column, typeName] of columns) {
      const cell = reader.cell(typeName);
      if (USEFUL_COLUMNS.has(column)) row.set(column, cell);
    }
    const id = stringCell(row, 'cardID');
    if (!id || (wanted && !wanted.has(id))) continue;
    const category = numberCell(row, 'category');
    const actions: LocalCardAction[] = [];
    const rules: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const suffix = index === 0 ? '' : ` ${index + 1}`;
      const rawName = stringCell(row, `EN Attack Name${suffix}`) || '';
      const text = plainCardText(stringCell(row, `EN Attack Text${suffix}`) || '');
      const cost = stringCell(row, `EN Cost${suffix}`) || '';
      const damage = stringCell(row, `Damage${suffix}`) || '';
      if (text) rules.push(text);
      if (!rawName && !text && !cost && !damage) continue;
      const ability = rawName.trimStart().startsWith('[Ability]');
      actions.push({
        kind: ability ? 'ability' : category === 1 ? 'attack' : 'rule',
        name: rawName.replace(/^\s*\[Ability\]\s*/, '').trim() || 'Card text',
        text, cost, damage,
      });
    }
    const hp = numberCell(row, 'HP');
    cards.push({
      id,
      name: stringCell(row, 'LocalizedCardName') || stringCell(row, 'EN Card Name') || id,
      ...(hp && hp > 0 ? { hp } : {}),
      cardType: stringCell(row, 'EN Type'),
      category,
      setCode: stringCell(row, 'setCode'),
      number: stringCell(row, 'EN Card #'),
      format: stringCell(row, 'EN Format'),
      retreat: numberCell(row, 'Retreat'),
      weaknessType: stringCell(row, 'EN Weakness Type'),
      weaknessAmount: stringCell(row, 'Weakness Amount'),
      resistanceType: stringCell(row, 'EN Resistance Type'),
      resistanceAmount: stringCell(row, 'Resistance Amount'),
      evolvesFrom: stringCell(row, 'EN Evolves From'),
      rulesText: rules.length ? rules.join('\n') : undefined,
      actions,
    });
  }
  return cards;
}

function databaseId(cardId: string): string {
  const [set, number] = cardId.split('_');
  return set && number ? `${set}_${number}` : cardId;
}

const CARD_SET_CACHE = new Map<string, Map<string, LocalCardInfo>>();

function loadCardSet(databaseRoot: string, set: string): Map<string, LocalCardInfo> {
  const cacheKey = `${databaseRoot}:${set}`;
  const cached = CARD_SET_CACHE.get(cacheKey);
  if (cached) return cached;
  const cards = new Map<string, LocalCardInfo>();
  for (const fileName of fs.readdirSync(databaseRoot)) {
    if (!fileName.startsWith(`card-database-${set}_`) || !fileName.includes('_en_') || !fileName.endsWith('.json')) continue;
    const json = JSON.parse(fs.readFileSync(path.join(databaseRoot, fileName), 'utf8'));
    const encoded = json?.keys?.table?.contentBinary;
    if (typeof encoded !== 'string') continue;
    for (const card of parseTable(Buffer.from(encoded, 'base64'))) cards.set(card.id, card);
  }
  CARD_SET_CACHE.set(cacheKey, cards);
  return cards;
}

export function resolveLocalCardSources(databaseRoot: string, artRoot: string, cardIds: string[]): LocalCardInfo[] {
  const wantedIds = [...new Set(cardIds.filter(Boolean))];
  const byDatabaseId = new Map<string, LocalCardInfo>();
  for (const id of wantedIds.map(databaseId)) {
    const set = id.split('_')[0];
    const card = set ? loadCardSet(databaseRoot, set).get(id) : undefined;
    if (card) byDatabaseId.set(id, card);
  }
  return wantedIds.map((id) => {
    const card = byDatabaseId.get(databaseId(id));
    const artPath = path.join(artRoot, `${id}.png`);
    return {
      ...(card || { id, name: id, actions: [] }),
      id,
      imageDataUrl: fs.existsSync(artPath) ? `/api/turnlume/card-art/${encodeURIComponent(id)}.png` : undefined,
    };
  });
}
