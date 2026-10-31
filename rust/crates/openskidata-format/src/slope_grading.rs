//! Replaces: `openskidata-format/dist/SlopeGradingScale.{d.ts,js}`.

use crate::{RunDifficulty, RunDifficultyConvention, RunUse};

#[derive(Debug, Clone, PartialEq)]
pub struct SlopeGradingScale {
    /// Ordered ascending by steepness, as upstream requires.
    pub stops: Vec<SlopeStop>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SlopeStop {
    /// The upper bound of this stop. `f64::INFINITY` for an unbounded final stop —
    /// upstream uses `Infinity` here, which is not the same as "no threshold".
    pub max_steepness: f64,
    pub difficulty: Option<RunDifficulty>,
}

/// Replaces `getSlopeGradingScaleForUse`.
///
/// `convention` is accepted and unused, mirroring upstream, which takes it so regional
/// variation can be added without changing every call site.
pub fn slope_grading_scale_for_use(
    run_use: RunUse,
    _convention: RunDifficultyConvention,
) -> SlopeGradingScale {
    match run_use {
        RunUse::Downhill | RunUse::Skitour => SlopeGradingScale {
            stops: vec![
                // No difficulty is assigned below 5%.
                SlopeStop {
                    max_steepness: 0.05,
                    difficulty: None,
                },
                SlopeStop {
                    max_steepness: 0.25,
                    difficulty: Some(RunDifficulty::Easy),
                },
                SlopeStop {
                    max_steepness: 0.4,
                    difficulty: Some(RunDifficulty::Intermediate),
                },
                SlopeStop {
                    max_steepness: 0.8,
                    difficulty: Some(RunDifficulty::Advanced),
                },
                SlopeStop {
                    max_steepness: 1.0,
                    difficulty: Some(RunDifficulty::Expert),
                },
                SlopeStop {
                    max_steepness: 1.2,
                    difficulty: Some(RunDifficulty::Freeride),
                },
                SlopeStop {
                    max_steepness: f64::INFINITY,
                    difficulty: Some(RunDifficulty::Extreme),
                },
            ],
        },
        RunUse::Nordic => SlopeGradingScale {
            stops: vec![
                SlopeStop {
                    max_steepness: 0.1,
                    difficulty: Some(RunDifficulty::Easy),
                },
                SlopeStop {
                    max_steepness: 0.15,
                    difficulty: Some(RunDifficulty::Intermediate),
                },
                SlopeStop {
                    max_steepness: 0.3,
                    difficulty: Some(RunDifficulty::Advanced),
                },
            ],
        },
        _ => SlopeGradingScale { stops: Vec::new() },
    }
}

/// Replaces `getEstimatedRunDifficulty`.
///
/// Takes the absolute steepness, so an uphill and a downhill gradient of the same
/// magnitude grade the same, and returns the first stop whose threshold the steepness
/// falls strictly under.
pub fn estimated_run_difficulty(
    steepness: f64,
    scale: &SlopeGradingScale,
) -> Option<RunDifficulty> {
    let absolute = steepness.abs();
    scale
        .stops
        .iter()
        .find(|stop| stop.max_steepness > absolute)
        .and_then(|stop| stop.difficulty)
}
