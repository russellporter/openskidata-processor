//! Replaces: `openskidata-format/dist/SnowCoverHistory.{d.ts,js}`.

use serde::{Deserialize, Serialize};

/// `[dayOfYear, ndsi, validPixelPercent]`, as upstream emits it — a bare triple, not
/// an object, so the JSON shape must stay a 3-element array.
pub type SnowCoverDay = (u16, i16, u8);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnowCoverYear {
    pub year: i32,
    pub days: Vec<SnowCoverDay>,
}

pub type SnowCoverHistory = Vec<SnowCoverYear>;

pub type MonthlySnowCoverMonth = (u8, i16, u8);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonthlySnowCoverYear {
    pub year: i32,
    pub months: Vec<MonthlySnowCoverMonth>,
}

/// Replaces `getMonthlySnowCover`.
pub fn monthly_snow_cover(_history: &SnowCoverHistory) -> Vec<MonthlySnowCoverYear> {
    todo!("port getMonthlySnowCover from openskidata-format/dist/SnowCoverHistory.js")
}
