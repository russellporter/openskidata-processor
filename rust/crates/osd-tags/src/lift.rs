//! OSM tags to lift properties.
//!
//! Replaces the tag-reading half of `src/transforms/LiftFormatter.ts`.

use crate::js_number;
use crate::osm::{first_value, osm_name, osm_ref};
use crate::run::{osm_boolean, tunnel, websites};
use crate::status::{Tags, status_and_value};
use openskidata_format::lift::Access;
use openskidata_format::source::Source;
use openskidata_format::{FeatureType, LiftType, SourceType, Status};
use serde::Serialize;
use std::str::FromStr;

/// Railway values that are a lift for this dataset's purposes.
///
/// A funicular is already a `LiftType`; these are ordinary railway classifications that
/// get folded into the generic `railway` lift type, because a mountain railway serving a
/// ski area is a lift even though OSM tags it like any other line.
const RAILWAY_AS_LIFT: &[&str] = &[
    "narrow_gauge",
    "rail",
    "light_rail",
    "tram",
    "subway",
    "monorail",
];

/// Tag conditions that disqualify a way from being a lift at all.
///
/// These are about *who or what* the line carries: a freight-only railway or a line
/// closed to passengers and to foot access is infrastructure, not a ski lift. Checked
/// before the lift type, so a perfectly well-tagged `aerialway` is still rejected if it
/// carries no passengers.
pub fn is_disqualified(tags: &Tags) -> bool {
    let is = |key: &str, value: &str| tags.get(key).map(String::as_str) == Some(value);

    is("passenger", "no")
        || is("access", "forestry")
        || is("access", "no")
        || is("foot", "no")
        || is("foot", "private")
        || is("usage", "freight")
        || is("usage", "industrial")
        || is("railway:traffic_mode", "freight")
}

/// The status and lift type of a way.
///
/// Replaces `getStatusAndLiftType`. `aerialway` is tried first; only when it yields no
/// value at all does `railway` get a turn, so a way tagged both is an aerialway. Note the
/// status comes from whichever tag supplied the value, which is why the fallback re-reads
/// it rather than keeping the first result.
///
/// A `None` lift type means the way is not a lift — an `aerialway=station` or
/// `aerialway=pylon` is part of a lift's infrastructure but not a lift itself.
pub fn status_and_lift_type(tags: &Tags) -> (Option<Status>, Option<LiftType>) {
    let aerialway = status_and_value("aerialway", tags);

    let (status, value) = if aerialway.value.is_none() {
        let railway = status_and_value("railway", tags);
        let value = railway.value.map(|value| {
            if RAILWAY_AS_LIFT.contains(&value.as_str()) {
                LiftType::Railway.as_wire_str().to_owned()
            } else {
                value
            }
        });
        (railway.status, value)
    } else {
        (aerialway.status, aerialway.value)
    };

    let lift_type = value.and_then(|value| LiftType::from_str(&value).ok());
    (status, lift_type)
}

/// Whether the tags describe a lift this dataset includes.
///
/// Replaces the rejection cascade at the top of `formatLift`, excluding the geometry
/// checks, which belong to the reader rather than to tag interpretation.
pub fn is_lift(tags: &Tags) -> bool {
    if is_disqualified(tags) {
        return false;
    }
    let (status, lift_type) = status_and_lift_type(tags);
    status.is_some() && lift_type.is_some()
}

/// `isNumeric` in `LiftFormatter.ts`: `!isNaN(parseFloat(n)) && isFinite(n)`.
///
/// The two halves disagree on purpose-built inputs -- `parseFloat("")` is NaN but
/// `Number("")` is 0, and `parseFloat("5 min")` is 5 but `Number("5 min")` is NaN -- so
/// both conversions are applied exactly as written.
fn is_numeric(value: &str) -> bool {
    !js_number::parse_float(value).is_nan() && js_number::number(value).is_finite()
}

/// Parses a duration in minutes into seconds.
///
/// Replaces `mapDuration`. OSM uses both a bare number of minutes and an `M:SS` form.
/// Returns `None` where upstream returns `null` *or* `NaN` (JSON cannot tell the two apart,
/// and a `NaN` duration is useless to a consumer either way).
///
/// The `M:SS` form is read with `parseInt`, so `1.5:30` is 90 and `-1:30` is -30: the
/// minutes' sign applies only to the minutes.
pub fn duration_seconds(value: Option<&str>) -> Option<f64> {
    let value = value?;

    if is_numeric(value) {
        return finite(js_number::round(js_number::parse_float(value) * 60.0));
    }

    if value.contains(':') {
        let components: Vec<&str> = value.split(':').collect();
        if components.len() != 2 {
            return None;
        }
        return finite(
            js_number::parse_int(components[0]) * 60.0 + js_number::parse_int(components[1]),
        );
    }

    None
}

fn finite(value: f64) -> Option<f64> {
    value.is_finite().then_some(value)
}

/// `mapOSMNumber`: `Number(input)`, or `None` when that is NaN.
///
/// Infinity is a number to JavaScript but not to JSON, where it would be written as `null`,
/// so it also reads as unknown here.
pub fn osm_number(input: Option<&str>) -> Option<f64> {
    finite(js_number::number(input?))
}

/// The properties of a lift that tags alone determine.
///
/// What `formatLift` returns minus `id`, `stations`, `skiAreas`, `places` and
/// `viewportHint`, which are filled in later.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LiftTagProperties {
    #[serde(rename = "type")]
    pub feature_type: FeatureType,
    #[serde(rename = "liftType")]
    pub lift_type: LiftType,
    pub status: Status,
    pub name: Option<String>,
    pub oneway: Option<bool>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    #[serde(rename = "refFRCAIRN")]
    pub ref_fr_cairn: Option<String>,
    pub description: Option<String>,
    pub occupancy: Option<f64>,
    pub capacity: Option<f64>,
    pub duration: Option<f64>,
    pub bubble: Option<bool>,
    pub heating: Option<bool>,
    pub detachable: Option<bool>,
    pub tunnel: Option<bool>,
    pub access: Option<Access>,
    pub sources: Vec<Source>,
    pub websites: Vec<String>,
    #[serde(rename = "wikidataID")]
    pub wikidata_id: Option<String>,
}

/// Replaces the tag half of `formatLift`: `None` when the element is not a lift.
///
/// The geometry checks (only lines are lifts, and they must be valid) belong to the caller.
pub fn lift_properties(tags: &Tags, osm_type: &str, osm_id: i64) -> Option<LiftTagProperties> {
    if is_disqualified(tags) {
        return None;
    }
    let (status, lift_type) = status_and_lift_type(tags);
    let (status, lift_type) = (status?, lift_type?);

    let get = |key: &str| tags.get(key).map(String::as_str);
    let reference = osm_ref(tags);
    Some(LiftTagProperties {
        feature_type: FeatureType::Lift,
        lift_type,
        status,
        name: osm_name(tags, "name", None, reference.as_deref()),
        oneway: osm_boolean(get("oneway")),
        reference,
        ref_fr_cairn: first_value(tags, "ref:FR:CAIRN"),
        // `tags.description || null`: unlike runs, an empty description is no description.
        description: get("description")
            .filter(|d| !d.is_empty())
            .map(str::to_owned),
        occupancy: osm_number(get("aerialway:occupancy")),
        capacity: osm_number(get("aerialway:capacity")),
        duration: duration_seconds(get("aerialway:duration")),
        bubble: osm_boolean(get("aerialway:bubble")),
        heating: osm_boolean(get("aerialway:heating")),
        detachable: osm_boolean(get("aerialway:detachable")),
        tunnel: tunnel(tags),
        access: (get("access") == Some("private")).then_some(Access::Private),
        sources: vec![Source {
            source_type: SourceType::Openstreetmap,
            id: format!("{osm_type}/{osm_id}"),
        }],
        websites: websites(tags),
        wikidata_id: first_value(tags, "wikidata"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(pairs: &[(&str, &str)]) -> Tags {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn an_aerialway_is_a_lift() {
        let (status, lift_type) = status_and_lift_type(&tags(&[("aerialway", "chair_lift")]));
        assert_eq!(status, Some(Status::Operating));
        assert_eq!(lift_type, Some(LiftType::ChairLift));
    }

    #[test]
    fn aerialway_takes_precedence_over_railway() {
        let (_, lift_type) =
            status_and_lift_type(&tags(&[("aerialway", "gondola"), ("railway", "funicular")]));
        assert_eq!(lift_type, Some(LiftType::Gondola));
    }

    #[test]
    fn ordinary_railways_fold_into_the_generic_railway_type() {
        for value in RAILWAY_AS_LIFT {
            let (_, lift_type) = status_and_lift_type(&tags(&[("railway", value)]));
            assert_eq!(lift_type, Some(LiftType::Railway), "railway={value}");
        }
    }

    #[test]
    fn a_funicular_keeps_its_own_type() {
        let (_, lift_type) = status_and_lift_type(&tags(&[("railway", "funicular")]));
        assert_eq!(lift_type, Some(LiftType::Funicular));
    }

    /// Infrastructure that belongs to a lift but is not one.
    #[test]
    fn stations_and_pylons_are_not_lifts() {
        for value in ["station", "pylon", "zip_line", "nonsense"] {
            let (_, lift_type) = status_and_lift_type(&tags(&[("aerialway", value)]));
            assert_eq!(lift_type, None, "aerialway={value}");
            assert!(!is_lift(&tags(&[("aerialway", value)])));
        }
    }

    #[test]
    fn the_status_follows_whichever_tag_supplied_the_value() {
        let (status, lift_type) = status_and_lift_type(&tags(&[("disused:railway", "funicular")]));
        assert_eq!(status, Some(Status::Disused));
        assert_eq!(lift_type, Some(LiftType::Funicular));
    }

    #[test]
    fn freight_and_closed_lines_are_disqualified() {
        for pair in [
            ("passenger", "no"),
            ("access", "forestry"),
            ("access", "no"),
            ("foot", "no"),
            ("foot", "private"),
            ("usage", "freight"),
            ("usage", "industrial"),
            ("railway:traffic_mode", "freight"),
        ] {
            let t = tags(&[("aerialway", "chair_lift"), pair.into()]);
            assert!(is_disqualified(&t), "{pair:?}");
            assert!(
                !is_lift(&t),
                "a well-tagged aerialway must still be rejected for {pair:?}"
            );
        }
    }

    #[test]
    fn permitted_access_values_are_not_disqualifying() {
        assert!(!is_disqualified(&tags(&[
            ("aerialway", "chair_lift"),
            ("foot", "yes"),
        ])));
        assert!(is_lift(&tags(&[
            ("aerialway", "chair_lift"),
            ("access", "customers"),
        ])));
    }

    #[test]
    fn durations_parse_from_minutes_and_from_m_ss() {
        assert_eq!(duration_seconds(Some("5")), Some(300.0));
        assert_eq!(duration_seconds(Some("7.5")), Some(450.0));
        assert_eq!(duration_seconds(Some("5:30")), Some(330.0));
        assert_eq!(duration_seconds(Some("0:45")), Some(45.0));
    }

    #[test]
    fn unparseable_durations_are_unknown() {
        assert_eq!(duration_seconds(None), None);
        assert_eq!(duration_seconds(Some("nonsense")), None);
        assert_eq!(duration_seconds(Some("1:2:3")), None);
        assert_eq!(duration_seconds(Some("a:b")), None);
    }
}
