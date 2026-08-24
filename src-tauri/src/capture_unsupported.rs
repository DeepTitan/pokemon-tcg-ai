use crate::wire::CapturedOperation;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Manager};

const OBSERVER_PORT: u16 = 8899;
const UNSUPPORTED_MESSAGE: &str =
    "Automatic live capture is not installed on this platform yet. Match archive and review remain available.";

#[derive(Default)]
pub struct CaptureState {
    enabled: AtomicBool,
    last_error: Mutex<Option<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub permission_ready: bool,
    pub enabled: bool,
    pub observer_running: bool,
    pub route_active: bool,
    pub client_attached: bool,
    pub frame_count: u64,
    pub operation_count: u64,
    pub last_error: Option<String>,
    pub observer_port: u16,
}

pub fn status(app: &AppHandle) -> CaptureStatus {
    let state = app.state::<std::sync::Arc<CaptureState>>();
    CaptureStatus {
        permission_ready: false,
        enabled: state.enabled.load(Ordering::Relaxed),
        observer_running: false,
        route_active: false,
        client_attached: false,
        frame_count: 0,
        operation_count: 0,
        last_error: state.last_error.lock().ok().and_then(|value| value.clone()),
        observer_port: OBSERVER_PORT,
    }
}

pub fn recent_operations(_app: &AppHandle) -> Vec<CapturedOperation> {
    Vec::new()
}

pub fn request_permission(app: &AppHandle) -> Result<CaptureStatus, String> {
    if let Ok(mut last_error) = app
        .state::<std::sync::Arc<CaptureState>>()
        .last_error
        .lock()
    {
        *last_error = Some(UNSUPPORTED_MESSAGE.to_owned());
    }
    Err(UNSUPPORTED_MESSAGE.to_owned())
}

pub async fn start(app: AppHandle) -> Result<CaptureStatus, String> {
    request_permission(&app)
}

pub fn stop(app: &AppHandle) -> CaptureStatus {
    app.state::<std::sync::Arc<CaptureState>>()
        .enabled
        .store(false, Ordering::Relaxed);
    status(app)
}

pub fn shutdown(app: &AppHandle) {
    app.state::<std::sync::Arc<CaptureState>>()
        .enabled
        .store(false, Ordering::Relaxed);
}
