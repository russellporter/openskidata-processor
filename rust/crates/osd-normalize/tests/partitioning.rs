//! The property that makes partitioning safe: normalizing one component at a time gives
//! exactly what normalizing everything together gives.
//!
//! Scenes from the recorded corpus are each a small, usually connected, set of runs. To get
//! several components with interleaved input order, scenes are shifted apart in longitude
//! and their runs dealt out alternately, so a component's runs are not contiguous in the
//! input and the order reassembly has real work to do.

use openskidata_format::run::RunProperties;
use openskidata_format::viewport_hint::ViewportHint;
use osd_normalize::normalize::{RunInput, normalize_runs, normalize_runs_partitioned};
use osd_normalize::topology::InputGeometry;
use osd_store::FixedCoord;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Scenes {
    scenes: Vec<Scene>,
}

#[derive(Deserialize)]
struct Scene {
    runs: Vec<RawRun>,
}

#[derive(Deserialize)]
struct RawRun {
    geometry: RawGeometry,
    properties: RunProperties,
}

#[derive(Deserialize)]
struct RawGeometry {
    #[serde(rename = "type")]
    kind: String,
    coordinates: Value,
}

fn shifted(raw: &RawGeometry, lng_offset: i32) -> InputGeometry {
    let shift = |[lng, lat]: [i32; 2]| FixedCoord {
        lng: lng + lng_offset,
        lat,
    };
    match raw.kind.as_str() {
        "LineString" => {
            let points: Vec<[i32; 2]> = serde_json::from_value(raw.coordinates.clone()).unwrap();
            InputGeometry::Line(points.into_iter().map(shift).collect())
        }
        _ => {
            let rings: Vec<Vec<[i32; 2]>> =
                serde_json::from_value(raw.coordinates.clone()).unwrap();
            InputGeometry::Polygon(
                rings
                    .into_iter()
                    .map(|ring| ring.into_iter().map(shift).collect())
                    .collect(),
            )
        }
    }
}

const STUB: ViewportHint = ViewportHint {
    center: (0.0, 0.0),
    bearing: None,
    rotated_width_meters: 0.0,
    rotated_height_meters: 0.0,
    min_camera_y: 0.0,
};

#[test]
fn partitioned_output_equals_global_output() {
    let scenes: Scenes = serde_json::from_str(include_str!("normalize_scenes.json")).unwrap();
    let hint = |_: &[FixedCoord]| STUB;

    let mut multi_component = 0;
    // Groups of up to five scenes at distinct longitudes.
    for (group_number, group) in scenes.scenes.chunks(5).enumerate() {
        let per_scene: Vec<Vec<RunInput>> = group
            .iter()
            .enumerate()
            .map(|(k, scene)| {
                let offset = (k as i32) * 100_000_000; // 10 degrees apart
                scene
                    .runs
                    .iter()
                    .map(|run| RunInput {
                        geometry: shifted(&run.geometry, offset),
                        properties: run.properties.clone(),
                    })
                    .collect()
            })
            .collect();

        // Deal runs out round-robin so each scene's runs are interleaved with the others'.
        let mut interleaved: Vec<RunInput> = Vec::new();
        let longest = per_scene.iter().map(Vec::len).max().unwrap_or(0);
        for i in 0..longest {
            for scene in &per_scene {
                if let Some(run) = scene.get(i) {
                    interleaved.push(run.clone());
                }
            }
        }
        if per_scene.len() > 1 {
            multi_component += 1;
        }

        let global = normalize_runs(&interleaved, &hint).unwrap();
        let partitioned = normalize_runs_partitioned(&interleaved, &hint).unwrap();
        assert_eq!(
            partitioned.len(),
            global.len(),
            "group {group_number}: different number of outputs"
        );
        for (i, (p, g)) in partitioned.iter().zip(&global).enumerate() {
            assert_eq!(p, g, "group {group_number}: output {i} differs");
        }
    }
    assert!(
        multi_component > 100,
        "only {multi_component} multi-scene groups"
    );
}
