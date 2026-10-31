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
pub fn source_url(source: &Source) -> String {
    match source.source_type {
        SourceType::Openstreetmap => {
            format!("https://www.openstreetmap.org/{}", source.id)
        }
        SourceType::SkimapOrg => {
            format!("https://www.skimap.org/SkiAreas/view/{}", source.id)
        }
    }
}

/// Replaces `getSourceName`.
pub fn source_name(source_type: SourceType) -> &'static str {
    match source_type {
        SourceType::Openstreetmap => "OpenStreetMap",
        SourceType::SkimapOrg => "Skimap.org",
    }
}
