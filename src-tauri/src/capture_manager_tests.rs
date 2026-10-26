//! Exercises the production manager tick. The fake replaces only process/DNS
//! reads and privileged route mutations; it never touches the installed app.
use super::*;
use std::collections::VecDeque;

struct FakeIo {
    pid: Option<u32>,
    pid_reads: VecDeque<Option<u32>>,
    count: Result<usize, String>,
    count_reads: VecDeque<Result<usize, String>>,
    addresses: Vec<IpAddr>,
    dns_error: bool,
    activation_error: bool,
    events: Vec<String>,
    pause_on_dns: bool,
}
impl Default for FakeIo {
    fn default() -> Self {
        Self {
            pid: None,
            pid_reads: VecDeque::new(),
            count: Ok(2),
            count_reads: VecDeque::new(),
            addresses: vec!["192.0.2.10".parse().unwrap()],
            dns_error: false,
            activation_error: false,
            events: Vec::new(),
            pause_on_dns: false,
        }
    }
}
impl CaptureManagerIo for FakeIo {
    fn client_pid(&mut self) -> Option<u32> {
        self.pid_reads.pop_front().unwrap_or(self.pid)
    }
    fn connections(&mut self, _state: &CaptureState, _pid: u32) -> Result<usize, String> {
        self.count_reads
            .pop_front()
            .unwrap_or_else(|| self.count.clone())
    }
    fn route_current(&mut self, state: &CaptureState) -> Result<bool, String> {
        if self.pause_on_dns {
            state.enabled.store(false, Ordering::Relaxed);
        }
        if self.dns_error {
            return Err("DNS temporarily unavailable".into());
        }
        Ok(crate::capture_health::addresses_cover(
            &state.upstream_ips.lock().unwrap(),
            &self.addresses,
        ))
    }
    fn release(&mut self, state: &Arc<CaptureState>) {
        if state.route_active.swap(false, Ordering::Relaxed) {
            self.events.push("release".into());
        }
        state.routed_pid.store(0, Ordering::Relaxed);
        state.upstream_ips.lock().unwrap().clear();
    }
    fn activate(&mut self, state: &Arc<CaptureState>, pid: u32) -> Result<(), String> {
        self.events.push(format!("activate:{pid}"));
        if self.activation_error {
            return Err("injected helper failure".into());
        }
        *state.upstream_ips.lock().unwrap() = self.addresses.clone();
        state.route_active.store(true, Ordering::Relaxed);
        state.routed_pid.store(u64::from(pid), Ordering::Relaxed);
        state.waiting_for_match_end.store(false, Ordering::Relaxed);
        state.match_in_progress.store(false, Ordering::Relaxed);
        *state.last_error.lock().unwrap() = None;
        Ok(())
    }
}
fn enabled_state() -> Arc<CaptureState> {
    let state = Arc::new(CaptureState::default());
    state.enabled.store(true, Ordering::Relaxed);
    state
}
fn arm(manager: &mut CaptureManager, state: &Arc<CaptureState>, io: &mut FakeIo) {
    for now in [0, 750, 1500] {
        manager.tick(state, io, now);
    }
    assert!(state.route_active.load(Ordering::Relaxed));
    assert_eq!(io.events, ["activate:0"]);
    io.events.clear();
}
fn rotate(io: &mut FakeIo) {
    io.addresses = vec![
        "192.0.2.11".parse().unwrap(),
        "2001:db8::1".parse().unwrap(),
    ];
}

#[test]
fn manager_idle_four_days_refreshes_dns_then_adopts_launch_without_another_reset() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    arm(&mut manager, &state, &mut io);
    rotate(&mut io);
    let day4 = 4 * 24 * 60 * 60 * 1000;
    manager.tick(&state, &mut io, day4);
    assert_eq!(io.events, ["release", "activate:0"]);
    assert_eq!(*state.upstream_ips.lock().unwrap(), io.addresses);
    io.events.clear();
    io.pid = Some(42);
    manager.tick(&state, &mut io, day4 + 1000);
    assert_eq!(state.routed_pid.load(Ordering::Relaxed), 42);
    io.count = Ok(6);
    for now in 1..100 {
        manager.tick(&state, &mut io, day4 + 2000 + now * 1000);
    }
    assert!(
        io.events.is_empty(),
        "healthy route must survive launch and active play"
    );
    assert!(state.match_in_progress.load(Ordering::Relaxed));
}

#[test]
fn manager_stale_route_found_at_launch_waits_through_match_then_refreshes_in_lobby() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    arm(&mut manager, &state, &mut io);
    rotate(&mut io);
    io.pid = Some(42);
    io.count = Ok(3);
    for now in 10..40 {
        manager.tick(&state, &mut io, now * 1000);
    }
    assert!(io.events.is_empty());
    assert!(state.waiting_for_match_end.load(Ordering::Relaxed));
    io.count = Ok(2);
    for now in 40..44 {
        manager.tick(&state, &mut io, now * 1000);
    }
    assert!(io.events.is_empty());
    manager.tick(&state, &mut io, 44_000);
    assert_eq!(io.events, ["release", "activate:42"]);
    assert!(!state.waiting_for_match_end.load(Ordering::Relaxed));
}

#[test]
fn manager_relaunch_and_transient_missing_process_cannot_reset_a_match() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    arm(&mut manager, &state, &mut io);
    io.pid = Some(42);
    manager.tick(&state, &mut io, 2000);
    io.pid = None;
    manager.tick(&state, &mut io, 2750);
    manager.tick(&state, &mut io, 3500);
    io.pid = Some(43);
    io.count = Ok(6);
    for now in 4..30 {
        manager.tick(&state, &mut io, now * 1000);
    }
    assert!(io.events.is_empty());
    assert!(state.waiting_for_match_end.load(Ordering::Relaxed));
}

#[test]
fn manager_game_launch_during_idle_dns_check_defers_refresh() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    arm(&mut manager, &state, &mut io);
    rotate(&mut io);
    io.pid_reads = [None, Some(42)].into();
    manager.tick(&state, &mut io, 60_000);
    assert!(io.events.is_empty());
    io.pid = Some(42);
    io.count = Ok(3);
    manager.tick(&state, &mut io, 61_000);
    assert!(io.events.is_empty());
}

#[test]
fn manager_match_start_on_final_safety_check_defers_refresh() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    io.pid = Some(42);
    for now in 0..4 {
        manager.tick(&state, &mut io, now * 1000);
    }
    io.count_reads = [Ok(2), Ok(3)].into();
    manager.tick(&state, &mut io, 4000);
    assert!(io.events.is_empty());
}

#[test]
fn manager_dns_failure_keeps_route_and_recovers_on_retry() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    arm(&mut manager, &state, &mut io);
    rotate(&mut io);
    io.dns_error = true;
    manager.tick(&state, &mut io, 60_000);
    assert!(io.events.is_empty());
    assert!(state.route_active.load(Ordering::Relaxed));
    io.dns_error = false;
    manager.tick(&state, &mut io, 75_000);
    assert_eq!(io.events, ["release", "activate:0"]);
}

#[test]
fn manager_helper_failure_retries_without_claiming_a_route() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    arm(&mut manager, &state, &mut io);
    rotate(&mut io);
    io.activation_error = true;
    manager.tick(&state, &mut io, 60_000);
    assert!(!state.route_active.load(Ordering::Relaxed));
    assert!(state.last_error.lock().unwrap().is_some());
    io.activation_error = false;
    manager.tick(&state, &mut io, 61_000);
    assert!(state.route_active.load(Ordering::Relaxed));
    assert_eq!(*state.upstream_ips.lock().unwrap(), io.addresses);
}

#[test]
fn manager_unknown_match_state_never_authorizes_a_route_reset() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    arm(&mut manager, &state, &mut io);
    rotate(&mut io);
    io.pid = Some(42);
    io.count = Err("socket inspection failed".into());
    for now in 10..20 {
        manager.tick(&state, &mut io, now * 1000);
    }
    assert!(
        io.events.is_empty(),
        "unknown socket state must not be treated as an empty lobby: {:?}",
        io.events
    );
}

#[test]
fn manager_pause_during_dns_check_cannot_reactivate_capture() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    arm(&mut manager, &state, &mut io);
    rotate(&mut io);
    io.pause_on_dns = true;
    manager.tick(&state, &mut io, 60_000);
    assert!(
        !io.events.iter().any(|e| e.starts_with("activate:")),
        "pause during slow DNS must win: {:?}",
        io.events
    );
}

struct StoredRecorder {
    storage: crate::storage::MatchStorage,
    changed: Arc<tokio::sync::Notify>,
}
impl StreamRecorder for StoredRecorder {
    fn inspect(&self, data: &[u8], host: &str) {
        if let Some(operation) = decode_websocket_message(data, host.into(), unix_timestamp()) {
            self.storage
                .record_operation(&operation)
                .expect("persist test operation");
            self.changed.notify_one();
        }
    }
}

fn encoded_operation(index: u32) -> Vec<u8> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use flate2::{write::GzEncoder, Compression};
    use serde_json::json;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder
        .write_all(
            &serde_json::to_vec(&json!({
                "operationNumber": index,
                "type": if index == 3 { "EndGameModification" } else { "TestOperation" }
            }))
            .unwrap(),
        )
        .unwrap();
    let message = serde_json::to_vec(&json!({
        "compressedValue": BASE64.encode(encoder.finish().unwrap()),
        "messageIndex": index, "matchID": "idle-recovery-lab",
        "operationID": format!("lab-{index}"), "messageType": 8,
    }))
    .unwrap();
    // Current PlayerMessage FlatBuffer layout, with synthetic game contents.
    let mut body = vec![0_u8; 36];
    body[0..4].copy_from_slice(&16_u32.to_le_bytes());
    body[6..8].copy_from_slice(&10_u16.to_le_bytes());
    body[8..10].copy_from_slice(&16_u16.to_le_bytes());
    body[10..12].copy_from_slice(&12_u16.to_le_bytes());
    body[12..14].copy_from_slice(&8_u16.to_le_bytes());
    body[14..16].copy_from_slice(&4_u16.to_le_bytes());
    body[16..20].copy_from_slice(&10_i32.to_le_bytes());
    body[24..28].copy_from_slice(&12_u32.to_le_bytes());
    body.extend_from_slice(&(message.len() as u32).to_le_bytes());
    body.extend(message);
    while body.len() % 4 != 0 {
        body.push(0);
    }
    let offset = body.len();
    body[28..32].copy_from_slice(&((offset - 28) as u32).to_le_bytes());
    body.extend_from_slice(&8_u32.to_le_bytes());
    body.extend_from_slice(b"lab-game\0");
    let mut payload = format!(
        "MESSAGE\ncontent-length:{}\npay:PlayerMessage\n\n",
        body.len()
    )
    .into_bytes();
    payload.extend(body);
    let mut frame = vec![0x82, 126];
    frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    frame.extend(payload);
    frame
}

async fn read_http_headers<S: AsyncRead + Unpin>(stream: &mut S) -> Vec<u8> {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        let mut byte = [0u8; 1];
        stream.read_exact(&mut byte).await.unwrap();
        bytes.extend(byte);
        assert!(bytes.len() < 8192);
    }
    bytes
}

async fn replay_over_local_tls(chunk_size: usize) {
    // First run the actual recovery decision loop, advancing its clock four
    // days and changing DNS before the simulated game process launches.
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    arm(&mut manager, &state, &mut io);
    rotate(&mut io);
    manager.tick(&state, &mut io, 4 * 24 * 60 * 60 * 1000);
    io.pid = Some(42);
    manager.tick(&state, &mut io, 4 * 24 * 60 * 60 * 1000 + 1000);
    assert_eq!(state.routed_pid.load(Ordering::Relaxed), 42);

    let directory = std::env::temp_dir().join(format!("trace-idle-test-{}", uuid::Uuid::new_v4()));
    let path = directory.join("archive.sqlite3");
    let storage = crate::storage::MatchStorage::new(path.clone()).unwrap();
    let changed = Arc::new(tokio::sync::Notify::new());
    let recorder = StoredRecorder {
        storage: storage.clone(),
        changed: changed.clone(),
    };

    // Ephemeral certificates and ports belong only to these test processes.
    // Neither the OS trust store nor Trace's helper/routing is touched.
    let key = KeyPair::generate().unwrap();
    let cert = CertificateParams::new(vec!["capture.test".into()])
        .unwrap()
        .self_signed(&key)
        .unwrap();
    let cert_der = CertificateDer::from(cert.der().to_vec());
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let server_config = ServerConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert_der.clone()],
            PrivateKeyDer::from(PrivatePkcs8KeyDer::from(key.serialize_der())),
        )
        .unwrap();
    let mut roots = RootCertStore::empty();
    roots.add(cert_der).unwrap();
    let client_config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let acceptor = TlsAcceptor::from(Arc::new(server_config));
    let connector = TlsConnector::from(Arc::new(client_config));
    let upstream_listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let observer_listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let upstream_address = upstream_listener.local_addr().unwrap();
    let observer_address = observer_listener.local_addr().unwrap();
    let mut expected = b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n".to_vec();
    // Send three synthetic operations, including an explicit terminal operation.
    for index in [1, 2, 3] {
        expected.extend(encoded_operation(index));
    }
    let response = expected.clone();
    let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
    let server_acceptor = acceptor.clone();
    let server = tokio::spawn(async move {
        let (socket, _) = upstream_listener.accept().await.unwrap();
        let mut stream = server_acceptor.accept(socket).await.unwrap();
        assert!(read_http_headers(&mut stream)
            .await
            .starts_with(b"GET /game HTTP/1.1"));
        for chunk in response.chunks(chunk_size) {
            write_forwarded_batch(&mut stream, chunk).await.unwrap();
        }
        finish_rx.await.unwrap();
        stream.shutdown().await.unwrap();
    });
    let observer_state = state.clone();
    let upstream_connector = connector.clone();
    let observer = tokio::spawn(async move {
        let (socket, _) = observer_listener.accept().await.unwrap();
        let client = acceptor.accept(socket).await.unwrap();
        let socket = TcpStream::connect(upstream_address).await.unwrap();
        let upstream = upstream_connector
            .connect(ServerName::try_from("capture.test").unwrap(), socket)
            .await
            .unwrap();
        let id = observer_state.activity.lock().unwrap().opened(Some(42));
        observer_state
            .client_connections
            .fetch_add(1, Ordering::Relaxed);
        let connection = ActiveCaptureConnection {
            state: observer_state,
            id,
        };
        forward_and_inspect(
            client,
            upstream,
            recorder,
            "capture.test".into(),
            &connection,
        )
        .await
        .unwrap();
    });
    let socket = TcpStream::connect(observer_address).await.unwrap();
    let mut client = connector
        .connect(ServerName::try_from("capture.test").unwrap(), socket)
        .await
        .unwrap();
    write_forwarded_batch(
        &mut client,
        b"GET /game HTTP/1.1\r\nHost: capture.test\r\nUpgrade: websocket\r\n\r\n",
    )
    .await
    .unwrap();
    let mut forwarded = vec![0u8; expected.len()];
    client.read_exact(&mut forwarded).await.unwrap();
    assert_eq!(forwarded, expected, "capture must preserve all game bytes");
    while storage
        .load_operations("live-idle-recovery-lab")
        .unwrap()
        .len()
        < 3
    {
        changed.notified().await;
    }
    assert!(state
        .activity
        .lock()
        .unwrap()
        .is_live(Some(42), now_millis()));
    assert!(!state
        .activity
        .lock()
        .unwrap()
        .is_live(Some(43), now_millis()));
    finish_tx.send(()).unwrap();
    let mut remaining = Vec::new();
    client.read_to_end(&mut remaining).await.unwrap();
    client.shutdown().await.unwrap();
    server.await.unwrap();
    observer.await.unwrap();
    assert_eq!(state.client_connections.load(Ordering::Relaxed), 0);
    assert!(!state
        .activity
        .lock()
        .unwrap()
        .is_live(Some(42), now_millis()));
    let reopened = crate::storage::MatchStorage::new(path).unwrap();
    let saved = reopened.load_operations("live-idle-recovery-lab").unwrap();
    assert_eq!(saved.len(), 3);
    assert_eq!(
        saved
            .iter()
            .map(|op| op.message_index.unwrap())
            .collect::<Vec<_>>(),
        [1, 2, 3]
    );
    assert_eq!(saved[2].operation["type"], "EndGameModification");
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn manager_recovered_route_forwards_tls_and_persists_fragmented_match_without_restart() {
    for chunk_size in [1, 7, 4096] {
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            replay_over_local_tls(chunk_size),
        )
        .await
        .expect("bounded local capture test");
    }
}

#[test]
fn manager_failed_final_socket_check_defers_even_after_a_stable_lobby() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    io.pid = Some(42);
    for now in 0..4 {
        manager.tick(&state, &mut io, now * 1000);
    }
    io.count_reads = [Ok(2), Err("inspection interrupted".into())].into();
    manager.tick(&state, &mut io, 4000);
    assert!(io.events.is_empty());
    assert!(state.waiting_for_match_end.load(Ordering::Relaxed));
    for now in 5..9 {
        manager.tick(&state, &mut io, now * 1000);
    }
    assert!(
        io.events.is_empty(),
        "failed check must reset the stability window"
    );
    manager.tick(&state, &mut io, 9000);
    assert_eq!(io.events, ["activate:42"]);
}

#[test]
fn manager_shutdown_cannot_rearm_an_idle_route() {
    let (mut manager, state, mut io) = (
        CaptureManager::default(),
        enabled_state(),
        FakeIo::default(),
    );
    arm(&mut manager, &state, &mut io);
    state.terminate.store(true, Ordering::Relaxed);
    rotate(&mut io);
    manager.tick(&state, &mut io, 60_000);
    assert_eq!(io.events, ["release"]);
    assert!(!state.route_active.load(Ordering::Relaxed));
}
