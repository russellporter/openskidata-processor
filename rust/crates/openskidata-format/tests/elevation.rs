//! The elevation maths against the real `openskidata-format` package
//! (`rust/codegen/generate-elevation-vectors.mjs`): `lineChunkPatched`,
//! `extractPointsForElevationProfile`, `getProfileGeometry`, `getAscentAndDescent`,
//! `getPitchData`, `getElevationData`, `getRunElevationData` and `getLiftElevationData`, on
//! random lines, including the strings upstream throws.
//!
//! Longitudes and latitudes are compared to 1e-13 and everything else to 1e-9, because the
//! trigonometry behind every distance comes from `libm` rather than V8 (musl and V8 share
//! fdlibm's lineage but not every last digit); the test reports how many numbers matched
//! exactly (99.7%) and the worst difference seen (7e-11, in a pitch ratio).
//!
//! # Mutants that survive, and why
//!
//! Each was found by deliberately breaking the port; these cannot be told apart by any input
//! the generator can produce:
//!
//! - the last-segment cut-off at 1% of the resolution (vs 2%): the resolution divides the line
//!   evenly, so a last segment is either about a full resolution long or a rounding-error
//!   sliver; nothing lands between;
//! - `ascent` with `>=` instead of `>`: a change of exactly zero adds zero to either total;
//! - a pitch line exactly half the resolution long: a measure-zero length;
//! - interpolating across two references at the same place, and the single-point last chunk in
//!   `extractPointsForElevationProfile`: observable only if the repeated vertex falls exactly
//!   on a chunk boundary, since only chunk end points are read back;
//! - `±180` on the direction in `lineSliceAlong`, and skipping the zero-overshoot shortcut:
//!   mathematically identical, differing by an ulp.
//!
//! One deliberate difference: upstream's `interpolateElevation` pushes elevations onto the
//! caller's own coordinate arrays, so for a line with elevation on only some vertices the
//! returned line has the gaps filled in. The pipeline never produces such a line, so only the
//! numbers are compared for them (see `Stats::data`).

use openskidata_format::LiftStationPosition;
use openskidata_format::elevation_profile::{
    AscentDescentData, ElevationData, ElevationProfile, PitchData, ascent_and_descent,
    elevation_data, extract_points_for_elevation_profile, line_chunk_patched, pitch_data,
    profile_geometry,
};
use openskidata_format::lift::{LiftElevationData, StationPoint, lift_elevation_data};
use openskidata_format::run::run_elevation_data;
use osd_turf::Coord;
use serde::Deserialize;
use serde_json::Value;
use std::str::FromStr;

#[derive(Deserialize)]
struct Vectors {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    kind: String,
    input: Value,
    expected: Value,
}

/// Turns `{"$nonFinite": "Infinity"}` back into a number.
fn decode(value: &Value) -> Value {
    match value {
        Value::Object(map) if map.len() == 1 && map.contains_key("$nonFinite") => {
            // `serde_json` has no non-finite numbers; carry them as strings.
            Value::String(map["$nonFinite"].as_str().unwrap().to_owned())
        }
        Value::Object(map) => {
            Value::Object(map.iter().map(|(k, v)| (k.clone(), decode(v))).collect())
        }
        Value::Array(items) => Value::Array(items.iter().map(decode).collect()),
        other => other.clone(),
    }
}

/// A number as the vectors carry it: finite, or `NaN` / `Infinity` / `-Infinity` as text.
fn number(value: &Value) -> f64 {
    match value {
        Value::Number(n) => n.as_f64().unwrap(),
        Value::String(s) if s == "NaN" => f64::NAN,
        Value::String(s) if s == "Infinity" => f64::INFINITY,
        Value::String(s) if s == "-Infinity" => f64::NEG_INFINITY,
        other => panic!("not a number: {other}"),
    }
}

fn coord(value: &Value) -> Coord {
    let a = value.as_array().unwrap();
    Coord {
        x: number(&a[0]),
        y: number(&a[1]),
        z: a.get(2).map(number),
    }
}

fn coords(value: &Value) -> Vec<Coord> {
    value.as_array().unwrap().iter().map(coord).collect()
}

#[derive(Default)]
struct Stats {
    numbers: usize,
    exact: usize,
    worst: f64,
}

impl Stats {
    /// Whether `got` matches `want`; records how closely.
    fn close(&mut self, got: f64, want: f64) -> bool {
        self.numbers += 1;
        if got == want || (got.is_nan() && want.is_nan()) {
            self.exact += 1;
            return true;
        }
        let scale = got.abs().max(want.abs()).max(1.0);
        let difference = (got - want).abs() / scale;
        self.worst = self.worst.max(difference);
        difference <= 1e-9
    }

    fn opt(&mut self, got: Option<f64>, want: &Value) -> bool {
        match (got, want) {
            (None, Value::Null) => true,
            (Some(g), w) if !w.is_null() => self.close(g, number(w)),
            _ => false,
        }
    }

    fn coord(&mut self, got: &Coord, want: &Value) -> bool {
        let want = coord(want);
        // Longitudes and latitudes agree to 1e-13 (and are bit-identical in all but about one
        // case in eighty): tighter than the 1e-9 allowed for the quantities that divide them.
        for (g, w) in [(got.x, want.x), (got.y, want.y)] {
            if (g - w).abs() > 1e-13 * w.abs().max(1.0) {
                return false;
            }
        }
        self.close(got.x, want.x)
            && self.close(got.y, want.y)
            && match (got.z, want.z) {
                (Some(g), Some(w)) => self.close(g, w),
                (None, None) => true,
                _ => false,
            }
    }

    fn coords(&mut self, got: &[Coord], want: &Value) -> bool {
        let want = want.as_array().unwrap();
        got.len() == want.len() && got.iter().zip(want).all(|(g, w)| self.coord(g, w))
    }

    fn ascent(&mut self, got: &AscentDescentData, want: &Value) -> bool {
        self.close(got.ascent_in_meters, number(&want["ascentInMeters"]))
            && self.close(got.descent_in_meters, number(&want["descentInMeters"]))
            && self.close(
                got.min_elevation_in_meters,
                number(&want["minElevationInMeters"]),
            )
            && self.close(
                got.max_elevation_in_meters,
                number(&want["maxElevationInMeters"]),
            )
            && self.close(got.vertical_in_meters, number(&want["verticalInMeters"]))
    }

    fn pitch(&mut self, got: &PitchData, want: &Value) -> bool {
        self.opt(got.average_pitch_in_percent, &want["averagePitchInPercent"])
            && self.opt(got.max_pitch_in_percent, &want["maxPitchInPercent"])
            && self.close(
                got.inclined_length_in_meters,
                number(&want["inclinedLengthInMeters"]),
            )
            && self.opt(got.overall_pitch_in_percent, &want["overallPitchInPercent"])
            && self.close(
                got.pitch_calculation_resolution_in_meters,
                number(&want["pitchCalculationResolutionInMeters"]),
            )
    }

    /// `with_profile` is false for lines with elevation on only some vertices: upstream's
    /// `interpolateElevation` pushes the interpolated values onto the caller's own coordinate
    /// arrays, so its returned line has them filled in. That aliasing cannot arise from the
    /// pipeline, which gives every vertex of a line an elevation or none, so only the numbers
    /// are compared there.
    fn data(&mut self, got: &ElevationData, want: &Value, with_profile: bool) -> bool {
        self.ascent(&got.ascent_descent, want)
            && self.pitch(&got.pitch, want)
            && (!with_profile || self.coords(&got.profile_geometry, &want["profile"]))
    }
}

/// The error a throw gives: compared by message, up to the numbers or points some quote.
fn same_error(got: &str, want: &str) -> bool {
    let normalise = |s: &str| {
        let s = s.to_lowercase();
        // V8's own TypeErrors; their wording is not this port's to reproduce.
        if s.starts_with("cannot read properties of undefined") {
            return "cannot read properties of undefined".to_owned();
        }
        // Some messages go on to quote numbers or dump the points.
        s.split(" (")
            .next()
            .unwrap()
            .split(" [")
            .next()
            .unwrap()
            .to_owned()
    };
    normalise(got) == normalise(want)
}

/// Whether every vertex has an elevation, or none does.
fn uniform_elevation(line: &[Coord]) -> bool {
    line.iter().all(|c| c.z.is_some()) || line.iter().all(|c| c.z.is_none())
}

fn profile(value: &Value) -> ElevationProfile {
    ElevationProfile {
        heights: value["heights"]
            .as_array()
            .unwrap()
            .iter()
            .map(number)
            .collect(),
        resolution: number(&value["resolution"]),
        target_resolution: number(&value["targetResolution"]),
    }
}

#[test]
fn every_recorded_elevation_computation_is_reproduced() {
    let vectors: Vectors = serde_json::from_str(include_str!("elevation_vectors.json")).unwrap();
    assert!(vectors.cases.len() >= 4000);

    let mut stats = Stats::default();
    let mut failures: Vec<String> = Vec::new();
    for (n, case) in vectors.cases.iter().enumerate() {
        let input = decode(&case.input);
        let expected = decode(&case.expected);
        let want_error = expected.get("error").and_then(Value::as_str);
        let want = expected.get("ok");

        // Each arm yields Ok(matched?) or the error message the port produced.
        let outcome: Result<bool, String> = (|| match case.kind.as_str() {
            "chunk" => {
                let (resolution, chunks) =
                    line_chunk_patched(&coords(&input["coords"]), number(&input["res"]))?;
                let Some(want) = want else { return Ok(false) };
                let want_chunks = want["chunks"].as_array().unwrap();
                Ok(stats.close(resolution, number(&want["resolution"]))
                    && chunks.len() == want_chunks.len()
                    && chunks
                        .iter()
                        .zip(want_chunks)
                        .all(|(g, w)| stats.coords(g, w)))
            }
            "extract" => {
                let (resolution, points) = extract_points_for_elevation_profile(
                    &coords(&input["coords"]),
                    number(&input["res"]),
                )?;
                let Some(want) = want else { return Ok(false) };
                Ok(stats.close(resolution, number(&want["resolution"]))
                    && stats.coords(&points, &want["points"]))
            }
            "ascent" => {
                let got = ascent_and_descent(&coords(&input["coords"]))?;
                Ok(want.is_some_and(|w| stats.ascent(&got, w)))
            }
            "pitch" => {
                let got = pitch_data(&coords(&input["coords"]), number(&input["minRes"]))?;
                Ok(want.is_some_and(|w| stats.pitch(&got, w)))
            }
            "data" => {
                let line = coords(&input["coords"]);
                let got = elevation_data(&line)?;
                Ok(want.is_some_and(|w| stats.data(&got, w, uniform_elevation(&line))))
            }
            "profile" => {
                let got = profile_geometry(&coords(&input["coords"]), &profile(&input["profile"]))?;
                Ok(want.is_some_and(|w| stats.coords(&got, w)))
            }
            "run" => {
                let got = run_elevation_data(
                    &coords(&input["coords"]),
                    Some(&profile(&input["profile"])),
                )?;
                Ok(match (got, want) {
                    (None, Some(Value::Null)) => true,
                    (Some(g), Some(w)) if !w.is_null() => stats.data(&g, w, true),
                    _ => false,
                })
            }
            "lift" => {
                let stations: Vec<StationPoint> = input["stations"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| StationPoint {
                        position: Some(
                            LiftStationPosition::from_str(s["position"].as_str().unwrap()).unwrap(),
                        ),
                        coord: coord(&s["point"]),
                    })
                    .collect();
                let duration = input["duration"].as_f64();
                let line = coords(&input["coords"]);
                let got: Option<LiftElevationData> =
                    lift_elevation_data(&line, duration, &stations)?;
                Ok(match (got, want) {
                    (None, Some(Value::Null)) => true,
                    (Some(g), Some(w)) if !w.is_null() => {
                        stats.data(&g.elevation, w, uniform_elevation(&line))
                            && stats.opt(g.speed_in_meters_per_second, &w["speedInMetersPerSecond"])
                            && stats.opt(
                                g.vertical_speed_in_meters_per_second,
                                &w["verticalSpeedInMetersPerSecond"],
                            )
                    }
                    _ => false,
                })
            }
            other => panic!("unknown kind {other}"),
        })();

        let ok = match (&outcome, want_error) {
            (Ok(matched), None) => *matched,
            (Err(got), Some(want)) => same_error(got, want),
            _ => false,
        };
        if !ok {
            failures.push(format!(
                "case {n} ({}): got {outcome:?}, expected {}\n  input: {}",
                case.kind,
                want_error.map_or_else(|| "a result".to_owned(), |e| format!("error {e:?}")),
                input.to_string().chars().take(300).collect::<String>()
            ));
        }
    }
    eprintln!(
        "{} numbers compared, {} exact ({:.4}%), worst relative difference {:e}",
        stats.numbers,
        stats.exact,
        100.0 * stats.exact as f64 / stats.numbers as f64,
        stats.worst
    );
    assert!(
        failures.is_empty(),
        "{} of {} cases differ; first:\n{}",
        failures.len(),
        vectors.cases.len(),
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
