use serde::Serialize;
use std::{
    ffi::OsString,
    fs,
    net::{IpAddr, ToSocketAddrs},
    os::windows::ffi::OsStringExt,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
};

pub const GAME_HOST: &str = "api.us-east-1.studio-prod.pokemon.com";
pub const CA_COMMON_NAME: &str = "Turnlume Local Capture Root";
pub const LEGACY_CA_COMMON_NAME: &str = "Match Lens Pokémon Capture Root";
const HOSTS_BEGIN: &str = "# Match Lens local capture begin";
const HOSTS_END: &str = "# Match Lens local capture end";

fn hidden_command(program: &str) -> Command {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[derive(Default)]
pub struct RouteHandle;

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

fn hosts_without_override(contents: &str) -> String {
    let mut output = Vec::new();
    let mut skipping = false;
    for line in contents.lines() {
        if line.trim() == HOSTS_BEGIN {
            skipping = true;
            continue;
        }
        if line.trim() == HOSTS_END {
            skipping = false;
            continue;
        }
        if !skipping {
            output.push(line);
        }
    }
    let mut result = output.join("\r\n");
    result.push_str("\r\n");
    result
}

fn flush_dns_cache() {
    let _ = hidden_command("ipconfig.exe").arg("/flushdns").output();
}

fn remove_host_override() -> Result<(), String> {
    let path = hosts_path();
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read the Windows hosts file: {error}"))?;
    if contents.contains(HOSTS_BEGIN) || contents.contains(HOSTS_END) {
        fs::write(&path, hosts_without_override(&contents))
            .map_err(|error| format!("Could not remove the Pokémon capture route: {error}"))?;
        flush_dns_cache();
    }
    Ok(())
}

fn pokemon_server_ips() -> Result<Vec<IpAddr>, String> {
    let mut ips = (GAME_HOST, 443)
        .to_socket_addrs()
        .map_err(|error| format!("Could not resolve the Pokémon game server: {error}"))?
        .map(|address| address.ip())
        .filter(|ip| !ip.is_loopback())
        .collect::<Vec<_>>();
    ips.sort();
    ips.dedup();
    if ips.is_empty() {
        Err("Pokémon TCG Live has no reachable game-server address yet.".to_owned())
    } else {
        Ok(ips)
    }
}

pub fn enable_route(
    _app_pid: u32,
    _pokemon_pid: u32,
) -> Result<(HelperReply, RouteHandle), String> {
    if !is_elevated() {
        return Err(
            "Windows live capture needs Trace to run as administrator so it can route only the Pokémon game host."
                .to_owned(),
        );
    }
    remove_host_override()?;
    let ips = pokemon_server_ips()?;
    let path = hosts_path();
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read the Windows hosts file: {error}"))?;
    let clean = hosts_without_override(&contents);
    let routed = format!("{clean}{HOSTS_BEGIN}\r\n127.0.0.1 {GAME_HOST}\r\n{HOSTS_END}\r\n");
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
        RouteHandle,
    ))
}

pub fn disable_route(_handle: &mut RouteHandle) {
    let _ = remove_host_override();
}

pub fn run_if_requested() -> bool {
    false
}
