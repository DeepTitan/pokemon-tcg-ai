//! Experimental identities from the startup dictionary, never a counted decklist.
use crate::{deck_access::MatchAccess, wire::CapturedOperation};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

fn message_is(operation: &CapturedOperation, kind: u64) -> bool {
    operation.message_type.as_u64() == Some(kind)
        || operation.message_type.as_str() == Some(kind.to_string().as_str())
}

pub fn preview(access: &MatchAccess, operations: &[CapturedOperation]) -> Result<Value, String> {
    // Keep complete captures authoritative when the older protocol provided them.
    if let Ok(deck) = access.opponent_deck() { return Ok(deck); }
    let unavailable = "This match has no usable opponent card preview saved.";
    let local = access.local_player_id.as_deref().ok_or(unavailable)?;
    let own = access.own_decks();
    if own.len() != 1 { return Err(unavailable.into()); }
    let own_ids: HashSet<_> = own[0]["cards"].as_array().ok_or(unavailable)?.iter()
        .filter_map(|entry| entry["cardId"].as_str()).map(str::to_ascii_lowercase).collect();
    if own_ids.is_empty() || own[0]["total"].as_u64() != Some(60) { return Err(unavailable.into()); }

    let players = operations.iter().filter(|op| message_is(op, 9))
        .find_map(|op| op.operation.get("players").and_then(Value::as_array)).ok_or(unavailable)?;
    if players.len() != 2 || players.iter().filter(|p| p["playerId"].as_str() == Some(local)).count() != 1 {
        return Err(unavailable.into());
    }
    let opponent = players.iter().find(|p| p["playerId"].as_str() != Some(local)).ok_or(unavailable)?;
    let opponent_id = opponent["playerId"].as_str().filter(|id| !id.is_empty()).ok_or(unavailable)?;
    let opponent_name = opponent["playerName"].as_str().filter(|name| !name.is_empty()).ok_or(unavailable)?;
    let definitions = operations.iter().filter(|op| message_is(op, 7))
        .find_map(|op| op.operation.as_array()).ok_or(unavailable)?;
    // Two 60-card decks can have at most 120 distinct printing definitions.
    if definitions.is_empty() || definitions.len() > 120 { return Err(unavailable.into()); }
    let mut cards = BTreeMap::new();
    for definition in definitions {
        let id = definition["cardSourceID"].as_str().filter(|id| !id.is_empty() && id.len() <= 100
            && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')).ok_or(unavailable)?;
        let name = definition["cardName"].as_str().filter(|name| !name.is_empty() && name.len() <= 200).ok_or(unavailable)?;
        cards.insert(id.to_ascii_lowercase(), name);
    }
    if !own_ids.iter().all(|id| cards.contains_key(id)) { return Err(unavailable.into()); }
    let cards: Vec<_> = cards.into_iter().filter(|(id, _)| !own_ids.contains(id))
        .map(|(id, name)| json!({"cardId": id, "name": name})).collect();
    if cards.is_empty() || cards.len() > 60 { return Err(unavailable.into()); }
    Ok(json!({"source": "startup-card-pool", "playerId": opponent_id,
        "playerName": opponent_name, "cards": cards}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn operation(kind: u64, value: Value) -> CapturedOperation {
        serde_json::from_value(json!({"receivedAt":"1Z","socketHost":"local","globalMessageType":"GameMessage",
            "gameId":"game","messageType":kind,"matchId":"match","accountId":"local","operation":value})).unwrap()
    }
    fn fixture() -> (MatchAccess, Vec<CapturedOperation>) {
        let roster = operation(9, json!({"players":[
            {"playerId":"local","playerName":"You","deckInfo":{"cards":{"sv1_1":60}}},
            {"playerId":"other","playerName":"Opponent","deckInfo":{}}]}));
        let definitions = operation(7, json!([
            {"cardSourceID":"SV1_1","cardName":"Shared or own"},
            {"cardSourceID":"sv1_2","cardName":"Possible opponent"}]));
        let mut access = MatchAccess::default();
        access.observe(&roster);
        (access, vec![definitions, roster])
    }
    #[test]
    fn startup_pool_excludes_own_printings_without_inventing_quantities() {
        let (access, ops) = fixture();
        let result = preview(&access, &ops).unwrap();
        assert_eq!(result["source"], "startup-card-pool");
        assert_eq!(result["cards"], json!([{"cardId":"sv1_2","name":"Possible opponent"}]));
        assert!(result.get("total").is_none());
        assert!(result["cards"][0].get("count").is_none());
    }
    #[test]
    fn missing_identity_partial_dictionary_or_nonstartup_definitions_fail_closed() {
        let (mut access, mut ops) = fixture();
        access.local_player_id = None;
        assert!(preview(&access, &ops).is_err());
        let (access, _) = fixture();
        ops[0].operation.as_array_mut().unwrap().remove(0);
        assert!(preview(&access, &ops).is_err());
        let (_, mut ops) = fixture();
        ops[0].message_type = json!(8);
        assert!(preview(&access, &ops).is_err());
        assert!(preview(&access, &[]).is_err());
    }
    #[test]
    fn complete_capture_takes_precedence() {
        let (mut access, ops) = fixture();
        access.observe(&operation(9, json!({"players":[{"playerId":"other","playerName":"Opponent",
            "deckInfo":{"cards":{"sv1_2":60}}}]})));
        assert_eq!(preview(&access, &ops).unwrap()["source"], "match-start");
    }

    #[test]
    #[ignore = "Requires an operator-supplied private capture fixture; never bundled"]
    fn audit_recent_captures() {
        let path = std::env::var("TRACE_CARD_POOL_FIXTURE").expect("fixture path required");
        let matches: Vec<Vec<CapturedOperation>> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert!(!matches.is_empty());
        for operations in &matches {
            let mut access = MatchAccess::default();
            for operation in operations { access.observe(operation); }
            let result = preview(&access, operations).unwrap();
            assert_eq!(result["source"], "startup-card-pool");
            assert!(result.get("total").is_none());
            assert!(result["cards"].as_array().unwrap().iter().all(|card| card.get("count").is_none()));
        }
        println!("Validated inferred previews for {} recent captures", matches.len());
    }
}
