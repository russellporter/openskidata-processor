//! Replaces: `openskidata-format/dist/ElevationProfile.{d.ts,js}`.
//!
//! **Float-sensitive.** `line_chunk_patched` is a *patched* turf `lineChunk`
//! working around four bugs documented in the upstream source; the patched behaviour is
//! the contract, not textbook turf. Every run's and lift's elevation statistics flow
//! from these functions, so last-digit drift here is visible in every feature.

use osd_turf::{Coord, Units, distance, length, line_chunk};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Upstream throws strings for malformed input; they are carried as the error here.
pub type ElevationError = String;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElevationProfile {
    pub heights: Vec<f64>,
    pub resolution: f64,
    #[serde(rename = "targetResolution")]
    pub target_resolution: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AscentDescentData {
    #[serde(rename = "ascentInMeters")]
    pub ascent_in_meters: f64,
    #[serde(rename = "descentInMeters")]
    pub descent_in_meters: f64,
    #[serde(rename = "minElevationInMeters")]
    pub min_elevation_in_meters: f64,
    #[serde(rename = "maxElevationInMeters")]
    pub max_elevation_in_meters: f64,
    #[serde(rename = "verticalInMeters")]
    pub vertical_in_meters: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PitchData {
    #[serde(rename = "averagePitchInPercent")]
    pub average_pitch_in_percent: Option<f64>,
    #[serde(rename = "maxPitchInPercent")]
    pub max_pitch_in_percent: Option<f64>,
    #[serde(rename = "inclinedLengthInMeters")]
    pub inclined_length_in_meters: f64,
    #[serde(rename = "overallPitchInPercent")]
    pub overall_pitch_in_percent: Option<f64>,
    #[serde(rename = "pitchCalculationResolutionInMeters")]
    pub pitch_calculation_resolution_in_meters: f64,
}

/// Upstream `ElevationData` is the intersection `AscentDescentData & PitchData &
/// { profileGeometry }`. It is derived, never serialized, so it has no wire form here.
#[derive(Debug, Clone, PartialEq)]
pub struct ElevationData {
    pub ascent_descent: AscentDescentData,
    pub pitch: PitchData,
    pub profile_geometry: Vec<Coord>,
}

/// The resolution the pitch calculation aims for, `getPitchData`'s default.
pub const DEFAULT_PITCH_RESOLUTION_M: f64 = 25.0;

/// `Math.min`: `NaN` if either is, and `-0` below `0`.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_negative() { a } else { b }
    } else if a < b {
        a
    } else {
        b
    }
}

/// `Math.max`: `NaN` if either is, and `+0` above `-0`.
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_negative() { b } else { a }
    } else if a > b {
        a
    } else {
        b
    }
}

/// Replaces `getElevationData`.
pub fn elevation_data(profile_geometry: &[Coord]) -> Result<ElevationData, ElevationError> {
    Ok(ElevationData {
        ascent_descent: ascent_and_descent(profile_geometry)?,
        pitch: pitch_data(profile_geometry, DEFAULT_PITCH_RESOLUTION_M)?,
        profile_geometry: profile_geometry.to_vec(),
    })
}

/// Replaces `getAscentAndDescent`.
pub fn ascent_and_descent(coordinates: &[Coord]) -> Result<AscentDescentData, ElevationError> {
    let first = coordinates
        .first()
        .ok_or("Empty coordinates are not supported for elevation data analysis")?;
    if first.z.is_none() {
        return Err("Elevation data is required for elevation data analysis".into());
    }
    let initial = first.z.unwrap();
    let (mut ascent, mut descent) = (0.0, 0.0);
    let (mut min_elevation, mut max_elevation, mut last_elevation) = (initial, initial, initial);
    for point in coordinates {
        // A point without elevation reads as `undefined`, which makes every sum `NaN`.
        let current = point.z.unwrap_or(f64::NAN);
        let change = current - last_elevation;
        if change > 0.0 {
            ascent += change;
        } else {
            descent -= change;
        }
        last_elevation = current;
        min_elevation = js_min(current, min_elevation);
        max_elevation = js_max(current, max_elevation);
    }
    Ok(AscentDescentData {
        ascent_in_meters: ascent,
        descent_in_meters: descent,
        min_elevation_in_meters: min_elevation,
        max_elevation_in_meters: max_elevation,
        vertical_in_meters: max_elevation - min_elevation,
    })
}

/// Replaces `getPitchData`.
pub fn pitch_data(
    coordinates: &[Coord],
    min_resolution_in_meters: f64,
) -> Result<PitchData, ElevationError> {
    if coordinates
        .first()
        .ok_or("cannot read properties of undefined")?
        .z
        .is_none()
    {
        return Err("Elevation data is required for slope analysis".into());
    }

    let mut total_length = 0.0;
    let mut total_inclined_length = 0.0;
    let mut total_elevation_change = 0.0;
    for pair in coordinates.windows(2) {
        let (before, after) = (pair[0], pair[1]);
        let elevation = after.z.unwrap_or(f64::NAN) - before.z.unwrap_or(f64::NAN);
        let length_in_meters = length(&[before, after], Units::Meters);
        total_length += length_in_meters;
        total_inclined_length +=
            (length_in_meters * length_in_meters + elevation * elevation).sqrt();
        total_elevation_change += elevation.abs();
    }

    // Too short for the elevation data's resolution: a 1 m change over 1 m would read as a
    // 45 degree slope.
    if total_length < min_resolution_in_meters / 2.0 {
        return Ok(PitchData {
            average_pitch_in_percent: None,
            max_pitch_in_percent: None,
            inclined_length_in_meters: total_inclined_length,
            overall_pitch_in_percent: None,
            pitch_calculation_resolution_in_meters: total_length,
        });
    }

    let (actual_resolution, mut chunks) =
        line_chunk_patched(coordinates, min_resolution_in_meters)?;
    interpolate_elevation(&mut chunks)?;

    let mut max_pitch = 0.0;
    for chunk in &chunks {
        let (start, end) = (chunk[0], chunk[chunk.len() - 1]);
        let elevation_change = end.z.unwrap_or(f64::NAN) - start.z.unwrap_or(f64::NAN);
        let chunk_length = length(chunk, Units::Meters);
        let chunk_pitch = (elevation_change / chunk_length).abs();
        if chunk_pitch > max_pitch {
            max_pitch = chunk_pitch;
        }
    }

    let average_pitch = total_elevation_change / total_length;
    let last = coordinates[coordinates.len() - 1].z.unwrap_or(f64::NAN);
    let first = coordinates[0].z.unwrap_or(f64::NAN);
    let overall_elevation_change = (last - first).abs();
    Ok(PitchData {
        average_pitch_in_percent: Some(average_pitch),
        max_pitch_in_percent: Some(max_pitch),
        inclined_length_in_meters: total_inclined_length,
        overall_pitch_in_percent: Some(overall_elevation_change / total_length),
        pitch_calculation_resolution_in_meters: actual_resolution,
    })
}

/// Replaces `getProfileGeometry`: the line resampled at the profile's resolution, with the
/// profile's heights as elevations.
pub fn profile_geometry(
    geometry: &[Coord],
    profile: &ElevationProfile,
) -> Result<Vec<Coord>, ElevationError> {
    let (actual_resolution, mut line) =
        extract_points_for_elevation_profile(geometry, profile.target_resolution)?;
    if line.len() != profile.heights.len() {
        return Err("Mismatch of points & elevation profile".into());
    }
    if (actual_resolution - profile.resolution).abs() > profile.resolution * 0.001 {
        return Err(format!(
            "Resolution mismatch between profile geometry ({}) and elevation profile ({})",
            actual_resolution, profile.resolution
        ));
    }
    for (point, height) in line.iter_mut().zip(&profile.heights) {
        point.z = Some(*height);
    }
    Ok(line)
}

/// Replaces `extractPointsForElevationProfile`: the points to take heights at, evenly spaced
/// along the line, and the spacing.
///
/// Called once per run and lift with a 25 m target resolution, so this is on the hot
/// path for the elevation cache's key count.
pub fn extract_points_for_elevation_profile(
    geometry: &[Coord],
    min_resolution_in_meters: f64,
) -> Result<(f64, Vec<Coord>), ElevationError> {
    let (resolution, chunks) = line_chunk_patched(geometry, min_resolution_in_meters)?;
    let mut points: Vec<Coord> = chunks.iter().map(|c| Coord::new(c[0].x, c[0].y)).collect();
    if let Some(last) = chunks.last()
        && last.len() > 1
    {
        let end = last[last.len() - 1];
        points.push(Coord::new(end.x, end.y));
    }
    Ok((resolution, points))
}

/// Replaces `lineChunkPatched`: turf's `lineChunk` with four documented bugs worked around.
///
/// - it doesn't allow for a custom resolution that divides the line evenly, which is
///   important for consistent pitch calculations -- so the resolution is the largest that
///   divides the line into an integer number of segments, at most the one asked for;
/// - it puts the elevation of the segment's end on newly created points, which is wrong
///   (turf issue 3007) -- so elevations are stripped from points that are not original;
/// - it can produce a last point that is very close but not exactly the original endpoint --
///   so the last point is set to exactly the original endpoint;
/// - it can produce two points very close to the end of the line -- so a last segment shorter
///   than 1% of the resolution is dropped.
pub fn line_chunk_patched(
    geometry: &[Coord],
    min_resolution_in_meters: f64,
) -> Result<(f64, Vec<Vec<Coord>>), ElevationError> {
    let resolution = horizontal_resolution_fitting(geometry, min_resolution_in_meters);
    let mut chunks = line_chunk(geometry, resolution, Units::Meters)?;

    let last_segment = chunks.last().ok_or("cannot read properties of undefined")?;
    if length(last_segment, Units::Meters) < resolution * 0.01 {
        chunks.pop();
    }

    let last_original = *geometry
        .last()
        .ok_or("cannot read properties of undefined")?;
    let last_chunk = chunks
        .last_mut()
        .ok_or("Cannot read properties of undefined (reading 'coordinates')")?;
    let end = last_chunk.len() - 1;
    last_chunk[end] = last_original;

    strip_non_original_elevations(&mut chunks, geometry);
    Ok((resolution, chunks))
}

fn horizontal_resolution_fitting(geometry: &[Coord], min_resolution: f64) -> f64 {
    let total_length = length(geometry, Units::Meters);
    if total_length == 0.0 {
        return 0.0;
    }
    let number_of_segments = (total_length / min_resolution).ceil();
    total_length / number_of_segments
}

/// Strips the elevation from points `lineChunk` created. Original vertices are the ones whose
/// longitude and latitude match.
fn strip_non_original_elevations(chunks: &mut [Vec<Coord>], original: &[Coord]) {
    // Keyed on the numbers' bits, with `-0` folded into `0` as JavaScript's number-to-string
    // does.
    let key = |c: &Coord| {
        let fold = |v: f64| {
            if v == 0.0 {
                0.0f64.to_bits()
            } else {
                v.to_bits()
            }
        };
        (fold(c.x), fold(c.y))
    };
    let originals: HashSet<(u64, u64)> = original.iter().map(key).collect();
    for point in chunks.iter_mut().flatten() {
        if !originals.contains(&key(point)) && point.z.is_some() {
            point.z = None;
        }
    }
}

/// Gives the points of a list of lines that have no elevation one, interpolated by distance
/// between the nearest points before and after that do.
fn interpolate_elevation(lines: &mut [Vec<Coord>]) -> Result<(), ElevationError> {
    if lines.is_empty() {
        return Ok(());
    }
    // (line, index in line, distance from start)
    let mut all: Vec<(usize, usize, f64)> = Vec::new();
    let mut total_distance = 0.0;
    let mut previous: Option<Coord> = None;
    for (l, line) in lines.iter().enumerate() {
        for (i, point) in line.iter().enumerate() {
            if let Some(previous) = previous {
                total_distance += distance(previous.xy(), point.xy(), Units::Meters);
            }
            all.push((l, i, total_distance));
            previous = Some(*point);
        }
    }

    let had_elevation: Vec<bool> = all
        .iter()
        .map(|&(l, i, _)| lines[l][i].z.is_some())
        .collect();
    let references: Vec<usize> = (0..all.len()).filter(|&k| had_elevation[k]).collect();
    if references.len() <= 1 {
        return Err("At least two points with elevation data are required".into());
    }

    for pair in references.windows(2) {
        let (start, end) = (pair[0], pair[1]);
        let (sl, si, start_distance) = all[start];
        let (el, ei, end_distance) = all[end];
        let start_elevation = lines[sl][si].z.unwrap();
        let end_elevation = lines[el][ei].z.unwrap();
        let elevation_delta = end_elevation - start_elevation;
        let distance_between_refs = end_distance - start_distance;

        for k in (start + 1)..end {
            if had_elevation[k] {
                return Err("Can't interpolate elevation for points that already have it".into());
            }
            let (l, i, point_distance) = all[k];
            let distance_from_start = point_distance - start_distance;
            let mut interpolated = start_elevation;
            if distance_between_refs > 0.0 {
                let factor = distance_from_start / distance_between_refs;
                interpolated = start_elevation + elevation_delta * factor;
            }
            lines[l][i].z = Some(interpolated);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// JavaScript keys the original vertices by `` `${x},${y}` ``, in which `-0` prints as `0`,
    /// so a point created at `-0` is still an original vertex and keeps its elevation. JSON
    /// cannot carry `-0`, so the vectors cannot pin this.
    #[test]
    fn negative_zero_is_the_same_vertex_as_zero() {
        let original = [Coord::with_z(0.0, 1.0, 5.0), Coord::with_z(2.0, 1.0, 6.0)];
        let mut chunks = vec![vec![
            Coord::with_z(-0.0, 1.0, 5.0),
            Coord::with_z(1.0, 1.0, 5.5),
        ]];
        strip_non_original_elevations(&mut chunks, &original);
        assert_eq!(chunks[0][0].z, Some(5.0), "-0 matches 0");
        assert_eq!(
            chunks[0][1].z, None,
            "a point that is not a vertex loses its elevation"
        );
    }

    #[test]
    fn math_min_and_max_follow_javascript_for_nan_and_signed_zero() {
        assert!(js_min(f64::NAN, 1.0).is_nan() && js_min(1.0, f64::NAN).is_nan());
        assert!(js_max(f64::NAN, 1.0).is_nan() && js_max(1.0, f64::NAN).is_nan());
        assert!(js_min(0.0, -0.0).is_sign_negative() && js_min(-0.0, 0.0).is_sign_negative());
        assert!(js_max(0.0, -0.0).is_sign_positive() && js_max(-0.0, 0.0).is_sign_positive());
        assert_eq!((js_min(3.0, 2.0), js_max(3.0, 2.0)), (2.0, 3.0));
    }
}
