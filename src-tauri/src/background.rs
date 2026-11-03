//! Window-independent recording, durable preferences, and per-user sign-in startup.
//! Registration never stops the running recorder or changes a game's route.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager};

pub const BACKGROUND_ARGUMENT: &str = "--trace-background";
const AGENT_LABEL: &str = "com.isaiahw.matchlens.recorder";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct Preferences {
    launch_at_login: bool,
    recording_enabled: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            recording_enabled: true,
        }
    }
}

pub struct BackgroundState {
    path: PathBuf,
    preferences: Mutex<Preferences>,
    error: Mutex<Option<String>>,
    pub operation: tokio::sync::Mutex<()>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundStatus {
    pub launch_at_login: bool,
    pub recording_enabled: bool,
    pub supported: bool,
    pub last_error: Option<String>,
}

fn read_preferences(path: &Path) -> Result<Preferences, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("Could not read recording settings: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Preferences::default()),
        Err(e) => Err(format!("Could not read recording settings: {e}")),
    }
}

impl BackgroundState {
    pub fn load(path: PathBuf) -> Self {
        let (preferences, error) = match read_preferences(&path) {
            Ok(p) => (p, None),
            // An unreadable saved pause must not silently resume recording.
            Err(e) => (
                Preferences {
                    recording_enabled: false,
                    ..Preferences::default()
                },
                Some(e),
            ),
        };
        Self {
            path,
            preferences: Mutex::new(preferences),
            error: Mutex::new(error),
            operation: tokio::sync::Mutex::new(()),
        }
    }

    fn update(&self, change: impl FnOnce(&mut Preferences)) -> Result<(), String> {
        let mut preferences = self.preferences.lock().map_err(|e| e.to_string())?;
        let mut next = preferences.clone();
        change(&mut next);
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let bytes = serde_json::to_vec(&next).map_err(|e| e.to_string())?;
        let temporary = self.path.with_extension("tmp");
        fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
        replace_file(&temporary, &self.path)?;
        *preferences = next;
        Ok(())
    }

    pub fn should_record(&self) -> bool {
        self.preferences.lock().is_ok_and(|p| p.recording_enabled)
    }

    pub fn remember_recording(&self, enabled: bool) -> Result<(), String> {
        self.update(|p| p.recording_enabled = enabled)
    }
}

fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        if unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    fs::rename(source, destination).map_err(|e| e.to_string())
}

pub fn is_background_launch(args: &[String]) -> bool {
    args.iter().any(|arg| arg == BACKGROUND_ARGUMENT)
}

#[tauri::command]
pub fn background_status(app: AppHandle) -> BackgroundStatus {
    let state = app.state::<BackgroundState>();
    let preferences = state.preferences.lock().unwrap_or_else(|e| e.into_inner());
    BackgroundStatus {
        launch_at_login: preferences.launch_at_login,
        recording_enabled: preferences.recording_enabled,
        supported: cfg!(any(target_os = "macos", target_os = "windows")),
        last_error: state.error.lock().ok().and_then(|e| e.clone()),
    }
}

pub fn report_error(app: &AppHandle, error: Option<String>) {
    *app.state::<BackgroundState>()
        .error
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = error;
    notify(app);
}

pub fn notify(app: &AppHandle) {
    let _ = app.emit("background-status", background_status(app.clone()));
}

#[tauri::command]
pub async fn set_launch_at_login(
    app: AppHandle,
    enabled: bool,
) -> Result<BackgroundStatus, String> {
    let state = app.state::<BackgroundState>();
    let _operation = state.operation.lock().await;
    let result = tauri::async_runtime::spawn_blocking(move || register_startup(enabled))
        .await
        .map_err(|e| e.to_string())?;
    if let Err(error) = result {
        report_error(&app, Some(error.clone()));
        return Err(error);
    }
    state.update(|p| p.launch_at_login = enabled)?;
    report_error(&app, None);
    Ok(background_status(app.clone()))
}

pub fn show_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    let window = app.get_webview_window("main").map(Ok).unwrap_or_else(|| {
        tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?.build()
    });
    match window {
        Ok(window) => {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        Err(e) => report_error(app, Some(format!("Could not open Trace: {e}"))),
    }
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let open = MenuItem::with_id(app, "trace-open", "Open Trace", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "trace-pause", "Pause recording", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "trace-resume", "Resume recording", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "trace-quit", "Quit Trace", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &pause,
            &resume,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    if let Some(tray) = app.tray_by_id("trace-mascot") {
        tray.set_menu(Some(menu))?;
    }
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "trace-open" => show_window(app),
        "trace-pause" | "trace-resume" => {
            let resume = event.id().as_ref() == "trace-resume";
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let result = if resume {
                    crate::start_tracking(app.clone()).await
                } else {
                    crate::stop_tracking(app.clone()).await
                };
                if let Err(e) = result {
                    report_error(&app, Some(e));
                    show_window(&app);
                }
            });
        }
        "trace-quit" => app.exit(0),
        _ => {}
    });
    if is_background_launch(&std::env::args().collect::<Vec<_>>()) {
        #[cfg(target_os = "macos")]
        app.set_activation_policy(tauri::ActivationPolicy::Accessory)?;
    } else {
        show_window(app);
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // No webview, frontend timer, membership, or network account is required
        // to start recording. Never trigger an approval prompt at sign-in.
        let state = app.state::<BackgroundState>();
        let _operation = state.operation.lock().await;
        if state.should_record() {
            if let Err(e) = crate::capture::start(app.clone()).await {
                report_error(&app, Some(e));
            }
        }
        drop(_operation);
        loop {
            let status_app = app.clone();
            let Ok(status) =
                tauri::async_runtime::spawn_blocking(move || crate::capture::status(&status_app))
                    .await
            else {
                break;
            };
            let _ = pause.set_enabled(status.enabled);
            let _ = resume.set_enabled(!status.enabled);
            let message = if state.should_record()
                && (status.last_error.is_some() || !status.permission_ready)
            {
                "Trace — recording needs attention"
            } else if !status.enabled {
                "Trace — recording paused"
            } else if status.waiting_for_match_end {
                "Trace — close Pokémon once to connect"
            } else if status.client_attached {
                "Trace — connected"
            } else if status.route_active {
                "Trace — ready to record"
            } else {
                "Trace — connecting"
            };
            if let Some(tray) = app.tray_by_id("trace-mascot") {
                let _ = tray.set_tooltip(Some(message));
            }
            if status.permission_ready && (!status.enabled || !status.observer_running) {
                let _operation = state.operation.lock().await;
                if state.should_record() {
                    let error = crate::capture::start(app.clone()).await.err();
                    report_error(&app, error);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
    Ok(())
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(any(target_os = "macos", test))]
fn launch_agent(executable: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{AGENT_LABEL}</string>
<key>ProgramArguments</key><array><string>{}</string><string>{BACKGROUND_ARGUMENT}</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>15</integer>
<key>AbandonProcessGroup</key><true/>
<key>LimitLoadToSessionType</key><string>Aqua</string>
</dict></plist>
"#,
        xml_escape(&executable.to_string_lossy())
    )
}

#[cfg(any(target_os = "windows", test))]
fn windows_task(executable: &Path, sid: &str) -> String {
    let sid = xml_escape(sid);
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>Record Pokémon TCG Live matches while Trace's window is closed.</Description></RegistrationInfo>
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>{sid}</UserId></LogonTrigger></Triggers>
<Principals><Principal id="Recorder"><UserId>{sid}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
<Actions Context="Recorder"><Exec><Command>{}</Command><Arguments>{BACKGROUND_ARGUMENT}</Arguments></Exec></Actions>
</Task>
"#,
        xml_escape(&executable.to_string_lossy())
    )
}

#[cfg(target_os = "macos")]
fn register_startup(enabled: bool) -> Result<(), String> {
    use std::process::Command;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    if enabled
        && !executable
            .ancestors()
            .any(|p| p.extension().is_some_and(|e| e == "app"))
    {
        return Err("Install Trace in Applications before enabling launch at sign-in.".into());
    }
    let home = std::env::var_os("HOME").ok_or("Could not locate your login folder.")?;
    let path = PathBuf::from(home)
        .join("Library/LaunchAgents")
        .join(format!("{AGENT_LABEL}.plist"));
    let uid = Command::new("/usr/bin/id")
        .arg("-u")
        .output()
        .map_err(|e| e.to_string())?;
    if !uid.status.success() {
        return Err("Could not find your macOS login session.".into());
    }
    let domain = format!("gui/{}", String::from_utf8_lossy(&uid.stdout).trim());
    let service = format!("{domain}/{AGENT_LABEL}");
    if enabled {
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(&path, launch_agent(&executable)).map_err(|e| e.to_string())?;
        command_ok(Command::new("/bin/launchctl").args(["enable", &service]))?;
        let loaded = Command::new("/bin/launchctl")
            .args(["print", &service])
            .output()
            .map_err(|e| e.to_string())?
            .status
            .success();
        if !loaded {
            command_ok(
                Command::new("/bin/launchctl")
                    .arg("bootstrap")
                    .arg(domain)
                    .arg(&path),
            )?;
        }
    } else {
        // Disabling/removing the job must not bootout (kill) a live recorder.
        command_ok(Command::new("/bin/launchctl").args(["disable", &service]))?;
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_task_name() -> Result<(String, String), String> {
    let output = crate::hidden_windows_command("whoami.exe")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout);
    let sid = text
        .split(',')
        .next_back()
        .unwrap_or("")
        .trim()
        .trim_matches('"');
    if !output.status.success()
        || !sid.starts_with("S-1-")
        || !sid
            .chars()
            .all(|c| c.is_ascii_digit() || c == 'S' || c == '-')
    {
        return Err("Could not identify your Windows sign-in account.".into());
    }
    Ok((format!("Trace Background Recorder {sid}"), sid.to_owned()))
}

#[cfg(target_os = "windows")]
fn register_startup(enabled: bool) -> Result<(), String> {
    let (name, sid) = windows_task_name()?;
    if enabled {
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let path = std::env::temp_dir().join(format!("trace-startup-{}.xml", uuid::Uuid::new_v4()));
        let xml = windows_task(&executable, &sid);
        let bytes = std::iter::once(0xfeffu16)
            .chain(xml.encode_utf16())
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
        let result = command_ok(
            crate::hidden_windows_command("schtasks.exe")
                .args(["/Create", "/TN", &name, "/XML"])
                .arg(&path)
                .arg("/F"),
        );
        let _ = fs::remove_file(path);
        result
    } else {
        command_ok(
            crate::hidden_windows_command("schtasks.exe").args(["/Delete", "/TN", &name, "/F"]),
        )
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn register_startup(_enabled: bool) -> Result<(), String> {
    Err("Background recording supports Mac and Windows.".into())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn command_ok(command: &mut std::process::Command) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|e| format!("Could not update background startup: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not update background startup: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

pub fn uninstall_if_requested() -> bool {
    if std::env::args().nth(1).as_deref() != Some("--trace-uninstall-background") {
        return false;
    }
    let _ = register_startup(false);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pause_survives_restart_and_damaged_preferences_do_not_resume() {
        let path =
            std::env::temp_dir().join(format!("trace-background-{}.json", uuid::Uuid::new_v4()));
        let state = BackgroundState::load(path.clone());
        assert!(state.should_record());
        state.remember_recording(false).unwrap();
        assert!(!BackgroundState::load(path.clone()).should_record());
        state.update(|p| p.launch_at_login = true).unwrap();
        assert!(!BackgroundState::load(path.clone()).should_record());
        fs::write(&path, "broken").unwrap();
        let damaged = BackgroundState::load(path.clone());
        assert!(!damaged.should_record());
        assert!(damaged.error.lock().unwrap().is_some());
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn startup_targets_are_escaped_and_do_not_expire_or_stop_on_battery() {
        let agent = launch_agent(Path::new(
            "/Applications/Trace & Friends.app/Contents/MacOS/Trace",
        ));
        assert!(agent.contains("Trace &amp; Friends.app"));
        assert!(agent.contains("<key>SuccessfulExit</key><false/>"));
        assert!(agent.contains("<key>AbandonProcessGroup</key><true/>"));
        let task = windows_task(
            Path::new(r"C:\Program Files\Trace & Friends\Trace.exe"),
            "S-1-5-21-123",
        );
        assert!(task.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
        assert!(task.contains("<StopIfGoingOnBatteries>false"));
        assert!(task.contains("<DisallowStartIfOnBatteries>false"));
        assert!(task.contains("<LogonType>InteractiveToken</LogonType>"));
        assert!(task.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(task.contains("Trace &amp; Friends"));
        assert!(is_background_launch(&[
            "trace.exe".into(),
            BACKGROUND_ARGUMENT.into()
        ]));
        assert!(!is_background_launch(&[
            "trace.exe".into(),
            "--other".into()
        ]));
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "Registers and removes a real task; run on a disposable elevated Windows runner"]
    fn windows_sign_in_task_registers_with_scheduler() {
        register_startup(true).unwrap();
        let (name, _) = windows_task_name().unwrap();
        let query = crate::hidden_windows_command("schtasks.exe")
            .args(["/Query", "/TN", &name, "/XML"])
            .output();
        let cleanup = register_startup(false);
        let output = query.unwrap();
        cleanup.unwrap();
        assert!(output.status.success());
        // schtasks may emit UTF-16 when redirected.
        let xml = if output.stdout.iter().take(100).any(|b| *b == 0) {
            String::from_utf16_lossy(
                &output
                    .stdout
                    .chunks_exact(2)
                    .map(|v| u16::from_le_bytes([v[0], v[1]]))
                    .collect::<Vec<_>>(),
            )
        } else {
            String::from_utf8_lossy(&output.stdout).into_owned()
        };
        assert!(xml.contains(BACKGROUND_ARGUMENT), "{xml}");
        assert!(xml.contains("InteractiveToken"), "{xml}");
        assert!(xml.contains("HighestAvailable"), "{xml}");
        assert!(
            xml.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"),
            "{xml}"
        );
    }
}
