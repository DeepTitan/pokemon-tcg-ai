//! Device credentials stay native. A UI flag is never authority for paid access.
use crate::cloud_sync::CloudSync;
use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const LEASE: Duration = Duration::from_secs(60);
pub const RECENT_REPLAY_SECONDS: i64 = 7 * 24 * 60 * 60;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Capabilities {
    pub record_matches: bool,
    pub leaderboard: bool,
    pub recent_replay_days: u32,
    pub full_history: bool,
    pub expanded_sharing: bool,
    pub opponent_decklists: bool,
    pub free_shares_per_window: u32,
    pub share_window_days: u32,
}
impl Default for Capabilities {
    fn default() -> Self {
        Self { record_matches: true, leaderboard: true, recent_replay_days: 7,
            full_history: false, expanded_sharing: false, opponent_decklists: false,
            free_shares_per_window: 1, share_window_days: 7 }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipStatus {
    pub linked: bool,
    pub email: Option<String>,
    pub plan: String,
    pub trace_access: bool,
    pub opponent_decklists: bool,
    pub admin: bool,
    pub status: String,
    pub expires_at: Option<String>,
    pub cancel_at_period_end: bool,
    #[serde(default)]
    pub capabilities: Capabilities,
}
impl MembershipStatus {
    pub fn denied(status: &str) -> Self {
        Self {
            linked: false,
            email: None,
            plan: "none".into(),
            trace_access: false,
            opponent_decklists: false,
            admin: false,
            status: status.into(),
            expires_at: None,
            cancel_at_period_end: false,
            capabilities: Capabilities::default(),
        }
    }
    fn paid_expiry(&self) -> Option<OffsetDateTime> {
        self.expires_at.as_deref().and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())
    }
    fn owner_access(&self) -> bool {
        self.linked && self.admin && self.status == "admin" && self.plan == "supporter"
    }
    fn paid_access_at(&self, now: OffsetDateTime) -> bool {
        self.linked && !self.admin && self.status == "active"
            && matches!(self.plan.as_str(), "trace" | "supporter")
            && self.paid_expiry().is_some_and(|expiry| expiry > now)
    }
    fn cache_lifetime_at(&self, now: OffsetDateTime) -> Duration {
        if self.owner_access() { return LEASE; }
        self.paid_expiry().and_then(|expiry| Duration::try_from(expiry - now).ok())
            .map(|remaining| remaining.min(LEASE)).unwrap_or(Duration::ZERO)
    }
    fn validated(self) -> Self { self.validated_at(OffsetDateTime::now_utc()) }
    fn validated_at(mut self, now: OffsetDateTime) -> Self {
        let owner = self.owner_access();
        let paid = self.paid_access_at(now);
        self.admin = owner;
        self.trace_access &= owner || paid;
        self.opponent_decklists &= self.trace_access && owner;
        self.capabilities = Capabilities {
            full_history: self.trace_access && self.capabilities.full_history,
            expanded_sharing: self.trace_access && self.capabilities.expanded_sharing,
            opponent_decklists: self.opponent_decklists,
            ..Capabilities::default()
        };
        self
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipLink {
    pub user_code: String,
    pub verification_url: String,
    pub expires_at: String,
}
#[derive(Default)]
struct AccessState {
    // Monotonic expiry is capped by both 60 seconds and the verified subscription expiry.
    lease: Option<(MembershipStatus, Instant)>,
}
#[derive(Clone)]
pub struct Membership {
    endpoint: Option<Url>,
    client: Client,
    state: Arc<Mutex<AccessState>>,
    refresh_lock: Arc<tokio::sync::Mutex<()>>,
}
impl Membership {
    pub fn new() -> Self {
        let endpoint = std::env::var("TRACE_MEMBERSHIP_API_URL")
            .ok()
            .or_else(|| option_env!("TRACE_MEMBERSHIP_API_URL").map(str::to_owned))
            .and_then(|value| Url::parse(value.trim().trim_end_matches('/')).ok())
            .filter(|url| {
                url.scheme() == "https"
                    && url.host_str().is_some()
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.query().is_none()
                    && url.fragment().is_none()
            });
        Self {
            endpoint,
            client: Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap_or_default(),
            state: Arc::new(Mutex::new(AccessState::default())),
            refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }
    async fn request(
        &self,
        cloud: &CloudSync,
        method: Method,
        path: &str,
    ) -> Result<Value, String> {
        let mut url = self
            .endpoint
            .clone()
            .ok_or("Memberships are not configured in this build.")?;
        url.path_segments_mut()
            .map_err(|_| "Membership service is unavailable.")?
            .extend(["v1", "devices"]).extend(path.split('/'));
        for attempt in 0..2 {
            let (device, token) = cloud.membership_credentials().await?;
            let result = self.client.request(method.clone(), url.clone())
                .header("x-trace-device", &device).bearer_auth(&token)
                .send().await.map_err(|_| "Couldn’t reach your Trace account. Check your connection and try again.")?;
            if result.status() == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 {
                cloud.reject_membership_credentials(&device, &token).await;
                continue;
            }
            if !result.status().is_success() {
                return Err(if result.status().as_u16() == 409 {
                    "This installation is already linked. Unlink it before linking another account."
                } else {
                    "Couldn’t verify your Trace account. Try again from Settings."
                }.into());
            }
            return result.json().await.map_err(|_| "The membership response could not be verified.".into());
        }
        Err("Couldn’t verify your Trace account. Try again from Settings.".into())
    }
    pub async fn refresh(&self, cloud: &CloudSync) -> MembershipStatus {
        let _lock = self.refresh_lock.lock().await;
        let status = if self.endpoint.is_none() {
            MembershipStatus::denied("not_configured")
        } else {
            self.request(cloud, Method::GET, "status")
                .await
                .ok()
                .and_then(|value| serde_json::from_value::<MembershipStatus>(value).ok())
                .map(MembershipStatus::validated)
                .unwrap_or_else(|| MembershipStatus::denied("unavailable"))
        };
        if let Ok(mut state) = self.state.lock() {
            let deadline = Instant::now() + status.cache_lifetime_at(OffsetDateTime::now_utc());
            state.lease = Some((status.clone(), deadline));
        }
        status
    }
    pub async fn link(&self, cloud: &CloudSync) -> Result<MembershipLink, String> {
        let link: MembershipLink = serde_json::from_value(self.request(cloud, Method::POST, "link/start").await?)
            .map_err(|_| "Couldn’t read the account link.")?;
        validate_link(&link)?;
        Ok(link)
    }
    pub async fn unlink(&self, cloud: &CloudSync) -> Result<MembershipStatus, String> {
        let _lock = self.refresh_lock.lock().await;
        self.request(cloud, Method::POST, "unlink").await?;
        let status = MembershipStatus::denied("unlinked");
        if let Ok(mut state) = self.state.lock() {
            let deadline = Instant::now() + status.cache_lifetime_at(OffsetDateTime::now_utc());
            state.lease = Some((status.clone(), deadline));
        }
        Ok(status)
    }
    pub fn has_full_history(&self) -> bool {
        self.state.lock().ok().and_then(|state| {
            state.lease.as_ref().map(|(status, deadline)| {
                status.capabilities.full_history && Instant::now() < *deadline
                    && (status.owner_access() || status.paid_access_at(OffsetDateTime::now_utc()))
            })
        }).unwrap_or(false)
    }
    pub fn require_full_history(&self) -> Result<(), String> {
        if self.has_full_history() { Ok(()) }
        else { Err("Trace Pro unlocks replays older than 7 days. Your matches are still saved. Link or refresh your membership in Settings.".into()) }
    }
}

pub fn validate_link(link: &MembershipLink) -> Result<(), String> {
    let url = Url::parse(&link.verification_url).map_err(|_| "Invalid account link.")?;
    let valid_code = link.user_code.len() == 11
        && link.user_code.as_bytes()[5] == b'-'
        && link
            .user_code
            .bytes()
            .enumerate()
            .all(|(i, c)| i == 5 || c.is_ascii_uppercase() || (b'2'..=b'7').contains(&c));
    if !valid_code
        || url.scheme() != "https"
        || url.host_str() != Some("victoryroad.app")
        || url.port().is_some()
        || url.path() != "/trace/link"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query_pairs().count() != 1
        || url
            .query_pairs()
            .next()
            .is_none_or(|(k, v)| k != "code" || v != link.user_code)
    {
        return Err("The account link could not be verified.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn active() -> MembershipStatus {
        MembershipStatus {
            linked: true,
            email: Some("test@example.invalid".into()),
            plan: "trace".into(),
            trace_access: true,
            opponent_decklists: true,
            admin: false,
            status: "active".into(),
            expires_at: Some("2099-01-01T00:00:00Z".into()),
            cancel_at_period_end: false,
            capabilities: Capabilities { full_history: true, expanded_sharing: true, ..Capabilities::default() },
        }
    }
    #[test]
    fn strict_entitlements_and_admin() {
        assert!(!active().validated().opponent_decklists);
        for status in ["trialing", "past_due", "canceled", "unknown"] {
            let mut value = active();
            value.status = status.into();
            assert!(!value.validated().trace_access);
        }
        let mut value = active();
        value.plan = "supporter".into();
        assert!(!value.clone().validated().opponent_decklists);
        value.admin = true;
        assert!(!value.clone().validated().trace_access);
        value.plan = "supporter".into();
        value.status = "admin".into();
        assert!(value.clone().validated().opponent_decklists);
        value.linked = false;
        assert!(!value.validated().trace_access);
    }
    #[test]
    fn free_capture_and_recent_replays_survive_all_account_states() {
        for name in ["unlinked", "unavailable", "not_configured", "past_due", "canceled"] {
            let status = MembershipStatus::denied(name).validated();
            assert!(status.capabilities.record_matches);
            assert!(status.capabilities.leaderboard);
            assert_eq!(status.capabilities.recent_replay_days, 7);
            assert_eq!(status.capabilities.free_shares_per_window, 1);
            assert!(!status.capabilities.full_history);
            assert!(!status.capabilities.expanded_sharing);
            assert!(!status.opponent_decklists);
        }
        let mut invalid = active();
        invalid.status = "unknown".into();
        invalid.capabilities.record_matches = false;
        invalid.capabilities.recent_replay_days = 0;
        let invalid = invalid.validated();
        assert!(!invalid.capabilities.full_history);
        assert!(invalid.capabilities.record_matches);
        assert_eq!(invalid.capabilities.recent_replay_days, 7);
    }
    #[test]
    fn paid_history_expires_without_affecting_free_capabilities() {
        let member = Membership::new();
        assert!(!member.has_full_history());
        member.state.lock().unwrap().lease = Some((active().validated(), Instant::now() + LEASE));
        assert!(member.require_full_history().is_ok());
        member.state.lock().unwrap().lease = Some((active().validated(), Instant::now() - Duration::from_secs(1)));
        assert!(member.require_full_history().is_err());
        member.state.lock().unwrap().lease = Some((MembershipStatus::denied("unlinked"), Instant::now()));
        assert!(!member.has_full_history());
    }
    #[test]
    fn paid_expiry_is_required_and_strict_at_the_boundary_but_owner_is_exempt() {
        let now = OffsetDateTime::parse("2026-09-28T12:00:00Z", &Rfc3339).unwrap();
        for expires in [None, Some("garbage"), Some("2026-02-30T12:00:00Z"), Some("2026-09-28T11:59:59Z"), Some("2026-09-28T12:00:00Z")] {
            let mut value = active();
            value.expires_at = expires.map(str::to_owned);
            let validated = value.validated_at(now);
            assert!(!validated.trace_access);
            assert!(!validated.capabilities.full_history);
            assert!(validated.capabilities.record_matches);
        }
        let mut value = active();
        value.expires_at = Some("2026-09-28T12:00:01Z".into());
        assert!(value.clone().validated_at(now).trace_access);
        assert_eq!(value.cache_lifetime_at(now), Duration::from_secs(1));
        assert_eq!(value.cache_lifetime_at(now + time::Duration::seconds(1)), Duration::ZERO);
        assert_eq!(active().cache_lifetime_at(now), LEASE);
        value.admin = true;
        value.plan = "supporter".into();
        value.status = "admin".into();
        value.expires_at = None;
        assert!(value.clone().validated_at(now).trace_access);
        assert_eq!(value.cache_lifetime_at(now), LEASE);
    }
    #[test]
    fn a_fresh_lease_does_not_override_an_expired_server_snapshot() {
        let member = Membership::new();
        let mut expired = active();
        expired.expires_at = Some("2020-01-01T00:00:00Z".into());
        member.state.lock().unwrap().lease = Some((expired, Instant::now() + LEASE));
        assert!(!member.has_full_history());
    }
    #[tokio::test]
    async fn device_requests_recover_once_from_401_using_exact_routes_and_new_credentials() {
        use std::{fs, io::{Read, Write}, net::TcpListener};
        use serde_json::json;
        for (path, method, final_status) in [
            ("status", Method::GET, 200), ("link/start", Method::POST, 200),
            ("unlink", Method::POST, 200), ("status", Method::GET, 401),
        ] {
            let directory = std::env::temp_dir().join(format!("trace-membership-http-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&directory).unwrap();
            let config_path = directory.join("cloud-sync.json");
            fs::write(&config_path, br#"{"deviceId":"stale-device","token":"stale-token"}"#).unwrap();
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let endpoint = Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
            let expected_method = method.as_str().to_owned();
            let server = std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(8);
                let mut registration_ids = Vec::new();
                for index in 0..4 {
                    let (mut stream, _) = loop {
                        match listener.accept() {
                            Ok(value) => break value,
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
                                std::thread::sleep(Duration::from_millis(5)),
                            Err(error) => panic!("Offline membership server did not receive its expected request: {error}"),
                        }
                    };
                    stream.set_nonblocking(false).unwrap();
                    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                    let mut data = Vec::new();
                    let (headers, body) = loop {
                        let mut chunk = [0u8; 2048];
                        let count = stream.read(&mut chunk).unwrap();
                        assert!(count > 0);
                        data.extend_from_slice(&chunk[..count]);
                        if let Some(offset) = data.windows(4).position(|v| v == b"\r\n\r\n") {
                            let headers = String::from_utf8_lossy(&data[..offset]).to_lowercase();
                            let size = headers.lines().find_map(|line| line.strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
                            if data.len() >= offset + 4 + size {
                                break (headers, data[offset + 4..offset + 4 + size].to_vec());
                            }
                        }
                    };
                    if index == 0 || index == 3 {
                        assert!(headers.starts_with(&format!("{} /v1/devices/{path} http/1.1", expected_method.to_lowercase())));
                        if index == 0 {
                            assert!(headers.contains("x-trace-device: stale-device"));
                            assert!(headers.contains("authorization: bearer stale-token"));
                        } else {
                            assert!(headers.contains(&format!("x-trace-device: {}", registration_ids[1])));
                            assert!(headers.contains("authorization: bearer renewed-token"));
                        }
                    } else {
                        assert!(headers.starts_with("post /v1/register http/1.1"));
                        let body: Value = serde_json::from_slice(&body).unwrap();
                        registration_ids.push(body["deviceId"].as_str().unwrap().to_owned());
                    }
                    let status = [401, 409, 201, final_status][index];
                    let body = if index == 2 { json!({"token":"renewed-token"}).to_string() }
                        else if status == 200 { json!({"ok":true}).to_string() }
                        else { json!({"error":"unauthorized"}).to_string() };
                    write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                }
                assert_eq!(registration_ids[0], "stale-device");
                assert_ne!(registration_ids[0], registration_ids[1]);
                registration_ids[1].clone()
            });
            let cloud = CloudSync::with_test_endpoint(config_path, endpoint.clone());
            let mut member = Membership::new();
            member.endpoint = Some(endpoint);
            let result = member.request(&cloud, method, path).await;
            assert_eq!(result.is_ok(), final_status == 200);
            let renewed_device = server.join().unwrap();
            assert_eq!(cloud.membership_credentials().await.unwrap(), (renewed_device, "renewed-token".into()));
            fs::remove_dir_all(directory).unwrap();
        }
    }
    #[test]
    fn browser_link_is_fixed_origin_and_code_bound() {
        let mut link = MembershipLink {
            user_code: "ABCDE-FGHIJ".into(),
            verification_url: "https://victoryroad.app/trace/link?code=ABCDE-FGHIJ".into(),
            expires_at: "later".into(),
        };
        assert!(validate_link(&link).is_ok());
        for url in [
            "https://evil.invalid/trace/link?code=ABCDE-FGHIJ",
            "https://victoryroad.app/trace/link?code=ZZZZZ-ZZZZZ",
            "javascript:alert(1)",
            "https://victoryroad.app/trace/link?code=ABCDE-FGHIJ&redirect=evil",
        ] {
            link.verification_url = url.into();
            assert!(validate_link(&link).is_err());
        }
    }
}
