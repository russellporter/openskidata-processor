//! Rust port of the `openskidata-format` npm package — the **public wire contract**
//! of this dataset.
//!
//! Replaces: `node_modules/openskidata-format` (consumed by 62 of the TypeScript
//! source files across 125 import statements).
//!
//! # Why this crate is special
//!
//! The enum string values here land in GeoJSON properties, CSV cells, GeoPackage
//! `TEXT` columns and MVT attributes, and openskimap.org reads them. They cannot be
//! changed. To make drift impossible they are **generated** from the installed npm
//! package by `rust/codegen/generate-format-enums.mjs` into [`generated::enums`],
//! rather than hand-typed — a single typo'd string literal would be a silent data
//! corruption that no type system catches.
//!
//! While both implementations coexist this crate is a second source of truth for the
//! same contract. `cargo test` runs a check that the generated file still matches the
//! npm package, and CI should run the generator with `--check`.
//!
//! # Float sensitivity
//!
//! Three areas are last-digit minefields and are deliberately the **last** things to
//! be ported, because drift in them shows up in every single output feature:
//!
//! - [`viewport_hint`] — a rotated minimum bounding rectangle (convex hull plus
//!   rotating calipers, with tie-breaking and trig).
//! - [`elevation_profile::line_chunk_patched`] — the upstream TypeScript is a *patched*
//!   turf `lineChunk` that works around four documented turf bugs. Port the patched
//!   behaviour, not textbook turf.
//! - Feature id hashing, which upstream uses `object-hash` (SHA-1 over a walked object
//!   graph, with JS `Number.prototype.toString()` number formatting). See
//!   `osd_store::feature_id`.

pub mod generated;

pub mod elevation_profile;
pub mod lift;
pub mod place;
pub mod run;
pub mod ski_area;
pub mod slope_grading;
pub mod snow_cover;
pub mod source;
pub mod spot;
pub mod viewport_hint;

pub use generated::enums::*;

/// Returned when a wire string does not correspond to any known enum variant.
///
/// Upstream TypeScript is structurally typed and simply carries unexpected strings
/// through; here an unknown value is an explicit error so that an `openskidata-format`
/// bump cannot silently drop data.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unknown {enum_name} wire value: {value:?}")]
pub struct UnknownWireValue {
    pub enum_name: &'static str,
    pub value: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    /// The wire values are the contract; this pins the ones most likely to be
    /// mangled by a naive re-casing (`+`, `-` and `.` in the value).
    #[test]
    fn tricky_wire_values_survive_the_round_trip() {
        assert_eq!(
            RunGrooming::ClassicAndSkating.as_wire_str(),
            "classic+skating"
        );
        assert_eq!(LiftType::TBar.as_wire_str(), "t-bar");
        assert_eq!(LiftType::JBar.as_wire_str(), "j-bar");
        assert_eq!(SourceType::SkimapOrg.as_wire_str(), "skimap.org");
        assert_eq!(FeatureType::SkiArea.as_wire_str(), "skiArea");
        assert_eq!(RunColorValue::Green.as_wire_str(), "hsl(125, 100%, 33%)");

        for name in ["classic+skating", "t-bar", "skimap.org"] {
            // Parsing is the inverse of printing for every variant.
            if let Ok(v) = RunGrooming::from_str(name) {
                assert_eq!(v.as_wire_str(), name);
            }
        }
    }

    #[test]
    fn every_variant_round_trips_through_its_wire_string() {
        fn check<T>(all: &[T])
        where
            T: Copy + PartialEq + core::fmt::Debug + FromStr,
            <T as FromStr>::Err: core::fmt::Debug,
            T: WireStr,
        {
            for &v in all {
                assert_eq!(T::from_str(v.wire()).unwrap(), v, "round trip failed");
            }
        }

        // A tiny local trait so the generated enums can be checked uniformly without
        // the generator having to emit a shared trait impl.
        trait WireStr {
            fn wire(self) -> &'static str;
        }
        macro_rules! wire {
            ($($t:ty),* $(,)?) => { $( impl WireStr for $t {
                fn wire(self) -> &'static str { self.as_wire_str() }
            } )* };
        }
        wire!(
            FeatureType,
            Status,
            SourceType,
            RunUse,
            RunGrooming,
            RunDifficulty,
            RunColorName,
            RunColorValue,
            RunDifficultyConvention,
            LiftType,
            SkiAreaActivity,
            SpotType,
            DismountRequirement,
            LiftStationPosition,
        );

        check(FeatureType::ALL);
        check(Status::ALL);
        check(SourceType::ALL);
        check(RunUse::ALL);
        check(RunGrooming::ALL);
        check(RunDifficulty::ALL);
        check(RunColorName::ALL);
        check(RunColorValue::ALL);
        check(RunDifficultyConvention::ALL);
        check(LiftType::ALL);
        check(SkiAreaActivity::ALL);
        check(SpotType::ALL);
        check(DismountRequirement::ALL);
        check(LiftStationPosition::ALL);
    }

    /// Serde must emit the wire string, not the Rust variant name — this is what
    /// actually reaches the output files.
    #[test]
    fn serde_uses_wire_values() {
        assert_eq!(
            serde_json::to_string(&RunGrooming::ClassicAndSkating).unwrap(),
            "\"classic+skating\""
        );
        assert_eq!(
            serde_json::to_string(&FeatureType::SkiArea).unwrap(),
            "\"skiArea\""
        );
        assert_eq!(
            serde_json::from_str::<LiftType>("\"t-bar\"").unwrap(),
            LiftType::TBar
        );
    }

    #[test]
    fn unknown_wire_value_is_an_error_not_a_silent_default() {
        let err = RunDifficulty::from_str("nonexistent").unwrap_err();
        assert_eq!(err.enum_name, "RunDifficulty");
        assert_eq!(err.value, "nonexistent");
    }
}
