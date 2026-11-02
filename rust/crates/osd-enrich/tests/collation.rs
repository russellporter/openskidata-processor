//! `locale_compare` against V8's `localeCompare` (`rust/codegen/generate-collation-vectors.mjs`).

use osd_enrich::collation::locale_compare;
use serde::Deserialize;
use std::cmp::Ordering;

#[derive(Deserialize)]
struct Vectors {
    strings: Vec<String>,
    pairs: Vec<(usize, usize, i8)>,
}

#[test]
fn every_recorded_comparison_is_reproduced() {
    let vectors: Vectors = serde_json::from_str(include_str!("collation_vectors.json")).unwrap();
    assert!(vectors.pairs.len() >= 36_000);
    let mut failures = Vec::new();
    for &(a, b, want) in &vectors.pairs {
        let got = match locale_compare(&vectors.strings[a], &vectors.strings[b]) {
            Ordering::Less => -1,
            Ordering::Equal => 0,
            Ordering::Greater => 1,
        };
        if got != want {
            failures.push(format!(
                "{:?} vs {:?}: got {got}, V8 says {want}",
                vectors.strings[a], vectors.strings[b]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} comparisons differ; first:\n{}",
        failures.len(),
        vectors.pairs.len(),
        failures
            .iter()
            .take(15)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
