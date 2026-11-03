//! Best-effort recording must never apply backpressure to the game's transport.
//! Parsing, SQLite, fallback files and UI delivery run on bounded worker threads.
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicU8, AtomicUsize, Ordering},
        mpsc::{sync_channel, SyncSender},
        Arc,
    },
};

pub const FORWARD_BATCH_BYTES: usize = 64 * 1024;
// Tiny TLS records must have headroom too; the shared byte budget remains the
// primary memory limit, independent of the number of connections.
const QUEUE_SLOTS: usize = 4096;
const MAX_BUFFERED_BYTES: usize = 16 * 1024 * 1024;
const MAX_WORKERS: usize = 32;

#[derive(Clone, Copy, Debug)]
pub enum RecordingFault {
    Backlog = 1,
    Worker = 2,
    Decode = 3,
    Storage = 4,
}

#[derive(Default)]
pub struct RecordingHealth(AtomicU8);

impl RecordingHealth {
    pub fn fail(&self, fault: RecordingFault) {
        let _ = self
            .0
            .compare_exchange(0, fault as u8, Ordering::Relaxed, Ordering::Relaxed);
    }

    pub fn error(&self) -> Option<&'static str> {
        match self.0.load(Ordering::Relaxed) {
            0 => None,
            1 => Some("Recording fell behind. Part of this game may be missing. Game traffic is still being forwarded."),
            2 => Some("The recording worker stopped. Part of this game may be missing. Game traffic is still being forwarded."),
            3 => Some("Trace could not decode the game stream. Part of this game may be missing. Game traffic is still being forwarded."),
            _ => Some("Trace could not save the recording. Part of this game may be missing. Game traffic is still being forwarded."),
        }
    }
}

// Shared across sessions, including any old worker still waiting on the OS.
#[derive(Default)]
pub struct InspectionBudget {
    bytes: AtomicUsize,
    workers: AtomicUsize,
}

impl InspectionBudget {
    // Called only after the app's quit guard confirms the game is closed.
    // Network EOF never waits here. Give the final delivered operations time
    // to reach storage, without hanging app exit on a broken filesystem.
    pub fn wait_until_drained(&self, timeout: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        while self.bytes.load(Ordering::Relaxed) != 0 {
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        true
    }
}

struct Chunk {
    data: Vec<u8>,
    received_ms: u64,
    budget: Arc<InspectionBudget>,
}

impl Drop for Chunk {
    fn drop(&mut self) {
        self.budget
            .bytes
            .fetch_sub(self.data.len(), Ordering::Relaxed);
    }
}

struct WorkerPermit(Arc<InspectionBudget>);

impl Drop for WorkerPermit {
    fn drop(&mut self) {
        self.0.workers.fetch_sub(1, Ordering::Relaxed);
    }
}

pub struct InspectionQueue {
    sender: Option<SyncSender<Chunk>>,
    health: Arc<RecordingHealth>,
    budget: Arc<InspectionBudget>,
}

impl InspectionQueue {
    pub fn start(
        health: Arc<RecordingHealth>,
        budget: Arc<InspectionBudget>,
        mut inspect: impl FnMut(&[u8], u64) -> Result<(), RecordingFault> + Send + 'static,
    ) -> Self {
        let mut queue = Self {
            sender: None,
            health: health.clone(),
            budget: budget.clone(),
        };
        if budget
            .workers
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |count| {
                (count < MAX_WORKERS).then_some(count + 1)
            })
            .is_err()
        {
            health.fail(RecordingFault::Worker);
            return queue;
        }
        let permit = WorkerPermit(budget);
        let (sender, receiver) = sync_channel::<Chunk>(QUEUE_SLOTS);
        let worker_health = health.clone();
        let worker = std::thread::Builder::new()
            .name("trace-recording".into())
            .spawn(move || {
                let _permit = permit;
                let result = catch_unwind(AssertUnwindSafe(|| {
                    // Dropping the producer drains the already-forwarded prefix;
                    // network EOF and socket shutdown never wait for storage.
                    for chunk in receiver {
                        if let Err(fault) = inspect(&chunk.data, chunk.received_ms) {
                            worker_health.fail(fault);
                            break;
                        }
                    }
                }));
                if result.is_err() {
                    worker_health.fail(RecordingFault::Worker);
                }
            });
        if worker.is_ok() {
            queue.sender = Some(sender);
        } else {
            health.fail(RecordingFault::Worker);
        }
        queue
    }

    pub fn offer(&mut self, data: &[u8], received_ms: u64) {
        let Some(sender) = self.sender.as_ref() else {
            return;
        };
        let reserved = data.len() <= FORWARD_BATCH_BYTES
            && self
                .budget
                .bytes
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |used| {
                    used.checked_add(data.len())
                        .filter(|next| *next <= MAX_BUFFERED_BYTES)
                })
                .is_ok();
        if !reserved {
            self.health.fail(RecordingFault::Backlog);
            self.sender = None;
            return;
        }
        let chunk = Chunk {
            data: data.to_vec(),
            received_ms,
            budget: self.budget.clone(),
        };
        if let Err(error) = sender.try_send(chunk) {
            self.health.fail(match error {
                std::sync::mpsc::TrySendError::Full(_) => RecordingFault::Backlog,
                std::sync::mpsc::TrySendError::Disconnected(_) => RecordingFault::Worker,
            });
            // Missing bytes invalidate frame/compression boundaries. Stop this
            // recording stream; never silently resume in the middle of it.
            self.sender = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };

    fn wait_for_release(budget: &InspectionBudget) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while budget.workers.load(Ordering::Relaxed) != 0 {
            assert!(
                Instant::now() < deadline,
                "idle recording workers must exit"
            );
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(budget.bytes.load(Ordering::Relaxed), 0);
    }

    struct ReleaseOnDrop(Vec<mpsc::SyncSender<()>>);
    impl Drop for ReleaseOnDrop {
        fn drop(&mut self) {
            for release in &self.0 {
                let _ = release.try_send(());
            }
        }
    }

    #[test]
    fn total_buffer_is_bounded_across_connections_and_released_after_drain() {
        let budget = Arc::new(InspectionBudget::default());
        let health = Arc::new(RecordingHealth::default());
        let mut releases = ReleaseOnDrop(Vec::new());
        let mut queues = Vec::new();
        for _ in 0..2 {
            let (release, resume) = mpsc::sync_channel(1);
            let (started, ready) = mpsc::sync_channel(1);
            releases.0.push(release);
            let mut first = true;
            let mut queue = InspectionQueue::start(health.clone(), budget.clone(), move |_, _| {
                if first {
                    first = false;
                    started.send(()).unwrap();
                    resume.recv_timeout(Duration::from_secs(5)).unwrap();
                }
                Ok(())
            });
            queue.offer(&[0], 1);
            ready.recv_timeout(Duration::from_secs(2)).unwrap();
            queues.push(queue);
        }
        // A fragmented TLS burst must survive a briefly descheduled recorder;
        // packet count alone must not exhaust the buffer after just 256 bytes.
        for index in 0..2048 {
            queues[index % 2].offer(&[0], 2);
        }
        assert!(
            health.error().is_none(),
            "small TLS fragments need queue headroom"
        );
        let batch = vec![0; FORWARD_BATCH_BYTES];
        for index in 0..300 {
            queues[index % 2].offer(&batch, 2);
        }
        let buffered = budget.bytes.load(Ordering::Relaxed);
        assert!(
            buffered <= MAX_BUFFERED_BYTES && buffered > MAX_BUFFERED_BYTES - FORWARD_BATCH_BYTES
        );
        assert!(
            !budget.wait_until_drained(Duration::from_millis(10)),
            "a blocked disk must not hang app exit"
        );
        assert!(health.error().unwrap().contains("fell behind"));
        drop(queues);
        drop(releases);
        assert!(budget.wait_until_drained(Duration::from_secs(2)));
        wait_for_release(&budget);
    }

    #[test]
    fn worker_limit_spans_sessions_and_capacity_is_reusable() {
        let budget = Arc::new(InspectionBudget::default());
        let mut queues = Vec::new();
        for _ in 0..MAX_WORKERS {
            queues.push(InspectionQueue::start(
                Arc::default(),
                budget.clone(),
                |_, _| Ok(()),
            ));
        }
        let health = Arc::new(RecordingHealth::default());
        let _overflow = InspectionQueue::start(health.clone(), budget.clone(), |_, _| Ok(()));
        assert!(health.error().unwrap().contains("worker"));
        assert_eq!(budget.workers.load(Ordering::Relaxed), MAX_WORKERS);
        drop(queues);
        wait_for_release(&budget);
        let healthy = Arc::new(RecordingHealth::default());
        let (recorded, received) = mpsc::channel();
        let mut queue = InspectionQueue::start(healthy.clone(), budget.clone(), move |data, at| {
            recorded.send((data.to_vec(), at)).unwrap();
            Ok(())
        });
        queue.offer(b"first", 100);
        queue.offer(b"last", 200);
        drop(queue);
        assert_eq!(
            received.recv_timeout(Duration::from_secs(2)).unwrap(),
            (b"first".to_vec(), 100)
        );
        assert_eq!(
            received.recv_timeout(Duration::from_secs(2)).unwrap(),
            (b"last".to_vec(), 200)
        );
        wait_for_release(&budget);
        assert!(
            healthy.error().is_none(),
            "producer EOF must drain the complete recording in order"
        );
    }
}
