use crate::{cards::CardInfo, wire::CapturedOperation};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

const SCHEMA_VERSION: i64 = 2;

#[derive(Clone, Debug)]
pub struct PendingCloudReview {
    pub match_id: String,
    pub reducer_version: i64,
    pub generation: i64,
    pub attempt_count: i64,
    pub review: Value,
}

#[derive(Clone)]
pub struct MatchStorage {
    database_path: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    pub raw_operations: i64,
    pub raw_matches: i64,
    pub derived_matches: i64,
    pub pending_matches: i64,
    pub archived_matches: i64,
    pub imported_legacy_operations: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchSummary {
    pub id: String,
    pub imported_at: String,
    pub source: String,
    pub local_player: String,
    pub opponent: String,
    pub winner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_rating: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opponent_rating: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating_change: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating_after: Option<i64>,
    pub turn_count: usize,
    pub operation_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<u64>,
    pub reducer_version: i64,
    pub final_snapshot: Option<Value>,
    #[serde(default)]
    pub recording: bool,
}

fn capture_elapsed_seconds(
    first_received: &str,
    last_received: &str,
    operation_count: i64,
) -> Option<u64> {
    if operation_count < 2 {
        return None;
    }
    let first = first_received.trim_end_matches('Z').parse::<f64>().ok()?;
    let last = last_received.trim_end_matches('Z').parse::<f64>().ok()?;
    let elapsed = last - first;
    (elapsed.is_finite() && elapsed >= 0.0).then(|| elapsed.round() as u64)
}

fn competitive_rating_result(
    local_rating: i64,
    opponent_rating: i64,
    local_won: bool,
) -> (i64, i64) {
    let expected_score = 1.0 / (1.0 + 10_f64.powf((opponent_rating - local_rating) as f64 / 400.0));
    let actual_score = if local_won { 1.0 } else { 0.0 };
    let change = (25.0 * (actual_score - expected_score)).floor() as i64;
    (change, local_rating + change)
}

fn gzip(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder
        .write_all(bytes)
        .map_err(|error| error.to_string())?;
    encoder.finish().map_err(|error| error.to_string())
}

fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut output = Vec::new();
    decoder
        .read_to_end(&mut output)
        .map_err(|error| error.to_string())?;
    Ok(output)
}

fn operation_match_id(operation: &CapturedOperation) -> String {
    format!(
        "live-{}",
        operation.match_id.as_deref().unwrap_or(&operation.game_id)
    )
}

fn operation_fingerprint(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

impl MatchStorage {
    pub fn new(database_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let storage = Self { database_path };
        storage.initialize_schema()?;
        Ok(storage)
    }

    fn connection(&self) -> Result<Connection, String> {
        let connection =
            Connection::open(&self.database_path).map_err(|error| error.to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
            )
            .map_err(|error| error.to_string())?;
        Ok(connection)
    }

    fn initialize_schema(&self) -> Result<(), String> {
        let connection = self.connection()?;
        connection
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS matches (
                    id TEXT PRIMARY KEY,
                    first_received TEXT NOT NULL,
                    last_received TEXT NOT NULL,
                    imported_at TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'live-network',
                    operation_count INTEGER NOT NULL DEFAULT 0,
                    reducer_version INTEGER NOT NULL DEFAULT 0,
                    summary_json TEXT,
                    review_gzip BLOB
                );
                CREATE TABLE IF NOT EXISTS operations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    match_id TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    message_index INTEGER,
                    operation_id TEXT,
                    fingerprint TEXT NOT NULL UNIQUE,
                    payload_gzip BLOB NOT NULL,
                    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS operations_match_order
                    ON operations(match_id, id);
                CREATE INDEX IF NOT EXISTS matches_recent
                    ON matches(imported_at DESC, last_received DESC);
                CREATE TABLE IF NOT EXISTS cards (
                    id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS cloud_sync_outbox (
                    match_id TEXT PRIMARY KEY,
                    reducer_version INTEGER NOT NULL,
                    generation INTEGER NOT NULL DEFAULT 1,
                    queued_at INTEGER NOT NULL,
                    next_attempt_at INTEGER NOT NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS cloud_sync_receipts (
                    match_id TEXT PRIMARY KEY,
                    reducer_version INTEGER NOT NULL,
                    synced_at INTEGER NOT NULL,
                    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS cloud_sync_outbox_due
                    ON cloud_sync_outbox(next_attempt_at, queued_at);
                INSERT OR IGNORE INTO matches(
                    id, first_received, last_received, imported_at, source, operation_count,
                    reducer_version, summary_json, review_gzip
                )
                SELECT
                    'live-' || id, first_received, last_received, imported_at, source, operation_count,
                    reducer_version, summary_json, review_gzip
                FROM matches
                WHERE operation_count > 0 AND id NOT LIKE 'live-%';
                UPDATE operations
                SET match_id='live-' || match_id
                WHERE match_id NOT LIKE 'live-%';
                DELETE FROM matches
                WHERE operation_count > 0 AND id NOT LIKE 'live-%';
                INSERT OR IGNORE INTO cloud_sync_outbox(
                    match_id, reducer_version, generation, queued_at,
                    next_attempt_at, attempt_count, last_error
                )
                SELECT
                    matches.id, matches.reducer_version, 1, unixepoch(), unixepoch(), 0, NULL
                FROM matches
                LEFT JOIN cloud_sync_receipts
                    ON cloud_sync_receipts.match_id = matches.id
                WHERE matches.review_gzip IS NOT NULL
                  AND (
                    cloud_sync_receipts.match_id IS NULL
                    OR cloud_sync_receipts.reducer_version < matches.reducer_version
                  );
                ",
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO metadata(key, value) VALUES('schema_version', ?1)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [SCHEMA_VERSION.to_string()],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn insert_operation(
        connection: &Connection,
        operation: &CapturedOperation,
    ) -> Result<bool, String> {
        let payload = serde_json::to_vec(operation).map_err(|error| error.to_string())?;
        let fingerprint = operation_fingerprint(&payload);
        let match_id = operation_match_id(operation);
        connection
            .execute(
                "INSERT OR IGNORE INTO matches(
                    id, first_received, last_received, imported_at, source, operation_count
                 ) VALUES(?1, ?2, ?2, ?2, 'live-network', 0)",
                params![&match_id, operation.received_at],
            )
            .map_err(|error| error.to_string())?;
        let inserted = connection
            .execute(
                "INSERT OR IGNORE INTO operations(
                    match_id, received_at, message_index, operation_id, fingerprint, payload_gzip
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    &match_id,
                    operation.received_at,
                    operation.message_index,
                    operation.operation_id,
                    fingerprint,
                    gzip(&payload)?,
                ],
            )
            .map_err(|error| error.to_string())?
            > 0;
        if inserted {
            connection
                .execute(
                    "UPDATE matches
                     SET last_received=?2, operation_count=operation_count + 1
                     WHERE id=?1",
                    params![&match_id, operation.received_at],
                )
                .map_err(|error| error.to_string())?;
        }
        Ok(inserted)
    }

    pub fn record_operation(&self, operation: &CapturedOperation) -> Result<bool, String> {
        Self::insert_operation(&self.connection()?, operation)
    }

    pub fn import_legacy_jsonl(&self, path: &Path) -> Result<i64, String> {
        let mut connection = self.connection()?;
        let Some(file_length) = fs::metadata(path).ok().map(|metadata| metadata.len()) else {
            return Ok(0);
        };
        let saved_offset = connection
            .query_row(
                "SELECT value FROM metadata WHERE key='legacy_jsonl_offset'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|offset| *offset <= file_length)
            .unwrap_or(0);
        let mut file = File::open(path).map_err(|error| error.to_string())?;
        file.seek(SeekFrom::Start(saved_offset))
            .map_err(|error| error.to_string())?;
        let mut reader = BufReader::new(file);
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let mut imported = 0i64;
        let mut offset = saved_offset;
        let mut line = String::new();
        loop {
            line.clear();
            let read = reader
                .read_line(&mut line)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            offset += read as u64;
            if let Ok(operation) = serde_json::from_str::<CapturedOperation>(line.trim_end()) {
                if Self::insert_operation(&transaction, &operation)? {
                    imported += 1;
                }
            }
        }
        transaction
            .execute(
                "INSERT INTO metadata(key, value) VALUES('legacy_jsonl_offset', ?1)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [offset.to_string()],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(imported)
    }

    pub fn status(&self, imported_legacy_operations: i64) -> Result<StorageStatus, String> {
        let connection = self.connection()?;
        let raw_operations = connection
            .query_row("SELECT COUNT(*) FROM operations", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        let raw_matches = connection
            .query_row(
                "SELECT COUNT(*) FROM matches WHERE operation_count > 0",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let derived_matches = connection
            .query_row(
                "SELECT COUNT(*) FROM matches WHERE review_gzip IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let pending_matches = connection
            .query_row(
                "SELECT COUNT(*) FROM matches WHERE operation_count > 0 AND review_gzip IS NULL",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let archived_matches = connection
            .query_row(
                "SELECT COUNT(*) FROM matches WHERE operation_count > 0 OR summary_json IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        Ok(StorageStatus {
            raw_operations,
            raw_matches,
            derived_matches,
            pending_matches,
            archived_matches,
            imported_legacy_operations,
        })
    }

    pub fn persist_review(
        &self,
        review: &Value,
        reducer_version: i64,
    ) -> Result<MatchSummary, String> {
        let id = review
            .get("id")
            .and_then(Value::as_str)
            .ok_or("review is missing id")?
            .to_owned();
        let imported_at = review
            .get("importedAt")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let source = review
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("live-network")
            .to_owned();
        let local_player = review
            .get("localPlayer")
            .and_then(Value::as_str)
            .unwrap_or("You")
            .to_owned();
        let opponent = review
            .get("opponent")
            .and_then(Value::as_str)
            .unwrap_or("Opponent")
            .to_owned();
        let winner = review
            .get("winner")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let local_rating = review.get("localRating").and_then(Value::as_i64);
        let opponent_rating = review.get("opponentRating").and_then(Value::as_i64);
        let rating_result = winner.as_ref().and_then(|winner| {
            Some(competitive_rating_result(
                local_rating?,
                opponent_rating?,
                winner == &local_player,
            ))
        });
        let turns = review.get("turns").and_then(Value::as_array);
        let turn_count = turns.map_or(0, Vec::len);
        let final_snapshot = turns.and_then(|values| {
            values
                .iter()
                .rev()
                .find_map(|turn| turn.get("snapshot").cloned())
        });
        let mut connection = self.connection()?;
        let timing = connection
            .query_row(
                "SELECT operation_count, first_received, last_received FROM matches WHERE id=?1",
                [&id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or_else(|| (0, imported_at.clone(), imported_at.clone()));
        let operation_count = timing.0;
        let recording = source == "live-network" && winner.is_none();
        let summary = MatchSummary {
            id: id.clone(),
            imported_at: imported_at.clone(),
            source: source.clone(),
            local_player,
            opponent,
            winner,
            local_rating,
            opponent_rating,
            rating_change: rating_result.map(|result| result.0),
            rating_after: rating_result.map(|result| result.1),
            turn_count,
            operation_count,
            duration_seconds: capture_elapsed_seconds(&timing.1, &timing.2, operation_count),
            reducer_version,
            final_snapshot,
            recording,
        };
        let summary_json = serde_json::to_string(&summary).map_err(|error| error.to_string())?;
        let review_json = serde_json::to_vec(review).map_err(|error| error.to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO matches(
                    id, first_received, last_received, imported_at, source,
                    operation_count, reducer_version, summary_json, review_gzip
                 ) VALUES(?1, ?2, ?2, ?2, ?3, 0, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    imported_at=excluded.imported_at,
                    source=excluded.source,
                    reducer_version=excluded.reducer_version,
                    summary_json=excluded.summary_json,
                    review_gzip=excluded.review_gzip",
                params![
                    id,
                    imported_at,
                    source,
                    reducer_version,
                    summary_json,
                    gzip(&review_json)?
                ],
            )
            .map_err(|error| error.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |duration| duration.as_secs() as i64);
        // Live reviews are rewritten as operations arrive. Delay unfinished
        // reviews briefly so a normal match generally produces one cloud
        // object, while still leaving a durable obligation if Trace exits.
        let next_attempt_at = now + if summary.recording { 30 } else { 0 };
        transaction
            .execute(
                "INSERT INTO cloud_sync_outbox(
                    match_id, reducer_version, generation, queued_at,
                    next_attempt_at, attempt_count, last_error
                 ) VALUES(?1, ?2, 1, ?3, ?4, 0, NULL)
                 ON CONFLICT(match_id) DO UPDATE SET
                    reducer_version=excluded.reducer_version,
                    generation=cloud_sync_outbox.generation + 1,
                    queued_at=excluded.queued_at,
                    next_attempt_at=excluded.next_attempt_at,
                    attempt_count=0,
                    last_error=NULL",
                params![&id, reducer_version, now, next_attempt_at],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(summary)
    }

    pub fn pending_cloud_reviews(&self, limit: i64) -> Result<Vec<PendingCloudReview>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT
                    cloud_sync_outbox.match_id,
                    cloud_sync_outbox.reducer_version,
                    cloud_sync_outbox.generation,
                    cloud_sync_outbox.attempt_count,
                    matches.review_gzip
                 FROM cloud_sync_outbox
                 JOIN matches ON matches.id = cloud_sync_outbox.match_id
                 WHERE cloud_sync_outbox.next_attempt_at <= unixepoch()
                 ORDER BY cloud_sync_outbox.next_attempt_at, cloud_sync_outbox.queued_at
                 LIMIT ?1",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([limit.clamp(1, 50)], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Vec<u8>>(4)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut pending = Vec::new();
        for row in rows {
            let (match_id, reducer_version, generation, attempt_count, compressed) =
                row.map_err(|error| error.to_string())?;
            let review =
                serde_json::from_slice(&gunzip(&compressed)?).map_err(|error| error.to_string())?;
            pending.push(PendingCloudReview {
                match_id,
                reducer_version,
                generation,
                attempt_count,
                review,
            });
        }
        Ok(pending)
    }

    pub fn mark_cloud_sync_success(
        &self,
        match_id: &str,
        reducer_version: i64,
        generation: i64,
    ) -> Result<bool, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let removed = transaction
            .execute(
                "DELETE FROM cloud_sync_outbox WHERE match_id=?1 AND generation=?2",
                params![match_id, generation],
            )
            .map_err(|error| error.to_string())?
            > 0;
        if removed {
            transaction
                .execute(
                    "INSERT INTO cloud_sync_receipts(match_id, reducer_version, synced_at)
                     VALUES(?1, ?2, unixepoch())
                     ON CONFLICT(match_id) DO UPDATE SET
                        reducer_version=excluded.reducer_version,
                        synced_at=excluded.synced_at",
                    params![match_id, reducer_version],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(removed)
    }

    pub fn mark_cloud_sync_failure(
        &self,
        match_id: &str,
        generation: i64,
        attempt_count: i64,
        error: &str,
    ) -> Result<bool, String> {
        let exponent = (attempt_count + 1).clamp(0, 6) as u32;
        let retry_seconds = (15_i64.saturating_mul(2_i64.pow(exponent))).min(15 * 60);
        let concise_error = error.chars().take(500).collect::<String>();
        Ok(self
            .connection()?
            .execute(
                "UPDATE cloud_sync_outbox
                 SET attempt_count=attempt_count + 1,
                     next_attempt_at=unixepoch() + ?3,
                     last_error=?4
                 WHERE match_id=?1 AND generation=?2",
                params![match_id, generation, retry_seconds, concise_error],
            )
            .map_err(|error| error.to_string())?
            > 0)
    }

    #[cfg(test)]
    fn cloud_sync_counts(&self) -> Result<(i64, i64), String> {
        let connection = self.connection()?;
        let outbox = connection
            .query_row("SELECT COUNT(*) FROM cloud_sync_outbox", [], |row| {
                row.get(0)
            })
            .map_err(|error| error.to_string())?;
        let receipts = connection
            .query_row("SELECT COUNT(*) FROM cloud_sync_receipts", [], |row| {
                row.get(0)
            })
            .map_err(|error| error.to_string())?;
        Ok((outbox, receipts))
    }

    pub fn list_summaries(&self, offset: i64, limit: i64) -> Result<Vec<MatchSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT summary_json, id, imported_at, source, operation_count, reducer_version,
                        first_received, last_received
                 FROM matches
                 WHERE operation_count > 0 OR summary_json IS NOT NULL
                 ORDER BY imported_at DESC, last_received DESC
                 LIMIT ?1 OFFSET ?2",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![limit.clamp(1, 200), offset.max(0)], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut summaries = Vec::new();
        for row in rows {
            let (
                json,
                id,
                imported_at,
                source,
                operation_count,
                reducer_version,
                first_received,
                last_received,
            ) = row.map_err(|error| error.to_string())?;
            let parsed = json.and_then(|value| serde_json::from_str::<MatchSummary>(&value).ok());
            let mut summary = parsed.unwrap_or(MatchSummary {
                id,
                imported_at,
                source,
                local_player: "You".to_owned(),
                opponent: "Live game".to_owned(),
                winner: None,
                local_rating: None,
                opponent_rating: None,
                rating_change: None,
                rating_after: None,
                turn_count: 0,
                operation_count,
                duration_seconds: None,
                reducer_version,
                final_snapshot: None,
                recording: true,
            });
            summary.operation_count = operation_count;
            summary.duration_seconds =
                capture_elapsed_seconds(&first_received, &last_received, operation_count);
            summaries.push(summary);
        }
        Ok(summaries)
    }

    pub fn load_review(&self, id: &str) -> Result<Option<Value>, String> {
        let connection = self.connection()?;
        let bytes = connection
            .query_row("SELECT review_gzip FROM matches WHERE id=?1", [id], |row| {
                row.get::<_, Option<Vec<u8>>>(0)
            })
            .optional()
            .map_err(|error| error.to_string())?
            .flatten();
        bytes
            .map(|compressed| {
                serde_json::from_slice(&gunzip(&compressed)?).map_err(|error| error.to_string())
            })
            .transpose()
    }

    pub fn load_operations(&self, match_id: &str) -> Result<Vec<CapturedOperation>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT payload_gzip FROM operations WHERE match_id=?1 ORDER BY id")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([match_id], |row| row.get::<_, Vec<u8>>(0))
            .map_err(|error| error.to_string())?;
        let mut operations = Vec::new();
        for row in rows {
            let bytes = row.map_err(|error| error.to_string())?;
            if let Ok(operation) = serde_json::from_slice(&gunzip(&bytes)?) {
                operations.push(operation);
            }
        }
        Ok(operations)
    }

    pub fn raw_match_ids(
        &self,
        pending_only: bool,
        reducer_version: i64,
        limit: i64,
    ) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let sql = if pending_only {
            "SELECT id FROM matches
             WHERE operation_count > 0 AND (review_gzip IS NULL OR reducer_version < ?2)
             ORDER BY last_received DESC LIMIT ?1"
        } else {
            "SELECT id FROM matches WHERE operation_count > 0 AND ?2 >= 0 ORDER BY last_received DESC LIMIT ?1"
        };
        let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![limit.clamp(1, 5_000), reducer_version], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn load_cards(&self, ids: &[String]) -> Result<Vec<CardInfo>, String> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT payload_json FROM cards WHERE id=?1")
            .map_err(|error| error.to_string())?;
        let mut cards = Vec::new();
        for id in ids {
            let payload = statement
                .query_row([id], |row| row.get::<_, String>(0))
                .optional()
                .map_err(|error| error.to_string())?;
            if let Some(payload) = payload {
                if let Ok(card) = serde_json::from_str(&payload) {
                    cards.push(card);
                }
            }
        }
        Ok(cards)
    }

    pub fn save_cards(&self, cards: &[CardInfo]) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for card in cards {
            transaction
                .execute(
                    "INSERT INTO cards(id, payload_json, updated_at)
                     VALUES(?1, ?2, CURRENT_TIMESTAMP)
                     ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=CURRENT_TIMESTAMP",
                    params![card.id, serde_json::to_string(card).map_err(|error| error.to_string())?],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temporary_storage() -> (PathBuf, MatchStorage) {
        let directory = std::env::temp_dir().join(format!(
            "trace-storage-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).unwrap();
        let storage = MatchStorage::new(directory.join("trace.sqlite3")).unwrap();
        (directory, storage)
    }

    fn operation() -> CapturedOperation {
        CapturedOperation {
            received_at: "1787301501.649Z".to_owned(),
            socket_host: "local".to_owned(),
            global_message_type: "PlayerMessage".to_owned(),
            game_id: "game-1".to_owned(),
            message_type: json!(1),
            match_id: Some("match-1".to_owned()),
            account_id: Some("local".to_owned()),
            operation_id: Some("operation-1".to_owned()),
            message_index: Some(7),
            operation: json!({"operationNumber": 7}),
        }
    }

    #[test]
    fn calculates_tcg_live_competitive_elo_changes() {
        assert_eq!(competitive_rating_result(1753, 1755, false), (-13, 1740));
        assert_eq!(competitive_rating_result(1684, 1770, true), (15, 1699));
        assert_eq!(competitive_rating_result(1736, 1716, false), (-14, 1722));
    }

    #[test]
    fn deduplicates_raw_operations_and_round_trips_reviews() {
        let (directory, storage) = temporary_storage();
        let captured = operation();
        assert!(storage.record_operation(&captured).unwrap());
        assert!(!storage.record_operation(&captured).unwrap());
        let mut later = operation();
        later.received_at = "1787301596.649Z".to_owned();
        later.operation_id = Some("operation-2".to_owned());
        later.message_index = Some(8);
        later.operation = json!({"operationNumber": 8});
        assert!(storage.record_operation(&later).unwrap());
        assert_eq!(storage.status(0).unwrap().raw_operations, 2);
        assert_eq!(
            storage.raw_match_ids(false, 0, 10).unwrap(),
            vec!["live-match-1"]
        );
        assert_eq!(storage.load_operations("live-match-1").unwrap().len(), 2);
        assert_eq!(storage.load_review("live-match-1").unwrap(), None);
        let recording = storage.list_summaries(0, 50).unwrap();
        assert_eq!(recording.len(), 1);
        assert_eq!(recording[0].id, "live-match-1");
        assert_eq!(recording[0].opponent, "Live game");
        assert!(recording[0].recording);
        assert_eq!(storage.status(0).unwrap().archived_matches, 1);

        let review = json!({
            "id": "live-match-1",
            "importedAt": "2026-08-21T08:38:21.649Z",
            "source": "live-network",
            "players": ["You", "Opponent"],
            "localPlayer": "You",
            "opponent": "Opponent",
            "turns": [{"index": 0, "label": "Capture baseline", "events": [], "snapshot": {"players": {}, "stadium": null}}],
            "rawLog": ""
        });
        let summary = storage.persist_review(&review, 1).unwrap();
        assert_eq!(summary.operation_count, 2);
        assert_eq!(summary.duration_seconds, Some(95));
        assert!(summary.recording);
        let summaries = storage.list_summaries(0, 50).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].duration_seconds, Some(95));
        assert_eq!(storage.load_review("live-match-1").unwrap(), Some(review));
        assert_eq!(storage.status(0).unwrap().pending_matches, 0);
        assert_eq!(storage.cloud_sync_counts().unwrap(), (1, 0));
        assert!(storage.raw_match_ids(true, 1, 10).unwrap().is_empty());
        assert_eq!(
            storage.raw_match_ids(true, 2, 10).unwrap(),
            vec!["live-match-1"]
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn cloud_outbox_retries_without_losing_newer_revisions() {
        let (directory, storage) = temporary_storage();
        let review = json!({
            "id": "completed-match",
            "importedAt": "2026-09-04T10:00:00Z",
            "source": "live-network",
            "localPlayer": "Local",
            "opponent": "Opponent",
            "winner": "Local",
            "turns": [{"index": 0, "events": [], "snapshot": {"players": {}}}]
        });

        storage.persist_review(&review, 3).unwrap();
        let first = storage.pending_cloud_reviews(10).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].generation, 1);

        let mut revised = review.clone();
        revised["turns"] = json!([
            {"index": 0, "events": [], "snapshot": {"players": {}}},
            {"index": 1, "events": [{"kind": "game"}], "snapshot": {"players": {}}}
        ]);
        storage.persist_review(&revised, 3).unwrap();
        assert!(!storage
            .mark_cloud_sync_success("completed-match", 3, first[0].generation)
            .unwrap());

        let second = storage.pending_cloud_reviews(10).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].generation, 2);
        assert!(storage
            .mark_cloud_sync_failure(
                "completed-match",
                second[0].generation,
                second[0].attempt_count,
                "offline",
            )
            .unwrap());
        assert!(storage.pending_cloud_reviews(10).unwrap().is_empty());

        storage
            .connection()
            .unwrap()
            .execute(
                "UPDATE cloud_sync_outbox SET next_attempt_at=0 WHERE match_id='completed-match'",
                [],
            )
            .unwrap();
        let retry = storage.pending_cloud_reviews(10).unwrap();
        assert_eq!(retry[0].attempt_count, 1);
        assert!(storage
            .mark_cloud_sync_success("completed-match", 3, retry[0].generation)
            .unwrap());
        assert_eq!(storage.cloud_sync_counts().unwrap(), (0, 1));

        let reopened = MatchStorage::new(directory.join("trace.sqlite3")).unwrap();
        assert_eq!(reopened.cloud_sync_counts().unwrap(), (0, 1));
        reopened.persist_review(&revised, 4).unwrap();
        assert_eq!(reopened.cloud_sync_counts().unwrap(), (1, 1));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn migrates_existing_reviews_into_the_cloud_outbox() {
        let directory = std::env::temp_dir().join(format!(
            "trace-storage-v1-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).unwrap();
        let database_path = directory.join("trace.sqlite3");
        let review = json!({
            "id": "archived-match",
            "importedAt": "2026-09-03T10:00:00Z",
            "source": "live-network",
            "localPlayer": "Local",
            "opponent": "Opponent",
            "winner": "Local",
            "turns": []
        });
        let connection = Connection::open(&database_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 CREATE TABLE matches (
                    id TEXT PRIMARY KEY,
                    first_received TEXT NOT NULL,
                    last_received TEXT NOT NULL,
                    imported_at TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'live-network',
                    operation_count INTEGER NOT NULL DEFAULT 0,
                    reducer_version INTEGER NOT NULL DEFAULT 0,
                    summary_json TEXT,
                    review_gzip BLOB
                 );
                 CREATE TABLE operations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    match_id TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    message_index INTEGER,
                    operation_id TEXT,
                    fingerprint TEXT NOT NULL UNIQUE,
                    payload_gzip BLOB NOT NULL,
                    FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
                 );
                 CREATE TABLE cards (
                    id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO metadata(key, value) VALUES('schema_version', '1');",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO matches(
                    id, first_received, last_received, imported_at, source,
                    operation_count, reducer_version, summary_json, review_gzip
                 ) VALUES(?1, ?2, ?2, ?2, 'live-network', 0, 11, NULL, ?3)",
                params![
                    "archived-match",
                    "2026-09-03T10:00:00Z",
                    gzip(&serde_json::to_vec(&review).unwrap()).unwrap()
                ],
            )
            .unwrap();
        drop(connection);

        let storage = MatchStorage::new(database_path).unwrap();
        assert_eq!(storage.load_review("archived-match").unwrap(), Some(review));
        let queued = storage.pending_cloud_reviews(10).unwrap();
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].match_id, "archived-match");
        assert_eq!(queued[0].reducer_version, 11);
        assert_eq!(storage.cloud_sync_counts().unwrap(), (1, 0));

        fs::remove_dir_all(directory).unwrap();
    }
}
