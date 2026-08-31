pub const GAME_HOST: &str = "api.us-east-1.studio-prod.pokemon.com";

const LEGACY_BEGIN: &str = "# Match Lens local capture begin";
const LEGACY_END: &str = "# Match Lens local capture end";
const TRACE_BEGIN: &str = "# Trace local capture begin";
const TRACE_END: &str = "# Trace local capture end";
const BEGIN_MARKERS: [&str; 2] = [LEGACY_BEGIN, TRACE_BEGIN];
const END_MARKERS: [&str; 2] = [LEGACY_END, TRACE_END];

pub struct CleanedHosts {
    pub contents: String,
    pub changed: bool,
}

fn line_parts(line: &str) -> (&str, &str) {
    if let Some(body) = line.strip_suffix("\r\n") {
        (body, "\r\n")
    } else if let Some(body) = line.strip_suffix('\n') {
        (body, "\n")
    } else {
        (line, "")
    }
}

fn marker_matches(line: &str, markers: &[&str], session: Option<&str>) -> bool {
    let trimmed = line.trim();
    markers.iter().any(|marker| match session {
        Some(session) => trimmed == format!("{marker} {session}"),
        None => trimmed == *marker || trimmed.starts_with(&format!("{marker} ")),
    })
}

fn has_inline_managed_block(line: &str) -> bool {
    BEGIN_MARKERS.iter().any(|begin| {
        line.find(begin).is_some_and(|start| {
            END_MARKERS
                .iter()
                .any(|end| line[start + begin.len()..].contains(end))
        })
    })
}

fn without_game_host_mapping(line: &str) -> Option<String> {
    let (mapping, comment) = line
        .split_once('#')
        .map(|(mapping, comment)| (mapping, Some(comment)))
        .unwrap_or((line, None));
    let mut fields = mapping.split_whitespace();
    let address = fields.next()?;
    if address != "127.0.0.1" && address != "::1" {
        return None;
    }

    let hosts = fields.collect::<Vec<_>>();
    if !hosts
        .iter()
        .any(|host| host.eq_ignore_ascii_case(GAME_HOST))
    {
        return None;
    }

    let retained = hosts
        .into_iter()
        .filter(|host| !host.eq_ignore_ascii_case(GAME_HOST))
        .collect::<Vec<_>>();
    let indentation = &mapping[..mapping.len() - mapping.trim_start().len()];
    let mut result = if retained.is_empty() {
        String::new()
    } else {
        format!("{indentation}{address} {}", retained.join(" "))
    };
    if let Some(comment) = comment {
        if !result.is_empty() {
            result.push(' ');
        } else {
            result.push_str(indentation);
        }
        result.push('#');
        result.push_str(comment);
    }
    Some(result)
}

/// Removes only Trace-owned routing data. With a session ID, cleanup is scoped
/// to that capture session so an old watchdog cannot tear down a newer route.
pub fn without_managed_route(contents: &str, session: Option<&str>) -> CleanedHosts {
    let lines = contents.split_inclusive('\n').collect::<Vec<_>>();
    let mut output = String::with_capacity(contents.len());
    let mut changed = false;
    let mut index = 0;
    let mut orphaned_target = false;

    while index < lines.len() {
        let (body, ending) = line_parts(lines[index]);

        // Old repair transcripts sometimes contain a whole managed block on
        // one physical line. Generic recovery owns and removes that line.
        if session.is_none() && has_inline_managed_block(body) {
            changed = true;
            index += 1;
            continue;
        }

        if marker_matches(body, &BEGIN_MARKERS, session) {
            let matching_end = ((index + 1)..lines.len()).find(|candidate| {
                let (candidate, _) = line_parts(lines[*candidate]);
                marker_matches(candidate, &END_MARKERS, session)
            });
            changed = true;
            if let Some(end) = matching_end {
                index = end + 1;
                continue;
            }
            // Do not discard unrelated hosts entries after a torn write. The
            // exact Trace loopback mapping is removed below instead.
            orphaned_target = true;
            index += 1;
            continue;
        }

        if marker_matches(body, &END_MARKERS, session) {
            changed = true;
            index += 1;
            continue;
        }

        if session.is_none() || orphaned_target {
            if let Some(cleaned) = without_game_host_mapping(body) {
                changed = true;
                if !cleaned.is_empty() {
                    output.push_str(&cleaned);
                    output.push_str(ending);
                }
                index += 1;
                continue;
            }
        }

        output.push_str(lines[index]);
        index += 1;
    }

    // split_inclusive does not produce a final item for an empty input and is
    // otherwise lossless, including the original line-ending convention.
    CleanedHosts {
        contents: output,
        changed,
    }
}

pub fn with_managed_route(contents: &str, session: &str) -> String {
    let ending = if contents.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut routed = contents.to_owned();
    if !routed.is_empty() && !routed.ends_with('\n') {
        routed.push_str(ending);
    }
    routed.push_str(&format!(
        "{LEGACY_BEGIN} {session}{ending}127.0.0.1 {GAME_HOST}{ending}{LEGACY_END} {session}{ending}"
    ));
    routed
}

#[cfg(test)]
mod tests {
    use super::{with_managed_route, without_managed_route, GAME_HOST};

    #[test]
    fn removes_legacy_block_without_touching_other_hosts_entries() {
        let hosts = format!(
            "127.0.0.1 localhost\r\n# Match Lens local capture begin\r\n127.0.0.1 {GAME_HOST}\r\n# Match Lens local capture end\r\n10.0.0.2 example.test\r\n"
        );

        let cleaned = without_managed_route(&hosts, None);

        assert!(cleaned.changed);
        assert_eq!(
            cleaned.contents,
            "127.0.0.1 localhost\r\n10.0.0.2 example.test\r\n"
        );
    }

    #[test]
    fn removes_duplicate_partial_inline_and_bare_legacy_routes() {
        let hosts = format!(
            "# Match Lens local capture begin 127.0.0.1 {GAME_HOST} # Match Lens local capture end\n# Trace local capture begin\n127.0.0.1 {GAME_HOST}\n127.0.0.1 {GAME_HOST}\n::1 {GAME_HOST}\n192.0.2.1 keep.test\n"
        );

        let cleaned = without_managed_route(&hosts, None);

        assert!(cleaned.changed);
        assert_eq!(cleaned.contents, "192.0.2.1 keep.test\n");
    }

    #[test]
    fn removes_only_the_game_host_from_a_shared_mapping() {
        let hosts = format!("127.0.0.1 localhost {GAME_HOST} # local names\n");

        let cleaned = without_managed_route(&hosts, None);

        assert_eq!(cleaned.contents, "127.0.0.1 localhost # local names\n");
    }

    #[test]
    fn session_cleanup_cannot_remove_a_newer_capture_route() {
        let current = with_managed_route("127.0.0.1 localhost\r\n", "new-session");

        let cleaned = without_managed_route(&current, Some("old-session"));

        assert!(!cleaned.changed);
        assert_eq!(cleaned.contents, current);
    }

    #[test]
    fn session_cleanup_removes_its_own_route() {
        let routed = with_managed_route("127.0.0.1 localhost\r\n", "session-one");

        let cleaned = without_managed_route(&routed, Some("session-one"));

        assert!(cleaned.changed);
        assert_eq!(cleaned.contents, "127.0.0.1 localhost\r\n");
    }

    #[test]
    fn generic_cleanup_is_idempotent() {
        let hosts = "127.0.0.1 localhost\n";

        let cleaned = without_managed_route(hosts, None);

        assert!(!cleaned.changed);
        assert_eq!(cleaned.contents, hosts);
    }
}
