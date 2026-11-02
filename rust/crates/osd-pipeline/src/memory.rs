//! Resident memory of this process, for the phase timings in the log (Linux; elsewhere nothing).

/// `(current, peak)` resident set size in megabytes, from `/proc/self/status`.
pub fn resident_mb() -> Option<(u64, u64)> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let kb = |name: &str| -> Option<u64> {
        status
            .lines()
            .find_map(|line| line.strip_prefix(name))?
            .split_whitespace()
            .next()?
            .parse()
            .ok()
    };
    Some((kb("VmRSS:")? / 1024, kb("VmHWM:")? / 1024))
}

/// ` (memory 123 MB, peak 456 MB)` for appending to a phase's log line.
pub fn describe() -> String {
    resident_mb().map_or_else(String::new, |(now, peak)| {
        format!(" (memory {now} MB, peak {peak} MB)")
    })
}
