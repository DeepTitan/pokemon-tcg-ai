use crate::{
    privileged,
    wire::{decode_websocket_message, CapturedOperation},
};
use flate2::read::DeflateDecoder;
use rcgen::{
    BasicConstraints, CertificateParams, CertificateRevocationListParams, CrlDistributionPoint,
    DistinguishedName, DnType, ExtendedKeyUsagePurpose, GeneralSubtree, IsCa, Issuer, KeyIdMethod,
    KeyPair, KeyUsagePurpose, NameConstraints, SerialNumber, PKCS_RSA_SHA256,
};
use serde::Serialize;
#[cfg(target_os = "windows")]
use sha1::{Digest, Sha1};
use socket2::{Domain, Protocol, Socket, Type};
#[cfg(target_os = "macos")]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs::{self, OpenOptions},
    io::{BufReader, Read, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream as StdTcpStream},
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use time::{Duration, OffsetDateTime};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{lookup_host, TcpListener, TcpStream},
    sync::oneshot,
};
use tokio_rustls::{
    rustls::{
        self,
        pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName},
        ClientConfig, RootCertStore, ServerConfig,
    },
    TlsAcceptor, TlsConnector,
};

#[cfg(target_os = "macos")]
const OBSERVER_PORT: u16 = 8899;
#[cfg(target_os = "windows")]
const OBSERVER_PORT: u16 = 443;
const UPSTREAM_PORT_START: u16 = 49_000;
const UPSTREAM_PORT_END: u16 = 49_099;
const CA_COMMON_NAME: &str = privileged::CA_COMMON_NAME;
const CERTIFICATE_VERSION_MARKER: &str = "unity-rsa-crl-chain-v5";
const ISSUER_COMMON_NAME: &str = "Turnlume DNS-Constrained Pokémon Issuer";
#[cfg(target_os = "windows")]
const CRL_PORT: u16 = 80;
#[cfg(target_os = "windows")]
const ROOT_CRL_PATH: &str = "/turnlume-root-v5.crl";
#[cfg(target_os = "windows")]
const ISSUER_CRL_PATH: &str = "/turnlume-issuer-v5.crl";
const MAX_WEBSOCKET_MESSAGE: usize = 64 * 1024 * 1024;

#[derive(Default)]
pub struct CaptureState {
    pub enabled: AtomicBool,
    pub observer_running: AtomicBool,
    pub route_active: AtomicBool,
    pub manager_running: AtomicBool,
    pub terminate: AtomicBool,
    pub client_connections: AtomicU64,
    pub routed_pid: AtomicU64,
    pub frame_count: AtomicU64,
    pub operation_count: AtomicU64,
    pub last_error: Mutex<Option<String>>,
    pub upstream_ips: Mutex<Vec<IpAddr>>,
    pub observer_shutdown: Mutex<Option<oneshot::Sender<()>>>,
    pub route_stream: Mutex<Option<privileged::RouteHandle>>,
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

#[derive(Clone)]
struct Recorder {
    app: AppHandle,
    state: Arc<CaptureState>,
    capture_path: PathBuf,
}

impl Recorder {
    fn inspect(&self, data: &[u8], host: &str) {
        if !self.state.enabled.load(Ordering::Relaxed) {
            return;
        }
        self.state.frame_count.fetch_add(1, Ordering::Relaxed);
        if let Some(operation) = decode_websocket_message(data, host.to_owned(), unix_timestamp()) {
            self.record(operation);
        }
    }

    fn record(&self, operation: CapturedOperation) {
        self.state.operation_count.fetch_add(1, Ordering::Relaxed);
        let stored = self
            .app
            .try_state::<crate::storage::MatchStorage>()
            .is_some_and(|storage| storage.record_operation(&operation).is_ok());
        // SQLite is the durable compressed archive. Keep JSONL only as a
        // recovery fallback if the indexed store is unavailable; existing
        // JSONL archives remain untouched and are imported on the next launch.
        if !stored {
            if let Some(parent) = self.capture_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(mut file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.capture_path)
            {
                if let Ok(line) = serde_json::to_string(&operation) {
                    let _ = writeln!(file, "{line}");
                }
            }
        }
        let _ = self.app.emit("match-operation", &operation);
    }
}

fn unix_timestamp() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis())
}

fn capture_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("capture"))
        .map_err(|error| error.to_string())
}

#[derive(Clone)]
struct CaptureAuthorityPaths {
    root_cert: PathBuf,
    issuer_cert: PathBuf,
    issuer_key: PathBuf,
    #[cfg(target_os = "windows")]
    root_crl: PathBuf,
    #[cfg(target_os = "windows")]
    issuer_crl: PathBuf,
}

fn ca_paths(app: &AppHandle) -> Result<CaptureAuthorityPaths, String> {
    let directory = capture_dir(app)?;
    Ok(CaptureAuthorityPaths {
        root_cert: directory.join("match-lens-ca.pem"),
        issuer_cert: directory.join("match-lens-issuer.pem"),
        issuer_key: directory.join("match-lens-ca.key"),
        #[cfg(target_os = "windows")]
        root_crl: directory.join("match-lens-root.crl"),
        #[cfg(target_os = "windows")]
        issuer_crl: directory.join("match-lens-issuer.crl"),
    })
}

fn ensure_ca(app: &AppHandle) -> Result<CaptureAuthorityPaths, String> {
    let paths = ca_paths(app)?;
    let directory = paths
        .root_cert
        .parent()
        .ok_or("Invalid capture directory")?;
    if paths.root_cert.exists()
        && paths.issuer_cert.exists()
        && paths.issuer_key.exists()
        && {
            #[cfg(target_os = "windows")]
            {
                paths.root_crl.exists()
            }
            #[cfg(not(target_os = "windows"))]
            {
                true
            }
        }
        && directory.join(CERTIFICATE_VERSION_MARKER).exists()
    {
        return Ok(paths);
    }
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;

    // Earlier builds used a login-keychain trust entry. Unity's WebSocket stack
    // ignores user-domain trust, so rotate that CA before installing the
    // system-scoped, DNS-constrained root used by current builds.
    #[cfg(target_os = "macos")]
    {
        if let Some(keychain) = std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join("Library/Keychains/login.keychain-db"))
        {
            let _ = Command::new("/usr/bin/security")
                .args(["delete-certificate", "-c", CA_COMMON_NAME])
                .arg(keychain)
                .output();
        }
    }

    let now = OffsetDateTime::now_utc();
    // TCG Live's bundled Mono certificate validator cannot verify the ECDSA
    // capture authorities generated by earlier Windows builds. Keep the whole
    // local chain RSA, matching the production endpoint's interoperability.
    let root_key = KeyPair::generate_for(&PKCS_RSA_SHA256).map_err(|error| error.to_string())?;
    let mut root_params =
        CertificateParams::new(Vec::<String>::new()).map_err(|error| error.to_string())?;
    let mut root_name = DistinguishedName::new();
    root_name.push(DnType::CommonName, CA_COMMON_NAME);
    root_name.push(DnType::OrganizationName, "Turnlume");
    root_params.distinguished_name = root_name;
    root_params.not_before = now - Duration::days(1);
    root_params.not_after = now + Duration::days(3650);
    root_params.is_ca = IsCa::Ca(BasicConstraints::Constrained(1));
    root_params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    let root = root_params
        .self_signed(&root_key)
        .map_err(|error| error.to_string())?;
    let root_pem = root.pem();
    let root_issuer =
        Issuer::from_ca_cert_pem(&root_pem, root_key).map_err(|error| error.to_string())?;

    let issuer_key = KeyPair::generate_for(&PKCS_RSA_SHA256).map_err(|error| error.to_string())?;
    let mut issuer_params =
        CertificateParams::new(Vec::<String>::new()).map_err(|error| error.to_string())?;
    let mut issuer_name = DistinguishedName::new();
    issuer_name.push(DnType::CommonName, ISSUER_COMMON_NAME);
    issuer_name.push(DnType::OrganizationName, "Turnlume");
    issuer_params.distinguished_name = issuer_name;
    issuer_params.not_before = now - Duration::days(1);
    issuer_params.not_after = now + Duration::days(1825);
    issuer_params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    issuer_params.name_constraints = Some(NameConstraints {
        permitted_subtrees: vec![GeneralSubtree::DnsName(
            ".studio-prod.pokemon.com".to_owned(),
        )],
        excluded_subtrees: Vec::new(),
    });
    issuer_params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    #[cfg(target_os = "windows")]
    {
        issuer_params.crl_distribution_points = vec![CrlDistributionPoint {
            uris: vec![format!("http://{}{ROOT_CRL_PATH}", privileged::GAME_HOST)],
        }];
    }
    issuer_params.use_authority_key_identifier_extension = true;
    let issuer = issuer_params
        .signed_by(&issuer_key, &root_issuer)
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    {
        let root_crl = CertificateRevocationListParams {
            this_update: now - Duration::days(1),
            next_update: now + Duration::days(3650),
            crl_number: SerialNumber::from(1u64),
            issuing_distribution_point: None,
            revoked_certs: Vec::new(),
            key_identifier_method: KeyIdMethod::Sha256,
        }
        .signed_by(&root_issuer)
        .map_err(|error| error.to_string())?;
        fs::write(&paths.root_crl, root_crl.der().as_ref()).map_err(|error| error.to_string())?;
    }

    fs::write(&paths.root_cert, root_pem).map_err(|error| error.to_string())?;
    fs::write(&paths.issuer_cert, issuer.pem()).map_err(|error| error.to_string())?;
    fs::write(&paths.issuer_key, issuer_key.serialize_pem()).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    fs::set_permissions(&paths.issuer_key, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    fs::write(
        directory.join(CERTIFICATE_VERSION_MARKER),
        "DNS-constrained Turnlume capture CA\n",
    )
    .map_err(|error| error.to_string())?;
    Ok(paths)
}

#[cfg(target_os = "macos")]
fn certificate_sha1(cert_path: &PathBuf) -> Option<String> {
    let output = Command::new("/usr/bin/openssl")
        .args(["x509", "-in"])
        .arg(cert_path)
        .args(["-noout", "-fingerprint", "-sha1"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .split_once('=')
        .map(|(_, fingerprint)| fingerprint.trim().replace(':', "").to_uppercase())
}

#[cfg(target_os = "macos")]
fn trust_domain_contains(app: &AppHandle, cert_path: &PathBuf, admin_domain: bool) -> bool {
    let Some(fingerprint) = certificate_sha1(cert_path) else {
        return false;
    };
    let export_name = if admin_domain {
        "admin-trust-settings.plist"
    } else {
        "user-trust-settings.plist"
    };
    let Ok(export_path) = capture_dir(app).map(|path| path.join(export_name)) else {
        return false;
    };
    let _ = fs::remove_file(&export_path);
    let mut export = Command::new("/usr/bin/security");
    export.arg("trust-settings-export");
    if admin_domain {
        export.arg("-d");
    }
    let exported = export
        .arg(&export_path)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !exported {
        return false;
    }
    let output = Command::new("/usr/bin/plutil")
        .arg("-p")
        .arg(&export_path)
        .output();
    let _ = fs::remove_file(export_path);
    output
        .map(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout).contains(&fingerprint)
        })
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn certificate_has_trust(app: &AppHandle, cert_path: &PathBuf) -> bool {
    trust_domain_contains(app, cert_path, false) || trust_domain_contains(app, cert_path, true)
}

#[cfg(target_os = "windows")]
fn certificate_has_trust(_app: &AppHandle, cert_path: &PathBuf) -> bool {
    certificate_installed(cert_path)
}

#[cfg(target_os = "macos")]
fn mono_user_trust_path(cert_path: &PathBuf) -> Result<PathBuf, String> {
    // TCG Live ships Unity's Mono/BoringTLS stack. Unlike native macOS
    // networking, that stack reads its current-user roots from the XDG
    // application-data directory (`~/.config` by default).
    let config_home = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join(".config"))
        })
        .ok_or("Could not locate the current user's application-data directory.")?;
    let output = Command::new("/usr/bin/openssl")
        .args(["x509", "-in"])
        .arg(cert_path)
        .args(["-subject_hash", "-noout"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err("Could not compute the Unity certificate-store name.".to_owned());
    }
    let hash_output = String::from_utf8_lossy(&output.stdout);
    let hash = hash_output
        .lines()
        .next()
        .map(str::trim)
        .filter(|value| value.len() == 8 && value.chars().all(|ch| ch.is_ascii_hexdigit()))
        .ok_or("OpenSSL returned an invalid Unity certificate-store name.")?;
    Ok(config_home
        .join(".mono/new-certs/Trust")
        .join(format!("{hash}.0")))
}

#[cfg(target_os = "macos")]
fn ensure_mono_certificate_trust(cert_path: &PathBuf) -> Result<(), String> {
    let destination = mono_user_trust_path(cert_path)?;
    let expected = fs::read(cert_path).map_err(|error| error.to_string())?;
    if fs::read(&destination).ok().as_deref() == Some(expected.as_slice()) {
        return Ok(());
    }
    let parent = destination
        .parent()
        .ok_or("Invalid Unity certificate-store directory.")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(destination, expected).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn mono_certificate_der(cert_path: &PathBuf) -> Result<Vec<u8>, String> {
    let pem = fs::read(cert_path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(pem.as_slice());
    let certificate = rustls_pemfile::certs(&mut reader)
        .next()
        .ok_or("The local capture root did not contain a certificate.".to_owned())?
        .map(|certificate| certificate.as_ref().to_vec())
        .map_err(|error| error.to_string())?;
    Ok(certificate)
}

#[cfg(target_os = "windows")]
fn der_length(length: usize) -> Vec<u8> {
    if length < 128 {
        return vec![length as u8];
    }
    let bytes = length.to_be_bytes();
    let first = bytes
        .iter()
        .position(|byte| *byte != 0)
        .unwrap_or(bytes.len() - 1);
    let significant = &bytes[first..];
    let mut encoded = Vec::with_capacity(significant.len() + 1);
    encoded.push(0x80 | significant.len() as u8);
    encoded.extend_from_slice(significant);
    encoded
}

#[cfg(target_os = "windows")]
fn der_value(tag: u8, contents: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(contents.len() + 5);
    encoded.push(tag);
    encoded.extend(der_length(contents.len()));
    encoded.extend_from_slice(contents);
    encoded
}

#[cfg(target_os = "windows")]
fn mono_subject_hash() -> String {
    // BoringTLS names trust-store files using OpenSSL's X509_NAME_hash: SHA-1
    // over the canonical DER RDN sets, interpreted as a little-endian u32.
    // These are the DER contents for commonName (2.5.4.3) and organization
    // (2.5.4.10), the two fixed attributes in the generated root.
    let attributes = [
        (&[0x55, 0x04, 0x03][..], CA_COMMON_NAME),
        (&[0x55, 0x04, 0x0a][..], "Turnlume"),
    ];
    let mut canonical_name = Vec::new();
    for (oid, value) in attributes {
        let oid = der_value(0x06, oid);
        let normalized = value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        let string = der_value(0x0c, normalized.as_bytes());
        let mut entry = oid;
        entry.extend(string);
        let entry = der_value(0x30, &entry);
        canonical_name.extend(der_value(0x31, &entry));
    }
    let digest = Sha1::digest(&canonical_name);
    format!(
        "{:08x}",
        u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]])
    )
}

#[cfg(target_os = "windows")]
fn mono_user_trust_paths() -> Result<(PathBuf, PathBuf), String> {
    let app_data = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or("Could not locate the current user's application-data directory.")?;
    Ok((
        app_data
            .join(".mono/certs/Trust")
            .join("turnlume-match-lens.cer"),
        app_data
            .join(".mono/new-certs/Trust")
            .join(format!("{}.0", mono_subject_hash())),
    ))
}

#[cfg(target_os = "windows")]
fn ensure_mono_certificate_trust(cert_path: &PathBuf) -> Result<(), String> {
    let pem = fs::read(cert_path).map_err(|error| error.to_string())?;
    let der = mono_certificate_der(cert_path)?;
    let (legacy_path, btls_path) = mono_user_trust_paths()?;
    for parent in [legacy_path.parent(), btls_path.parent()]
        .into_iter()
        .flatten()
    {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if fs::read(&legacy_path).ok().as_deref() != Some(der.as_slice()) {
        fs::write(&legacy_path, &der).map_err(|error| error.to_string())?;
    }
    if fs::read(&btls_path).ok().as_deref() != Some(pem.as_slice()) {
        fs::write(&btls_path, &pem).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn mono_certificate_ready(cert_path: &PathBuf) -> bool {
    let Ok(destination) = mono_user_trust_path(cert_path) else {
        return false;
    };
    fs::read(cert_path).ok() == fs::read(destination).ok()
}

#[cfg(target_os = "windows")]
fn mono_certificate_ready(cert_path: &PathBuf) -> bool {
    let Ok(pem) = fs::read(cert_path) else {
        return false;
    };
    let Ok(der) = mono_certificate_der(cert_path) else {
        return false;
    };
    let Ok((legacy_path, btls_path)) = mono_user_trust_paths() else {
        return false;
    };
    fs::read(legacy_path).ok().as_deref() == Some(der.as_slice())
        && fs::read(btls_path).ok().as_deref() == Some(pem.as_slice())
}

#[cfg(target_os = "macos")]
fn request_user_certificate_trust(cert_path: &PathBuf) -> Result<(), String> {
    let keychain = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library/Keychains/login.keychain-db"))
        .ok_or("Could not locate the current user's login keychain.")?;
    let output = Command::new("/usr/bin/security")
        .args(["add-trusted-cert", "-r", "trustRoot", "-k"])
        .arg(keychain)
        .arg(cert_path)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        Err(if error.is_empty() {
            "The Keychain trust approval was cancelled.".to_owned()
        } else {
            error
        })
    }
}

#[cfg(target_os = "windows")]
fn request_user_certificate_trust(cert_path: &PathBuf) -> Result<(), String> {
    let output = Command::new("certutil.exe")
        .args(["-addstore", "-f", "Root"])
        .arg(cert_path)
        .output()
        .map_err(|error| format!("Could not open the Windows certificate store: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        Err(if error.is_empty() {
            "Windows did not trust the local capture certificate.".to_owned()
        } else {
            error
        })
    }
}

#[cfg(target_os = "macos")]
fn certificate_installed(cert_path: &PathBuf) -> bool {
    let Ok(expected) = fs::read_to_string(&cert_path) else {
        return false;
    };
    [CA_COMMON_NAME, privileged::LEGACY_CA_COMMON_NAME]
        .iter()
        .any(|common_name| {
            let mut command = Command::new("/usr/bin/security");
            command
                .args(["find-certificate", "-a", "-c", common_name, "-p"])
                .arg("/Library/Keychains/System.keychain");
            command
                .output()
                .map(|output| {
                    output.status.success()
                        && String::from_utf8_lossy(&output.stdout).contains(expected.trim())
                })
                .unwrap_or(false)
        })
}

#[cfg(target_os = "windows")]
fn certificate_installed(cert_path: &PathBuf) -> bool {
    let Ok(der) = mono_certificate_der(cert_path) else {
        return false;
    };
    let fingerprint = Sha1::digest(der)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<String>();
    Command::new("certutil.exe")
        .args(["-store", "Root", &fingerprint])
        .output()
        .map(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .replace(' ', "")
                    .to_uppercase()
                    .contains(&fingerprint)
        })
        .unwrap_or(false)
}

fn certificate_ready(app: &AppHandle) -> bool {
    let Ok(paths) = ensure_ca(app) else {
        return false;
    };
    certificate_installed(&paths.root_cert)
        && certificate_has_trust(app, &paths.root_cert)
        && mono_certificate_ready(&paths.root_cert)
}

pub fn permission_ready(app: &AppHandle) -> bool {
    certificate_ready(app) && privileged::helper_ready()
}

fn stage_apple_tls_provider(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let launch_agents = app
            .path()
            .home_dir()
            .map_err(|error| format!("Could not locate the user LaunchAgents folder: {error}"))?
            .join("Library/LaunchAgents");
        fs::create_dir_all(&launch_agents)
            .map_err(|error| format!("Could not prepare the user LaunchAgents folder: {error}"))?;
        let launch_agent = launch_agents.join("com.isaiahw.matchlens.tls-provider.plist");
        let contents = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.isaiahw.matchlens.tls-provider</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>MONO_TLS_PROVIDER</string>
    <string>apple</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#;
        let needs_write = fs::read_to_string(&launch_agent)
            .map(|existing| existing != contents)
            .unwrap_or(true);
        if needs_write {
            fs::write(&launch_agent, contents).map_err(|error| {
                format!("Could not persist the TCG Live TLS compatibility setting: {error}")
            })?;
        }
        let status = Command::new("/bin/launchctl")
            .args(["setenv", "MONO_TLS_PROVIDER", "apple"])
            .status()
            .map_err(|error| {
                format!("Could not configure TCG Live's system TLS provider: {error}")
            })?;
        if !status.success() {
            return Err("macOS did not accept the TCG Live TLS compatibility setting.".to_owned());
        }
    }
    Ok(())
}

pub fn request_permission(app: &AppHandle) -> Result<CaptureStatus, String> {
    stage_apple_tls_provider(app)?;
    let cert_path = ensure_ca(app)?.root_cert;
    ensure_mono_certificate_trust(&cert_path)?;
    if !privileged::helper_ready() || !certificate_installed(&cert_path) {
        privileged::install_helper(&cert_path)?;
    }
    if !certificate_ready(app) {
        request_user_certificate_trust(&cert_path)?;
    }
    if !certificate_ready(app) || !privileged::helper_ready() {
        return Err("The operating system did not finish approving local capture.".to_owned());
    }
    Ok(status(app))
}

pub fn status(app: &AppHandle) -> CaptureStatus {
    let state = app.state::<Arc<CaptureState>>();
    CaptureStatus {
        permission_ready: permission_ready(app),
        enabled: state.enabled.load(Ordering::Relaxed),
        observer_running: state.observer_running.load(Ordering::Relaxed),
        route_active: state.route_active.load(Ordering::Relaxed),
        client_attached: state.client_connections.load(Ordering::Relaxed) > 0,
        frame_count: state.frame_count.load(Ordering::Relaxed),
        operation_count: state.operation_count.load(Ordering::Relaxed),
        last_error: state.last_error.lock().ok().and_then(|value| value.clone()),
        observer_port: OBSERVER_PORT,
    }
}

pub fn recent_operations(app: &AppHandle) -> Vec<CapturedOperation> {
    let Ok(path) = capture_dir(app).map(|directory| directory.join("operations.jsonl")) else {
        return Vec::new();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut operations: Vec<_> = contents
        .lines()
        .rev()
        .take(5_000)
        .filter_map(|line| serde_json::from_str::<CapturedOperation>(line).ok())
        .collect();
    operations.reverse();
    operations
}

fn server_config(app: &AppHandle) -> Result<Arc<ServerConfig>, String> {
    let paths = ensure_ca(app)?;
    let issuer_pem = fs::read_to_string(paths.issuer_cert).map_err(|error| error.to_string())?;
    let issuer_key_pem = fs::read_to_string(paths.issuer_key).map_err(|error| error.to_string())?;
    let issuer_key = KeyPair::from_pem(&issuer_key_pem).map_err(|error| error.to_string())?;
    let issuer =
        Issuer::from_ca_cert_pem(&issuer_pem, issuer_key).map_err(|error| error.to_string())?;

    // Unity's bundled TLS stack is more interoperable with the RSA server
    // keys used by Pokémon's production endpoints than with an ECDSA leaf.
    let leaf_key = KeyPair::generate_for(&PKCS_RSA_SHA256).map_err(|error| error.to_string())?;
    let mut leaf_params = CertificateParams::new(vec![
        "*.studio-prod.pokemon.com".to_owned(),
        "*.us-east-1.studio-prod.pokemon.com".to_owned(),
    ])
    .map_err(|error| error.to_string())?;
    let mut distinguished_name = DistinguishedName::new();
    distinguished_name.push(DnType::CommonName, "*.studio-prod.pokemon.com");
    distinguished_name.push(DnType::OrganizationName, "Turnlume Local Capture");
    leaf_params.distinguished_name = distinguished_name;
    let now = OffsetDateTime::now_utc();
    leaf_params.not_before = now - Duration::days(1);
    leaf_params.not_after = now + Duration::days(90);
    leaf_params.is_ca = IsCa::ExplicitNoCa;
    leaf_params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    leaf_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    #[cfg(target_os = "windows")]
    {
        leaf_params.crl_distribution_points = vec![CrlDistributionPoint {
            uris: vec![format!("http://{}{ISSUER_CRL_PATH}", privileged::GAME_HOST)],
        }];
    }
    leaf_params.use_authority_key_identifier_extension = true;
    let leaf = leaf_params
        .signed_by(&leaf_key, &issuer)
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    {
        let issuer_crl = CertificateRevocationListParams {
            this_update: now - Duration::hours(1),
            next_update: now + Duration::days(90),
            crl_number: SerialNumber::from(1u64),
            issuing_distribution_point: None,
            revoked_certs: Vec::new(),
            key_identifier_method: KeyIdMethod::Sha256,
        }
        .signed_by(&issuer)
        .map_err(|error| error.to_string())?;
        fs::write(&paths.issuer_crl, issuer_crl.der().as_ref())
            .map_err(|error| error.to_string())?;
    }

    let mut issuer_reader = BufReader::new(issuer_pem.as_bytes());
    let issuer_der = rustls_pemfile::certs(&mut issuer_reader)
        .collect::<Result<Vec<CertificateDer<'static>>, _>>()
        .map_err(|error| error.to_string())?;
    let mut chain = vec![CertificateDer::from(leaf.der().to_vec())];
    chain.extend(issuer_der);
    let key = PrivateKeyDer::from(PrivatePkcs8KeyDer::from(leaf_key.serialize_der()));
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let config = ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| error.to_string())?
        .with_no_client_auth()
        .with_single_cert(chain, key)
        .map_err(|error| error.to_string())?;
    Ok(Arc::new(config))
}

fn client_config() -> Result<Arc<ClientConfig>, String> {
    let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| error.to_string())?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(config))
}

fn is_pokemon_host(host: &str) -> bool {
    host == "studio-prod.pokemon.com" || host.ends_with(".studio-prod.pokemon.com")
}

fn connect_upstream_blocking(addresses: Vec<SocketAddr>) -> Result<StdTcpStream, String> {
    let mut last_error = None;
    for address in addresses {
        for port in UPSTREAM_PORT_START..=UPSTREAM_PORT_END {
            let domain = if address.is_ipv4() {
                Domain::IPV4
            } else {
                Domain::IPV6
            };
            let socket = match Socket::new(domain, Type::STREAM, Some(Protocol::TCP)) {
                Ok(socket) => socket,
                Err(error) => {
                    last_error = Some(error.to_string());
                    continue;
                }
            };
            let _ = socket.set_reuse_address(true);
            let bind_address = match address.ip() {
                IpAddr::V4(_) => SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port),
                IpAddr::V6(_) => SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), port),
            };
            if let Err(error) = socket.bind(&bind_address.into()) {
                last_error = Some(error.to_string());
                continue;
            }
            match socket.connect(&address.into()) {
                Ok(()) => {
                    let stream: StdTcpStream = socket.into();
                    stream.set_nonblocking(true).map_err(|error| {
                        format!("Could not set the upstream socket nonblocking: {error}")
                    })?;
                    return Ok(stream);
                }
                Err(error) => {
                    last_error = Some(format!(
                        "Could not connect to {address} from reserved port {port}: {error}"
                    ))
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "Could not connect to a Pokémon game server.".to_owned()))
}

async fn connect_upstream(host: &str, state: &CaptureState) -> Result<TcpStream, String> {
    let pinned_ips = state
        .upstream_ips
        .lock()
        .map_err(|_| "Capture state lock failed")?
        .clone();
    let addresses = if pinned_ips.is_empty() {
        lookup_host((host, 443))
            .await
            .map_err(|error| format!("Could not resolve the Pokémon API host: {error}"))?
            .filter(|address| !address.ip().is_loopback())
            .collect::<Vec<_>>()
    } else {
        pinned_ips
            .into_iter()
            .map(|ip| SocketAddr::new(ip, 443))
            .collect::<Vec<_>>()
    };
    let stream = tauri::async_runtime::spawn_blocking(move || connect_upstream_blocking(addresses))
        .await
        .map_err(|error| format!("The upstream connector task failed: {error}"))??;
    TcpStream::from_std(stream)
        .map_err(|error| format!("Could not register the upstream socket: {error}"))
}

#[derive(Default)]
struct WebSocketInspector {
    response_headers: Vec<u8>,
    websocket_bytes: Vec<u8>,
    headers_complete: bool,
    websocket: bool,
    fragmented: Vec<u8>,
    fragmented_opcode: Option<u8>,
    fragmented_compressed: bool,
}

impl WebSocketInspector {
    fn feed(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        if !self.headers_complete {
            self.response_headers.extend_from_slice(data);
            let Some(end) = self
                .response_headers
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map(|index| index + 4)
            else {
                return Vec::new();
            };
            let headers = String::from_utf8_lossy(&self.response_headers[..end]);
            self.websocket = headers
                .lines()
                .next()
                .map(|line| line.contains(" 101 "))
                .unwrap_or(false);
            self.headers_complete = true;
            if self.websocket {
                self.websocket_bytes
                    .extend_from_slice(&self.response_headers[end..]);
            }
            self.response_headers.clear();
        } else if self.websocket {
            self.websocket_bytes.extend_from_slice(data);
        }
        self.take_messages()
    }

    fn take_messages(&mut self) -> Vec<Vec<u8>> {
        let mut messages = Vec::new();
        loop {
            if self.websocket_bytes.len() < 2 {
                break;
            }
            let first = self.websocket_bytes[0];
            let second = self.websocket_bytes[1];
            let fin = first & 0x80 != 0;
            let compressed = first & 0x40 != 0;
            let opcode = first & 0x0f;
            let masked = second & 0x80 != 0;
            let mut header_length = 2usize;
            let mut payload_length = usize::from(second & 0x7f);
            if payload_length == 126 {
                if self.websocket_bytes.len() < 4 {
                    break;
                }
                payload_length =
                    u16::from_be_bytes([self.websocket_bytes[2], self.websocket_bytes[3]]) as usize;
                header_length = 4;
            } else if payload_length == 127 {
                if self.websocket_bytes.len() < 10 {
                    break;
                }
                let length = u64::from_be_bytes(
                    self.websocket_bytes[2..10]
                        .try_into()
                        .expect("WebSocket length slice"),
                );
                let Ok(length) = usize::try_from(length) else {
                    self.websocket_bytes.clear();
                    break;
                };
                payload_length = length;
                header_length = 10;
            }
            if payload_length > MAX_WEBSOCKET_MESSAGE {
                self.websocket_bytes.clear();
                break;
            }
            let mask_length = if masked { 4 } else { 0 };
            let Some(total_length) = header_length
                .checked_add(mask_length)
                .and_then(|value| value.checked_add(payload_length))
            else {
                self.websocket_bytes.clear();
                break;
            };
            if self.websocket_bytes.len() < total_length {
                break;
            }
            let mask: Option<[u8; 4]> = masked.then(|| {
                self.websocket_bytes[header_length..header_length + 4]
                    .try_into()
                    .expect("WebSocket mask slice")
            });
            let payload_start = header_length + mask_length;
            let mut payload =
                self.websocket_bytes[payload_start..payload_start + payload_length].to_vec();
            if let Some(mask) = mask {
                for (index, byte) in payload.iter_mut().enumerate() {
                    *byte ^= mask[index % 4];
                }
            }
            self.websocket_bytes.drain(..total_length);

            match opcode {
                0x1 | 0x2 if fin => {
                    if let Some(message) = decompress_websocket(payload, compressed) {
                        messages.push(message);
                    }
                }
                0x1 | 0x2 => {
                    self.fragmented = payload;
                    self.fragmented_opcode = Some(opcode);
                    self.fragmented_compressed = compressed;
                }
                0x0 if self.fragmented_opcode.is_some() => {
                    if self.fragmented.len().saturating_add(payload.len()) > MAX_WEBSOCKET_MESSAGE {
                        self.fragmented.clear();
                        self.fragmented_opcode = None;
                        continue;
                    }
                    self.fragmented.extend(payload);
                    if fin {
                        let payload = std::mem::take(&mut self.fragmented);
                        self.fragmented_opcode = None;
                        if let Some(message) =
                            decompress_websocket(payload, self.fragmented_compressed)
                        {
                            messages.push(message);
                        }
                    }
                }
                _ => {}
            }
        }
        messages
    }
}

fn decompress_websocket(mut payload: Vec<u8>, compressed: bool) -> Option<Vec<u8>> {
    if !compressed {
        return Some(payload);
    }
    payload.extend_from_slice(&[0x00, 0x00, 0xff, 0xff]);
    let mut decoder = DeflateDecoder::new(payload.as_slice());
    let mut output = Vec::new();
    decoder.read_to_end(&mut output).ok()?;
    Some(output)
}

async fn forward_and_inspect<C, S>(
    client: C,
    server: S,
    recorder: Recorder,
    host: String,
) -> Result<(), String>
where
    C: AsyncRead + AsyncWrite + Unpin,
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (mut client_read, mut client_write) = tokio::io::split(client);
    let (mut server_read, mut server_write) = tokio::io::split(server);
    let client_to_server = async {
        tokio::io::copy(&mut client_read, &mut server_write)
            .await
            .map_err(|error| {
                format!("Forwarding TCG Live to the Pokémon server failed: {error}")
            })?;
        server_write
            .shutdown()
            .await
            .map_err(|error| format!("Closing the upstream Pokémon socket failed: {error}"))
    };
    let server_to_client = async {
        let mut inspector = WebSocketInspector::default();
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            let count = server_read
                .read(&mut buffer)
                .await
                .map_err(|error| format!("Reading the Pokémon server stream failed: {error}"))?;
            if count == 0 {
                break;
            }
            client_write
                .write_all(&buffer[..count])
                .await
                .map_err(|error| {
                    format!("Forwarding the Pokémon server to TCG Live failed: {error}")
                })?;
            for message in inspector.feed(&buffer[..count]) {
                recorder.inspect(&message, &host);
            }
        }
        client_write
            .shutdown()
            .await
            .map_err(|error| format!("Closing the TCG Live socket failed: {error}"))
    };
    tokio::try_join!(client_to_server, server_to_client)?;
    Ok(())
}

async fn observe_connection(
    stream: TcpStream,
    acceptor: TlsAcceptor,
    connector: TlsConnector,
    recorder: Recorder,
) -> Result<(), String> {
    let client = acceptor
        .accept(stream)
        .await
        .map_err(|error| format!("TCG Live rejected the local capture certificate: {error}"))?;
    let host = client
        .get_ref()
        .1
        .server_name()
        .map(str::to_owned)
        .ok_or("TCG Live did not provide a TLS server name.")?;
    if !is_pokemon_host(&host) {
        return Err(format!("Refused to inspect non-Pokémon host {host}."));
    }
    let upstream = connect_upstream(&host, &recorder.state).await?;
    let server_name = ServerName::try_from(host.clone())
        .map_err(|error| format!("TCG Live provided an invalid Pokémon server name: {error}"))?;
    let server = connector
        .connect(server_name, upstream)
        .await
        .map_err(|error| {
            format!("Could not establish the upstream Pokémon TLS session: {error}")
        })?;
    recorder
        .state
        .client_connections
        .fetch_add(1, Ordering::Relaxed);
    if let Ok(mut last_error) = recorder.state.last_error.lock() {
        *last_error = None;
    }
    let result = forward_and_inspect(client, server, recorder.clone(), host).await;
    recorder
        .state
        .client_connections
        .fetch_sub(1, Ordering::Relaxed);
    result
}

#[cfg(target_os = "windows")]
async fn serve_crl_connection(
    mut stream: TcpStream,
    paths: CaptureAuthorityPaths,
) -> Result<(), String> {
    let mut request = Vec::with_capacity(1024);
    let mut buffer = [0u8; 1024];
    while request.len() < 8 * 1024 {
        let count = stream
            .read(&mut buffer)
            .await
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..count]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let request_line = String::from_utf8_lossy(&request)
        .lines()
        .next()
        .unwrap_or_default()
        .to_owned();
    let path = request_line.split_whitespace().nth(1).unwrap_or_default();
    let crl_path = match path {
        ROOT_CRL_PATH => Some(paths.root_crl),
        ISSUER_CRL_PATH => Some(paths.issuer_crl),
        _ => None,
    };
    let (status, content_type, body) = if let Some(crl_path) = crl_path {
        match fs::read(crl_path) {
            Ok(body) => ("200 OK", "application/pkix-crl", body),
            Err(_) => ("404 Not Found", "text/plain", b"CRL not ready\n".to_vec()),
        }
    } else {
        ("404 Not Found", "text/plain", b"Not found\n".to_vec())
    };
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(headers.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stream
        .write_all(&body)
        .await
        .map_err(|error| error.to_string())?;
    stream.shutdown().await.map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
async fn run_crl_server(app: AppHandle, listener: TcpListener) {
    let Ok(paths) = ca_paths(&app) else {
        return;
    };
    while let Ok((stream, _)) = listener.accept().await {
        let paths = paths.clone();
        tauri::async_runtime::spawn(async move {
            let _ = serve_crl_connection(stream, paths).await;
        });
    }
}

async fn run_observer(
    app: AppHandle,
    state: Arc<CaptureState>,
    listener: TcpListener,
    #[cfg(target_os = "windows")] crl_listener: TcpListener,
    shutdown: oneshot::Receiver<()>,
) -> Result<(), String> {
    let acceptor = TlsAcceptor::from(server_config(&app)?);
    let connector = TlsConnector::from(client_config()?);
    #[cfg(target_os = "windows")]
    let crl_task = tauri::async_runtime::spawn(run_crl_server(app.clone(), crl_listener));
    let recorder = Recorder {
        app: app.clone(),
        state: state.clone(),
        capture_path: capture_dir(&app)?.join("operations.jsonl"),
    };
    state.observer_running.store(true, Ordering::Relaxed);
    tokio::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => {
                let (stream, _) = accepted.map_err(|error| error.to_string())?;
                let acceptor = acceptor.clone();
                let connector = connector.clone();
                let recorder = recorder.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = observe_connection(stream, acceptor, connector, recorder.clone()).await {
                        let benign_disconnect = error
                            .contains("peer closed connection without sending TLS close_notify");
                        if recorder.state.enabled.load(Ordering::Relaxed) && !benign_disconnect {
                            if let Ok(mut last_error) = recorder.state.last_error.lock() {
                                *last_error = Some(error);
                            }
                        }
                    }
                });
            }
        }
    }
    #[cfg(target_os = "windows")]
    crl_task.abort();
    state.observer_running.store(false, Ordering::Relaxed);
    state.client_connections.store(0, Ordering::Relaxed);
    Ok(())
}

async fn ensure_observer(app: &AppHandle, state: &Arc<CaptureState>) -> Result<(), String> {
    if state.observer_running.load(Ordering::Relaxed) {
        return Ok(());
    }
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, OBSERVER_PORT))
        .await
        .map_err(|error| format!("Could not start the local capture observer: {error}"))?;
    #[cfg(target_os = "windows")]
    let crl_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, CRL_PORT))
        .await
        .map_err(|error| format!("Could not start local certificate validation: {error}"))?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    *state
        .observer_shutdown
        .lock()
        .map_err(|_| "Capture state lock failed")? = Some(shutdown_tx);
    let app = app.clone();
    let observer_state = state.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_observer(
            app,
            observer_state.clone(),
            listener,
            #[cfg(target_os = "windows")]
            crl_listener,
            shutdown_rx,
        )
        .await
        {
            if let Ok(mut last_error) = observer_state.last_error.lock() {
                *last_error = Some(error);
            }
            observer_state
                .observer_running
                .store(false, Ordering::Relaxed);
        }
    });
    for _ in 0..20 {
        if state.observer_running.load(Ordering::Relaxed) {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    Err("The local capture observer did not start.".to_owned())
}

fn release_route(state: &Arc<CaptureState>) {
    if let Ok(mut route) = state.route_stream.lock() {
        if let Some(mut stream) = route.take() {
            privileged::disable_route(&mut stream);
        }
    }
    state.route_active.store(false, Ordering::Relaxed);
    state.routed_pid.store(0, Ordering::Relaxed);
    if let Ok(mut upstream_ips) = state.upstream_ips.lock() {
        upstream_ips.clear();
    }
}

#[cfg(target_os = "macos")]
fn ensure_manager(state: &Arc<CaptureState>) {
    if state.manager_running.swap(true, Ordering::Relaxed) {
        return;
    }
    let manager_state = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut zero_frame_route_since = None;
        let mut initial_route_refreshed = false;
        while !manager_state.terminate.load(Ordering::Relaxed) {
            if !manager_state.enabled.load(Ordering::Relaxed) {
                release_route(&manager_state);
                zero_frame_route_since = None;
                initial_route_refreshed = false;
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }
            let Some(pokemon_pid) = crate::pokemon_client_pid() else {
                release_route(&manager_state);
                tokio::time::sleep(std::time::Duration::from_millis(750)).await;
                continue;
            };
            if manager_state.route_active.load(Ordering::Relaxed)
                && manager_state.routed_pid.load(Ordering::Relaxed) == u64::from(pokemon_pid)
            {
                if manager_state.frame_count.load(Ordering::Relaxed) == 0
                    && !initial_route_refreshed
                {
                    let started =
                        zero_frame_route_since.get_or_insert_with(std::time::Instant::now);
                    if started.elapsed() >= std::time::Duration::from_secs(10) {
                        // A long-lived game socket can occasionally retain its old PF
                        // state while background Pokémon sockets attach successfully.
                        // Refresh this first zero-data route once so the actual match
                        // stream reconnects without requiring an off/on toggle.
                        initial_route_refreshed = true;
                        zero_frame_route_since = None;
                        release_route(&manager_state);
                        continue;
                    }
                } else {
                    zero_frame_route_since = None;
                }
                tokio::time::sleep(std::time::Duration::from_millis(750)).await;
                continue;
            }
            release_route(&manager_state);
            match privileged::enable_route(std::process::id(), pokemon_pid) {
                Ok((reply, stream)) => {
                    if let Ok(mut upstream_ips) = manager_state.upstream_ips.lock() {
                        *upstream_ips = reply
                            .server_ips
                            .iter()
                            .filter_map(|ip| ip.parse::<IpAddr>().ok())
                            .collect();
                    }
                    if let Ok(mut route) = manager_state.route_stream.lock() {
                        *route = Some(stream);
                    }
                    manager_state.route_active.store(true, Ordering::Relaxed);
                    manager_state
                        .routed_pid
                        .store(u64::from(pokemon_pid), Ordering::Relaxed);
                    if manager_state.frame_count.load(Ordering::Relaxed) == 0 {
                        zero_frame_route_since = Some(std::time::Instant::now());
                    }
                    if let Ok(mut last_error) = manager_state.last_error.lock() {
                        *last_error = None;
                    }
                }
                Err(error) => {
                    if !error.contains("no active game-server connection") {
                        if let Ok(mut last_error) = manager_state.last_error.lock() {
                            *last_error = Some(error);
                        }
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
        release_route(&manager_state);
        manager_state
            .manager_running
            .store(false, Ordering::Relaxed);
    });
}

#[cfg(target_os = "windows")]
fn ensure_manager(_state: &Arc<CaptureState>) {}

pub async fn start(app: AppHandle) -> Result<CaptureStatus, String> {
    if !permission_ready(&app) {
        return Err("Trace needs its one-time local capture permission first.".to_owned());
    }
    stage_apple_tls_provider(&app)?;
    let state = app.state::<Arc<CaptureState>>().inner().clone();
    ensure_observer(&app, &state).await?;
    #[cfg(target_os = "windows")]
    if !state.route_active.load(Ordering::Relaxed) {
        let pokemon_pid = crate::pokemon_client_pid();
        let (reply, stream) =
            privileged::enable_route(std::process::id(), pokemon_pid.unwrap_or_default())?;
        if let Ok(mut upstream_ips) = state.upstream_ips.lock() {
            *upstream_ips = reply
                .server_ips
                .iter()
                .filter_map(|ip| ip.parse::<IpAddr>().ok())
                .collect();
        }
        if let Ok(mut route) = state.route_stream.lock() {
            *route = Some(stream);
        }
        state.route_active.store(true, Ordering::Relaxed);
        if let Some(pokemon_pid) = pokemon_pid {
            privileged::restart_pokemon_client(pokemon_pid)?;
        }
    }
    state.terminate.store(false, Ordering::Relaxed);
    state.enabled.store(true, Ordering::Relaxed);
    if let Ok(mut last_error) = state.last_error.lock() {
        *last_error = None;
    }
    ensure_manager(&state);
    Ok(status(&app))
}

pub fn stop(app: &AppHandle) -> CaptureStatus {
    let state = app.state::<Arc<CaptureState>>().inner().clone();
    state.enabled.store(false, Ordering::Relaxed);
    release_route(&state);
    status(app)
}

pub fn shutdown(app: &AppHandle) {
    let state = app.state::<Arc<CaptureState>>().inner().clone();
    state.enabled.store(false, Ordering::Relaxed);
    state.terminate.store(true, Ordering::Relaxed);
    release_route(&state);
    if let Ok(mut sender) = state.observer_shutdown.lock() {
        if let Some(sender) = sender.take() {
            let _ = sender.send(());
        }
    };
}

#[cfg(test)]
mod tests {
    use super::WebSocketInspector;

    #[cfg(target_os = "windows")]
    #[test]
    fn mono_store_hash_matches_openssl_subject_hash() {
        assert_eq!(super::mono_subject_hash(), "bfb0f28f");
    }

    fn server_frame(payload: &[u8]) -> Vec<u8> {
        let mut frame = vec![0x82];
        if payload.len() < 126 {
            frame.push(payload.len() as u8);
        } else {
            frame.push(126);
            frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        }
        frame.extend_from_slice(payload);
        frame
    }

    #[test]
    fn extracts_server_websocket_messages_across_chunks() {
        let payload = b"MESSAGE\n\nexact-operation\0";
        let frame = server_frame(payload);
        let mut bytes = b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n".to_vec();
        bytes.extend(frame);
        let mut inspector = WebSocketInspector::default();
        assert!(inspector.feed(&bytes[..17]).is_empty());
        assert_eq!(inspector.feed(&bytes[17..]), vec![payload.to_vec()]);
    }
}
