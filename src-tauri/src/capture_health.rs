use std::{collections::HashMap, net::IpAddr};

const TRAFFIC_FRESHNESS_MS: u64 = 30_000;
const IDLE_ROUTE_CHECK_MS: u64 = 15_000;
const ABSENCE_CONFIRMATION_POLLS: u8 = 3;

/// Socket lifetime alone cannot prove that the current game is being captured.
/// Each observed WebSocket belongs to the game process that opened it.
#[derive(Default)]
pub struct CaptureActivity {
    next_id: u64,
    streams: HashMap<u64, (Option<u32>, Option<u64>)>,
}

impl CaptureActivity {
    pub fn opened(&mut self, pid: Option<u32>) -> u64 {
        self.next_id += 1;
        self.streams.insert(self.next_id, (pid, None));
        self.next_id
    }

    pub fn received(&mut self, id: u64, now_ms: u64) {
        if let Some((_, last_received)) = self.streams.get_mut(&id) {
            *last_received = Some(now_ms);
        }
    }

    pub fn closed(&mut self, id: u64) {
        self.streams.remove(&id);
    }

    pub fn is_live(&self, pid: Option<u32>, now_ms: u64) -> bool {
        pid.is_some()
            && self.streams.values().any(|(owner, received)| {
                *owner == pid
                    && received.is_some_and(|at| {
                        now_ms
                            .checked_sub(at)
                            .is_some_and(|age| age <= TRAFFIC_FRESHNESS_MS)
                    })
            })
    }
}

/// Poll DNS throughout a multi-day idle period, with no timer authorizing a
/// route reset while a game process exists. Wall time includes machine sleep.
#[derive(Default)]
pub struct IdleRouteWatch {
    missing_polls: u8,
    last_check: Option<u64>,
}

pub fn game_connection_count(active: &[IpAddr], current: &[IpAddr], known: &[IpAddr]) -> usize {
    // DNS rotation does not move existing TCP sockets. Those on the old routed
    // endpoints still count toward the active-match safety threshold.
    active
        .iter()
        .filter(|ip| current.contains(ip) || known.contains(ip))
        .count()
}

pub fn addresses_cover(pinned: &[IpAddr], current: &[IpAddr]) -> bool {
    !current.is_empty() && current.iter().all(|ip| pinned.contains(ip))
}

impl IdleRouteWatch {
    pub fn absence_confirmed(&self) -> bool {
        self.missing_polls >= ABSENCE_CONFIRMATION_POLLS
    }

    pub fn observe(&mut self, pid: Option<u32>, now_ms: u64) -> bool {
        if pid.is_some() {
            self.missing_polls = 0;
            self.last_check = None;
            return false;
        }
        self.missing_polls = self.missing_polls.saturating_add(1);
        let check_due = self.last_check.is_none_or(|last| {
            now_ms
                .checked_sub(last)
                .is_none_or(|age| age >= IDLE_ROUTE_CHECK_MS)
        });
        if self.missing_polls >= ABSENCE_CONFIRMATION_POLLS && check_due {
            self.last_check = Some(now_ms);
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dns_rotation_does_not_hide_an_existing_match_from_the_safety_check() {
        let old = "192.0.2.10".parse().unwrap();
        let new = "192.0.2.11".parse().unwrap();
        let asset = "192.0.2.12".parse().unwrap();
        assert_eq!(
            game_connection_count(&[old, old, old, asset], &[new], &[old]),
            3
        );
        assert_eq!(
            game_connection_count(&[new, old, new, asset], &[new], &[old]),
            3
        );
        assert_eq!(game_connection_count(&[new, new, asset], &[new], &[new]), 2);
    }

    #[test]
    fn rotated_dns_requires_refresh_even_when_old_tcp_sockets_remain() {
        let old = "192.0.2.10".parse().unwrap();
        let new = "192.0.2.11".parse().unwrap();
        let ipv6 = "2001:db8::1".parse().unwrap();
        assert!(addresses_cover(&[old, new], &[new, old]));
        assert!(addresses_cover(&[old, new], &[new]));
        assert!(!addresses_cover(&[old], &[old, new]));
        assert!(!addresses_cover(&[old, new], &[ipv6]));
        assert!(!addresses_cover(&[old], &[]));
    }

    #[test]
    fn stale_connections_cannot_keep_a_days_old_capture_live() {
        let mut health = CaptureActivity::default();
        let socket = health.opened(Some(10));
        assert!(!health.is_live(Some(10), 0)); // TLS alone is insufficient.
        health.received(socket, 1);
        assert!(health.is_live(Some(10), 2));
        assert!(!health.is_live(Some(10), 4 * 24 * 60 * 60 * 1000));
        assert!(!health.is_live(None, 2));
        assert!(!health.is_live(Some(11), 2));
        health.received(socket, 100_000); // A late callback from the old client.
        assert!(!health.is_live(Some(11), 100_001));
        let new_socket = health.opened(Some(11));
        health.received(new_socket, 100_002);
        health.closed(socket);
        assert!(health.is_live(Some(11), 100_003));
        health.closed(new_socket);
        assert!(!health.is_live(Some(11), 100_004));
    }

    #[test]
    fn traffic_resumes_after_idle_without_resetting_any_socket() {
        let mut health = CaptureActivity::default();
        let socket = health.opened(Some(10));
        health.received(socket, 100);
        assert!(!health.is_live(Some(10), 60_000));
        health.received(socket, 60_001);
        assert!(health.is_live(Some(10), 60_002));
        assert!(!health.is_live(Some(10), 99)); // Clock correction fails closed.
    }

    #[test]
    fn idle_route_is_checked_repeatedly_and_immediately_after_wake() {
        let mut watch = IdleRouteWatch::default();
        assert!(!watch.observe(None, 0));
        assert!(!watch.observe(None, 750));
        assert!(watch.observe(None, 1500));
        assert!(!watch.observe(None, 2250));
        assert!(watch.observe(None, 16_500));
        assert!(watch.observe(None, 4 * 24 * 60 * 60 * 1000));
    }

    #[test]
    fn running_or_briefly_missing_client_never_allows_idle_refresh() {
        let mut watch = IdleRouteWatch::default();
        for day in 0..7 {
            assert!(!watch.observe(Some(42), day * 24 * 60 * 60 * 1000));
        }
        assert!(!watch.observe(None, 1_000_000_000));
        assert!(!watch.observe(None, 1_000_000_750));
        assert!(!watch.observe(Some(42), 1_000_001_500));
        assert!(!watch.observe(None, 1_000_002_250));
        assert!(!watch.observe(None, 1_000_003_000));
        assert!(watch.observe(None, 1_000_003_750));
    }
}
