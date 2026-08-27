use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use flate2::read::{DeflateDecoder, GzDecoder, ZlibDecoder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedOperation {
    pub received_at: String,
    pub socket_host: String,
    pub global_message_type: String,
    pub game_id: String,
    pub message_type: Value,
    pub match_id: Option<String>,
    pub account_id: Option<String>,
    pub operation_id: Option<String>,
    pub message_index: Option<i64>,
    pub operation: Value,
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    let value = bytes.get(offset..offset + 2)?;
    Some(u16::from_le_bytes(value.try_into().ok()?))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let value = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes(value.try_into().ok()?))
}

fn read_i32(bytes: &[u8], offset: usize) -> Option<i32> {
    let value = bytes.get(offset..offset + 4)?;
    Some(i32::from_le_bytes(value.try_into().ok()?))
}

fn root_table(bytes: &[u8]) -> Option<usize> {
    let table = read_u32(bytes, 0)? as usize;
    (table < bytes.len()).then_some(table)
}

fn table_field(bytes: &[u8], table: usize, field_index: usize) -> Option<usize> {
    let backwards = read_i32(bytes, table)?;
    if backwards <= 0 {
        return None;
    }
    let vtable = table.checked_sub(backwards as usize)?;
    let vtable_len = read_u16(bytes, vtable)? as usize;
    let entry = vtable.checked_add(4 + field_index.checked_mul(2)?)?;
    if entry + 2 > vtable + vtable_len {
        return None;
    }
    let field_offset = read_u16(bytes, entry)? as usize;
    (field_offset != 0).then(|| table + field_offset)
}

fn indirect_range(bytes: &[u8], field: usize) -> Option<&[u8]> {
    let relative = read_u32(bytes, field)? as usize;
    let value = field.checked_add(relative)?;
    let length = read_u32(bytes, value)? as usize;
    bytes.get(value + 4..value.checked_add(4 + length)?)
}

fn table_string(bytes: &[u8], table: usize, field_index: usize) -> Option<String> {
    let field = table_field(bytes, table, field_index)?;
    String::from_utf8(indirect_range(bytes, field)?.to_vec()).ok()
}

fn table_vector(bytes: &[u8], table: usize, field_index: usize) -> Option<Vec<u8>> {
    let field = table_field(bytes, table, field_index)?;
    Some(indirect_range(bytes, field)?.to_vec())
}

struct StompMessage<'a> {
    payload_type: Option<&'a str>,
    body: &'a [u8],
}

fn stomp_message(frame: &[u8]) -> Option<StompMessage<'_>> {
    let separator = frame
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| (index, 4))
        .or_else(|| {
            frame
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|index| (index, 2))
        })?;
    let header = std::str::from_utf8(&frame[..separator.0]).ok()?;
    if !header.lines().next()?.eq_ignore_ascii_case("MESSAGE") {
        return None;
    }
    let body_start = separator.0 + separator.1;
    let content_length = header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("content-length")
            .then(|| value.trim().parse::<usize>().ok())
            .flatten()
    });
    let payload_type = header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("pay").then(|| value.trim())
    });
    let body = match content_length {
        Some(length) => frame.get(body_start..body_start.checked_add(length)?),
        None => {
            let body = frame.get(body_start..)?;
            let end = body
                .iter()
                .position(|byte| *byte == 0)
                .unwrap_or(body.len());
            body.get(..end)
        }
    }?;
    Some(StompMessage { payload_type, body })
}

fn value_for<'a>(object: &'a Value, names: &[&str]) -> Option<&'a Value> {
    names.iter().find_map(|name| object.get(*name))
}

fn string_for(object: &Value, names: &[&str]) -> Option<String> {
    value_for(object, names)?.as_str().map(str::to_owned)
}

fn integer_for(object: &Value, names: &[&str]) -> Option<i64> {
    value_for(object, names)?.as_i64()
}

fn decompress(bytes: &[u8]) -> Option<Vec<u8>> {
    fn read_all(reader: impl Read) -> Option<Vec<u8>> {
        let mut output = Vec::new();
        let mut reader = reader;
        reader.read_to_end(&mut output).ok()?;
        Some(output)
    }

    read_all(GzDecoder::new(bytes))
        .or_else(|| read_all(ZlibDecoder::new(bytes)))
        .or_else(|| read_all(DeflateDecoder::new(bytes)))
}

pub fn decode_websocket_message(
    websocket_data: &[u8],
    socket_host: String,
    received_at: String,
) -> Option<CapturedOperation> {
    let stomp = stomp_message(websocket_data);
    let global_bytes = stomp
        .as_ref()
        .map_or(websocket_data, |message| message.body);

    // Current production messages name the FlatBuffer payload in the STOMP
    // `pay` header. PlayerMessage is already the inner table; there is no
    // longer a GlobalMessage wrapper around it.
    if let Some(payload_type) = stomp.as_ref().and_then(|message| message.payload_type) {
        if payload_type.eq_ignore_ascii_case("PlayerMessage") {
            return decode_player_message(
                global_bytes,
                payload_type.to_owned(),
                socket_host,
                received_at,
            );
        }
    }

    // Retain compatibility with captures made using the older wrapped format.
    let global_table = root_table(global_bytes)?;
    let global_message_type = table_string(global_bytes, global_table, 0)?;
    let player_bytes = table_vector(global_bytes, global_table, 1)?;

    decode_player_message(&player_bytes, global_message_type, socket_host, received_at)
}

fn decode_player_message(
    player_bytes: &[u8],
    global_message_type: String,
    socket_host: String,
    received_at: String,
) -> Option<CapturedOperation> {
    let player_table = root_table(&player_bytes)?;
    let game_id = table_string(&player_bytes, player_table, 0)?;
    let server_message_bytes = table_vector(&player_bytes, player_table, 1)?;
    let server_message: Value = serde_json::from_slice(&server_message_bytes).ok()?;

    let compressed = value_for(&server_message, &["compressedValue", "CompressedValue"])?
        .as_str()
        .and_then(|encoded| BASE64.decode(encoded).ok())?;
    let operation_bytes = decompress(&compressed)?;
    let operation: Value = serde_json::from_slice(&operation_bytes).ok()?;

    Some(CapturedOperation {
        received_at,
        socket_host,
        global_message_type,
        game_id,
        message_type: value_for(&server_message, &["messageType", "MessageType"])
            .cloned()
            .unwrap_or(Value::Null),
        match_id: string_for(&server_message, &["matchID", "matchId", "MatchID"]),
        account_id: string_for(&server_message, &["accountID", "accountId", "AccountID"]),
        operation_id: string_for(
            &server_message,
            &["operationID", "operationId", "OperationID"],
        ),
        message_index: integer_for(&server_message, &["messageIndex", "MessageIndex"]),
        operation,
    })
}

#[cfg(test)]
mod tests {
    use super::{decode_websocket_message, decompress};
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    #[test]
    fn decodes_the_clients_gzip_payload() {
        let source = br#"{"operationStatus":0}"#;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(source).unwrap();
        let compressed = encoder.finish().unwrap();
        assert_eq!(decompress(&compressed).unwrap(), source);
    }

    #[test]
    fn decodes_current_direct_player_message_frames() {
        let operation = br#"{"operationStatus":0,"type":"test"}"#;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(operation).unwrap();
        let compressed = BASE64.encode(encoder.finish().unwrap());
        let server_message = format!(
            r#"{{"compressedValue":"{compressed}","messageIndex":33,"matchID":"match-1"}}"#
        );
        let game_id = "game-1";

        // Minimal PlayerMessage FlatBuffer matching the production table:
        // field 0 = game id string, field 1 = server-message byte vector.
        let mut body = vec![0_u8; 36];
        body[0..4].copy_from_slice(&16_u32.to_le_bytes());
        body[6..8].copy_from_slice(&10_u16.to_le_bytes());
        body[8..10].copy_from_slice(&16_u16.to_le_bytes());
        body[10..12].copy_from_slice(&12_u16.to_le_bytes());
        body[12..14].copy_from_slice(&8_u16.to_le_bytes());
        body[14..16].copy_from_slice(&4_u16.to_le_bytes());
        body[16..20].copy_from_slice(&10_i32.to_le_bytes());
        body[24..28].copy_from_slice(&12_u32.to_le_bytes());
        body.extend_from_slice(&(server_message.len() as u32).to_le_bytes());
        body.extend_from_slice(server_message.as_bytes());
        while body.len() % 4 != 0 {
            body.push(0);
        }
        let game_string = body.len();
        body[28..32].copy_from_slice(&((game_string - 28) as u32).to_le_bytes());
        body.extend_from_slice(&(game_id.len() as u32).to_le_bytes());
        body.extend_from_slice(game_id.as_bytes());
        body.push(0);

        let mut frame = format!(
            "MESSAGE\ncontent-type:application/octet-stream\ncontent-length:{}\npay:PlayerMessage\n\n",
            body.len()
        )
        .into_bytes();
        frame.extend_from_slice(&body);

        let decoded = decode_websocket_message(&frame, "example.test".into(), "now".into())
            .expect("direct PlayerMessage should decode");
        assert_eq!(decoded.global_message_type, "PlayerMessage");
        assert_eq!(decoded.game_id, game_id);
        assert_eq!(decoded.message_index, Some(33));
        assert_eq!(
            decoded.operation,
            serde_json::from_slice::<serde_json::Value>(operation).unwrap()
        );
    }
}
