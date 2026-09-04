use crate::storage::{MatchStorage, PendingCloudReview};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Mutex;
use uuid::Uuid;

const MAX_REVIEWS_PER_SWEEP: usize = 16;

#[derive(Clone)]
pub struct CloudSync {
    endpoint: Option<Url>,
    config_path: PathBuf,
    client: Client,
    config: Arc<Mutex<CloudSyncConfig>>,
    sweep_lock: Arc<Mutex<()>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudSyncConfig {
    device_id: String,
    token: Option<String>,
}

#[derive(Deserialize)]
struct Registration {
    token: String,
}

#[derive(Debug)]
struct SyncFailure {
    message: String,
    stop_sweep: bool,
}

impl SyncFailure {
    fn global(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            stop_sweep: true,
        }
    }

    fn item(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            stop_sweep: false,
        }
    }
}

impl CloudSync {
    pub fn new(config_path: PathBuf) -> Self {
        let endpoint = std::env::var("TRACE_SYNC_API_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| option_env!("TRACE_SYNC_API_URL").map(str::to_owned))
            .and_then(|value| Url::parse(value.trim_end_matches('/')).ok());
        // Older releases also stored an `enabled` field. Serde intentionally
        // ignores it: backup is part of capture now, not a user preference.
        let config = fs::read(&config_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CloudSyncConfig>(&bytes).ok())
            .filter(|config| !config.device_id.trim().is_empty())
            .unwrap_or_else(|| CloudSyncConfig {
                device_id: Uuid::new_v4().to_string(),
                token: None,
            });
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("Trace/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_else(|_| Client::new());
        let sync = Self {
            endpoint,
            config_path,
            client,
            config: Arc::new(Mutex::new(config)),
            sweep_lock: Arc::new(Mutex::new(())),
        };
        // Cloud configuration must never prevent the local archive from
        // opening. A failed write simply means registration will retry later.
        let _ = sync.save_config_blocking();
        sync
    }

    pub async fn sync_pending(&self, storage: MatchStorage) {
        if self.endpoint.is_none() {
            return;
        }
        let Ok(_guard) = self.sweep_lock.try_lock() else {
            return;
        };

        for _ in 0..MAX_REVIEWS_PER_SWEEP {
            let pending = match storage.pending_cloud_reviews(1) {
                Ok(mut values) => values.pop(),
                Err(_) => return,
            };
            let Some(pending) = pending else {
                return;
            };

            match self.put_review(&pending).await {
                Ok(()) => {
                    let _ = storage.mark_cloud_sync_success(
                        &pending.match_id,
                        pending.reducer_version,
                        pending.generation,
                    );
                }
                Err(failure) => {
                    let _ = storage.mark_cloud_sync_failure(
                        &pending.match_id,
                        pending.generation,
                        pending.attempt_count,
                        &failure.message,
                    );
                    if failure.stop_sweep {
                        return;
                    }
                }
            }
        }
    }

    async fn put_review(&self, pending: &PendingCloudReview) -> Result<(), SyncFailure> {
        let review_id = pending
            .review
            .get("id")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| SyncFailure::item("Cloud backup review is missing an id."))?;
        if review_id != pending.match_id {
            return Err(SyncFailure::item(
                "Cloud backup review id does not match its outbox id.",
            ));
        }

        let mut retried_auth = false;
        loop {
            let (device_id, token) = self.ensure_registration().await?;
            let mut url = self
                .endpoint
                .clone()
                .ok_or_else(|| SyncFailure::global("Cloud backup is not configured."))?;
            url.path_segments_mut()
                .map_err(|_| SyncFailure::global("Cloud backup URL cannot accept path segments."))?
                .extend(["v1", "matches", pending.match_id.as_str()]);

            let response = self
                .client
                .put(url)
                .header("x-trace-device", &device_id)
                .bearer_auth(&token)
                .json(&json!({
                    "review": &pending.review,
                    "reducerVersion": pending.reducer_version,
                }))
                .send()
                .await
                .map_err(|error| {
                    SyncFailure::global(format!("Cloud backup request failed: {error}"))
                })?;

            if response.status() == StatusCode::UNAUTHORIZED && !retried_auth {
                {
                    let mut config = self.config.lock().await;
                    config.token = None;
                }
                let _ = self.save_config_blocking();
                retried_auth = true;
                continue;
            }
            if !response.status().is_success() {
                let status = response.status();
                let message = format!("Cloud backup returned {status}.");
                return Err(
                    if status == StatusCode::BAD_REQUEST || status == StatusCode::PAYLOAD_TOO_LARGE
                    {
                        SyncFailure::item(message)
                    } else {
                        SyncFailure::global(message)
                    },
                );
            }
            return Ok(());
        }
    }

    async fn ensure_registration(&self) -> Result<(String, String), SyncFailure> {
        let current = self.config.lock().await.clone();
        if let Some(token) = current.token {
            return Ok((current.device_id, token));
        }

        let mut url = self
            .endpoint
            .clone()
            .ok_or_else(|| SyncFailure::global("Cloud backup is not configured."))?;
        url.path_segments_mut()
            .map_err(|_| SyncFailure::global("Cloud backup URL cannot accept path segments."))?
            .extend(["v1", "register"]);
        let response = self
            .client
            .post(url)
            .json(&json!({ "deviceId": current.device_id }))
            .send()
            .await
            .map_err(|error| {
                SyncFailure::global(format!("Cloud backup registration failed: {error}"))
            })?;
        if !response.status().is_success() {
            return Err(SyncFailure::global(format!(
                "Cloud backup registration returned {}.",
                response.status()
            )));
        }
        let registration = response.json::<Registration>().await.map_err(|error| {
            SyncFailure::global(format!("Cloud backup registration was unreadable: {error}"))
        })?;
        if registration.token.is_empty() {
            return Err(SyncFailure::global(
                "Cloud backup registration returned an empty token.",
            ));
        }
        {
            let mut config = self.config.lock().await;
            config.token = Some(registration.token.clone());
        }
        // The current process can still upload if this persistence attempt
        // fails. A later launch will register again and drain the same outbox.
        let _ = self.save_config_blocking();
        Ok((current.device_id, registration.token))
    }

    fn save_config_blocking(&self) -> Result<(), String> {
        let config = self
            .config
            .try_lock()
            .map_err(|_| "Cloud backup settings are busy.".to_string())?
            .clone();
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let temporary = self.config_path.with_extension("json.tmp");
        fs::write(
            &temporary,
            serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
        fs::rename(temporary, &self.config_path).map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_disabled_config_is_migrated_without_an_opt_out() {
        let directory = std::env::temp_dir().join(format!(
            "trace-cloud-config-test-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).unwrap();
        let config_path = directory.join("cloud-sync.json");
        fs::write(
            &config_path,
            br#"{"deviceId":"existing-device","token":"existing-token","enabled":false}"#,
        )
        .unwrap();

        let sync = CloudSync::new(config_path.clone());
        let config = sync.config.try_lock().unwrap().clone();
        assert_eq!(config.device_id, "existing-device");
        assert_eq!(config.token.as_deref(), Some("existing-token"));
        let persisted = fs::read_to_string(config_path).unwrap();
        assert!(!persisted.contains("enabled"));

        fs::remove_dir_all(directory).unwrap();
    }
}
