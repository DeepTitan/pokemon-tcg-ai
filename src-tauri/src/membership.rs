//! Device credentials stay native. A UI flag is never authority for paid access.
use crate::cloud_sync::CloudSync;
use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const LEASE: Duration = Duration::from_secs(60);
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
        }
    }
    fn validated(mut self) -> Self {
        let owner = self.linked && self.admin && self.status == "admin" && self.plan == "supporter";
        let paid = self.linked
            && !self.admin
            && self.status == "active"
            && matches!(self.plan.as_str(), "trace" | "supporter");
        self.admin = owner;
        self.trace_access &= owner || paid;
        self.opponent_decklists &= self.trace_access && self.plan == "supporter";
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
    lease: Option<(MembershipStatus, Instant)>,
    // Only matches admitted while access was valid. Never mutate routing on expiry.
    admitted_matches: HashSet<String>,
    denied_matches: HashSet<String>,
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
            .extend(["v1", "devices", path]);
        let (device, token) = cloud.membership_credentials().await?;
        let result = self
            .client
            .request(method, url)
            .header("x-trace-device", device)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| {
                "Couldn’t reach your Trace account. Check your connection and try again."
            })?;
        if !result.status().is_success() {
            return Err(if result.status().as_u16() == 409 {
                "This installation is already linked. Unlink it before linking another account."
            } else {
                "Couldn’t verify your Trace account. Try again from Settings."
            }
            .into());
        }
        result
            .json()
            .await
            .map_err(|_| "The membership response could not be verified.".into())
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
            state.lease = Some((status.clone(), Instant::now()));
        }
        status
    }
    pub async fn link(&self, cloud: &CloudSync) -> Result<MembershipLink, String> {
        // `link/start` is a pair of URL segments, not an escaped slash.
        let endpoint = self.clone();
        let mut url = endpoint
            .endpoint
            .clone()
            .ok_or("Memberships are not configured in this build.")?;
        url.path_segments_mut()
            .map_err(|_| "Membership service is unavailable.")?
            .extend(["v1", "devices", "link", "start"]);
        let (device, token) = cloud.membership_credentials().await?;
        let result = endpoint
            .client
            .post(url)
            .header("x-trace-device", device)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "Couldn’t connect to your Trace account.")?;
        if !result.status().is_success() {
            return Err("Couldn’t start account linking. If already linked, unlink this installation first.".into());
        }
        let link: MembershipLink = result
            .json()
            .await
            .map_err(|_| "Couldn’t read the account link.")?;
        validate_link(&link)?;
        Ok(link)
    }
    pub async fn unlink(&self, cloud: &CloudSync) -> Result<MembershipStatus, String> {
        let _lock = self.refresh_lock.lock().await;
        self.request(cloud, Method::POST, "unlink").await?;
        let status = MembershipStatus::denied("unlinked");
        if let Ok(mut state) = self.state.lock() {
            state.lease = Some((status.clone(), Instant::now()));
        }
        Ok(status)
    }
    pub fn require_trace(&self) -> Result<(), String> {
        if self
            .state
            .lock()
            .ok()
            .and_then(|state| {
                state
                    .lease
                    .as_ref()
                    .map(|(s, at)| s.trace_access && at.elapsed() < LEASE)
            })
            .unwrap_or(false)
        {
            Ok(())
        } else {
            Err("Link an active Trace membership in Settings to continue.".into())
        }
    }
    pub fn admit_match(&self, match_id: &str) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if state.denied_matches.contains(match_id) {
            return false;
        }
        if state.admitted_matches.contains(match_id) {
            return true;
        }
        if state
            .lease
            .as_ref()
            .is_some_and(|(s, at)| s.trace_access && at.elapsed() < LEASE)
        {
            state.admitted_matches.insert(match_id.into());
            true
        } else {
            state.denied_matches.insert(match_id.into());
            false
        }
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
            expires_at: None,
            cancel_at_period_end: false,
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
        value.admin = true;
        assert!(!value.clone().validated().trace_access);
        value.plan = "supporter".into();
        value.status = "admin".into();
        assert!(value.clone().validated().opponent_decklists);
        value.linked = false;
        assert!(!value.validated().trace_access);
    }
    #[test]
    fn expiry_does_not_interrupt_admitted_match_but_blocks_next_one() {
        let member = Membership::new();
        member.state.lock().unwrap().lease = Some((active(), Instant::now()));
        assert!(member.admit_match("current"));
        member.state.lock().unwrap().lease =
            Some((MembershipStatus::denied("unlinked"), Instant::now()));
        assert!(member.admit_match("current"));
        assert!(!member.admit_match("next"));
        assert!(member.require_trace().is_err());
        member.state.lock().unwrap().lease =
            Some((active(), Instant::now() - Duration::from_secs(61)));
        assert!(!member.admit_match("new"));
        member.state.lock().unwrap().lease = Some((active(), Instant::now()));
        assert!(
            !member.admit_match("new"),
            "a match denied at its start stays denied; never begin partway through"
        );
        assert!(member.admit_match("later"));
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
