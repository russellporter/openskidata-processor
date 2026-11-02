//! Which tagged closed ways are areas rather than lines.
//!
//! Replaces `isPolygonFeature` and its table in `OSMToGeoJSONConverter.ts`, which follows
//! <https://wiki.openstreetmap.org/wiki/Overpass_turbo/Polygon_Features> with the addition
//! of downhill piste areas.
//!
//! OSM does not say whether a closed way is a ring or an area: a closed `highway` is a
//! roundabout, a closed `landuse` is a field. The convention is a per-key table, some keys
//! meaning "always an area", some "an area for these values", some "an area except for
//! these".

use crate::element::Tags;

enum Rule {
    /// Any value makes it an area.
    Always,
    /// Only these values do.
    Included(&'static [&'static str]),
    /// Every value except these does.
    Excluded(&'static [&'static str]),
}

use Rule::{Always, Excluded, Included};

const POLYGON_FEATURES: &[(&str, Rule)] = &[
    ("building", Always),
    ("highway", Included(&["services", "rest_area", "escape"])),
    (
        "natural",
        Excluded(&["coastline", "ridge", "arete", "tree_row"]),
    ),
    ("landuse", Always),
    (
        "waterway",
        Included(&["riverbank", "dock", "boatyard", "dam"]),
    ),
    ("amenity", Always),
    ("leisure", Always),
    (
        "barrier",
        Included(&[
            "city_wall",
            "ditch",
            "hedge",
            "retaining_wall",
            "wall",
            "spikes",
        ]),
    ),
    (
        "railway",
        Included(&["station", "turntable", "roundhouse", "platform"]),
    ),
    ("area", Always),
    ("boundary", Always),
    ("man_made", Excluded(&["cutline", "embankment", "pipeline"])),
    (
        "power",
        Included(&["generator", "station", "sub_station", "transformer"]),
    ),
    ("place", Always),
    ("shop", Always),
    ("aeroway", Excluded(&["taxiway"])),
    ("tourism", Always),
    ("historic", Always),
    ("public_transport", Always),
    ("office", Always),
    ("building:part", Always),
    ("military", Always),
    ("ruins", Always),
    ("area:highway", Always),
    ("craft", Always),
    // The addition over the wiki table: a closed downhill piste is an area, not a loop.
    ("piste:type", Included(&["downhill"])),
];

fn rule_for(key: &str) -> Option<&'static Rule> {
    POLYGON_FEATURES
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, rule)| rule)
}

/// Whether the tags describe an area.
pub fn is_polygon_feature(tags: &Tags) -> bool {
    // Explicitly tagged as not an area, regardless of anything else.
    if tags.get("area").map(String::as_str) == Some("no") {
        return false;
    }

    for (key, value) in tags {
        let Some(rule) = rule_for(key) else {
            continue;
        };
        // Explicitly un-set, e.g. `building=no`.
        if value == "no" {
            continue;
        }
        match rule {
            Always => return true,
            Included(values) if values.contains(&value.as_str()) => return true,
            Excluded(values) if !values.contains(&value.as_str()) => return true,
            _ => {}
        }
    }
    false
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
    fn always_rules_make_any_value_an_area() {
        assert!(is_polygon_feature(&tags(&[("landuse", "winter_sports")])));
        assert!(is_polygon_feature(&tags(&[("building", "yes")])));
    }

    #[test]
    fn included_value_rules_need_a_listed_value() {
        assert!(is_polygon_feature(&tags(&[("highway", "services")])));
        assert!(!is_polygon_feature(&tags(&[("highway", "residential")])));
    }

    #[test]
    fn excluded_value_rules_accept_everything_else() {
        assert!(is_polygon_feature(&tags(&[("natural", "wood")])));
        assert!(!is_polygon_feature(&tags(&[("natural", "coastline")])));
    }

    #[test]
    fn a_closed_downhill_piste_is_an_area_but_other_pistes_are_not() {
        assert!(is_polygon_feature(&tags(&[("piste:type", "downhill")])));
        assert!(!is_polygon_feature(&tags(&[("piste:type", "nordic")])));
    }

    #[test]
    fn explicit_no_overrides_the_rule() {
        assert!(!is_polygon_feature(&tags(&[("building", "no")])));
        assert!(!is_polygon_feature(&tags(&[
            ("landuse", "winter_sports"),
            ("area", "no")
        ])));
    }

    #[test]
    fn untagged_and_unrelated_ways_are_not_areas() {
        assert!(!is_polygon_feature(&tags(&[])));
        assert!(!is_polygon_feature(&tags(&[("name", "A road")])));
    }
}
