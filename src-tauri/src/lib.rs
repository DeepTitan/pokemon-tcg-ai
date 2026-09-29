#[cfg(any(target_os = "macos", target_os = "windows"))]
mod capture;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[path = "capture_unsupported.rs"]
mod capture;
#[cfg(any(target_os = "windows", test))]
mod capture_hosts;
mod cards;
mod cloud_sync;
mod deck_access;
mod membership;
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
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use tauri::Manager;

#[cfg(target_os = "windows")]
fn hidden_windows_command(program: &str) -> Command {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
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
        let output = hidden_windows_command("tasklist")
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
        let line = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()?
            .to_owned();
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
            std::env::var_os("USERPROFILE").map(|root| {
                Path::new(&root)
                    .join("The Pokémon Company International")
                    .join("Pokémon Trading Card Game Live")
                    .join("Pokemon TCG Live.exe")
            }),
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
async fn open_leaderboard() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            const LEADERBOARD_URL: &str = "https://victoryroad.app/trace/leaderboard";
            #[cfg(target_os = "macos")]
            let output = Command::new("/usr/bin/open").arg(LEADERBOARD_URL).output();
            #[cfg(target_os = "windows")]
            let output = hidden_windows_command("rundll32.exe")
                .args(["url.dll,FileProtocolHandler", LEADERBOARD_URL])
                .output();
            let output = output.map_err(|error| {
                format!("Could not launch your default browser for Leaderboards: {error}")
            })?;
            if output.status.success() {
                return Ok(());
            }
            let details = String::from_utf8_lossy(&output.stderr);
            let details = details.trim();
            if details.is_empty() {
                Err(format!(
                    "Could not open Leaderboards in your default browser ({})",
                    output.status
                ))
            } else {
                Err(format!(
                    "Could not open Leaderboards in your default browser ({}): {details}",
                    output.status
                ))
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("Opening Leaderboards is not supported on this platform".to_owned())
        }
    })
    .await
    .map_err(|error| format!("Could not finish opening Leaderboards: {error}"))?
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
fn recent_match_operations(
    app: tauri::AppHandle,
    membership: tauri::State<'_, membership::Membership>,
    storage: tauri::State<'_, storage::MatchStorage>,
) -> Result<Vec<wire::CapturedOperation>, String> {
    capture::recent_operations(&app)
        .into_iter()
        .map(|operation| {
            let id = format!(
                "live-{}",
                operation.match_id.as_deref().unwrap_or(&operation.game_id)
            );
            if storage.replay_requires_pro(&id)? && !membership.has_full_history() {
                return Ok(None);
            }
            Ok(Some(storage.match_access(&id)?.project_operation_for_plan(operation, membership.has_full_history())))
        })
        .filter_map(|result| result.transpose())
        .collect()
}

async fn verify_replay_access(
    storage: &storage::MatchStorage,
    membership: &membership::Membership,
    cloud: &cloud_sync::CloudSync,
    id: &str,
) -> Result<(), String> {
    if storage.replay_requires_pro(id)? && !membership.has_full_history() {
        membership.refresh(cloud).await;
        membership.require_full_history()?;
    }
    Ok(())
}

#[tauri::command]
async fn import_legacy_reviews(
    storage: tauri::State<'_, storage::MatchStorage>,
    reviews: Vec<Value>,
    reducer_version: i64,
) -> Result<(), String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage.import_legacy_reviews(reviews, reducer_version))
        .await.map_err(|e| e.to_string())?
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
    tauri::async_runtime::spawn_blocking(move || {
        storage
            .list_summaries(offset, limit)?
            .into_iter()
            .map(|summary| storage.project_summary(summary))
            .collect::<Result<Vec<_>, String>>()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_match_review(
    membership: tauri::State<'_, membership::Membership>,
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
    storage: tauri::State<'_, storage::MatchStorage>,
    match_id: String,
) -> Result<tauri::ipc::Response, String> {
    verify_replay_access(&storage, &membership, &cloud_sync, &match_id).await?;
    let pro = membership.has_full_history();
    let storage = storage.inner().clone();
    let json = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let access = storage.match_access(&match_id)?;
        let value = storage
            .load_review(&match_id)?
            .map(|review| access.project_review_for_plan(review, pro))
            .unwrap_or(Value::Null);
        serde_json::to_string(&value).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(json))
}

#[tauri::command]
async fn persist_match_review(
    storage: tauri::State<'_, storage::MatchStorage>,
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
    review: Value,
    reducer_version: i64,
) -> Result<storage::MatchSummary, String> {
    let storage = storage.inner().clone();
    let storage_for_persist = storage.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || {
        let review = storage_for_persist.review_for_storage(review)?;
        let summary = storage_for_persist.persist_review(&review, reducer_version)?;
        storage_for_persist.project_summary(summary)
    })
    .await
    .map_err(|error| error.to_string())??;
    let cloud_sync = cloud_sync.inner().clone();
    tauri::async_runtime::spawn(async move {
        cloud_sync.sync_pending(storage).await;
    });
    Ok(summary)
}

#[tauri::command]
async fn share_match(
    storage: tauri::State<'_, storage::MatchStorage>,
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
    review: Value,
    reducer_version: i64,
) -> Result<cloud_sync::ShareLink, String> {
    let storage = storage.inner().clone();
    let (review, summary) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let review = storage.review_for_storage(review)?;
        let summary = storage.persist_review(&review, reducer_version)?;
        Ok((review, summary))
    })
    .await
    .map_err(|error| error.to_string())??;
    cloud_sync
        .share_review(&review, reducer_version, &summary)
        .await
}

#[tauri::command]
async fn load_match_operations(
    membership: tauri::State<'_, membership::Membership>,
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
    storage: tauri::State<'_, storage::MatchStorage>,
    match_id: String,
) -> Result<Vec<wire::CapturedOperation>, String> {
    verify_replay_access(&storage, &membership, &cloud_sync, &match_id).await?;
    let pro = membership.has_full_history();
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<_>, String> {
        let access = storage.match_access(&match_id)?;
        Ok(storage
            .load_operations(&match_id)?
            .into_iter()
            .map(|operation| access.project_operation_for_plan(operation, pro))
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_raw_match_ids(
    membership: tauri::State<'_, membership::Membership>,
    storage: tauri::State<'_, storage::MatchStorage>,
    pending_only: bool,
    reducer_version: i64,
    limit: i64,
) -> Result<Vec<String>, String> {
    let storage = storage.inner().clone();
    let full_history = membership.has_full_history();
    tauri::async_runtime::spawn_blocking(move || {
        storage.raw_match_ids(pending_only, reducer_version, limit)?
            .into_iter().filter_map(|id| match storage.replay_requires_pro(&id) {
                Ok(true) if !full_history => None,
                Ok(_) => Some(Ok(id)),
                Err(error) => Some(Err(error)),
            }).collect::<Result<Vec<_>, String>>()
    })
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
async fn open_membership_account() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        open_account_url("https://victoryroad.app/trace/account")
    })
    .await
    .map_err(|_| "Could not open your account.")?
}

#[tauri::command]
async fn membership_status(
    membership: tauri::State<'_, membership::Membership>,
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
) -> Result<membership::MembershipStatus, String> {
    Ok(membership.refresh(&cloud_sync).await)
}

#[tauri::command]
async fn membership_link(
    membership: tauri::State<'_, membership::Membership>,
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
) -> Result<membership::MembershipLink, String> {
    let link = membership.link(&cloud_sync).await?;
    let url = link.verification_url.clone();
    tauri::async_runtime::spawn_blocking(move || open_account_url(&url))
        .await
        .map_err(|_| "Could not open account linking.")??;
    Ok(link)
}

fn open_account_url(url: &str) -> Result<(), String> {
    // The only caller passes a link validated against a fixed HTTPS origin/path.
    #[cfg(target_os = "macos")]
    let output = Command::new("/usr/bin/open").arg(url).output();
    #[cfg(target_os = "windows")]
    let output = hidden_windows_command("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .output();
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    return output
        .map_err(|_| "Could not open your browser.".to_owned())
        .and_then(|v| {
            if v.status.success() {
                Ok(())
            } else {
                Err("Could not open your browser.".into())
            }
        });
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = url;
        Err("Account linking is not supported on this platform.".into())
    }
}

#[tauri::command]
async fn membership_unlink(
    membership: tauri::State<'_, membership::Membership>,
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
) -> Result<membership::MembershipStatus, String> {
    membership.unlink(&cloud_sync).await
}

#[tauri::command]
async fn load_opponent_decklist(
    membership: tauri::State<'_, membership::Membership>,
    cloud_sync: tauri::State<'_, cloud_sync::CloudSync>,
    storage: tauri::State<'_, storage::MatchStorage>,
    match_id: String,
) -> Result<Value, String> {
    if !membership.refresh(&cloud_sync).await.opponent_decklists {
        return Err(
            "An active Supporters Club membership is required to view opponent decklists.".into(),
        );
    }
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || storage.match_access(&match_id)?.opponent_deck())
        .await
        .map_err(|e| e.to_string())?
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
            .filter(|card| {
                card.image_path
                    .as_deref()
                    .is_none_or(|path| !Path::new(path).is_file())
            })
            .map(|card| card.id.clone())
            .collect::<std::collections::HashSet<_>>();
        let cached_ids = cached
            .iter()
            .map(|card| card.id.clone())
            .collect::<std::collections::HashSet<_>>();
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
            #[cfg(target_os = "windows")]
            if let Err(error) = privileged::recover_stale_route() {
                if let Ok(mut last_error) = app.state::<Arc<CaptureState>>().last_error.lock() {
                    *last_error = Some(format!(
                        "Trace could not repair a leftover Windows capture route: {error}"
                    ));
                }
            }
            let database_path = app.path().app_data_dir()?.join("trace.sqlite3");
            let storage =
                storage::MatchStorage::new(database_path).map_err(std::io::Error::other)?;
            storage.prepare_legacy_replay_snapshot(&app.path().app_data_dir()?.join("capture/operations.jsonl"))
                .map_err(std::io::Error::other)?;
            let cloud_sync_path = app.path().app_data_dir()?.join("cloud-sync.json");
            let cloud_sync = cloud_sync::CloudSync::new(cloud_sync_path);
            app.manage(storage.clone());
            app.manage(cloud_sync.clone());
            let membership = membership::Membership::new();
            app.manage(membership.clone());
            let membership_cloud = cloud_sync.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    membership.refresh(&membership_cloud).await;
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                }
            });
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                loop {
                    cloud_sync.sync_pending(storage.clone()).await;
                    tokio::time::sleep(std::time::Duration::from_secs(20)).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                capture::shutdown(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_leaderboard,
            membership_status,
            open_membership_account,
            membership_link,
            membership_unlink,
            load_opponent_decklist,
            tracker_environment,
            capture_status,
            recent_match_operations,
            initialize_tracker_storage,
            import_legacy_reviews,
            list_match_summaries,
            load_match_review,
            persist_match_review,
            share_match,
            load_match_operations,
            list_raw_match_ids,
            resolve_card_sources,
            request_capture_permission,
            start_tracking,
            stop_tracking,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Trace")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                capture::shutdown(app);
            }
        });
}

pub fn run_privileged_helper_if_requested() -> bool {
    privileged::run_if_requested()
}
