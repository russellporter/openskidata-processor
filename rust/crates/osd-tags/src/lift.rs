//! OSM tags to lift properties.
//!
//! Replaces the tag-reading half of `src/transforms/LiftFormatter.ts`.

use crate::status::{Tags, status_and_value};
use openskidata_format::{LiftType, Status};
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

/// Parses a duration in minutes into whole seconds.
///
/// Replaces `mapDuration`. OSM uses both a bare number of minutes and an `M:SS` form, and
/// the numeric form is rounded, so `7.5` becomes 450 rather than 450.0.
pub fn duration_seconds(value: Option<&str>) -> Option<f64> {
    let value = value?;

    if let Ok(minutes) = value.trim().parse::<f64>() {
        if minutes.is_finite() {
            return Some((minutes * 60.0).round());
        }
    }

    if value.contains(':') {
        let parts: Vec<&str> = value.split(':').collect();
        if parts.len() != 2 {
            return None;
        }
        let minutes = parts[0].trim().parse::<f64>().ok()?;
        let seconds = parts[1].trim().parse::<f64>().ok()?;
        if !minutes.is_finite() || !seconds.is_finite() {
            return None;
        }
        return Some(minutes * 60.0 + seconds);
    }

    None
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
