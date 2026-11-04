//! Exercise both directions of the production forwarding loop under recorder
//! faults. No OS routes, certificates, real game or user archive are changed.
use super::*;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use tokio::{io::DuplexStream, task::JoinHandle};

const HEADERS: &[u8] = b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n";

struct ReleaseOnDrop(Option<SyncSender<()>>);
impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        if let Some(sender) = self.0.take() {
            let _ = sender.try_send(());
        }
    }
}

struct BlockedRecorder {
    started: Arc<tokio::sync::Notify>,
    release: Mutex<Receiver<()>>,
}
impl StreamRecorder for BlockedRecorder {
    fn inspect(&self, _: &[u8], _: &str, _: u64) -> Result<(), RecordingFault> {
        self.started.notify_one();
        self.release
            .lock()
            .unwrap()
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|_| RecordingFault::Storage)
    }
}

struct BrokenRecorder(bool);
impl StreamRecorder for BrokenRecorder {
    fn inspect(&self, _: &[u8], _: &str, _: u64) -> Result<(), RecordingFault> {
        if self.0 {
            panic!("injected recorder panic");
        }
        Err(RecordingFault::Storage)
    }
}

fn relay(
    recorder: impl StreamRecorder,
) -> (
    DuplexStream,
    DuplexStream,
    Arc<CaptureState>,
    JoinHandle<Result<(), String>>,
) {
    let (client, relay_client) = tokio::io::duplex(128 * 1024);
    let (relay_server, server) = tokio::io::duplex(128 * 1024);
    let state = Arc::new(CaptureState::default());
    let id = state.activity.lock().unwrap().opened(Some(42));
    state.client_connections.store(1, Ordering::Relaxed);
    let connection = ActiveCaptureConnection {
        state: state.clone(),
        id,
    };
    let task = tokio::spawn(async move {
        forward_and_inspect(
            relay_client,
            relay_server,
            recorder,
            "capture.test".into(),
            &connection,
        )
        .await
    });
    (client, server, state, task)
}

async fn send_and_check(server: &mut DuplexStream, client: &mut DuplexStream, bytes: &[u8]) {
    server.write_all(bytes).await.unwrap();
    let mut received = vec![0; bytes.len()];
    client.read_exact(&mut received).await.unwrap();
    assert_eq!(received, bytes, "inspection must not change game bytes");
}

async fn initial_message(server: &mut DuplexStream, client: &mut DuplexStream) {
    let mut message = HEADERS.to_vec();
    message.extend(super::tests::server_frame(b"operation"));
    send_and_check(server, client, &message).await;
}

async fn both_directions_and_close(
    mut server: DuplexStream,
    mut client: DuplexStream,
    task: JoinHandle<Result<(), String>>,
) {
    client.write_all(b"next player action").await.unwrap();
    let mut action = [0; 18];
    server.read_exact(&mut action).await.unwrap();
    assert_eq!(&action, b"next player action");
    send_and_check(&mut server, &mut client, &[0x89, 4, b'p', b'i', b'n', b'g']).await;
    server.shutdown().await.unwrap();
    client.shutdown().await.unwrap();
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn blocked_recorder_cannot_delay_bidirectional_traffic_or_socket_shutdown() {
    let started = Arc::new(tokio::sync::Notify::new());
    let (release, receiver) = sync_channel(1);
    let _release_on_exit = ReleaseOnDrop(Some(release));
    let (mut client, mut server, _, task) = relay(BlockedRecorder {
        started: started.clone(),
        release: Mutex::new(receiver),
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        initial_message(&mut server, &mut client).await;
        started.notified().await;
        // The worker is still deliberately blocked until this test returns.
        both_directions_and_close(server, client, task).await;
    })
    .await
    .expect("game traffic and EOF must not wait for the blocked recorder");
}

#[tokio::test]
async fn saturated_recording_buffer_keeps_forwarding_and_reports_lost_capture() {
    let started = Arc::new(tokio::sync::Notify::new());
    let (release, receiver) = sync_channel(1);
    let _release_on_exit = ReleaseOnDrop(Some(release));
    let (mut client, mut server, state, task) = relay(BlockedRecorder {
        started: started.clone(),
        release: Mutex::new(receiver),
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        initial_message(&mut server, &mut client).await;
        started.notified().await;
        let batch = vec![0x42; FORWARD_BATCH_BYTES];
        for _ in 0..300 {
            send_and_check(&mut server, &mut client, &batch).await;
        }
        assert!(state
            .recording_health
            .lock()
            .unwrap()
            .error()
            .unwrap()
            .contains("fell behind"));
        both_directions_and_close(server, client, task).await;
    })
    .await
    .expect("a full recording queue must not backpressure the game");
}

#[tokio::test]
async fn recorder_panic_or_disk_failure_does_not_close_the_game_connection() {
    for panic in [false, true] {
        let (mut client, mut server, state, task) = relay(BrokenRecorder(panic));
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            initial_message(&mut server, &mut client).await;
            while state.recording_health.lock().unwrap().error().is_none() {
                tokio::task::yield_now().await;
            }
            both_directions_and_close(server, client, task).await;
        })
        .await
        .expect("recording failure must leave both game directions usable");
    }
}

#[tokio::test]
async fn oversized_frame_is_forwarded_unchanged_and_disables_only_recording() {
    let (mut client, mut server, state, task) = relay(BrokenRecorder(false));
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        let mut response = HEADERS.to_vec();
        response.extend([0x82, 127]);
        response.extend(((MAX_WEBSOCKET_MESSAGE + 1) as u64).to_be_bytes());
        send_and_check(&mut server, &mut client, &response).await;
        while state.recording_health.lock().unwrap().error().is_none() {
            tokio::task::yield_now().await;
        }
        assert!(state
            .recording_health
            .lock()
            .unwrap()
            .error()
            .unwrap()
            .contains("decode"));
        both_directions_and_close(server, client, task).await;
    })
    .await
    .unwrap();
}
