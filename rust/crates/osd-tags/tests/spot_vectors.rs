//! Cross-checks the spot derivation against the 53 recorded cases.

use openskidata_format::spot::SpotKind;
use osd_tags::{Tags, spot::spots};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
struct Vectors {
    spots: Vec<Case>,
}

#[derive(Debug, Deserialize)]
struct Case {
    tags: Tags,
    output: Vec<Value>,
}

/// Upstream's own `spotType` string for an actual spot.
fn spot_type(spot: &SpotKind) -> &'static str {
    match spot {
        SpotKind::Crossing { .. } => "crossing",
        SpotKind::LiftStation { .. } => "lift_station",
        SpotKind::AvalancheTransceiverTraining {} => "avalanche_transceiver_training",
        SpotKind::AvalancheTransceiverCheckpoint {} => "avalanche_transceiver_checkpoint",
        SpotKind::Halfpipe {} => "halfpipe",
    }
}

#[test]
fn spots_match_the_live_implementation() {
    let v: Vectors = serde_json::from_str(include_str!("vectors.json")).expect("deserializes");

    let mut by_count = std::collections::BTreeMap::<usize, usize>::new();
    for case in &v.spots {
        let actual = spots(&case.tags);
        let context = format!("{:?}", case.tags);

        // Count and order first: both reach the output.
        let expected_types: Vec<&str> = case
            .output
            .iter()
            .map(|o| o["properties"]["spotType"].as_str().expect("spotType"))
            .collect();
        let actual_types: Vec<&str> = actual.iter().map(spot_type).collect();
        assert_eq!(actual_types, expected_types, "spot types for {context}");

        // Then the full serialized form of each spot, against the properties upstream
        // produced, ignoring the fields owned by later stages.
        for (spot, expected) in actual.iter().zip(&case.output) {
            let mut actual_json = serde_json::to_value(spot).expect("serializes");
            let expected_props = &expected["properties"];

            // `type` and the common fields are not part of SpotKind.
            let object = actual_json.as_object_mut().expect("an object");
            for key in [
                "type",
                "skiAreas",
                "sources",
                "places",
                "viewportHint",
                "id",
            ] {
                object.remove(key);
            }
            let mut expected_props = expected_props.clone();
            let expected_object = expected_props.as_object_mut().expect("an object");
            for key in [
                "type",
                "skiAreas",
                "sources",
                "places",
                "viewportHint",
                "id",
            ] {
                expected_object.remove(key);
            }
            assert_eq!(actual_json, expected_props, "properties for {context}");
        }

        *by_count.entry(actual.len()).or_default() += 1;
    }

    // The corpus has to exercise the empty, single and multiple cases or the above says
    // little about the multi-spot ordering.
    assert!(by_count.contains_key(&0), "{by_count:?}");
    assert!(by_count.contains_key(&1), "{by_count:?}");
    assert!(by_count.keys().any(|&n| n > 1), "{by_count:?}");
}
