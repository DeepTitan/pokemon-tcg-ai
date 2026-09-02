use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use std::{
    fs,
    io::{self, BufRead, BufReader, Write},
    net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream as StdTcpStream},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

const HELPER_ARGUMENT: &str = "--match-lens-capture-helper";
// Increment this only when the privileged routing protocol or helper behavior
// changes. App-only releases must continue reusing an already-approved helper.
const HELPER_VERSION: &str = "0.1.10";
const HELPER_LABEL: &str = "com.isaiahw.matchlens.capture-helper";
const HELPER_PATH: &str = "/Library/PrivilegedHelperTools/com.isaiahw.matchlens.capture-helper";
const HELPER_VERSION_PATH: &str =
    "/Library/PrivilegedHelperTools/com.isaiahw.matchlens.capture-helper.version";
const HELPER_PLIST: &str = "/Library/LaunchDaemons/com.isaiahw.matchlens.capture-helper.plist";
const HELPER_SOCKET: &str = "/var/run/com.isaiahw.matchlens.capture-helper.sock";
const HOSTS_PATH: &str = "/etc/hosts";
// Keep these legacy routing markers and helper IDs stable across the rebrand.
const HOSTS_BEGIN: &str = "# Match Lens local capture begin";
const HOSTS_END: &str = "# Match Lens local capture end";
pub const GAME_HOST: &str = "api.us-east-1.studio-prod.pokemon.com";
pub const CA_COMMON_NAME: &str = "Turnlume Local Capture Root";
pub const LEGACY_CA_COMMON_NAME: &str = "Match Lens Pokémon Capture Root";
const PF_ANCHOR: &str = "com.apple/matchlens";
const RELAY_PORT: u16 = 443;
const OBSERVER_PORT: u16 = 8899;
const UPSTREAM_PORT_START: u16 = 49_000;
const UPSTREAM_PORT_END: u16 = 49_099;

pub type RouteHandle = UnixStream;

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "command", rename_all = "camelCase")]
pub enum HelperCommand {
    Status,
    Enable { app_pid: u32, pokemon_pid: u32 },
    Disable,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperReply {
    pub ok: bool,
    pub version: String,
    pub route_active: bool,
    pub server_ips: Vec<String>,
    pub error: Option<String>,
}

fn reply_ok(route_active: bool, server_ips: Vec<String>) -> HelperReply {
    HelperReply {
        ok: true,
        version: HELPER_VERSION.to_owned(),
        route_active,
        server_ips,
        error: None,
    }
}

fn reply_error(error: impl Into<String>) -> HelperReply {
    HelperReply {
        ok: false,
        version: HELPER_VERSION.to_owned(),
        route_active: false,
        server_ips: Vec::new(),
        error: Some(error.into()),
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn apple_script_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn current_uid() -> Result<u32, String> {
    let output = Command::new("/usr/bin/id")
        .arg("-u")
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("Could not determine the current macOS user.".to_owned());
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .map_err(|error| error.to_string())
}

fn helper_plist(uid: u32) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{HELPER_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{HELPER_PATH}</string>
    <string>{HELPER_ARGUMENT}</string>
    <string>{uid}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>/var/log/match-lens-capture-helper.log</string>
  <key>StandardErrorPath</key><string>/var/log/match-lens-capture-helper.log</string>
</dict>
</plist>
"#
    )
}

pub fn install_helper(certificate_path: &Path) -> Result<(), String> {
    let uid = current_uid()?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let executable = executable
        .to_str()
        .ok_or("The Trace executable path is not valid UTF-8.")?;
    let certificate = certificate_path
        .to_str()
        .ok_or("The Trace certificate path is not valid UTF-8.")?;
    let plist = BASE64.encode(helper_plist(uid));
    let command = format!(
        "set -e; \
         /bin/launchctl bootout system/{label} >/dev/null 2>&1 || true; \
         /usr/bin/install -o root -g wheel -m 755 {source} {helper}; \
         /bin/echo {version} > {version_file}; \
         /usr/sbin/chown root:wheel {version_file}; \
         /bin/chmod 644 {version_file}; \
         /bin/echo {plist} | /usr/bin/base64 -D > {daemon}; \
         /usr/sbin/chown root:wheel {daemon}; \
         /bin/chmod 644 {daemon}; \
         /bin/rm -f {socket}; \
         /bin/launchctl bootstrap system {daemon}; \
         while /usr/bin/security delete-certificate -c {ca_name} \
           /Library/Keychains/System.keychain >/dev/null 2>&1; do :; done; \
         /usr/bin/security add-trusted-cert -d -r trustRoot -p ssl \
           -k /Library/Keychains/System.keychain {certificate} >/dev/null 2>&1 || true",
        label = HELPER_LABEL,
        source = shell_quote(executable),
        helper = shell_quote(HELPER_PATH),
        version = shell_quote(HELPER_VERSION),
        version_file = shell_quote(HELPER_VERSION_PATH),
        plist = shell_quote(&plist),
        daemon = shell_quote(HELPER_PLIST),
        ca_name = shell_quote(CA_COMMON_NAME),
        certificate = shell_quote(certificate),
        socket = shell_quote(HELPER_SOCKET),
    );
    let script = format!(
        "do shell script {} with administrator privileges",
        apple_script_quote(&command)
    );
    let output = Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if error.is_empty() {
            "The administrator approval was cancelled.".to_owned()
        } else {
            error
        });
    }

    for _ in 0..50 {
        if helper_status().is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("The local capture helper did not start after installation.".to_owned())
}

pub fn helper_ready() -> bool {
    let installed = Path::new(HELPER_PATH).exists()
        && Path::new(HELPER_PLIST).exists()
        && Path::new(HELPER_SOCKET).exists()
        && fs::read_to_string(HELPER_VERSION_PATH)
            .map(|version| version.trim() == HELPER_VERSION)
            .unwrap_or(false);
    installed
        && Command::new("/bin/launchctl")
            .args(["print", &format!("system/{HELPER_LABEL}")])
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
}

pub fn helper_status() -> Result<HelperReply, String> {
    let (reply, _) = send_command(HelperCommand::Status, false)?;
    Ok(reply)
}

pub fn enable_route(app_pid: u32, pokemon_pid: u32) -> Result<(HelperReply, RouteHandle), String> {
    let (reply, stream) = send_command(
        HelperCommand::Enable {
            app_pid,
            pokemon_pid,
        },
        true,
    )?;
    let stream = stream.ok_or("The capture helper connection closed unexpectedly.")?;
    if !reply.ok {
        return Err(reply
            .error
            .unwrap_or_else(|| "The capture helper could not route the game stream.".to_owned()));
    }
    Ok((reply, stream))
}

pub fn disable_route(stream: &mut RouteHandle) {
    if let Ok(line) = serde_json::to_string(&HelperCommand::Disable) {
        let _ = writeln!(stream, "{line}");
        let _ = stream.flush();
        let mut reader = BufReader::new(stream);
        let mut reply = String::new();
        let _ = reader.read_line(&mut reply);
    }
}

fn send_command(
    command: HelperCommand,
    keep_open: bool,
) -> Result<(HelperReply, Option<UnixStream>), String> {
    let mut stream = UnixStream::connect(HELPER_SOCKET).map_err(|error| error.to_string())?;
    // Route activation performs several privileged PF operations before replying.
    // Keep the control deadline generous so a briefly busy system does not make
    // the manager tear down a healthy relay during that handoff.
    let reply_timeout = match &command {
        HelperCommand::Enable { .. } => Duration::from_secs(15),
        _ => Duration::from_secs(5),
    };
    stream
        .set_read_timeout(Some(reply_timeout))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    let line = serde_json::to_string(&command).map_err(|error| error.to_string())?;
    writeln!(stream, "{line}").map_err(|error| error.to_string())?;
    stream.flush().map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|error| error.to_string())?);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    let reply = serde_json::from_str::<HelperReply>(&line).map_err(|error| error.to_string())?;
    Ok((reply, keep_open.then_some(stream)))
}

fn process_uid(pid: u32) -> Option<u32> {
    let output = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "uid="])
        .output()
        .ok()?;
    output.status.success().then(|| ())?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .ok()
}

fn established_ipv4_ips(pid: u32) -> Result<Vec<Ipv4Addr>, String> {
    let output = Command::new("/usr/sbin/lsof")
        .args([
            "-nP",
            "-a",
            "-p",
            &pid.to_string(),
            "-iTCP:443",
            "-sTCP:ESTABLISHED",
            "-Fn",
        ])
        .output()
        .map_err(|error| error.to_string())?;
    let mut ips = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some(remote) = line
            .strip_prefix('n')
            .and_then(|line| line.split_once("->"))
        else {
            continue;
        };
        let Some(host) = remote.1.rsplit_once(':').map(|value| value.0) else {
            continue;
        };
        if let Ok(ip) = host.parse::<Ipv4Addr>() {
            if !ips.contains(&ip) {
                ips.push(ip);
            }
        }
    }
    Ok(ips)
}

fn resolved_game_server_ips() -> Result<Vec<Ipv4Addr>, String> {
    let resolved = Command::new("/usr/bin/dig")
        .args(["+short", GAME_HOST, "A"])
        .output()
        .map_err(|error| error.to_string())?;
    let ips = String::from_utf8_lossy(&resolved.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<Ipv4Addr>().ok())
        .collect::<Vec<_>>();
    if ips.is_empty() {
        Err("Pokémon TCG Live's game server could not be resolved.".to_owned())
    } else {
        Ok(ips)
    }
}

fn pokemon_server_ips(pid: u32) -> Result<Vec<Ipv4Addr>, String> {
    let mut ips = established_ipv4_ips(pid)?;
    let resolved = resolved_game_server_ips()?;
    ips.retain(|ip| resolved.contains(ip));
    if ips.is_empty() {
        ips = resolved;
    }
    Ok(ips)
}

pub fn game_server_connection_active(pid: u32) -> bool {
    let Ok(active) = established_ipv4_ips(pid) else {
        return false;
    };
    let Ok(resolved) = resolved_game_server_ips() else {
        return false;
    };
    active.iter().any(|ip| resolved.contains(ip))
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
    let mut result = output.join("\n");
    result.push('\n');
    result
}

fn flush_dns_cache() {
    let _ = Command::new("/usr/bin/killall")
        .args(["-HUP", "mDNSResponder"])
        .status();
}

fn remove_host_override() -> Result<(), String> {
    let contents = fs::read_to_string(HOSTS_PATH).map_err(|error| error.to_string())?;
    if contents.contains(HOSTS_BEGIN) || contents.contains(HOSTS_END) {
        fs::write(HOSTS_PATH, hosts_without_override(&contents))
            .map_err(|error| error.to_string())?;
        flush_dns_cache();
    }
    Ok(())
}

fn relay_connection(client: StdTcpStream) -> io::Result<()> {
    // kqueue-backed listeners on macOS can yield accepted sockets that retain
    // O_NONBLOCK. The relay uses blocking io::copy in two dedicated threads,
    // so normalize the accepted socket before either direction starts. Without
    // this, an initial EAGAIN is mistaken for a completed stream and TLS is
    // closed before the ClientHello reaches Trace.
    client.set_nonblocking(false)?;
    let upstream = StdTcpStream::connect(("127.0.0.1", OBSERVER_PORT))?;
    let mut client_read = client.try_clone()?;
    let mut upstream_write = upstream.try_clone()?;
    let client_stop = client.try_clone()?;
    let upstream_stop = upstream.try_clone()?;
    let forward = thread::spawn(move || {
        let result = io::copy(&mut client_read, &mut upstream_write);
        let _ = client_stop.shutdown(Shutdown::Both);
        let _ = upstream_stop.shutdown(Shutdown::Both);
        result
    });
    let mut upstream_read = upstream;
    let mut client_write = client;
    let result = io::copy(&mut upstream_read, &mut client_write);
    let _ = client_write.shutdown(Shutdown::Both);
    let _ = upstream_read.shutdown(Shutdown::Both);
    let _ = forward.join();
    result.map(|_| ())
}

struct RelayHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl RelayHandle {
    fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn start_relay() -> Result<RelayHandle, String> {
    let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))
        .map_err(|error| format!("Could not create the local relay: {error}"))?;
    socket
        .set_reuse_address(true)
        .map_err(|error| format!("Could not configure the local relay: {error}"))?;
    socket
        .bind(&SocketAddr::from(([127, 0, 0, 1], RELAY_PORT)).into())
        .map_err(|error| format!("Could not reserve local port 443: {error}"))?;
    socket
        .listen(128)
        .map_err(|error| format!("Could not listen on local port 443: {error}"))?;
    socket
        .set_nonblocking(true)
        .map_err(|error| format!("Could not configure the local relay listener: {error}"))?;
    let listener: TcpListener = socket.into();
    let stop = Arc::new(AtomicBool::new(false));
    let relay_stop = stop.clone();
    let thread = thread::spawn(move || {
        while !relay_stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((client, _)) => {
                    thread::spawn(move || {
                        let _ = relay_connection(client);
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(25));
                }
                Err(_) => break,
            }
        }
    });
    Ok(RelayHandle {
        stop,
        thread: Some(thread),
    })
}

fn default_interface() -> Result<String, String> {
    let output = Command::new("/sbin/route")
        .args(["-n", "get", "default"])
        .output()
        .map_err(|error| error.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout);
    let interface = text.lines().find_map(|line| {
        let (key, value) = line.trim().split_once(':')?;
        (key == "interface").then(|| value.trim().to_owned())
    });
    let interface = interface.ok_or("Could not determine the active network interface.")?;
    if interface
        .chars()
        .all(|character| character.is_ascii_alphanumeric())
    {
        Ok(interface)
    } else {
        Err("The active network interface name is invalid.".to_owned())
    }
}

fn pfctl(args: &[&str], input: Option<&str>) -> Result<String, String> {
    let mut command = Command::new("/sbin/pfctl");
    command.args(args);
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    if let (Some(input), Some(stdin)) = (input, child.stdin.as_mut()) {
        stdin
            .write_all(input.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

fn disable_pf(token: &mut Option<String>) {
    let _ = pfctl(&["-a", PF_ANCHOR, "-F", "all"], None);
    if let Some(value) = token.take() {
        let _ = pfctl(&["-X", &value], None);
    }
}

fn pf_rules(interface: &str, ips: &[Ipv4Addr]) -> String {
    let mut rules = String::new();
    for ip in ips {
        rules.push_str(&format!(
            "rdr pass on lo0 inet proto tcp from any to {ip} port 443 -> 127.0.0.1 port {RELAY_PORT}\n"
        ));
    }
    for ip in ips {
        rules.push_str(&format!(
            "pass out quick on {interface} inet proto tcp from any port {UPSTREAM_PORT_START}:{UPSTREAM_PORT_END} to {ip} port 443\n"
        ));
    }
    for ip in ips {
        rules.push_str(&format!(
            "pass out quick on {interface} route-to (lo0 127.0.0.1) inet proto tcp from any to {ip} port 443\n"
        ));
    }
    rules
}

fn pf_state_kill_args(ip: Ipv4Addr) -> [String; 4] {
    [
        "-k".to_owned(),
        "0.0.0.0/0".to_owned(),
        "-k".to_owned(),
        ip.to_string(),
    ]
}

fn kill_existing_pf_states(ips: &[Ipv4Addr]) -> Result<(), String> {
    for ip in ips {
        let args = pf_state_kill_args(*ip);
        let args = args.iter().map(String::as_str).collect::<Vec<_>>();
        pfctl(&args, None)?;
    }
    Ok(())
}

fn enable_pf(ips: &[Ipv4Addr]) -> Result<String, String> {
    let interface = default_interface()?;
    let enabled = pfctl(&["-E"], None)?;
    let token = enabled
        .split("Token :")
        .nth(1)
        .and_then(|value| value.split_whitespace().next())
        .map(str::to_owned)
        .ok_or("macOS did not return a Packet Filter ownership token.".to_owned())?;
    let rules = pf_rules(&interface, ips);
    if let Err(error) = pfctl(&["-a", PF_ANCHOR, "-f", "-"], Some(&rules)) {
        let mut token = Some(token);
        disable_pf(&mut token);
        return Err(error);
    }
    // Existing TCP states predate the new route and would otherwise continue
    // bypassing Trace until Pokémon happens to reconnect. Install the route
    // first, then retire only states whose destination is a game-server IP so
    // TCG Live's immediate retry is captured by the active rules.
    if let Err(error) = kill_existing_pf_states(ips) {
        let mut token = Some(token);
        disable_pf(&mut token);
        return Err(error);
    }
    Ok(token)
}

fn stop_intercept(relay: &mut Option<RelayHandle>, token: &mut Option<String>) {
    let _ = remove_host_override();
    if let Some(relay) = relay.take() {
        relay.stop();
    }
    disable_pf(token);
}

fn handle_client(mut stream: UnixStream, owner_uid: u32) {
    let Ok(reader_stream) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(reader_stream);
    let mut active_ips = Vec::<Ipv4Addr>::new();
    let mut relay = None;
    let mut pf_token = None;
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let command = serde_json::from_str::<HelperCommand>(&line);
        let reply = match command {
            Ok(HelperCommand::Status) => reply_ok(
                relay.is_some() && pf_token.is_some(),
                active_ips.iter().map(ToString::to_string).collect(),
            ),
            Ok(HelperCommand::Disable) => {
                stop_intercept(&mut relay, &mut pf_token);
                active_ips.clear();
                reply_ok(false, Vec::new())
            }
            Ok(HelperCommand::Enable {
                app_pid,
                pokemon_pid,
            }) => {
                stop_intercept(&mut relay, &mut pf_token);
                active_ips.clear();
                if process_uid(app_pid) != Some(owner_uid)
                    || process_uid(pokemon_pid) != Some(owner_uid)
                {
                    reply_error("The requested processes do not belong to the approved macOS user.")
                } else {
                    match pokemon_server_ips(pokemon_pid).and_then(|ips| {
                        let next_relay = start_relay()?;
                        match enable_pf(&ips) {
                            Ok(next_token) => Ok((ips, next_relay, next_token)),
                            Err(error) => {
                                next_relay.stop();
                                Err(error)
                            }
                        }
                    }) {
                        Ok((ips, next_relay, next_token)) => {
                            relay = Some(next_relay);
                            pf_token = Some(next_token);
                            active_ips = ips;
                            reply_ok(true, active_ips.iter().map(ToString::to_string).collect())
                        }
                        Err(error) => reply_error(error),
                    }
                }
            }
            Err(error) => reply_error(format!("Invalid helper request: {error}")),
        };
        if let Ok(line) = serde_json::to_string(&reply) {
            if writeln!(stream, "{line}").is_err() || stream.flush().is_err() {
                break;
            }
        }
    }
    stop_intercept(&mut relay, &mut pf_token);
}

fn helper_main(owner_uid: u32) -> Result<(), String> {
    if current_uid()? != 0 {
        return Err("The capture helper must run as root through launchd.".to_owned());
    }
    let _ = fs::remove_file(HELPER_SOCKET);
    let listener = UnixListener::bind(HELPER_SOCKET).map_err(|error| error.to_string())?;
    fs::set_permissions(HELPER_SOCKET, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    let status = Command::new("/usr/sbin/chown")
        .arg(owner_uid.to_string())
        .arg(HELPER_SOCKET)
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(
            "Could not restrict the capture-helper socket to the approved user.".to_owned(),
        );
    }
    remove_host_override()?;
    let mut stale_token = None;
    disable_pf(&mut stale_token);
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => handle_client(stream, owner_uid),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

pub fn run_if_requested() -> bool {
    let mut args = std::env::args();
    let _ = args.next();
    if args.next().as_deref() != Some(HELPER_ARGUMENT) {
        return false;
    }
    let result = args
        .next()
        .ok_or_else(|| "The capture helper is missing its approved user id.".to_owned())
        .and_then(|value| value.parse::<u32>().map_err(|error| error.to_string()))
        .and_then(helper_main);
    if let Err(error) = result {
        eprintln!("Trace capture helper: {error}");
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{pf_rules, pf_state_kill_args};
    use std::net::Ipv4Addr;

    #[test]
    fn emits_all_translation_rules_before_filter_rules() {
        let rules = pf_rules(
            "en0",
            &[
                Ipv4Addr::new(52, 2, 12, 119),
                Ipv4Addr::new(3, 86, 122, 250),
            ],
        );
        let last_redirect = rules.rfind("rdr pass").expect("redirect rule");
        let first_filter = rules.find("pass out").expect("filter rule");
        assert!(last_redirect < first_filter);
    }

    #[test]
    fn stale_state_cleanup_is_scoped_to_the_game_server_destination() {
        let game_ip = Ipv4Addr::new(3, 86, 122, 250);
        assert_eq!(
            pf_state_kill_args(game_ip),
            ["-k", "0.0.0.0/0", "-k", "3.86.122.250"].map(str::to_owned)
        );
    }
}
