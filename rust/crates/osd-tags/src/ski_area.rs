//! Tags to ski area properties.
//!
//! Replaces the tag-reading half of `src/transforms/SkiAreaFormatter.ts`.
//!
//! A ski area reaches the pipeline through three different doors, each with its own
//! derivation, which is why this has three entry points rather than one:
//!
//! - an OSM `landuse=winter_sports` polygon ([`landuse`]);
//! - an OSM `site=piste` relation, which has no geometry of its own yet ([`site`]);
//! - a Skimap.org point ([`skimap`]).
//!
//! Each returns the properties that come from tags alone. The run-difficulty convention is
//! deliberately **not** among them: for the landuse and Skimap.org arms it is a function of
//! where the geometry is, and `getRunDifficultyConvention`'s embedded region polygons are
//! not ported yet, so the caller supplies it.

use crate::osm::{first_value, osm_name};
use crate::status::{Tags, status_and_value};
use openskidata_format::source::Source;
use openskidata_format::{RunDifficultyConvention, SkiAreaActivity, SourceType, Status};
use osd_store::GeometryKind;

/// The properties of a ski area that are determined by its tags.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkiAreaTagProperties {
    pub name: Option<String>,
    pub sources: Vec<Source>,
    /// Empty for OSM ski areas: their activities are derived later, from member runs.
    pub activities: Vec<SkiAreaActivity>,
    /// `None` is meaningful only for Skimap.org, which can report no status. The OSM arms
    /// never produce a ski area without one.
    pub status: Option<Status>,
    pub websites: Vec<String>,
    pub wikidata_id: Option<String>,
}

/// The run-difficulty convention given to every site relation.
///
/// Upstream's own comment calls it "also bogus, will be updated later when we know the real
/// geometry": a site has no geometry until clustering assigns its member objects, so there
/// is nothing to look the convention up from. It is overwritten once there is.
pub const SITE_PLACEHOLDER_CONVENTION: RunDifficultyConvention =
    RunDifficultyConvention::NorthAmerica;

/// The coordinate marking a ski area whose real position is not known yet.
///
/// Replaces `placeholderSiteGeometry`. The third element is the relation id, which exists
/// for one reason: the feature id is a hash of the geometry, and without it every site
/// would hash identically. In the Rust store the sentinel is a flag rather than a
/// coordinate (360 degrees does not fit the fixed-point grid), so this exists for the
/// output writer to re-emit it, and for comparing against upstream.
pub fn placeholder_site_geometry(relation_id: i64) -> [f64; 3] {
    [360.0, 360.0, relation_id as f64]
}

/// `[tags.website].filter(notEmpty)`.
///
/// `notEmpty` rejects only null and undefined, so an empty-string website **is kept**:
/// `website=""` yields `[""]`. That is almost certainly not what upstream intends, but it is
/// what it does, and the recorded vectors pin it.
fn websites(website: Option<&str>) -> Vec<String> {
    website.map(|w| vec![w.to_owned()]).unwrap_or_default()
}

fn osm_source(osm_type: &str, osm_id: i64) -> Source {
    Source {
        source_type: SourceType::Openstreetmap,
        id: format!("{osm_type}/{osm_id}"),
    }
}

fn osm_properties(
    osm_type: &str,
    osm_id: i64,
    tags: &Tags,
    status: Status,
) -> SkiAreaTagProperties {
    SkiAreaTagProperties {
        // No ref-stripping and no fallback root: ski areas are named by `name` alone.
        name: osm_name(tags, "name", None, None),
        sources: vec![osm_source(osm_type, osm_id)],
        activities: Vec::new(),
        status: Some(status),
        websites: websites(tags.get("website").map(String::as_str)),
        wikidata_id: first_value(tags, "wikidata"),
    }
}

/// An OSM `landuse=winter_sports` area.
///
/// Returns `None` when the area is not a ski area for this dataset:
///
/// - `sport` is set to something other than `skiing` or `ski`. Absent is fine; an *empty*
///   value is not, since it is set but is neither of the two.
/// - the geometry is not a polygon or multipolygon.
/// - the landuse is in an unsupported lifecycle state, such as `demolished`.
///
/// The status comes from the lifecycle resolution on `landuse` and the value is ignored —
/// as upstream notes, it is always `winter_sports`.
pub fn landuse(
    osm_type: &str,
    osm_id: i64,
    tags: &Tags,
    geometry: GeometryKind,
) -> Option<SkiAreaTagProperties> {
    if let Some(sport) = tags.get("sport")
        && sport != "skiing"
        && sport != "ski"
    {
        return None;
    }

    if !matches!(geometry, GeometryKind::Polygon | GeometryKind::MultiPolygon) {
        return None;
    }

    let status = status_and_value("landuse", tags).status?;
    Some(osm_properties(osm_type, osm_id, tags, status))
}

/// An OSM `site=piste` relation.
///
/// Unlike the landuse arm there is no geometry or `sport` check: a site relation is only a
/// list of members, and its position is filled in during clustering. The value of `site` is
/// ignored for the same reason `landuse`'s is.
pub fn site(osm_type: &str, relation_id: i64, tags: &Tags) -> Option<SkiAreaTagProperties> {
    let status = status_and_value("site", tags).status?;
    Some(osm_properties(osm_type, relation_id, tags, status))
}

/// A Skimap.org ski area, as it arrives in the input GeoJSON.
#[derive(Debug, Clone, Copy)]
pub struct SkimapInput<'a> {
    pub id: &'a str,
    pub name: Option<&'a str>,
    pub status: Option<Status>,
    pub activities: &'a [SkiAreaActivity],
    pub official_website: Option<&'a str>,
}

/// A Skimap.org ski area. Never rejected: the source is curated, so everything is kept.
///
/// The two empty-string rules differ, and both are upstream's: the name uses `||`, so an
/// empty name becomes `null`, but the website goes through `notEmpty`, which keeps `""`.
pub fn skimap(input: SkimapInput<'_>) -> SkiAreaTagProperties {
    SkiAreaTagProperties {
        name: input.name.filter(|n| !n.is_empty()).map(str::to_owned),
        sources: vec![Source {
            source_type: SourceType::SkimapOrg,
            id: input.id.to_owned(),
        }],
        activities: input.activities.to_vec(),
        status: input.status,
        websites: websites(input.official_website),
        // Upstream has a TODO (#153) to derive this from the Skimap.org id.
        wikidata_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(pairs: &[(&str, &str)]) -> Tags {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn a_plain_landuse_polygon_is_an_operating_ski_area() {
        let result = landuse(
            "way",
            7,
            &tags(&[("landuse", "winter_sports")]),
            GeometryKind::Polygon,
        )
        .expect("a ski area");
        assert_eq!(result.status, Some(Status::Operating));
        assert_eq!(result.sources[0].id, "way/7");
        assert!(result.activities.is_empty());
    }

    #[test]
    fn only_skiing_sports_are_kept() {
        let with_sport = |sport: &str| {
            landuse(
                "way",
                7,
                &tags(&[("landuse", "winter_sports"), ("sport", sport)]),
                GeometryKind::Polygon,
            )
        };
        assert!(with_sport("skiing").is_some());
        assert!(with_sport("ski").is_some());
        assert!(with_sport("snowboard").is_none());
        // Set but empty is still set, and is not skiing.
        assert!(with_sport("").is_none());
    }

    #[test]
    fn landuse_requires_an_area_geometry() {
        let t = tags(&[("landuse", "winter_sports")]);
        assert!(landuse("way", 1, &t, GeometryKind::Polygon).is_some());
        assert!(landuse("way", 1, &t, GeometryKind::MultiPolygon).is_some());
        assert!(landuse("way", 1, &t, GeometryKind::Point).is_none());
        assert!(landuse("way", 1, &t, GeometryKind::LineString).is_none());
    }

    #[test]
    fn an_unsupported_landuse_state_is_rejected() {
        assert!(
            landuse(
                "way",
                1,
                &tags(&[("landuse", "demolished")]),
                GeometryKind::Polygon
            )
            .is_none()
        );
    }

    #[test]
    fn a_lifecycle_prefixed_landuse_keeps_its_status() {
        let result = landuse(
            "way",
            1,
            &tags(&[("disused:landuse", "winter_sports")]),
            GeometryKind::Polygon,
        )
        .expect("kept, but not operating");
        assert_eq!(result.status, Some(Status::Disused));
    }

    #[test]
    fn a_site_needs_no_geometry_or_sport() {
        let result = site(
            "relation",
            5,
            &tags(&[("site", "piste"), ("sport", "hiking")]),
        )
        .expect("a site");
        assert_eq!(result.sources[0].id, "relation/5");
        assert_eq!(result.status, Some(Status::Operating));
    }

    #[test]
    fn a_demolished_site_is_rejected() {
        assert!(site("relation", 1, &tags(&[("site", "demolished")])).is_none());
    }

    #[test]
    fn the_placeholder_geometry_carries_the_relation_id() {
        assert_eq!(placeholder_site_geometry(42), [360.0, 360.0, 42.0]);
        assert_ne!(
            placeholder_site_geometry(1),
            placeholder_site_geometry(2),
            "distinct sites must hash differently"
        );
    }

    /// The two empty-string rules differ, and both are upstream's.
    #[test]
    fn skimap_name_and_website_treat_empty_strings_differently() {
        let result = skimap(SkimapInput {
            id: "1",
            name: Some(""),
            status: Some(Status::Operating),
            activities: &[],
            official_website: Some(""),
        });
        assert_eq!(result.name, None, "an empty name becomes null");
        assert_eq!(
            result.websites,
            vec![String::new()],
            "an empty website is kept"
        );
    }

    #[test]
    fn skimap_passes_status_and_activities_through() {
        let result = skimap(SkimapInput {
            id: "9",
            name: Some("Resort"),
            status: None,
            activities: &[SkiAreaActivity::Downhill, SkiAreaActivity::Nordic],
            official_website: None,
        });
        assert_eq!(result.status, None, "Skimap.org can report no status");
        assert_eq!(result.activities.len(), 2);
        assert_eq!(result.sources[0].source_type, SourceType::SkimapOrg);
        assert_eq!(result.wikidata_id, None);
    }
}
