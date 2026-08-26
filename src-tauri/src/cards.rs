use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardActionInfo {
    pub kind: String,
    pub name: String,
    pub text: String,
    pub cost: String,
    pub damage: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardInfo {
    pub id: String,
    pub name: String,
    pub hp: Option<i32>,
    pub card_type: Option<String>,
    pub category: Option<u8>,
    pub set_code: Option<String>,
    pub number: Option<String>,
    pub image_data_url: Option<String>,
    pub image_path: Option<String>,
    pub format: Option<String>,
    pub retreat: Option<i32>,
    pub weakness_type: Option<String>,
    pub weakness_amount: Option<String>,
    pub resistance_type: Option<String>,
    pub resistance_amount: Option<String>,
    pub evolves_from: Option<String>,
    pub rules_text: Option<String>,
    pub actions: Vec<CardActionInfo>,
}

#[derive(Clone, Debug)]
enum Cell {
    String(String),
    I32(i32),
    U32(u32),
    I64(i64),
    U8(u8),
    Bool,
    Double,
    Empty,
}

struct TableReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> TableReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self.offset.checked_add(count).ok_or("card table offset overflow")?;
        let result = self
            .bytes
            .get(self.offset..end)
            .ok_or("truncated card table")?;
        self.offset = end;
        Ok(result)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn i64(&mut self) -> Result<i64, String> {
        Ok(i64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn string(&mut self) -> Result<String, String> {
        let mut length = 0usize;
        let mut shift = 0usize;
        loop {
            let byte = self.u8()?;
            length |= ((byte & 0x7f) as usize) << shift;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift > 28 {
                return Err("invalid card table string length".into());
            }
        }
        String::from_utf8(self.take(length)?.to_vec()).map_err(|error| error.to_string())
    }

    fn cell(&mut self, type_name: &str) -> Result<Cell, String> {
        if self.u8()? != 0 {
            return Ok(Cell::Empty);
        }
        match type_name {
            "System.String" => Ok(Cell::String(self.string()?)),
            "System.Int32" => Ok(Cell::I32(self.i32()?)),
            "System.UInt32" => Ok(Cell::U32(self.u32()?)),
            "System.Int64" => Ok(Cell::I64(self.i64()?)),
            "System.Byte" => Ok(Cell::U8(self.u8()?)),
            "System.Boolean" => {
                self.u8()?;
                Ok(Cell::Bool)
            }
            "System.Double" => {
                self.take(8)?;
                Ok(Cell::Double)
            }
            other => Err(format!("unsupported card table value type: {other}")),
        }
    }
}

fn string_cell(row: &HashMap<String, Cell>, name: &str) -> Option<String> {
    match row.get(name) {
        Some(Cell::String(value)) if !value.is_empty() => Some(value.clone()),
        _ => None,
    }
}

fn i32_cell(row: &HashMap<String, Cell>, name: &str) -> Option<i32> {
    match row.get(name) {
        Some(Cell::I32(value)) => Some(*value),
        _ => None,
    }
}

fn plain_card_text(raw: &str) -> String {
    let mut output = String::with_capacity(raw.len());
    let mut remaining = raw;
    while let Some(start) = remaining.find('<') {
        output.push_str(&remaining[..start]);
        let Some(relative_end) = remaining[start..].find('>') else {
            output.push_str(&remaining[start..]);
            remaining = "";
            break;
        };
        let end = start + relative_end;
        let tag = &remaining[start + 1..end];
        let lower = tag.to_ascii_lowercase();
        if lower.trim_start().starts_with("sprite") {
            if let Some(name_start) = lower.find("name=") {
                let value = tag[name_start + 5..].trim_start();
                let value = value.trim_start_matches(['\'', '"']);
                let name_end = value
                    .find(|character: char| character == '\'' || character == '"' || character.is_whitespace())
                    .unwrap_or(value.len());
                let name = &value[..name_end];
                if !name.is_empty() {
                    let mut characters = name.chars();
                    if let Some(first) = characters.next() {
                        output.extend(first.to_uppercase());
                        output.push_str(characters.as_str());
                    }
                }
            }
        }
        remaining = &remaining[end + 1..];
    }
    output.push_str(remaining);
    let decoded = output
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_table(bytes: &[u8], wanted: &HashSet<String>) -> Result<Vec<CardInfo>, String> {
    // The first byte is the client's generic binary-config marker. The remaining
    // bytes are the CardDatabase DataTableFormatter stream.
    let mut reader = TableReader::new(bytes.get(1..).ok_or("empty card table")?);
    let _table_name = reader.string()?;
    let column_count = reader.i32()?;
    if !(0..=256).contains(&column_count) {
        return Err("invalid card table column count".into());
    }
    let mut columns = Vec::with_capacity(column_count as usize);
    for _ in 0..column_count {
        columns.push((reader.string()?, reader.string()?));
    }
    let row_count = reader.i32()?;
    if !(0..=100_000).contains(&row_count) {
        return Err("invalid card table row count".into());
    }
    let useful: HashSet<&str> = [
        "cardID",
        "LocalizedCardName",
        "EN Card Name",
        "EN Format",
        "EN Attack Name",
        "EN Attack Name 2",
        "EN Attack Name 3",
        "EN Attack Name 4",
        "EN Attack Text",
        "EN Attack Text 2",
        "EN Attack Text 3",
        "EN Attack Text 4",
        "EN Cost",
        "EN Cost 2",
        "EN Cost 3",
        "EN Cost 4",
        "Damage",
        "Damage 2",
        "Damage 3",
        "Damage 4",
        "HP",
        "Retreat",
        "EN Type",
        "EN Weakness Type",
        "Weakness Amount",
        "EN Resistance Type",
        "Resistance Amount",
        "EN Evolves From",
        "category",
        "setCode",
        "EN Card #",
    ]
    .into_iter()
    .collect();
    let mut cards = Vec::new();
    for _ in 0..row_count {
        let mut row = HashMap::new();
        for (column, type_name) in &columns {
            let cell = reader.cell(type_name)?;
            if useful.contains(column.as_str()) {
                row.insert(column.clone(), cell);
            }
        }
        let Some(id) = string_cell(&row, "cardID") else {
            continue;
        };
        if !wanted.contains(&id) {
            continue;
        }
        let name = string_cell(&row, "LocalizedCardName")
            .or_else(|| string_cell(&row, "EN Card Name"))
            .unwrap_or_else(|| id.clone());
        let hp = i32_cell(&row, "HP").filter(|value| *value > 0);
        let category = match row.get("category") {
            Some(Cell::U8(value)) => Some(*value),
            _ => None,
        };
        let mut actions = Vec::new();
        let mut rule_text = Vec::new();
        for index in 0..4 {
            let suffix = if index == 0 { String::new() } else { format!(" {}", index + 1) };
            let raw_name = string_cell(&row, &format!("EN Attack Name{suffix}")).unwrap_or_default();
            let text = string_cell(&row, &format!("EN Attack Text{suffix}"))
                .map(|text| plain_card_text(&text))
                .unwrap_or_default();
            let cost = string_cell(&row, &format!("EN Cost{suffix}")).unwrap_or_default();
            let damage = string_cell(&row, &format!("Damage{suffix}")).unwrap_or_default();
            if !text.is_empty() {
                rule_text.push(text.clone());
            }
            if raw_name.is_empty() && text.is_empty() && cost.is_empty() && damage.is_empty() {
                continue;
            }
            let ability = raw_name.trim_start().starts_with("[Ability]");
            let action_name = raw_name
                .trim_start_matches("[Ability]")
                .trim()
                .to_owned();
            actions.push(CardActionInfo {
                kind: if ability {
                    "ability"
                } else if category == Some(1) {
                    "attack"
                } else {
                    "rule"
                }
                .to_owned(),
                name: if action_name.is_empty() { "Card text".to_owned() } else { action_name },
                text,
                cost,
                damage,
            });
        }
        cards.push(CardInfo {
            id,
            name,
            hp,
            card_type: string_cell(&row, "EN Type"),
            category,
            set_code: string_cell(&row, "setCode"),
            number: string_cell(&row, "EN Card #"),
            image_data_url: None,
            image_path: None,
            format: string_cell(&row, "EN Format"),
            retreat: i32_cell(&row, "Retreat"),
            weakness_type: string_cell(&row, "EN Weakness Type"),
            weakness_amount: string_cell(&row, "Weakness Amount"),
            resistance_type: string_cell(&row, "EN Resistance Type"),
            resistance_amount: string_cell(&row, "Resistance Amount"),
            evolves_from: string_cell(&row, "EN Evolves From"),
            rules_text: if rule_text.is_empty() { None } else { Some(rule_text.join("\n")) },
            actions,
        });
    }
    Ok(cards)
}

fn set_id(card_id: &str) -> Option<&str> {
    card_id.split('_').next().filter(|set| !set.is_empty())
}

fn database_id(card_id: &str) -> String {
    let mut parts = card_id.split('_');
    match (parts.next(), parts.next()) {
        (Some(set), Some(number)) => format!("{set}_{number}"),
        _ => card_id.to_owned(),
    }
}

fn art_key(card_id: &str) -> Option<String> {
    let mut parts = card_id.split('_');
    let set = parts.next()?;
    let number = parts.next()?
        .split(|character: char| !character.is_ascii_digit())
        .next()?
        .parse::<u32>()
        .ok()?;
    Some(format!("{set}_en_{number:03}_t"))
}

fn find_bundle(cache_root: &Path, key: &str) -> Option<PathBuf> {
    let directory = cache_root.join(key);
    for entry in fs::read_dir(directory).ok()?.flatten() {
        let candidate = entry.path().join("__data");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn image_path(cache_root: &Path, output_root: &Path, card_id: &str) -> Option<String> {
    let thumbnail_key = art_key(card_id)?;
    let output = output_root.join(format!("{card_id}.png"));
    if !output.is_file() {
        let (key, bundle, resize) = if let Some(bundle) = find_bundle(cache_root, &thumbnail_key) {
            (thumbnail_key, bundle, false)
        } else {
            let full_key = thumbnail_key.trim_end_matches("_t").to_string();
            (full_key.clone(), find_bundle(cache_root, &full_key)?, true)
        };
        let extract_directory = output_root.join(format!("extract-{card_id}"));
        fs::create_dir_all(&extract_directory).ok()?;
        unityfs::extract_unity_assets_from_path(&bundle, &extract_directory).ok()?;
        let extracted = extract_directory.join(format!("{key}.png"));
        if !extracted.is_file() {
            return None;
        }
        if resize {
            image::open(&extracted)
                .ok()?
                .resize(256, 256, image::imageops::FilterType::Lanczos3)
                .save(&output)
                .ok()?;
        } else {
            fs::copy(extracted, &output).ok()?;
        }
        let _ = fs::remove_dir_all(extract_directory);
    }
    Some(output.to_string_lossy().into_owned())
}

#[derive(Debug)]
struct ClientDataRoots {
    database: Vec<PathBuf>,
    cache: Vec<PathBuf>,
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.contains(&path) {
        paths.push(path);
    }
}

fn windows_client_data_roots(
    home: &Path,
    local_app_data: Option<PathBuf>,
    roaming_app_data: Option<PathBuf>,
) -> ClientDataRoots {
    let local_low = home.join("AppData/LocalLow");
    let local = local_app_data.unwrap_or_else(|| home.join("AppData/Local"));
    let roaming = roaming_app_data.unwrap_or_else(|| home.join("AppData/Roaming"));

    // PTCGL is a Unity app. On Windows, Application.persistentDataPath lives
    // below LocalLow while Unity's downloaded AssetBundles use a separate
    // LocalLow/Unity cache. Keep the older LOCALAPPDATA layout as a fallback for
    // machines upgraded from early Trace builds.
    let game_roots = [
        local_low.join("pokemon/Pokemon TCG Live"),
        local_low.join("The Pokémon Company International/Pokémon Trading Card Game Live"),
        roaming.join("Pokemon/Pokemon TCG Live"),
        roaming.join("Pokémon Trading Card Game Live"),
        local.join("com.pokemon.pokemontcgl"),
    ];
    let mut database = Vec::new();
    for root in game_roots {
        push_unique(&mut database, root.join("config-cache"));
    }

    let unity_root = local_low.join("Unity/pokemon_Pokemon TCG Live");
    let mut cache = Vec::new();
    for root in [
        unity_root.clone(),
        unity_root.join("cache"),
        local_low.join("pokemon/Pokemon TCG Live/cache"),
        local.join("com.pokemon.pokemontcgl/cache"),
    ] {
        push_unique(&mut cache, root);
    }
    ClientDataRoots { database, cache }
}

fn client_data_roots(home: &Path) -> ClientDataRoots {
    #[cfg(target_os = "macos")]
    {
        ClientDataRoots {
            database: vec![home.join("Library/Application Support/com.pokemon.pokemontcgl/config-cache")],
            cache: vec![home.join("Library/Caches/com.pokemon.pokemontcgl")],
        }
    }
    #[cfg(target_os = "windows")]
    {
        windows_client_data_roots(
            home,
            std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
            std::env::var_os("APPDATA").map(PathBuf::from),
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        ClientDataRoots {
            database: vec![home.join(".local/share/com.pokemon.pokemontcgl/config-cache")],
            cache: vec![home.join(".cache/com.pokemon.pokemontcgl")],
        }
    }
}

fn resolve_from_roots(
    roots: &ClientDataRoots,
    output_root: &Path,
    wanted: HashSet<String>,
) -> Result<Vec<CardInfo>, String> {
    let database_wanted: HashSet<String> = wanted.iter().map(|id| database_id(id)).collect();
    let sets: HashSet<&str> = database_wanted.iter().filter_map(|id| set_id(id)).collect();
    let mut cards = HashMap::new();
    let mut readable_database = false;
    for database_root in &roots.database {
        let Ok(entries) = fs::read_dir(database_root) else {
            continue;
        };
        readable_database = true;
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let Some(set) = sets.iter().find(|set| {
                file_name.starts_with(&format!("card-database-{set}_"))
                    && file_name.contains("_en_")
                    && file_name.ends_with(".json")
            }) else {
                continue;
            };
            let json: Value = serde_json::from_slice(&fs::read(&path).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
            let Some(encoded) = json
                .pointer("/keys/table/contentBinary")
                .and_then(Value::as_str)
            else {
                continue;
            };
            let binary = STANDARD.decode(encoded).map_err(|error| error.to_string())?;
            let relevant: HashSet<String> = database_wanted
                .iter()
                .filter(|id| set_id(id) == Some(*set))
                .cloned()
                .collect();
            for card in parse_table(&binary, &relevant)? {
                cards.insert(card.id.clone(), card);
            }
        }
    }
    if !readable_database {
        let searched = roots.database.iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!("TCG Live's local card database is unavailable. Searched: {searched}"));
    }

    let mut result = Vec::new();
    for id in wanted {
        let base_id = database_id(&id);
        let mut card = cards.get(&base_id).cloned().unwrap_or_else(|| CardInfo {
            id: id.clone(),
            name: id.clone(),
            hp: None,
            card_type: None,
            category: None,
            set_code: None,
            number: None,
            image_data_url: None,
            image_path: None,
            format: None,
            retreat: None,
            weakness_type: None,
            weakness_amount: None,
            resistance_type: None,
            resistance_amount: None,
            evolves_from: None,
            rules_text: None,
            actions: Vec::new(),
        });
        card.id = id.clone();
        card.image_data_url = None;
        card.image_path = roots.cache.iter()
            .find_map(|cache_root| image_path(cache_root, output_root, &id));
        result.push(card);
    }
    result.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(result)
}

pub fn resolve(app: &tauri::AppHandle, card_ids: Vec<String>) -> Result<Vec<CardInfo>, String> {
    let wanted: HashSet<String> = card_ids.into_iter().filter(|id| !id.is_empty()).collect();
    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    let roots = client_data_roots(&home);
    let output_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("card-art");
    fs::create_dir_all(&output_root).map_err(|error| error.to_string())?;
    resolve_from_roots(&roots, &output_root, wanted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_string(output: &mut Vec<u8>, value: &str) {
        output.push(value.len() as u8);
        output.extend_from_slice(value.as_bytes());
    }

    #[test]
    fn parses_client_data_table_rows() {
        let mut bytes = vec![0];
        write_string(&mut bytes, "TEST_EN");
        bytes.extend_from_slice(&3i32.to_le_bytes());
        for (name, kind) in [
            ("cardID", "System.String"),
            ("LocalizedCardName", "System.String"),
            ("HP", "System.Int32"),
        ] {
            write_string(&mut bytes, name);
            write_string(&mut bytes, kind);
        }
        bytes.extend_from_slice(&1i32.to_le_bytes());
        bytes.push(0);
        write_string(&mut bytes, "svx_1");
        bytes.push(0);
        write_string(&mut bytes, "Test Pokémon");
        bytes.push(0);
        bytes.extend_from_slice(&120i32.to_le_bytes());
        let cards = parse_table(&bytes, &HashSet::from(["svx_1".to_string()])).unwrap();
        assert_eq!(cards[0].name, "Test Pokémon");
        assert_eq!(cards[0].hp, Some(120));
    }

    #[test]
    fn normalizes_parallel_holo_ids_to_the_base_database_row() {
        assert_eq!(database_id("sv10_169_ph"), "sv10_169");
        assert_eq!(art_key("sv10_169_ph").as_deref(), Some("sv10_en_169_t"));
        assert_eq!(art_key("sv8-5_6").as_deref(), Some("sv8-5_en_006_t"));
    }

    #[test]
    fn discovers_the_real_windows_ptcgl_database_and_unity_cache() {
        let roots = windows_client_data_roots(
            Path::new("C:/Users/TraceAdmin"),
            Some(PathBuf::from("C:/Users/TraceAdmin/AppData/Local")),
            Some(PathBuf::from("C:/Users/TraceAdmin/AppData/Roaming")),
        );
        assert!(roots.database.contains(&PathBuf::from(
            "C:/Users/TraceAdmin/AppData/LocalLow/pokemon/Pokemon TCG Live/config-cache"
        )));
        assert!(roots.cache.contains(&PathBuf::from(
            "C:/Users/TraceAdmin/AppData/LocalLow/Unity/pokemon_Pokemon TCG Live"
        )));
        assert!(roots.cache.contains(&PathBuf::from(
            "C:/Users/TraceAdmin/AppData/LocalLow/Unity/pokemon_Pokemon TCG Live/cache"
        )));
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires an installed Pokémon TCG Live client"]
    fn resolves_metadata_and_art_from_an_installed_client() {
        let home = PathBuf::from(std::env::var_os("HOME").expect("HOME is available"));
        let output = std::env::temp_dir().join(format!(
            "trace-card-resolution-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&output).unwrap();
        let cards = resolve_from_roots(
            &client_data_roots(&home),
            &output,
            HashSet::from(["sv9_120".to_owned()]),
        )
        .unwrap();
        assert_eq!(cards[0].name, "Dunsparce");
        assert!(cards[0]
            .image_path
            .as_deref()
            .is_some_and(|path| Path::new(path).is_file()));
        fs::remove_dir_all(output).unwrap();
    }

    #[test]
    fn parses_complete_rules_and_actions() {
        let columns = [
            ("cardID", "System.String"),
            ("LocalizedCardName", "System.String"),
            ("EN Format", "System.String"),
            ("EN Attack Name", "System.String"),
            ("EN Attack Text", "System.String"),
            ("EN Cost", "System.String"),
            ("Damage", "System.String"),
            ("EN Attack Name 2", "System.String"),
            ("EN Attack Text 2", "System.String"),
            ("HP", "System.Int32"),
            ("Retreat", "System.Int32"),
            ("EN Type", "System.String"),
            ("EN Weakness Type", "System.String"),
            ("Weakness Amount", "System.String"),
            ("EN Evolves From", "System.String"),
            ("category", "System.Byte"),
        ];
        let mut bytes = vec![0];
        write_string(&mut bytes, "TEST_EN");
        bytes.extend_from_slice(&(columns.len() as i32).to_le_bytes());
        for (name, kind) in columns {
            write_string(&mut bytes, name);
            write_string(&mut bytes, kind);
        }
        bytes.extend_from_slice(&1i32.to_le_bytes());
        for value in [
            "svx_2", "Dragapult ex", "2ex", "Phantom Dive",
            "Put 6 damage counters on your opponent's Benched Pokémon.", "PR", "200",
            "[Ability] Infiltrator", "Once during your turn, draw a card.",
        ] {
            bytes.push(0);
            write_string(&mut bytes, value);
        }
        bytes.push(0);
        bytes.extend_from_slice(&320i32.to_le_bytes());
        bytes.push(0);
        bytes.extend_from_slice(&1i32.to_le_bytes());
        for value in ["Psychic", "Darkness", "×2", "Drakloak"] {
            bytes.push(0);
            write_string(&mut bytes, value);
        }
        bytes.push(0);
        bytes.push(1);

        let cards = parse_table(&bytes, &HashSet::from(["svx_2".to_string()])).unwrap();
        let card = &cards[0];
        assert_eq!(card.format.as_deref(), Some("2ex"));
        assert_eq!(card.retreat, Some(1));
        assert_eq!(card.weakness_type.as_deref(), Some("Darkness"));
        assert_eq!(card.evolves_from.as_deref(), Some("Drakloak"));
        assert_eq!(card.actions.len(), 2);
        assert_eq!(card.actions[0].kind, "attack");
        assert_eq!(card.actions[0].cost, "PR");
        assert_eq!(card.actions[0].damage, "200");
        assert_eq!(card.actions[1].kind, "ability");
        assert_eq!(card.actions[1].name, "Infiltrator");
        assert!(card.rules_text.as_deref().unwrap().contains("6 damage counters"));
    }

    #[test]
    fn strips_unity_rich_text_and_names_energy_sprites() {
        assert_eq!(
            plain_card_text("Search for 5 Basic <sprite name=\"darkness\" tint=1> Energy. <i>(Then, shuffle.)</i>"),
            "Search for 5 Basic Darkness Energy. (Then, shuffle.)"
        );
    }
}
