//! Replaces: `openskidata-format/dist/Source.{d.ts,js}`.

use crate::SourceType;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Source {
    #[serde(rename = "type")]
    pub source_type: SourceType,
    pub id: String,
}

/// Replaces `getSourceURL`.
pub fn source_url(_source: &Source) -> String {
    todo!("port getSourceURL from openskidata-format/dist/Source.js")
}

/// Replaces `getSourceName`.
pub fn source_name(_source_type: SourceType) -> &'static str {
    todo!("port getSourceName from openskidata-format/dist/Source.js")
}
