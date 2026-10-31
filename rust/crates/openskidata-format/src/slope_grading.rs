//! Replaces: `openskidata-format/dist/SlopeGradingScale.{d.ts,js}`.

use crate::{RunDifficulty, RunDifficultyConvention, RunUse};

#[derive(Debug, Clone, PartialEq)]
pub struct SlopeGradingScale {
    /// Ordered ascending by steepness, as upstream requires.
    pub stops: Vec<SlopeStop>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SlopeStop {
    pub max_steepness: f64,
    pub difficulty: Option<RunDifficulty>,
}

/// Replaces `getSlopeGradingScaleForUse`.
pub fn slope_grading_scale_for_use(
    _run_use: RunUse,
    _convention: RunDifficultyConvention,
) -> SlopeGradingScale {
    todo!("port getSlopeGradingScaleForUse")
}

/// Replaces `getEstimatedRunDifficulty`.
pub fn estimated_run_difficulty(
    _steepness: f64,
    _scale: &SlopeGradingScale,
) -> Option<RunDifficulty> {
    todo!("port getEstimatedRunDifficulty")
}
