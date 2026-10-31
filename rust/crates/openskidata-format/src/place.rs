//! Replaces: `openskidata-format/dist/Place.d.ts`.

use serde::{Deserialize, Serialize};

/// A geographic place a feature lies within, from reverse geocoding.
///
/// Field names are serialized exactly as upstream emits them (`iso3166_1Alpha2`,
/// `iso3166_2`), because they are part of the wire contract.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Place {
    #[serde(rename = "iso3166_1Alpha2")]
    pub iso3166_1_alpha2: String,
    #[serde(rename = "iso3166_2")]
    pub iso3166_2: Option<String>,
    pub localized: Localized,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Localized {
    pub en: LocalizedNames,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct LocalizedNames {
    pub country: String,
    pub region: Option<String>,
    pub locality: Option<String>,
}
