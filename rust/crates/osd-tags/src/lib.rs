//! OSM tags to domain model.
//!
//! Replaces: `src/transforms/RunFormatter.ts`, `LiftFormatter.ts`,
//! `SkiAreaFormatter.ts`, `SpotFormatter.ts`, `OSMTransforms.ts`, `Status.ts`,
//! `SkiAreaSiteProvider.ts`.
//!
//! # Port this mechanically
//!
//! This is roughly 5k LOC of hard-won domain knowledge — lifecycle tag prefixes
//! (`disused:`, `abandoned:`, `proposed:`, `planned:`, `construction:`), grooming
//! defaults derived from difficulty, oneway defaults per run use, name/ref fallbacks
//! between `piste:*` and plain tags — and it carries the heaviest test coverage in the
//! repository. Port it against the extracted fixtures and resist improving it here;
//! behaviour changes in this layer are indistinguishable from porting bugs.

pub mod lift;
pub mod osm;
pub mod run;
pub mod status;

pub use status::{
    LIFECYCLE_STATES, StatusAndValue, Tags, UNSUPPORTED_STATES, lifecycle_prefix, status_and_value,
};

use anyhow::Result;
use osd_store::{FeatureIdx, FeatureStore};
use std::collections::BTreeMap;

/// Replaces `formatRun`. Returns zero or more features: one input way can yield several
/// runs, which is why upstream uses `flatMapArray`.
pub fn format_run(_tags: &Tags, _store: &mut FeatureStore) -> Result<Vec<FeatureIdx>> {
    todo!("port RunFormatter.ts")
}

/// Replaces `formatLift`.
pub fn format_lift(_tags: &Tags, _store: &mut FeatureStore) -> Result<Option<FeatureIdx>> {
    todo!("port LiftFormatter.ts")
}

/// Replaces `formatSkiArea`.
pub fn format_ski_area(_tags: &Tags, _store: &mut FeatureStore) -> Result<Option<FeatureIdx>> {
    todo!("port SkiAreaFormatter.ts")
}

/// Replaces `formatSpots`.
pub fn format_spots(_tags: &Tags, _store: &mut FeatureStore) -> Result<Vec<FeatureIdx>> {
    todo!("port SpotFormatter.ts")
}

/// Replaces `SkiAreaSiteProvider`: indexes `site=piste` relations by member OSM id so
/// each run, lift and spot can pick up its site membership.
#[derive(Debug, Default)]
pub struct SkiAreaSiteProvider {
    _by_osm_id: BTreeMap<String, Vec<u32>>,
}

impl SkiAreaSiteProvider {
    pub fn sites_for(&self, _osm_id: &str) -> &[u32] {
        todo!("look up site memberships")
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "scaffold: port the formatters first"]
    fn matches_run_formatter_snapshots() {}

    #[test]
    #[ignore = "scaffold: port the formatters first"]
    fn matches_lift_formatter_snapshots() {}

    #[test]
    #[ignore = "scaffold: port the formatters first"]
    fn matches_ski_area_formatter_snapshots() {}
}
