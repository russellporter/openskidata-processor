//! Packed in-memory feature store: a coordinate arena plus struct-of-arrays columns.
//!
//! Replaces: the per-feature `GeoJSON.Feature` objects that the TypeScript pipeline
//! passes between stages, and the `objects` table in
//! `src/clustering/database/PostgreSQLClusteringDatabase.ts`.
//!
//! # Why this exists
//!
//! The dataset is small — on the order of 10^5–10^6 features and 10^7 coordinates — but
//! the TypeScript pipeline needs a 4 GB V8 heap for it. The cost is representation, not
//! volume: every coordinate is a JS `[number, number]` array (~80 bytes of object header,
//! elements pointer and two boxed doubles for 16 bytes of payload), every feature is a
//! megamorphic object, and the clustering stage additionally stores each geometry twice
//! in Postgres (`geometry JSONB` *and* `geom GEOMETRY`).
//!
//! Here a coordinate is 8 bytes in a flat `Vec`, and a feature is a handful of integers
//! indexing into columns.
//!
//! # The fixed-point grid
//!
//! Coordinates are `i32` pairs of degrees scaled by [`COORD_SCALE`] (1e-7), giving about
//! 1.1 cm of resolution. This is not an arbitrary choice: the TypeScript run-joining code
//! already keys endpoints on `point.toFixed(7)`
//! (`src/transforms/normalization/PointMultiMap.ts:21`), so 1e-7 is the grid the pipeline
//! already collapses to. Working on it natively turns shared-vertex detection from string
//! formatting and hashing into an integer comparison, and it is what makes the
//! partitioned normalization in `osd_normalize` sound.
//!
//! One behaviour difference to measure, not assume: TopoJSON joins arcs on *exact* float
//! equality, which is finer than 1e-7, so snapping may join a few vertex pairs that
//! upstream treated as distinct. See `osd_normalize`'s module docs.
//!
//! Elevation lives in a parallel column rather than a third coordinate, because the
//! clustering predicates are all 2D upstream (`ST_Force2D` strips Z before indexing).

use openskidata_format::{
    FeatureType, LiftType, RunDifficulty, RunGrooming, RunUse, SkiAreaActivity, SourceType,
    SpotType, Status,
};

pub mod arena;
pub mod feature_id;
pub mod interner;

pub use arena::{CoordArena, CoordSlice, FixedCoord};
pub use interner::{StringInterner, Symbol};

/// Degrees are stored as `round(degrees * 1e7)`.
pub const COORD_SCALE: f64 = 1e7;

/// Index of a feature within the store. `u32` caps the store at ~4.3e9 features, which
/// is four orders of magnitude above planet scale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct FeatureIdx(pub u32);

/// Index of a ski area within the store.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SkiAreaIdx(pub u32);

/// The set of activities a feature supports, as a bitmask.
///
/// Upstream carries `activities: SkiAreaActivity[]` and the clustering hot loop
/// intersects those arrays on every traversal hop
/// (`SkiAreaClusteringService.ts:759`). As a mask the intersection is a single `&`,
/// which matters because that narrowing happens millions of times per run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, PartialOrd, Ord)]
pub struct ActivityMask(pub u8);

impl ActivityMask {
    pub const EMPTY: ActivityMask = ActivityMask(0);

    pub const fn bit(activity: SkiAreaActivity) -> u8 {
        1u8 << (activity as u8)
    }

    pub fn contains(self, activity: SkiAreaActivity) -> bool {
        self.0 & Self::bit(activity) != 0
    }

    pub fn insert(&mut self, activity: SkiAreaActivity) {
        self.0 |= Self::bit(activity);
    }

    pub fn intersection(self, other: ActivityMask) -> ActivityMask {
        ActivityMask(self.0 & other.0)
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// Expand back to the wire representation for output.
    pub fn to_vec(self) -> Vec<SkiAreaActivity> {
        SkiAreaActivity::ALL
            .iter()
            .copied()
            .filter(|&a| self.contains(a))
            .collect()
    }

    pub fn from_slice(activities: &[SkiAreaActivity]) -> ActivityMask {
        let mut mask = ActivityMask::EMPTY;
        for &a in activities {
            mask.insert(a);
        }
        mask
    }
}

/// Geometry kind, kept out of the coordinate arena so the arena stays a flat `Vec`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GeometryKind {
    Point,
    LineString,
    Polygon,
    MultiLineString,
    MultiPolygon,
}

/// A bounding box in fixed-point degrees, used as the R-tree key in `osd_cluster`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FixedBBox {
    pub min_lng: i32,
    pub min_lat: i32,
    pub max_lng: i32,
    pub max_lat: i32,
}

/// The store. Columns are parallel: index them all with the same [`FeatureIdx`].
///
/// This replaces the `objects` table, which carried 18 columns plus two geometry
/// representations and ten indexes, and which the clustering stage mutated row by row.
#[derive(Debug, Default)]
pub struct FeatureStore {
    pub coords: CoordArena,
    pub strings: StringInterner,

    // --- per-feature columns, all indexed by FeatureIdx ---
    pub feature_type: Vec<FeatureType>,
    pub geometry_kind: Vec<GeometryKind>,
    pub geometry: Vec<CoordSlice>,
    /// Ring/part offsets for polygon and multi-geometries; empty for simple geometries.
    pub geometry_parts: Vec<CoordSlice>,
    /// Elevation in centimetres, parallel to `coords`; `None` where unknown.
    pub elevation_cm: Vec<Option<i32>>,
    pub bbox: Vec<FixedBBox>,
    pub activities: Vec<ActivityMask>,
    pub status: Vec<Status>,
    pub source_type: Vec<SourceType>,
    pub source_id: Vec<Symbol>,
    pub name: Vec<Option<Symbol>>,
    /// Content hash, matching upstream's `properties.id`. See [`feature_id`].
    pub id: Vec<Symbol>,

    // --- type-specific columns; meaningful only for the matching feature_type ---
    pub run_uses: Vec<u16>,
    pub run_difficulty: Vec<Option<RunDifficulty>>,
    pub run_grooming: Vec<Option<RunGrooming>>,
    pub lift_type: Vec<Option<LiftType>>,
    pub spot_type: Vec<Option<SpotType>>,

    // --- clustering state, mutated in place by osd_cluster ---
    /// Ski areas this feature has been assigned to.
    pub assigned_ski_areas: Vec<Vec<SkiAreaIdx>>,
    pub is_basis_for_new_ski_area: Vec<bool>,
    pub is_in_ski_area_polygon: Vec<bool>,
    pub is_in_ski_area_site: Vec<bool>,
}

impl FeatureStore {
    pub fn len(&self) -> usize {
        self.feature_type.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Reserve capacity across every column at once, so a planet-scale load does not
    /// repeatedly reallocate twenty vectors.
    pub fn reserve(&mut self, _additional: usize) {
        todo!("reserve every column")
    }

    /// Coordinates of a feature, as fixed-point pairs.
    pub fn coords_of(&self, _idx: FeatureIdx) -> &[FixedCoord] {
        todo!("slice the arena with self.geometry[idx]")
    }

    /// Bit set of [`RunUse`] values for a run.
    pub fn run_uses_of(&self, _idx: FeatureIdx) -> Vec<RunUse> {
        todo!("expand the run_uses bitmask")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_mask_intersects_like_the_typescript_array_filter() {
        let downhill_only = ActivityMask::from_slice(&[SkiAreaActivity::Downhill]);
        let both = ActivityMask::from_slice(&[SkiAreaActivity::Downhill, SkiAreaActivity::Nordic]);
        let nordic_only = ActivityMask::from_slice(&[SkiAreaActivity::Nordic]);

        // This is the exact situation that makes union-find clustering wrong: narrowing
        // {D,N} by a downhill run yields {D}, which then excludes a nordic-only
        // neighbour even though that neighbour shares an activity with the run between
        // them. See osd_cluster's module docs.
        assert_eq!(both.intersection(downhill_only), downhill_only);
        assert!(downhill_only.intersection(nordic_only).is_empty());
    }

    #[test]
    fn activity_mask_round_trips_to_the_wire_vec() {
        let all = [SkiAreaActivity::Downhill, SkiAreaActivity::Nordic];
        assert_eq!(ActivityMask::from_slice(&all).to_vec(), all.to_vec());
        assert_eq!(ActivityMask::EMPTY.to_vec(), Vec::new());
    }
}
