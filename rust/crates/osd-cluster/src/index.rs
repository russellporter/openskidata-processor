//! The spatial index.

use crate::geometry::min_distance_metres;
use osd_store::{COORD_SCALE, FeatureIdx, FeatureStore};
use rstar::{AABB, RTree, RTreeObject};

/// An entry in the R-tree: a feature's bounding box, expanded by the search radius.
///
/// The expansion is baked into the stored envelope so a query is a plain point/box
/// intersection rather than a radius search, and so the latitude-dependent longitude
/// scaling is computed once per feature instead of per query.
#[derive(Debug, Clone, Copy)]
struct IndexEntry {
    feature: FeatureIdx,
    min: [f64; 2],
    max: [f64; 2],
}

impl RTreeObject for IndexEntry {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(self.min, self.max)
    }
}

/// Spatial index over feature bounding boxes.
#[derive(Debug)]
pub struct SpatialIndex {
    tree: RTree<IndexEntry>,
    /// The radius the stored envelopes were expanded by, in metres.
    expansion_metres: f64,
}

impl SpatialIndex {
    /// Builds the index, expanding every bounding box by `expansion_metres`.
    ///
    /// Uses `bulk_load`, which builds by sort-tile-recursive packing: both faster to
    /// construct and better balanced than inserting one at a time.
    ///
    /// Features with no coordinates — the placeholder geometries — are left out entirely.
    /// They have no position, so nothing is near them.
    pub fn build(store: &FeatureStore, expansion_metres: f64) -> SpatialIndex {
        let metres_per_degree_lat = 111_195.0_f64;

        let entries: Vec<IndexEntry> = (0..store.len())
            .map(|i| FeatureIdx(i as u32))
            .filter(|&idx| !store.coords_of(idx).is_empty())
            .map(|idx| {
                let bbox = store.bbox[idx.0 as usize];
                let min_lat = bbox.min_lat as f64 / COORD_SCALE;
                let max_lat = bbox.max_lat as f64 / COORD_SCALE;

                // Longitude degrees shrink with latitude, so the longitude padding is
                // computed at whichever edge of the box is closest to a pole — the wider
                // padding of the two, so the envelope cannot be too small.
                let widest_lat = min_lat.abs().max(max_lat.abs()).min(89.9);
                let lat_padding = expansion_metres / metres_per_degree_lat;
                let lng_padding =
                    expansion_metres / (metres_per_degree_lat * widest_lat.to_radians().cos());

                IndexEntry {
                    feature: idx,
                    min: [
                        bbox.min_lng as f64 / COORD_SCALE - lng_padding,
                        min_lat - lat_padding,
                    ],
                    max: [
                        bbox.max_lng as f64 / COORD_SCALE + lng_padding,
                        max_lat + lat_padding,
                    ],
                }
            })
            .collect();

        SpatialIndex {
            tree: RTree::bulk_load(entries),
            expansion_metres,
        }
    }

    pub fn len(&self) -> usize {
        self.tree.size()
    }

    pub fn is_empty(&self) -> bool {
        self.tree.size() == 0
    }

    /// Features whose geometry is within `metres` of the given feature's geometry.
    ///
    /// The R-tree narrows to candidates whose expanded envelopes overlap, then each is
    /// confirmed with the exact distance, because an envelope overlap only bounds the
    /// distance between boxes rather than between geometries. The feature itself is never
    /// returned.
    ///
    /// # Panics
    ///
    /// If `metres` exceeds the radius the index was built with, since the stored
    /// envelopes would then be too small to find every candidate and the result would be
    /// silently incomplete.
    pub fn candidates_within(
        &self,
        store: &FeatureStore,
        of: FeatureIdx,
        metres: f64,
    ) -> Vec<FeatureIdx> {
        assert!(
            metres <= self.expansion_metres + 1e-6,
            "queried {metres} m from an index built for {} m",
            self.expansion_metres
        );

        let own_coords = store.coords_of(of);
        if own_coords.is_empty() {
            return Vec::new();
        }

        let bbox = store.bbox[of.0 as usize];
        let query = AABB::from_corners(
            [
                bbox.min_lng as f64 / COORD_SCALE,
                bbox.min_lat as f64 / COORD_SCALE,
            ],
            [
                bbox.max_lng as f64 / COORD_SCALE,
                bbox.max_lat as f64 / COORD_SCALE,
            ],
        );

        self.tree
            .locate_in_envelope_intersecting(query)
            .filter(|entry| entry.feature != of)
            .filter(|entry| {
                min_distance_metres(own_coords, store.coords_of(entry.feature))
                    .is_some_and(|distance| distance <= metres)
            })
            .map(|entry| entry.feature)
            .collect()
    }
}
