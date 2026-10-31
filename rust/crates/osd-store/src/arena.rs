//! The coordinate arena.

use crate::COORD_SCALE;

/// A coordinate in fixed-point degrees: `round(degrees * 1e7)`.
///
/// 8 bytes, against roughly 80 for a JS `[number, number]`.
///
/// # Representable range
///
/// `i32` at this scale covers ±214.74°, which comfortably holds all valid WGS84
/// longitudes and latitudes. It does **not** hold the `[360, 360]` sentinel the
/// TypeScript pipeline uses for a Skimap.org ski area whose real position is unknown
/// (`src/utils/PlaceholderSiteGeometry.ts`): 360° scales to 3.6e9, past `i32::MAX`.
///
/// That sentinel is therefore not stored as a coordinate at all. The store carries it as
/// an explicit flag (see `FeatureStore::has_placeholder_geometry`), which is a better
/// representation regardless — the TypeScript code tests for it by comparing against the
/// literal 360 in several places, including inside SQL, and each of those is a place the
/// magic number can be forgotten.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
pub struct FixedCoord {
    pub lng: i32,
    pub lat: i32,
}

/// Returned when a coordinate cannot be represented on the fixed-point grid.
#[derive(Debug, Clone, Copy, PartialEq, thiserror::Error)]
#[error("coordinate ({lng}, {lat}) is outside the representable fixed-point range")]
pub struct CoordOutOfRange {
    pub lng: f64,
    pub lat: f64,
}

impl FixedCoord {
    /// Largest representable absolute value in scaled units.
    const MAX_SCALED: f64 = i32::MAX as f64;

    /// Snaps a floating-point degree pair onto the grid.
    ///
    /// # Relationship to the TypeScript behaviour
    ///
    /// The run-joining code keys graph nodes on `point.toFixed(7)`
    /// (`src/transforms/normalization/PointMultiMap.ts`), so 1e-7 is the grid that
    /// pipeline already collapses coordinates onto, and working on it natively turns
    /// shared-vertex detection into an integer comparison.
    ///
    /// The rounding is not bit-identical to `toFixed`, which rounds the decimal
    /// representation, whereas this rounds the scaled binary value half away from zero.
    /// The two differ only for values sitting within one ULP of a 5e-8 boundary. That is
    /// a real difference and is why the normalization stage treats vertex snapping as a
    /// measured divergence rather than an assumed equivalence.
    ///
    /// Unlike `toFixed`, this maps `-0.0` and `0.0` to the same value.
    /// `(-0).toFixed(7)` produces the string `"-0.0000000"` and `(0).toFixed(7)`
    /// produces `"0.0000000"`, which are two distinct map keys upstream for the same
    /// point — a latent bug there, not a behaviour worth reproducing.
    pub fn from_degrees(lng: f64, lat: f64) -> Result<FixedCoord, CoordOutOfRange> {
        let scaled_lng = (lng * COORD_SCALE).round();
        let scaled_lat = (lat * COORD_SCALE).round();

        if !scaled_lng.is_finite()
            || !scaled_lat.is_finite()
            || scaled_lng.abs() > Self::MAX_SCALED
            || scaled_lat.abs() > Self::MAX_SCALED
        {
            return Err(CoordOutOfRange { lng, lat });
        }

        // Casting f64 to i32 maps both -0.0 and 0.0 to 0, so the sign of zero needs no
        // special handling here.
        Ok(FixedCoord {
            lng: scaled_lng as i32,
            lat: scaled_lat as i32,
        })
    }

    pub fn lng_degrees(self) -> f64 {
        self.lng as f64 / COORD_SCALE
    }

    pub fn lat_degrees(self) -> f64 {
        self.lat as f64 / COORD_SCALE
    }
}

/// A half-open range into [`CoordArena`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CoordSlice {
    pub offset: u32,
    pub len: u32,
}

impl CoordSlice {
    pub fn is_empty(self) -> bool {
        self.len == 0
    }

    pub fn range(self) -> core::ops::Range<usize> {
        let start = self.offset as usize;
        start..start + self.len as usize
    }
}

/// One flat allocation holding every coordinate in the dataset.
#[derive(Debug, Default)]
pub struct CoordArena {
    coords: Vec<FixedCoord>,
}

impl CoordArena {
    pub fn len(&self) -> usize {
        self.coords.len()
    }

    pub fn is_empty(&self) -> bool {
        self.coords.is_empty()
    }

    pub fn reserve(&mut self, additional: usize) {
        self.coords.reserve(additional);
    }

    /// Appends a run of coordinates and returns the slice describing them.
    ///
    /// # Panics
    ///
    /// If the arena would exceed `u32::MAX` coordinates. At planet scale the arena holds
    /// on the order of 10^7, so this is three orders of magnitude of headroom; it panics
    /// rather than returning an error because exceeding it means the offsets in every
    /// feature column have become too narrow, which is a design change rather than a
    /// runtime condition to recover from.
    pub fn push_slice(&mut self, coords: &[FixedCoord]) -> CoordSlice {
        let offset = self.coords.len();
        assert!(
            offset + coords.len() <= u32::MAX as usize,
            "coordinate arena exceeded u32 addressing ({} + {})",
            offset,
            coords.len()
        );
        self.coords.extend_from_slice(coords);
        CoordSlice {
            offset: offset as u32,
            len: coords.len() as u32,
        }
    }

    pub fn get(&self, slice: CoordSlice) -> &[FixedCoord] {
        &self.coords[slice.range()]
    }

    /// Resident bytes of coordinate payload, for the memory reporting that gates each
    /// stage.
    pub fn heap_bytes(&self) -> usize {
        self.coords.capacity() * core::mem::size_of::<FixedCoord>()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_coordinate_is_eight_bytes() {
        // The whole point of the fixed-point representation.
        assert_eq!(core::mem::size_of::<FixedCoord>(), 8);
    }

    #[test]
    fn round_trips_through_degrees_within_the_grid_resolution() {
        let coord = FixedCoord::from_degrees(11.5819805, 48.1351253).unwrap();
        assert!((coord.lng_degrees() - 11.5819805).abs() < 1e-7);
        assert!((coord.lat_degrees() - 48.1351253).abs() < 1e-7);
    }

    #[test]
    fn negative_and_positive_zero_agree() {
        assert_eq!(
            FixedCoord::from_degrees(-0.0, -0.0).unwrap(),
            FixedCoord::from_degrees(0.0, 0.0).unwrap()
        );
    }

    #[test]
    fn extreme_valid_coordinates_are_representable() {
        assert!(FixedCoord::from_degrees(180.0, 90.0).is_ok());
        assert!(FixedCoord::from_degrees(-180.0, -90.0).is_ok());
    }

    /// The TypeScript placeholder geometry. It must be rejected rather than silently
    /// wrapping around, which is why the store flags it instead of storing it.
    #[test]
    fn the_placeholder_sentinel_is_rejected_rather_than_overflowing() {
        assert_eq!(
            FixedCoord::from_degrees(360.0, 360.0),
            Err(CoordOutOfRange {
                lng: 360.0,
                lat: 360.0
            })
        );
    }

    #[test]
    fn non_finite_coordinates_are_rejected() {
        assert!(FixedCoord::from_degrees(f64::NAN, 0.0).is_err());
        assert!(FixedCoord::from_degrees(f64::INFINITY, 0.0).is_err());
    }

    #[test]
    fn arena_slices_address_what_was_pushed() {
        let mut arena = CoordArena::default();
        let first =
            arena.push_slice(&[FixedCoord { lng: 1, lat: 2 }, FixedCoord { lng: 3, lat: 4 }]);
        let second = arena.push_slice(&[FixedCoord { lng: 5, lat: 6 }]);

        assert_eq!(arena.len(), 3);
        assert_eq!(arena.get(first).len(), 2);
        assert_eq!(arena.get(second), &[FixedCoord { lng: 5, lat: 6 }]);
        assert_eq!(arena.get(first)[1], FixedCoord { lng: 3, lat: 4 });
    }

    #[test]
    fn an_empty_push_yields_an_empty_slice() {
        let mut arena = CoordArena::default();
        let slice = arena.push_slice(&[]);
        assert!(slice.is_empty());
        assert!(arena.get(slice).is_empty());
    }
}
