use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone)]
pub struct CloudSync {
    endpoint: Option<Url>,
    config_path: PathBuf,
    client: Client,
    config: Arc<Mutex<CloudSyncConfig>>,
    last_error: Arc<Mutex<Option<String>>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudSyncConfig {
    device_id: String,
    token: Option<String>,
    enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncStatus {
    pub configured: bool,
    pub enabled: bool,
    pub device_id: String,
    pub last_error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registration {
    token: String,
}

impl CloudSync {
    pub fn new(config_path: PathBuf) -> Result<Self, String> {
        let endpoint = std::env::var("TRACE_SYNC_API_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| option_env!("TRACE_SYNC_API_URL").map(str::to_owned))
            .and_then(|value| Url::parse(value.trim_end_matches('/')).ok());
        let config = fs::read(&config_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CloudSyncConfig>(&bytes).ok())
            .unwrap_or_else(|| CloudSyncConfig {
                device_id: Uuid::new_v4().to_string(),
                token: None,
                enabled: false,
            });
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("Trace/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| error.to_string())?;
        let sync = Self {
            endpoint,
            config_path,
            client,
            config: Arc::new(Mutex::new(config)),
            last_error: Arc::new(Mutex::new(None)),
        };
        sync.save_config_blocking()?;
        Ok(sync)
    }

    pub async fn status(&self) -> CloudSyncStatus {
        let config = self.config.lock().await.clone();
        CloudSyncStatus {
            configured: self.endpoint.is_some(),
            enabled: config.enabled,
            device_id: config.device_id,
            last_error: self.last_error.lock().await.clone(),
        }
    }

    pub async fn set_enabled(&self, enabled: bool) -> Result<CloudSyncStatus, String> {
        if enabled && self.endpoint.is_none() {
            return Err("Cloud backup is not configured in this Trace build.".into());
        }

        if enabled {
            self.ensure_registration().await?;
        }
        {
            let mut config = self.config.lock().await;
            config.enabled = enabled;
        }
        self.save_config().await?;
        *self.last_error.lock().await = None;
        Ok(self.status().await)
    }

    pub async fn sync_review(&self, review: Value, reducer_version: i64) {
        if !self.config.lock().await.enabled {
            return;
        }
        let result = self.put_review(review, reducer_version, true).await;
        *self.last_error.lock().await = result.err();
    }

    async fn put_review(
        &self,
        review: Value,
        reducer_version: i64,
        retry_auth: bool,
    ) -> Result<(), String> {
        let match_id = review
            .get("id")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Cloud backup review is missing an id.".to_string())?;
        let (device_id, token) = self.ensure_registration().await?;
        let mut url = self
            .endpoint
            .clone()
            .ok_or_else(|| "Cloud backup is not configured.".to_string())?;
        url.path_segments_mut()
            .map_err(|_| "Cloud backup URL cannot accept path segments.".to_string())?
            .extend(["v1", "matches", match_id]);

        let response = self
            .client
            .put(url)
            .header("x-trace-device", &device_id)
            .bearer_auth(&token)
            .json(&json!({ "review": &review, "reducerVersion": reducer_version }))
            .send()
            .await
            .map_err(|error| format!("Cloud backup request failed: {error}"))?;

        if response.status() == StatusCode::UNAUTHORIZED && retry_auth {
            {
                let mut config = self.config.lock().await;
                config.token = None;
            }
            self.save_config().await?;
            return Box::pin(self.put_review(review, reducer_version, false)).await;
        }
        if !response.status().is_success() {
            return Err(format!("Cloud backup returned {}.", response.status()));
        }
        Ok(())
    }

    async fn ensure_registration(&self) -> Result<(String, String), String> {
        let current = self.config.lock().await.clone();
        if let Some(token) = current.token {
            return Ok((current.device_id, token));
        }

        let mut url = self
            .endpoint
            .clone()
            .ok_or_else(|| "Cloud backup is not configured.".to_string())?;
        url.path_segments_mut()
            .map_err(|_| "Cloud backup URL cannot accept path segments.".to_string())?
            .extend(["v1", "register"]);
        let response = self
            .client
            .post(url)
            .json(&json!({ "deviceId": current.device_id }))
            .send()
            .await
            .map_err(|error| format!("Cloud backup registration failed: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Cloud backup registration returned {}.",
                response.status()
            ));
        }
        let registration = response
            .json::<Registration>()
            .await
            .map_err(|error| format!("Cloud backup registration was unreadable: {error}"))?;
        if registration.token.is_empty() {
            return Err("Cloud backup registration returned an empty token.".into());
        }
        {
            let mut config = self.config.lock().await;
            config.token = Some(registration.token.clone());
        }
        self.save_config().await?;
        Ok((current.device_id, registration.token))
    }

    async fn save_config(&self) -> Result<(), String> {
        self.save_config_blocking()
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
