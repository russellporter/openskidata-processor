//! Giving runs, lifts and spots their elevations: `Elevation.ts`' `enhanceFeature` applied to
//! the formatted features before clustering.
//!
//! Every coordinate of every feature gets an elevation; a run that is a line also gets an
//! elevation profile, heights at an even spacing of about 25 m along it. Each feature's viewport
//! hint is then recomputed from its elevated geometry.
//!
//! A feature that cannot be elevated -- a coordinate has no data, or the server fails -- keeps
//! its geometry as it was, but not quite as upstream does: the geometry and the profile are
//! looked up separately, and the geometry keeps its elevations if only the profile fails. That
//! is upstream's behaviour too (the profile is the part left unset), reproduced.
//!
//! Unobservable differences, found by mutation: a point's viewport hint does not depend on its
//! elevation (so recomputing a spot's changes nothing), and a run's profile is only ever set
//! to something when the line has points to take heights at.

use crate::format::{Formatted, geometry_of_run, viewport_hint_with_elevations};
use openskidata_format::elevation_profile::{
    ElevationProfile, extract_points_for_elevation_profile,
};
use osd_enrich::elevation::{ElevationLoader, geometry_elevations};
use osd_osm::element::{Geometry, Position};
use osd_turf::Coord;

/// The spacing, in metres, a run's elevation profile aims for.
pub const ELEVATION_PROFILE_RESOLUTION: f64 = 25.0;

/// The profile of a line: its resolution and the points to take heights at.
fn profile_points(geometry: &Geometry) -> Option<Result<(f64, Vec<Position>), String>> {
    let Geometry::LineString(line) = geometry else {
        return None;
    };
    let coordinates: Vec<Coord> = line.iter().map(|p| Coord::new(p[0], p[1])).collect();
    Some(
        extract_points_for_elevation_profile(&coordinates, ELEVATION_PROFILE_RESOLUTION)
            .map(|(resolution, points)| (resolution, points.iter().map(Coord::xy).collect())),
    )
}

/// What `enhanceFeature` leaves on one feature.
struct Elevated {
    /// The geometry's elevations, if they could be looked up.
    elevations: Option<Vec<f64>>,
    /// The profile, set only when both lookups worked; `None` leaves what was there.
    profile: Option<Option<ElevationProfile>>,
}

fn enhance(loader: &ElevationLoader<'_>, geometry: &Geometry, is_run: bool) -> Elevated {
    let profile = if is_run {
        profile_points(geometry)
    } else {
        None
    };
    let (resolution, points) = match profile {
        Some(Ok(found)) => (Some(found.0), found.1),
        Some(Err(error)) => {
            // Upstream throws here, outside its error handling, and stops the pipeline.
            tracing::warn!("could not choose elevation profile points: {error}");
            return Elevated {
                elevations: None,
                profile: None,
            };
        }
        None => (None, Vec::new()),
    };

    let geometry_result = geometry_elevations(loader, geometry);
    let profile_result = loader.load_elevations(&points);
    if let Err(error) = &geometry_result {
        tracing::info!("failed to load elevations: {error}");
    }
    match (&geometry_result, &profile_result) {
        (Ok(_), Ok(heights)) => {
            // A run that is a line gets its profile; any other run, `null` (upstream sets
            // `elevationProfile` to `null` for them); other features have none.
            let profile = is_run.then(|| {
                resolution.map(|resolution| ElevationProfile {
                    heights: heights.clone(),
                    resolution,
                    target_resolution: ELEVATION_PROFILE_RESOLUTION,
                })
            });
            Elevated {
                elevations: geometry_result.ok(),
                profile,
            }
        }
        _ => Elevated {
            elevations: geometry_result.ok(),
            profile: None,
        },
    }
}

/// Looks up and applies elevations to every run, lift and spot.
pub fn apply_elevation(formatted: &mut Formatted, loader: &ElevationLoader<'_>) {
    for run in &mut formatted.runs {
        let geometry = geometry_of_run(&run.geometry);
        let elevated = enhance(loader, &geometry, true);
        if let Some(profile) = elevated.profile {
            run.properties.elevation_profile = profile;
        }
        if let Some(z) = elevated.elevations {
            run.properties.viewport_hint = viewport_hint_with_elevations(&geometry, &z);
            run.elevations = Some(z);
        }
    }
    for lift in &mut formatted.lifts {
        let elevated = enhance(loader, &lift.geometry, false);
        if let Some(z) = elevated.elevations {
            lift.properties.viewport_hint = viewport_hint_with_elevations(&lift.geometry, &z);
            lift.elevations = Some(z);
        }
    }
    for spot in &mut formatted.spots {
        let geometry = Geometry::Point(spot.coordinates);
        let elevated = enhance(loader, &geometry, false);
        if let Some(z) = elevated.elevations {
            spot.properties.base.viewport_hint = viewport_hint_with_elevations(&geometry, &z);
            spot.elevations = Some(z);
        }
    }
}
