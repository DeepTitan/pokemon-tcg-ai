//! Native-only inventories. Frontend-supplied winners or names never unlock a list.
use crate::wire::CapturedOperation;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct MatchAccess {
    #[serde(default)]
    pub projection_version: u8,
    pub local_account_id: Option<String>,
    pub local_player_id: Option<String>,
    pub local_player_name: Option<String>,
    pub completed: bool,
    #[serde(default)]
    pub local_player_side: Option<u8>,
    pub decks: Vec<Value>,
}

fn string<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(key)?.as_str())
        .filter(|s| !s.is_empty())
}

fn terminal(value: &Value) -> bool {
    match value {
        Value::Array(values) => values.iter().any(terminal),
        Value::Object(fields) => {
            let kind = string(value, &["$type", "type"])
                .unwrap_or("")
                .split(',')
                .next()
                .unwrap_or("")
                .rsplit('.')
                .next()
                .unwrap_or("");
            (kind == "EndGameModification"
                && matches!(
                    value
                        .get("winner")
                        .or_else(|| value.get("Winner"))
                        .and_then(Value::as_i64),
                    Some(1 | 2)
                ))
                || fields.values().any(terminal)
        }
        _ => false,
    }
}

fn captured_deck(player: &Value) -> Option<Value> {
    let name = string(player, &["playerName", "PlayerName"])?;
    let id = string(player, &["playerId", "PlayerId"])?;
    let cards = player
        .get("deckInfo")
        .or_else(|| player.get("DeckInfo"))?
        .get("cards")?
        .as_object()?;
    let mut entries = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut total = 0;
    for (id, count) in cards {
        let count = count.as_u64()?;
        if id.is_empty()
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            || !(1..=60).contains(&count)
            || !seen.insert(id.to_ascii_lowercase())
        {
            return None;
        }
        total += count;
        entries.push(json!({"cardId": id.to_ascii_lowercase(), "count": count}));
    }
    if total != 60
        || player
            .get("deckSize")
            .is_some_and(|v| v.as_u64() != Some(60))
    {
        return None;
    }
    Some(
        json!({"playerName": name, "playerId": id, "source": "match-start", "total": 60, "cards": entries}),
    )
}

impl MatchAccess {
    pub const PROJECTION_VERSION: u8 = 2;

    pub fn observe(&mut self, operation: &CapturedOperation) {
        self.projection_version = Self::PROJECTION_VERSION;
        if self.local_account_id.as_deref().is_none_or(|id| id.eq_ignore_ascii_case("SERVER")) {
            self.local_account_id = operation.account_id.clone()
                .filter(|v| !v.is_empty() && !v.eq_ignore_ascii_case("SERVER"));
        }
        self.observe_players(&operation.operation);
        // Match-start is often a SERVER envelope; the local account arrives later.
        // Resolve it against the native roster retained from that earlier packet.
        if let Some(account) = self.local_account_id.as_deref() {
            if let Some(deck) = self.decks.iter().find(|d| d.get("playerId").and_then(Value::as_str) == Some(account)) {
                self.local_player_id = Some(account.to_owned());
                self.local_player_name = string(deck, &["playerName"]).map(str::to_owned);
            }
        }
        if let Some(id) = self.local_player_id.as_deref() {
            self.local_player_side = self.local_player_side.or_else(|| player_side(&operation.operation, id));
        }
        self.completed |= terminal(&operation.operation);
    }

    fn observe_players(&mut self, value: &Value) {
        match value {
            Value::Array(values) => values.iter().for_each(|v| self.observe_players(v)),
            Value::Object(fields) => {
                if let Some(deck) = captured_deck(value) {
                    self.decks.retain(|old| old.get("playerId") != deck.get("playerId"));
                    self.decks.push(deck);
                }
                if let Some(account) = self.local_account_id.as_deref() {
                    let id = string(value, &["playerId", "PlayerId", "ownerPlayerId", "ownerPlayerID"]);
                    let name = string(value, &["playerName", "PlayerName", "userName", "UserName"]);
                    if name.is_some() && (id == Some(account)
                        || string(value, &["accountID", "accountId", "AccountID", "entityID"]) == Some(account)) {
                        self.local_player_id = id.map(str::to_owned).or_else(|| Some(account.to_owned()));
                        self.local_player_name = name.map(str::to_owned);
                    }
                }
                fields.values().for_each(|v| self.observe_players(v));
            }
            _ => {}
        }
    }

    pub fn opponent_deck(&self) -> Result<Value, String> {
        if !self.completed {
            return Err(
                "The opponent’s decklist unlocks after Trace records the match result.".into(),
            );
        }
        let local = self
            .local_player_id
            .as_deref()
            .ok_or("Trace could not verify the players in this capture.")?;
        let opponents: Vec<_> = self
            .decks
            .iter()
            .filter(|d| d.get("playerId").and_then(Value::as_str) != Some(local))
            .collect();
        if opponents.len() != 1 {
            return Err("This match has no complete opponent decklist saved.".into());
        }
        Ok(opponents[0].clone())
    }

    pub fn own_decks(&self) -> Vec<Value> {
        self.decks
            .iter()
            .filter(|d| {
                self.local_player_id
                    .as_deref()
                    .is_some_and(|id| d.get("playerId").and_then(Value::as_str) == Some(id))
            })
            .cloned()
            .collect()
    }

    pub fn project_operation(&self, mut operation: CapturedOperation) -> CapturedOperation {
        strip_inventories(&mut operation.operation, self.local_player_id.as_deref());
        redact_hidden_entities(
            &mut operation.operation,
            self.local_player_id.as_deref(),
            self.local_player_side,
        );
        if let Some(fields) = operation.operation.as_object_mut() {
            fields.insert("traceMatchCompleted".into(), Value::Bool(self.completed));
        }
        operation
    }

    pub fn project_review(&self, mut review: Value) -> Value {
        strip_inventories(&mut review, None);
        redact_review(&mut review, self.local_player_name.as_deref());
        review["decklists"] = Value::Array(self.own_decks());
        // This field is produced from raw native evidence, never a replay's winner.
        review["matchCompleted"] = Value::Bool(self.completed);
        review
    }
}

/// Strip nested/repeated inventories too, without changing revealed board cards.
fn strip_inventories(value: &mut Value, own_player_id: Option<&str>) {
    match value {
        Value::Array(values) => values
            .iter_mut()
            .for_each(|v| strip_inventories(v, own_player_id)),
        Value::Object(fields) => {
            let own = own_player_id.is_some_and(|id| {
                fields
                    .get("playerId")
                    .or_else(|| fields.get("PlayerId"))
                    .and_then(Value::as_str)
                    == Some(id)
            });
            fields.retain(|key, _| {
                !is_raw_payload_key(key)
                    && !key.eq_ignore_ascii_case("decklists")
                    && (own || !key.eq_ignore_ascii_case("deckinfo"))
            });
            fields
                .values_mut()
                .for_each(|v| strip_inventories(v, own_player_id));
        }
        _ => {}
    }
}

fn is_raw_payload_key(key: &str) -> bool {
    ["rawlog", "rawoperations", "rawpayload", "decodedmessage"]
        .contains(&key.to_ascii_lowercase().as_str())
}

fn player_side(value: &Value, own: &str) -> Option<u8> {
    match value {
        Value::Array(values) => values.iter().find_map(|v| player_side(v, own)),
        Value::Object(fields) => {
            let owner = string(
                value,
                &["ownerPlayerId", "ownerPlayerID", "playerId", "accountId"],
            );
            let pos = value
                .get("currentGamePos")
                .or_else(|| value.get("currentPos"))
                .and_then(Value::as_u64);
            if owner == Some(own) && matches!(pos, Some(3 | 4)) {
                return pos.map(|v| (v - 2) as u8);
            }
            if owner == Some(own) {
                if let Some(side) = value.get("isPlayer1").and_then(Value::as_bool) {
                    return Some(if side { 1 } else { 2 });
                }
            }
            fields.values().find_map(|v| player_side(v, own))
        }
        _ => None,
    }
}
fn redact_hidden_entities(value: &mut Value, own: Option<&str>, local_side: Option<u8>) {
    match value {
        Value::Array(values) => values
            .iter_mut()
            .for_each(|v| redact_hidden_entities(v, own, local_side)),
        Value::Object(fields) => {
            let owner = ["ownerPlayerId", "ownerPlayerID", "OwnerPlayerId"]
                .iter()
                .find_map(|k| fields.get(*k)?.as_str());
            let pos = ["currentGamePos", "currentPos", "CurrentGamePos"]
                .iter()
                .find_map(|k| fields.get(*k)?.as_u64());
            let is_own = own.is_some_and(|id| owner == Some(id))
                || (owner.is_none()
                    && local_side.is_some_and(|side| {
                        pos.is_some_and(|p| if side == 1 { p % 2 == 1 } else { p % 2 == 0 })
                    }));
            if !is_own && matches!(pos, Some(7 | 8 | 11 | 12 | 19 | 20 | 21 | 22)) {
                fields.retain(|key, _| {
                    ![
                        "cardsourceid",
                        "reviewsourceid",
                        "cardid",
                        "cardname",
                        "name",
                        "imageurl",
                        "imagedataurl",
                        "cardsource",
                        "cardentitygetcardsource",
                    ]
                    .contains(&key.to_ascii_lowercase().as_str())
                });
            }
            fields
                .values_mut()
                .for_each(|v| redact_hidden_entities(v, own, local_side));
        }
        _ => {}
    }
}
fn visible(card: &Value, visibility: &Value, public: &std::collections::HashSet<String>) -> bool {
    let id = card.get("id").and_then(Value::as_str).unwrap_or("");
    visibility.get(id).and_then(Value::as_str) == Some("temporarily-revealed")
        || public.contains(id)
}
fn collect_public_ids(value: &Value, output: &mut std::collections::HashSet<String>) {
    match value {
        Value::Array(values) => values.iter().for_each(|v| collect_public_ids(v, output)),
        Value::Object(fields) => {
            if let Some(id) = fields.get("id").and_then(Value::as_str) {
                output.insert(id.into());
            }
            fields.values().for_each(|v| collect_public_ids(v, output));
        }
        _ => {}
    }
}
fn public_ids(turn: &Value) -> std::collections::HashSet<String> {
    let mut output = std::collections::HashSet::new();
    if let Some(players) = turn
        .pointer("/canonical/state/players")
        .and_then(Value::as_array)
    {
        for player in players {
            for key in ["active", "bench", "discard", "lostZone"] {
                if let Some(zone) = player.get(key) {
                    collect_public_ids(zone, &mut output);
                }
            }
        }
    }
    if let Some(stadium) = turn.pointer("/canonical/state/stadium") {
        collect_public_ids(stadium, &mut output);
    }
    if let Some(players) = turn.pointer("/snapshot/players").and_then(Value::as_object) {
        for player in players.values() {
            for key in ["active", "bench", "discardCards", "lostZoneCards"] {
                if let Some(zone) = player.get(key) {
                    collect_public_ids(zone, &mut output);
                }
            }
        }
    }
    output
}
fn hidden_card(card: &Value) -> Value {
    json!({"id":card.get("id").and_then(Value::as_str).unwrap_or("hidden"), "name":"Hidden card", "cardType":"Trainer", "trainerType":"Item", "cardNumber":"", "imageUrl":"/tracker-assets/pokemon-card-back.jpg"})
}
fn redact_snapshot(
    snapshot: &mut Value,
    local: Option<&str>,
    visibility: &Value,
    public: &std::collections::HashSet<String>,
) {
    if let Some(players) = snapshot.get_mut("players").and_then(Value::as_object_mut) {
        for (name, board) in players {
            if local == Some(name.as_str()) {
                continue;
            }
            for key in ["deckCards", "prizeCards", "knownHandCards"] {
                if let Some(cards) = board.get_mut(key).and_then(Value::as_array_mut) {
                    cards.retain(|card| visible(card, visibility, public));
                }
            }
            // Names without entity IDs cannot be checked against visibility.
            if let Some(fields) = board.as_object_mut() {
                fields.insert("knownHand".into(), json!([]));
            }
        }
    }
}
fn redact_selections(
    value: &mut Value,
    visibility: &Value,
    public: &std::collections::HashSet<String>,
) {
    match value {
        Value::Array(values) => values
            .iter_mut()
            .for_each(|v| redact_selections(v, visibility, public)),
        Value::Object(fields) => {
            if let Some(cards) = fields.get_mut("optionCards").and_then(Value::as_array_mut) {
                for card in cards {
                    let explicitly_hidden = card
                        .get("id")
                        .and_then(Value::as_str)
                        .and_then(|id| visibility.get(id))
                        .and_then(Value::as_str)
                        == Some("hidden");
                    if explicitly_hidden && !visible(card, visibility, public) {
                        *card = hidden_card(card);
                    }
                }
            }
            fields
                .values_mut()
                .for_each(|v| redact_selections(v, visibility, public));
        }
        _ => {}
    }
}
fn redact_review(review: &mut Value, local: Option<&str>) {
    review["rawLog"] = Value::String(String::new());
    if let Some(turns) = review.get_mut("turns").and_then(Value::as_array_mut) {
        for turn in turns {
            let public = public_ids(turn);
            let visibility = turn
                .pointer("/canonical/visibility")
                .cloned()
                .unwrap_or(Value::Null);
            redact_selections(turn, &visibility, &public);
            let names = turn
                .pointer("/canonical/playerNames")
                .cloned()
                .unwrap_or(Value::Null);
            if let Some(players) = turn
                .pointer_mut("/canonical/state/players")
                .and_then(Value::as_array_mut)
            {
                for (index, player) in players.iter_mut().enumerate() {
                    let is_local =
                        local.is_some() && names.get(index).and_then(Value::as_str) == local;
                    for zone in ["deck", "hand", "prizes"] {
                        if let Some(cards) = player.get_mut(zone).and_then(Value::as_array_mut) {
                            for card in cards {
                                if !is_local && !visible(card, &visibility, &public) {
                                    *card = hidden_card(card);
                                }
                            }
                        }
                    }
                }
            }
            if let Some(pending) = turn
                .pointer_mut("/canonical/pendingCards")
                .and_then(Value::as_array_mut)
            {
                for (index, cards) in pending.iter_mut().enumerate() {
                    let is_local =
                        local.is_some() && names.get(index).and_then(Value::as_str) == local;
                    if !is_local {
                        if let Some(cards) = cards.as_array_mut() {
                            for card in cards {
                                if !visible(card, &visibility, &public) {
                                    *card = hidden_card(card);
                                }
                            }
                        }
                    }
                }
            }
            if let Some(snapshot) = turn.get_mut("snapshot") {
                redact_snapshot(snapshot, local, &visibility, &public);
            }
        }
    }
}

pub fn project_summary_snapshot(snapshot: &mut Value, local: Option<&str>) {
    let public = public_ids(&json!({"snapshot": snapshot}));
    redact_snapshot(snapshot, local, &Value::Null, &public);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn operation(value: Value) -> CapturedOperation {
        serde_json::from_value(json!({"receivedAt":"1", "socketHost":"offline", "globalMessageType":"GameMessage", "gameId":"test", "messageType":null, "matchId":"test", "accountId":"local", "operationId":null,"messageIndex":1,"operation":value})).unwrap()
    }
    fn start() -> CapturedOperation {
        operation(json!({"players": [
        {"playerId":"local","playerName":"You","deckInfo":{"cards":{"own_card":60}}},
        {"playerId":"other","playerName":"Opponent","deckInfo":{"cards":{"secret_card":60}}}
    ],"updatedEntities":[{"cardSourceID":"public_card"}]}))
    }
    #[test]
    fn server_start_then_local_envelope_preserves_own_hand_only() {
        let mut access = MatchAccess::default();
        let mut server = start();
        server.account_id = Some("SERVER".into());
        server.operation = json!([server.operation]);
        access.observe(&server);
        assert_eq!(access.local_account_id, None);
        let projected_start = access.project_operation(server);
        assert!(projected_start.operation.is_array());
        assert!(!projected_start.operation.to_string().contains("secret_card"));
        let raw = operation(json!({"updatedEntities":[
            {"entityID":"local-entity", "ownerPlayerId":"local", "userName":"You", "currentPos":4},
            {"entityID":"my-hand", "currentPos":12,"cardSourceID":"own_hand"},
            {"entityID":"their-hand", "currentPos":11,"cardSourceID":"secret_hand"}
        ]}));
        access.observe(&raw);
        assert_eq!(access.local_player_name.as_deref(), Some("You"));
        assert_eq!(access.local_player_side, Some(2));
        let projected = access.project_operation(raw).operation.to_string();
        assert!(projected.contains("own_hand"));
        assert!(!projected.contains("secret_hand"));
        let review = access.project_review(json!({"turns":[{"canonical":{
            "playerNames":["Opponent","You"],"state":{"players":[
                {"hand":[{"id":"a","name":"SECRET"}]},
                {"hand":[{"id":"b","name":"Own hand"}]}
            ]}}}]})).to_string();
        assert!(review.contains("Own hand"));
        assert!(!review.contains("SECRET"));
        assert!(access.opponent_deck().is_err(), "identity recovery must not unlock a live opponent list");
    }

    #[test]
    fn late_account_resolves_previously_captured_roster_without_repeating_start() {
        let mut access = MatchAccess::default();
        let mut server = start();
        server.account_id = Some("SERVER".into());
        access.observe(&server);
        access.observe(&operation(json!({"operationNumber": 2})));
        assert_eq!(access.local_player_id.as_deref(), Some("local"));
        assert_eq!(access.local_player_name.as_deref(), Some("You"));
    }

    #[test]
    fn inventory_is_hidden_until_native_result_and_never_in_normal_projection() {
        let mut access = MatchAccess::default();
        access.observe(&start());
        assert!(access.opponent_deck().is_err());
        let projected = serde_json::to_string(&access.project_operation(start())).unwrap();
        assert!(!projected.contains("secret_card"));
        assert!(projected.contains("own_card"));
        assert!(projected.contains("public_card"));
        access.observe(&operation(
            json!({"winner":1,"resultReason":"local-client-closed"}),
        ));
        assert!(access.opponent_deck().is_err());
        access.observe(&operation(
            json!({"modifications":[{"$type":"Game.EndGameModification, Game", "winner":2}]}),
        ));
        assert!(access
            .opponent_deck()
            .unwrap()
            .to_string()
            .contains("secret_card"));
        let forged = access.project_review(json!({"localPlayer":"Opponent","decklists":access.decks,"winner":"Opponent", "turns":[]}));
        assert!(!forged.to_string().contains("secret_card"));
        assert_eq!(forged["matchCompleted"], true);
    }
    #[test]
    fn unknown_identity_and_invalid_inventory_fail_closed() {
        let mut unknown = start();
        unknown.account_id = None;
        let mut access = MatchAccess::default();
        access.observe(&unknown);
        let mut result = operation(json!({"$type":"EndGameModification","winner":1}));
        result.account_id = None;
        access.observe(&result);
        assert!(access.opponent_deck().is_err());
        assert!(!access
            .project_operation(unknown)
            .operation
            .to_string()
            .contains("_card\":60"));
        assert!(captured_deck(
            &json!({"playerId":"x","playerName":"Y","deckInfo":{"cards":{"bad":59}}})
        )
        .is_none());
        assert!(!terminal(
            &json!({"$type":"EndGameModification","winner":0})
        ));
    }
    #[test]
    fn legacy_review_hides_inventory_and_hidden_zone_art_but_keeps_public_cards() {
        let mut access = MatchAccess::default();
        access.observe(&start());
        let review = json!({"localPlayer":"You", "rawLog":"secret_card", "rawPayload":{"deckInfo":{"cards":{"secret_card":60}}}, "turns":[{
            "canonical":{"playerNames":["You","Opponent"], "visibility":{"hidden":"known","private-choice":"hidden","revealed":"temporarily-revealed","public":"known"}, "selection":{"optionCards":[{"id":"private-choice","name":"SECRET"}]},
                "state":{"players":[{"deck":[{"id":"own","name":"Own card"}]},{"deck":[{"id":"hidden","name":"SECRET"},{"id":"revealed","name":"Revealed card"}],"hand":[{"id":"public","name":"Public card"}],"prizes":[{"id":"hidden","name":"SECRET"}],"discard":[{"id":"public","name":"Public card"}]}]}},
            "snapshot":{"players":{"Opponent":{"deckCards":[{"id":"hidden","name":"SECRET"}],"knownHand":["SECRET"],"knownHandCards":[{"id":"hidden","name":"SECRET"}]}}}
        }]});
        let projected = access.project_review(review).to_string();
        assert!(!projected.contains("SECRET"));
        assert!(!projected.contains("secret_card"));
        assert!(projected.contains("Own card"));
        assert!(projected.contains("Revealed card"));
        assert!(projected.contains("Public card"));
    }
    #[test]
    fn raw_hidden_entities_are_sanitized_before_js_but_public_board_is_intact() {
        let mut access = MatchAccess::default();
        access.observe(&start());
        let raw = operation(json!({"updatedEntities":[
            {"entityID":"private","currentGamePos":8,"ownerPlayerId":"other","cardSourceID":"secret_card"},
            {"entityID":"own","currentGamePos":7,"ownerPlayerId":"local","cardSourceID":"own_card"},
            {"entityID":"shown","currentGamePos":14,"ownerPlayerId":"other","cardSourceID":"public_card"}
        ], "decodedMessage":"secret_card"}));
        let projected = access.project_operation(raw).operation.to_string();
        assert!(!projected.contains("secret_card"));
        assert!(projected.contains("own_card"));
        assert!(projected.contains("public_card"));
    }
}
