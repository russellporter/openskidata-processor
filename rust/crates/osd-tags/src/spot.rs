//! Tags to spots.
//!
//! Replaces the tag-reading half of `src/transforms/SpotFormatter.ts`.
//!
//! # One element, several spots
//!
//! Every sub-formatter is applied, not just the first that matches, so a single OSM element
//! can yield more than one spot — a node tagged both as a pedestrian crossing and as a lift
//! station is both. The sub-formatters run in a fixed order and the result preserves it,
//! which matters because that order reaches the output.

use crate::osm::osm_name;
use crate::status::Tags;
use openskidata_format::spot::SpotKind;
use openskidata_format::{DismountRequirement, LiftStationPosition};
use std::str::FromStr;

/// A crossing, from `piste:dismount`.
///
/// Matching is exact and case-sensitive: `YES` is not `yes`. An empty value is falsy
/// upstream and so reads as absent.
fn crossing(tags: &Tags) -> Option<SpotKind> {
    let value = tags.get("piste:dismount")?;
    if value.is_empty() {
        return None;
    }
    DismountRequirement::from_str(value)
        .ok()
        .map(|dismount| SpotKind::Crossing { dismount })
}

/// A lift station, from `aerialway=station`.
///
/// Position and access are independent derivations from two different tags, and an
/// unrecognized value for either leaves just that part unknown rather than rejecting the
/// station. `lift_id` is empty here: the station is attached to its lift later, during
/// clustering, once it is known which lift it belongs to.
fn lift_station(tags: &Tags) -> Option<SpotKind> {
    if tags.get("aerialway").map(String::as_str) != Some("station") {
        return None;
    }

    let position = tags
        .get("aerialway:station")
        .and_then(|value| LiftStationPosition::from_str(value).ok());

    // `aerialway:access` says which directions passengers can use the station in.
    let (entry, exit) = match tags.get("aerialway:access").map(String::as_str) {
        Some("both") => (Some(true), Some(true)),
        Some("entry") => (Some(true), Some(false)),
        Some("exit") => (Some(false), Some(true)),
        Some("no") => (Some(false), Some(false)),
        _ => (None, None),
    };

    Some(SpotKind::LiftStation {
        name: osm_name(tags, "name", None, None),
        position,
        entry,
        exit,
        lift_id: String::new(),
    })
}

fn avalanche_transceiver(tags: &Tags, kind: &str) -> bool {
    tags.get("amenity").map(String::as_str) == Some("avalanche_transceiver")
        && tags.get("avalanche_transceiver").map(String::as_str) == Some(kind)
}

fn halfpipe(tags: &Tags) -> bool {
    tags.get("man_made").map(String::as_str) == Some("piste:halfpipe")
}

/// Every spot an element describes, in upstream's order.
///
/// Replaces the dispatch in `formatSpots`. The geometry is not considered here: upstream
/// reduces every geometry to its centroid, which belongs to the reader.
pub fn spots(tags: &Tags) -> Vec<SpotKind> {
    let mut found = Vec::new();

    if let Some(spot) = crossing(tags) {
        found.push(spot);
    }
    if let Some(spot) = lift_station(tags) {
        found.push(spot);
    }
    if avalanche_transceiver(tags, "training") {
        found.push(SpotKind::AvalancheTransceiverTraining {});
    }
    if avalanche_transceiver(tags, "checkpoint") {
        found.push(SpotKind::AvalancheTransceiverCheckpoint {});
    }
    if halfpipe(tags) {
        found.push(SpotKind::Halfpipe {});
    }

    found
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
    fn untagged_elements_yield_no_spots() {
        assert!(spots(&tags(&[])).is_empty());
        assert!(spots(&tags(&[("aerialway", "chair_lift")])).is_empty());
    }

    #[test]
    fn dismount_is_exact_and_case_sensitive() {
        for value in ["yes", "no", "sometimes"] {
            assert_eq!(
                spots(&tags(&[("piste:dismount", value)])).len(),
                1,
                "{value}"
            );
        }
        for value in ["", "YES", "nonsense"] {
            assert!(
                spots(&tags(&[("piste:dismount", value)])).is_empty(),
                "{value:?}"
            );
        }
    }

    #[test]
    fn a_station_reads_position_and_access_independently() {
        let result = spots(&tags(&[
            ("aerialway", "station"),
            ("aerialway:station", "top"),
            ("aerialway:access", "entry"),
        ]));
        assert_eq!(
            result,
            vec![SpotKind::LiftStation {
                name: None,
                position: Some(LiftStationPosition::Top),
                entry: Some(true),
                exit: Some(false),
                lift_id: String::new(),
            }]
        );
    }

    /// An unrecognized value leaves only that part unknown; the station itself survives.
    #[test]
    fn an_unrecognized_station_value_does_not_reject_the_station() {
        let result = spots(&tags(&[
            ("aerialway", "station"),
            ("aerialway:station", "nonsense"),
            ("aerialway:access", "nonsense"),
        ]));
        assert_eq!(result.len(), 1);
        assert!(matches!(
            &result[0],
            SpotKind::LiftStation {
                position: None,
                entry: None,
                exit: None,
                ..
            }
        ));
    }

    #[test]
    fn avalanche_transceivers_need_both_tags() {
        assert_eq!(
            spots(&tags(&[
                ("amenity", "avalanche_transceiver"),
                ("avalanche_transceiver", "training"),
            ])),
            vec![SpotKind::AvalancheTransceiverTraining {}]
        );
        assert!(spots(&tags(&[("avalanche_transceiver", "training")])).is_empty());
        assert!(spots(&tags(&[("amenity", "avalanche_transceiver")])).is_empty());
    }

    /// Every matching sub-formatter applies, and the output keeps their order.
    #[test]
    fn several_spots_from_one_element_keep_upstream_order() {
        let result = spots(&tags(&[
            ("man_made", "piste:halfpipe"),
            ("amenity", "avalanche_transceiver"),
            ("avalanche_transceiver", "training"),
            ("aerialway", "station"),
            ("piste:dismount", "no"),
        ]));
        let order: Vec<&str> = result
            .iter()
            .map(|spot| match spot {
                SpotKind::Crossing { .. } => "crossing",
                SpotKind::LiftStation { .. } => "lift_station",
                SpotKind::AvalancheTransceiverTraining {} => "training",
                SpotKind::AvalancheTransceiverCheckpoint {} => "checkpoint",
                SpotKind::Halfpipe {} => "halfpipe",
            })
            .collect();
        assert_eq!(
            order,
            vec!["crossing", "lift_station", "training", "halfpipe"]
        );
    }
}
