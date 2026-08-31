use crate::capture_hosts;
pub use crate::capture_hosts::GAME_HOST;
use serde::Serialize;
use std::{
    ffi::OsString,
    fs,
    net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs},
    os::windows::ffi::OsStringExt,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject, INFINITE,
        PROCESS_QUERY_LIMITED_INFORMATION,
    },
};

pub const CA_COMMON_NAME: &str = "Turnlume Local Capture Root";
pub const LEGACY_CA_COMMON_NAME: &str = "Match Lens Pokémon Capture Root";
const WATCHDOG_ARGUMENT: &str = "--trace-route-watchdog";
const CLEANUP_ARGUMENT: &str = "--trace-route-cleanup";
const CLEANUP_SESSION_ARGUMENT: &str = "--trace-route-cleanup-session";
const RECOVERY_TASK_PREFIX: &str = "Trace Capture Recovery ";

fn hidden_command(program: &str) -> Command {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

pub struct RouteHandle {
    session_id: String,
    watchdog: Option<Child>,
    stopped: bool,
}

impl RouteHandle {
    fn stop(&mut self) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        // Only stop the out-of-process guard after cleanup succeeds. If the
        // hosts file is temporarily locked, the guard remains alive and gets
        // another chance as soon as the parent exits.
        if cleanup_session(&self.session_id).is_ok() {
            if let Some(mut watchdog) = self.watchdog.take() {
                let _ = watchdog.kill();
                let _ = watchdog.wait();
            }
        }
    }
}

impl Drop for RouteHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperReply {
    pub ok: bool,
    pub version: String,
    pub route_active: bool,
    pub server_ips: Vec<String>,
    pub error: Option<String>,
}

fn hosts_path() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join(r"System32\drivers\etc\hosts")
}

fn is_elevated() -> bool {
    hidden_command("fltmc.exe")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn install_helper(certificate_path: &Path) -> Result<(), String> {
    if !is_elevated() {
        return Err(
            "Windows live capture needs Trace to run as administrator so it can route only the Pokémon game host."
                .to_owned(),
        );
    }
    let output = hidden_command("certutil.exe")
        .args(["-addstore", "-f", "Root"])
        .arg(certificate_path)
        .output()
        .map_err(|error| format!("Could not install the local capture certificate: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        Err(if error.is_empty() {
            "Windows did not install the local capture certificate.".to_owned()
        } else {
            error
        })
    }
}

fn process_image_path(pid: u32) -> Result<PathBuf, String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return Err("Could not inspect the running Pokémon client.".to_owned());
        }
        let mut buffer = vec![0u16; 32_768];
        let mut length = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut length);
        let _ = CloseHandle(handle);
        if result == 0 || length == 0 {
            return Err("Could not locate the running Pokémon client.".to_owned());
        }
        buffer.truncate(length as usize);
        Ok(PathBuf::from(OsString::from_wide(&buffer)))
    }
}

pub fn restart_pokemon_client(pid: u32) -> Result<(), String> {
    let executable = process_image_path(pid)?;
    let stopped = hidden_command("taskkill.exe")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .map_err(|error| format!("Could not reconnect Pokémon TCG Live: {error}"))?;
    if !stopped.status.success() {
        return Err("Could not reconnect the already-running Pokémon client.".to_owned());
    }
    thread::sleep(Duration::from_millis(350));
    Command::new("explorer.exe")
        .arg(executable)
        .spawn()
        .map_err(|error| format!("Could not relaunch Pokémon TCG Live: {error}"))?;
    Ok(())
}

pub fn helper_ready() -> bool {
    is_elevated()
}

fn flush_dns_cache() {
    let _ = hidden_command("ipconfig.exe").arg("/flushdns").output();
}

fn remove_host_override(session: Option<&str>) -> Result<(), String> {
    let path = hosts_path();
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read the Windows hosts file: {error}"))?;
    let cleaned = capture_hosts::without_managed_route(&contents, session);
    if cleaned.changed {
        fs::write(&path, cleaned.contents)
            .map_err(|error| format!("Could not remove the Pokémon capture route: {error}"))?;
        flush_dns_cache();
    }
    Ok(())
}

fn recovery_task_name(session_id: &str) -> String {
    format!("{RECOVERY_TASK_PREFIX}{session_id}")
}

fn command_output_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || (bytes.len() > 3 && bytes[1] == 0 && bytes[3] == 0) {
        let words = bytes
            .chunks_exact(2)
            .skip_while(|word| *word == [0xff, 0xfe])
            .map(|word| u16::from_le_bytes([word[0], word[1]]))
            .collect::<Vec<_>>();
        String::from_utf16_lossy(&words)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

fn register_recovery_task(session_id: &str) -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate Trace for route recovery: {error}"))?;
    let action = format!(
        "\"{}\" {CLEANUP_SESSION_ARGUMENT} {session_id}",
        executable.to_string_lossy()
    );
    let output = hidden_command("schtasks.exe")
        .args([
            "/Create",
            "/SC",
            "ONLOGON",
            "/TN",
            &recovery_task_name(session_id),
            "/TR",
            &action,
            "/RL",
            "HIGHEST",
            "/F",
        ])
        .output()
        .map_err(|error| format!("Could not arm capture recovery: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = command_output_text(&output.stderr).trim().to_owned();
        let error = if stderr.is_empty() {
            command_output_text(&output.stdout).trim().to_owned()
        } else {
            stderr
        };
        Err(if error.is_empty() {
            "Windows did not arm capture recovery. Trace left the game route unchanged.".to_owned()
        } else {
            format!("Windows did not arm capture recovery: {error}")
        })
    }
}

fn remove_recovery_task(session_id: &str) {
    let _ = hidden_command("schtasks.exe")
        .args(["/Delete", "/TN", &recovery_task_name(session_id), "/F"])
        .output();
}

fn remove_all_recovery_tasks() {
    let Ok(output) = hidden_command("schtasks.exe")
        .args(["/Query", "/FO", "CSV", "/NH"])
        .output()
    else {
        return;
    };
    let listing = command_output_text(&output.stdout);
    for line in listing.lines() {
        let line = line.trim_start_matches('\u{feff}').trim();
        let name = if let Some(quoted) = line.strip_prefix('"') {
            quoted.split('"').next().unwrap_or_default()
        } else {
            line.split(',').next().unwrap_or_default().trim()
        };
        let name = name.trim_start_matches('\\');
        if name.starts_with(RECOVERY_TASK_PREFIX) {
            let _ = hidden_command("schtasks.exe")
                .args(["/Delete", "/TN", &format!("\\{name}"), "/F"])
                .output();
        }
    }
}

fn cleanup_session(session_id: &str) -> Result<(), String> {
    remove_host_override(Some(session_id))?;
    remove_recovery_task(session_id);
    Ok(())
}

pub fn recover_stale_route() -> Result<(), String> {
    remove_host_override(None)?;
    remove_all_recovery_tasks();
    Ok(())
}

fn wait_for_parent_exit(parent_pid: u32) {
    const PROCESS_SYNCHRONIZE: u32 = 0x0010_0000;
    unsafe {
        let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, parent_pid);
        if !process.is_null() {
            let _ = WaitForSingleObject(process, INFINITE);
            let _ = CloseHandle(process);
        }
    }
}

fn start_watchdog(parent_pid: u32, session_id: &str) -> Result<Child, String> {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate Trace for route protection: {error}"))?;
    Command::new(executable)
        .args([WATCHDOG_ARGUMENT, &parent_pid.to_string(), session_id])
        .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start capture route protection: {error}"))
}

fn pokemon_server_ips() -> Result<Vec<IpAddr>, String> {
    let ips = (GAME_HOST, 443)
        .to_socket_addrs()
        .map_err(|error| format!("Could not resolve the Pokémon game server: {error}"))?
        .map(|address| address.ip())
        .filter(|ip| !ip.is_loopback())
        .collect::<Vec<_>>();
    // The production name returns multiple regional edges. The game races
    // them, but Trace has to resolve before replacing the name with loopback.
    // Prefer the first edge to establish a connection from this machine, then
    // pin that edge for the capture session. Merely choosing the first numeric
    // address can leave the client parked at the asset-loading checkpoint even
    // though TCP and TLS both connect successfully.
    let mut unique = Vec::with_capacity(ips.len());
    for ip in ips {
        if !unique.contains(&ip) {
            unique.push(ip);
        }
    }
    let ips = prioritize_fastest_server(unique, 443);
    if ips.is_empty() {
        Err("Pokémon TCG Live has no reachable game-server address yet.".to_owned())
    } else {
        Ok(ips)
    }
}

fn prioritize_fastest_server(mut ips: Vec<IpAddr>, port: u16) -> Vec<IpAddr> {
    if ips.len() < 2 {
        return ips;
    }

    let (sender, receiver) = std::sync::mpsc::channel();
    for ip in ips.iter().copied() {
        let sender = sender.clone();
        thread::spawn(move || {
            let address = SocketAddr::new(ip, port);
            if TcpStream::connect_timeout(&address, Duration::from_secs(2)).is_ok() {
                let _ = sender.send(ip);
            }
        });
    }
    drop(sender);

    if let Ok(preferred) = receiver.recv_timeout(Duration::from_millis(2_250)) {
        if let Some(index) = ips.iter().position(|ip| *ip == preferred) {
            ips.swap(0, index);
        }
    }
    ips
}

pub fn enable_route(app_pid: u32, _pokemon_pid: u32) -> Result<(HelperReply, RouteHandle), String> {
    if !is_elevated() {
        return Err(
            "Windows live capture needs Trace to run as administrator so it can route only the Pokémon game host."
                .to_owned(),
        );
    }
    recover_stale_route()?;
    let ips = pokemon_server_ips()?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let watchdog = start_watchdog(app_pid, &session_id)?;
    let handle = RouteHandle {
        session_id: session_id.clone(),
        watchdog: Some(watchdog),
        stopped: false,
    };
    register_recovery_task(&session_id)?;
    let path = hosts_path();
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read the Windows hosts file: {error}"))?;
    let clean = capture_hosts::without_managed_route(&contents, None).contents;
    let routed = capture_hosts::with_managed_route(&clean, &session_id);
    fs::write(&path, routed)
        .map_err(|error| format!("Could not enable the Pokémon capture route: {error}"))?;
    flush_dns_cache();
    Ok((
        HelperReply {
            ok: true,
            version: env!("CARGO_PKG_VERSION").to_owned(),
            route_active: true,
            server_ips: ips.iter().map(ToString::to_string).collect(),
            error: None,
        },
        handle,
    ))
}

pub fn disable_route(handle: &mut RouteHandle) {
    handle.stop();
}

pub fn run_if_requested() -> bool {
    let arguments = std::env::args().collect::<Vec<_>>();
    match arguments.get(1).map(String::as_str) {
        Some(WATCHDOG_ARGUMENT) => {
            let parent_pid = arguments.get(2).and_then(|pid| pid.parse::<u32>().ok());
            let session_id = arguments.get(3).cloned();
            if let (Some(parent_pid), Some(session_id)) = (parent_pid, session_id) {
                wait_for_parent_exit(parent_pid);
                let _ = cleanup_session(&session_id);
            }
            true
        }
        Some(CLEANUP_SESSION_ARGUMENT) => {
            if let Some(session_id) = arguments.get(2) {
                let _ = cleanup_session(session_id);
            }
            true
        }
        Some(CLEANUP_ARGUMENT) => {
            let _ = recover_stale_route();
            true
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::prioritize_fastest_server;
    use std::net::{IpAddr, Ipv4Addr, TcpListener};

    #[test]
    fn reachable_server_is_prioritized_over_failed_first_answer() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind test server");
        let port = listener.local_addr().expect("test server address").port();
        let reachable = IpAddr::V4(Ipv4Addr::LOCALHOST);
        let failed = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 2));

        let prioritized = prioritize_fastest_server(vec![failed, reachable], port);

        assert_eq!(prioritized, vec![reachable, failed]);
    }
}
