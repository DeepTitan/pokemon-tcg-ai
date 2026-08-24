mod cards;
mod cloud_sync;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod capture;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[path = "capture_unsupported.rs"]
mod capture;
#[cfg(target_os = "macos")]
mod privileged;
#[cfg(target_os = "windows")]
#[path = "privileged_windows.rs"]
mod privileged;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[path = "privileged_unsupported.rs"]
mod privileged;
mod storage;
mod wire;

use capture::{CaptureState, CaptureStatus};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use tauri::Manager;
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackerEnvironment {
    client_installed: bool,
    client_running: bool,
    pid: Option<u32>,
    capture_mode: &'static str,
    capture: CaptureStatus,
}

pub(crate) fn pokemon_client_pid() -> Option<u32> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("pgrep")
            .args(["-x", "Pokemon TCG Live"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .and_then(|line| line.trim().parse::<u32>().ok())
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("tasklist")
            .args([
                "/FI",
                "IMAGENAME eq Pokemon TCG Live.exe",
                "/FO",
                "CSV",
                "/NH",
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let line = String::from_utf8_lossy(&output.stdout).lines().next()?.to_owned();
        let mut columns = line.split(',').map(|column| column.trim_matches('"'));
        let image_name = columns.next()?;
        let pid = columns.next()?;
        image_name
            .eq_ignore_ascii_case("Pokemon TCG Live.exe")
            .then(|| pid.parse::<u32>().ok())
            .flatten()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

fn pokemon_client_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        return Path::new("/Applications/Pokemon TCG Live.app").exists();
    }
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            std::env::var_os("ProgramFiles").map(|root| {
                Path::new(&root)
                    .join("Pokemon Trading Card Game Live")
                    .join("Pokemon TCG Live.exe")
            }),
            std::env::var_os("LOCALAPPDATA").map(|root| {
                Path::new(&root)
                    .join("Programs")
                    .join("Pokemon Trading Card Game Live")
                    .join("Pokemon TCG Live.exe")
            }),
        ];
        return candidates.into_iter().flatten().any(|path| path.is_file());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

fn capture_mode() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "existing-client"
    }
    #[cfg(target_os = "windows")]
    {
        "existing-client"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "review-only"
    }
}

#[tauri::command]
fn tracker_environment(app: tauri::AppHandle) -> TrackerEnvironment {
    let pid = pokemon_client_pid();
    TrackerEnvironment {
        client_installed: pokemon_client_installed(),
        client_running: pid.is_some(),
        pid,
        capture_mode: capture_mode(),
        capture: capture::status(&app),
    }
}

#[tauri::command]
fn capture_status(app: tauri::AppHandle) -> CaptureStatus {
    capture::status(&app)
}

#[tauri::command]
fn recent_match_operations(app: tauri::AppHandle) -> Vec<wire::CapturedOperation> {
    capture::recent_operations(&app)
}

#[tauri::command]
async fn initialize_tracker_storage(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::MatchStorage>,
) -> Result<storage::StorageStatus, String> {
    let storage = storage.inner().clone();
    let legacy_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("capture/operations.jsonl");
    tauri::async_runtime::spawn_blocking(move || {
        let imported = storage.import_legacy_jsonl(&legacy_path)?;
        storage.status(imported)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_match_summaries(
    storage: tauri::State<'_, storage::MatchStorage>,
    offset: i64,
    limit: i64,
) -> Result<Vec<storage::MatchSummary>, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage.list_summaries(offset, limit))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_match_review(
    storage: tauri::State<'_, storage::MatchStorage>,
    match_id: String,
) -> Result<Option<Value>, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage.load_review(&match_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn persist_match_review(
    storage: tauri::State<'_, storage::MatchStorage>,
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
    review: Value,
    reducer_version: i64,
) -> Result<storage::MatchSummary, String> {
    let storage = storage.inner().clone();
    let review_for_cloud = review.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || storage.persist_review(&review, reducer_version))
        .await
        .map_err(|error| error.to_string())??;
    let cloud_sync = cloud_sync.inner().clone();
    tauri::async_runtime::spawn(async move {
        cloud_sync.sync_review(review_for_cloud, reducer_version).await;
    });
    Ok(summary)
}

#[tauri::command]
async fn cloud_sync_status(
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
) -> Result<cloud_sync::CloudSyncStatus, String> {
    Ok(cloud_sync.status().await)
}

#[tauri::command]
async fn set_cloud_sync_enabled(
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
    enabled: bool,
) -> Result<cloud_sync::CloudSyncStatus, String> {
    cloud_sync.set_enabled(enabled).await
}

#[tauri::command]
async fn load_match_operations(
    storage: tauri::State<'_, storage::MatchStorage>,
    match_id: String,
) -> Result<Vec<wire::CapturedOperation>, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage.load_operations(&match_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_raw_match_ids(
    storage: tauri::State<'_, storage::MatchStorage>,
    pending_only: bool,
    reducer_version: i64,
    limit: i64,
) -> Result<Vec<String>, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage.raw_match_ids(pending_only, reducer_version, limit))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn request_capture_permission(app: tauri::AppHandle) -> Result<CaptureStatus, String> {
    tauri::async_runtime::spawn_blocking(move || capture::request_permission(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn start_tracking(app: tauri::AppHandle) -> Result<CaptureStatus, String> {
    capture::start(app).await
}

#[tauri::command]
async fn resolve_card_sources(
    app: tauri::AppHandle,
    storage: tauri::State<'_, storage::MatchStorage>,
    card_ids: Vec<String>,
) -> Result<Vec<cards::CardInfo>, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cached = storage.load_cards(&card_ids)?;
        let retry_ids = cached
            .iter()
            .filter(|card| card.image_path.as_deref().is_none_or(|path| !Path::new(path).is_file()))
            .map(|card| card.id.clone())
            .collect::<std::collections::HashSet<_>>();
        let cached_ids = cached.iter().map(|card| card.id.clone()).collect::<std::collections::HashSet<_>>();
        let missing = card_ids
            .iter()
            .filter(|id| !cached_ids.contains(*id) || retry_ids.contains(*id))
            .cloned()
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            cached.retain(|card| !retry_ids.contains(&card.id));
            let resolved = cards::resolve(&app, missing)?;
            storage.save_cards(&resolved)?;
            cached.extend(resolved);
        }
        cached.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(cached)
    })
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn stop_tracking(app: tauri::AppHandle) -> CaptureStatus {
    capture::stop(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_process::init());
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        builder = builder.on_tray_icon_event(|app, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        });
    }
    builder
        .manage(Arc::new(CaptureState::default()))
        .setup(|app| {
            let database_path = app.path().app_data_dir()?.join("trace.sqlite3");
            let storage = storage::MatchStorage::new(database_path)
                .map_err(std::io::Error::other)?;
            app.manage(storage);
            let cloud_sync_path = app.path().app_data_dir()?.join("cloud-sync.json");
            let cloud_sync = cloud_sync::CloudSync::new(cloud_sync_path)
                .map_err(std::io::Error::other)?;
            app.manage(cloud_sync);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                capture::shutdown(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            tracker_environment,
            capture_status,
            recent_match_operations,
            initialize_tracker_storage,
            list_match_summaries,
            load_match_review,
            persist_match_review,
            cloud_sync_status,
            set_cloud_sync_enabled,
            load_match_operations,
            list_raw_match_ids,
            resolve_card_sources,
            request_capture_permission,
            start_tracking,
            stop_tracking,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Trace");
}

pub fn run_privileged_helper_if_requested() -> bool {
    privileged::run_if_requested()
}
