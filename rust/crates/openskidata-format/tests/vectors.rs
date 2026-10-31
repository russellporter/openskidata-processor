//! Verifies the ported format functions against vectors produced by the real
//! `openskidata-format` npm package.
//!
//! These are not hand-written expectations. `rust/codegen/generate-format-vectors.mjs`
//! calls the published implementation and records what it returns, because the failure
//! mode worth guarding against is a transcription slip: a colour attached to the wrong
//! difficulty, or a display string with the wrong casing, reads perfectly well and is
//! wrong in every output file.
//!
//! Regenerate after an `openskidata-format` bump:
//! `node rust/codegen/generate-format-vectors.mjs`

use openskidata_format::{
    LiftType, RunColorName, RunColorValue, RunDifficulty, RunDifficultyConvention, RunUse,
    SourceType, Status, lift, run,
    slope_grading::{self, SlopeGradingScale},
    source::{self, Source},
};
use serde::Deserialize;
use std::str::FromStr;

#[derive(Debug, Deserialize)]
struct Vectors {
    #[serde(rename = "formatVersion")]
    format_version: String,
    #[serde(rename = "runColorName")]
    run_color_name: Vec<RunColorCase>,
    #[serde(rename = "runColor")]
    run_color: Vec<RunColorCase>,
    #[serde(rename = "runColorNameToValue")]
    run_color_name_to_value: Vec<ColorNameCase>,
    #[serde(rename = "liftColor")]
    lift_color: Vec<LiftColorCase>,
    #[serde(rename = "formattedLiftType")]
    formatted_lift_type: Vec<LiftTypeCase>,
    #[serde(rename = "sourceURL")]
    source_url: Vec<SourceCase>,
    #[serde(rename = "sourceName")]
    source_name: Vec<SourceNameCase>,
    #[serde(rename = "slopeGradingScaleForUse")]
    slope_grading_scale_for_use: Vec<SlopeScaleCase>,
}

#[derive(Debug, Deserialize)]
struct RunColorCase {
    convention: String,
    difficulty: Option<String>,
    expected: String,
}

#[derive(Debug, Deserialize)]
struct ColorNameCase {
    color: String,
    expected: String,
}

#[derive(Debug, Deserialize)]
struct LiftColorCase {
    status: String,
    expected: String,
}

#[derive(Debug, Deserialize)]
struct LiftTypeCase {
    #[serde(rename = "liftType")]
    lift_type: String,
    expected: String,
}

#[derive(Debug, Deserialize)]
struct SourceCase {
    #[serde(rename = "type")]
    source_type: String,
    id: String,
    expected: String,
}

#[derive(Debug, Deserialize)]
struct SourceNameCase {
    #[serde(rename = "type")]
    source_type: String,
    expected: String,
}

#[derive(Debug, Deserialize)]
struct SlopeScaleCase {
    #[serde(rename = "runUse")]
    run_use: String,
    convention: String,
    expected: ExpectedScale,
}

#[derive(Debug, Deserialize)]
struct ExpectedScale {
    stops: Vec<ExpectedStop>,
}

#[derive(Debug, Deserialize)]
struct ExpectedStop {
    #[serde(rename = "maxSteepness")]
    max_steepness: Number,
    difficulty: Option<String>,
}

/// JSON has no Infinity, so the generator encodes a non-finite number as
/// `{"$nonFinite": "Infinity"}`. Without that the slope scales' unbounded final threshold
/// would arrive as `null` and read as "no threshold" rather than "unbounded".
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Number {
    Finite(f64),
    NonFinite {
        #[serde(rename = "$nonFinite")]
        non_finite: String,
    },
}

impl Number {
    fn value(&self) -> f64 {
        match self {
            Number::Finite(value) => *value,
            Number::NonFinite { non_finite } => match non_finite.as_str() {
                "Infinity" => f64::INFINITY,
                "-Infinity" => f64::NEG_INFINITY,
                "NaN" => f64::NAN,
                other => panic!("unexpected non-finite encoding: {other}"),
            },
        }
    }
}

fn vectors() -> Vectors {
    let raw = include_str!("vectors.json");
    serde_json::from_str(raw).expect("vectors.json should deserialize")
}

fn convention(value: &str) -> RunDifficultyConvention {
    RunDifficultyConvention::from_str(value).expect("known convention")
}

fn difficulty(value: &Option<String>) -> Option<RunDifficulty> {
    value
        .as_deref()
        .map(|d| RunDifficulty::from_str(d).expect("known difficulty"))
}

#[test]
fn vectors_were_generated_from_the_pinned_format_version() {
    // A mismatch means vectors.json was generated against a different package version
    // than the one currently installed, so the expectations below prove nothing.
    assert_eq!(vectors().format_version, "16.0.0");
}

#[test]
fn run_color_name_matches_every_convention_and_difficulty() {
    let v = vectors();
    assert_eq!(
        v.run_color_name.len(),
        24,
        "expected 3 conventions x 8 difficulties"
    );
    for case in &v.run_color_name {
        let actual =
            run::run_color_name(convention(&case.convention), difficulty(&case.difficulty));
        assert_eq!(
            actual.as_wire_str(),
            case.expected,
            "convention {} difficulty {:?}",
            case.convention,
            case.difficulty
        );
    }
}

#[test]
fn run_color_matches_every_convention_and_difficulty() {
    for case in &vectors().run_color {
        let actual = run::run_color(convention(&case.convention), difficulty(&case.difficulty));
        assert_eq!(
            actual.as_wire_str(),
            case.expected,
            "convention {} difficulty {:?}",
            case.convention,
            case.difficulty
        );
    }
}

#[test]
fn run_color_name_maps_to_the_right_value() {
    for case in &vectors().run_color_name_to_value {
        let color = RunColorName::from_str(&case.color).expect("known color name");
        let actual: RunColorValue = run::run_color_name_to_value(color);
        assert_eq!(actual.as_wire_str(), case.expected, "color {}", case.color);
    }
}

#[test]
fn lift_color_matches_every_status() {
    let v = vectors();
    assert_eq!(v.lift_color.len(), 6, "expected every Status to be covered");
    for case in &v.lift_color {
        let status = Status::from_str(&case.status).expect("known status");
        assert_eq!(
            lift::lift_color(status),
            case.expected,
            "status {}",
            case.status
        );
    }
}

#[test]
fn formatted_lift_type_matches_every_lift_type() {
    let v = vectors();
    assert_eq!(
        v.formatted_lift_type.len(),
        12,
        "expected every LiftType to be covered"
    );
    for case in &v.formatted_lift_type {
        let lift_type = LiftType::from_str(&case.lift_type).expect("known lift type");
        assert_eq!(
            lift::formatted_lift_type(lift_type),
            case.expected,
            "lift type {}",
            case.lift_type
        );
    }
}

#[test]
fn source_url_and_name_match() {
    let v = vectors();
    for case in &v.source_url {
        let source = Source {
            source_type: SourceType::from_str(&case.source_type).expect("known source type"),
            id: case.id.clone(),
        };
        assert_eq!(source::source_url(&source), case.expected);
    }
    for case in &v.source_name {
        let source_type = SourceType::from_str(&case.source_type).expect("known source type");
        assert_eq!(source::source_name(source_type), case.expected);
    }
}

#[test]
fn slope_grading_scales_match_every_use_and_convention() {
    let v = vectors();
    assert_eq!(
        v.slope_grading_scale_for_use.len(),
        33,
        "expected 11 run uses x 3 conventions"
    );
    for case in &v.slope_grading_scale_for_use {
        let run_use = RunUse::from_str(&case.run_use).expect("known run use");
        let actual: SlopeGradingScale =
            slope_grading::slope_grading_scale_for_use(run_use, convention(&case.convention));

        assert_eq!(
            actual.stops.len(),
            case.expected.stops.len(),
            "stop count for use {} convention {}",
            case.run_use,
            case.convention
        );

        for (index, (actual_stop, expected_stop)) in actual
            .stops
            .iter()
            .zip(case.expected.stops.iter())
            .enumerate()
        {
            let expected_steepness = expected_stop.max_steepness.value();
            assert_eq!(
                actual_stop.max_steepness, expected_steepness,
                "maxSteepness at stop {index} for use {} convention {}",
                case.run_use, case.convention
            );
            assert_eq!(
                actual_stop.difficulty.map(|d| d.as_wire_str().to_owned()),
                expected_stop.difficulty,
                "difficulty at stop {index} for use {} convention {}",
                case.run_use,
                case.convention
            );
        }
    }
}

/// `getEstimatedRunDifficulty` is a function of a scale rather than of enumerable inputs,
/// so it is pinned here against the behaviour described by upstream: absolute steepness,
/// first stop strictly above it wins, and a stop with no difficulty yields none.
#[test]
fn estimated_run_difficulty_follows_the_scale() {
    let scale = slope_grading::slope_grading_scale_for_use(
        RunUse::Downhill,
        RunDifficultyConvention::Europe,
    );

    // Below the first threshold there is no difficulty, even though a stop matched.
    assert_eq!(slope_grading::estimated_run_difficulty(0.01, &scale), None);
    assert_eq!(
        slope_grading::estimated_run_difficulty(0.1, &scale),
        Some(RunDifficulty::Easy)
    );
    assert_eq!(
        slope_grading::estimated_run_difficulty(0.3, &scale),
        Some(RunDifficulty::Intermediate)
    );
    // Beyond the last finite threshold the unbounded stop applies.
    assert_eq!(
        slope_grading::estimated_run_difficulty(5.0, &scale),
        Some(RunDifficulty::Extreme)
    );
    // Uphill and downhill of the same magnitude grade the same.
    assert_eq!(
        slope_grading::estimated_run_difficulty(-0.3, &scale),
        Some(RunDifficulty::Intermediate)
    );

    // A use with no scale never yields a difficulty.
    let empty =
        slope_grading::slope_grading_scale_for_use(RunUse::Hike, RunDifficultyConvention::Europe);
    assert!(empty.stops.is_empty());
    assert_eq!(slope_grading::estimated_run_difficulty(0.5, &empty), None);
}
