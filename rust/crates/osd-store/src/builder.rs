//! Appending features to a [`FeatureStore`].
//!
//! The columns have to stay parallel — every one is indexed by the same [`FeatureIdx`] —
//! so adding a feature means pushing to all of them. Doing that by hand at each call site
//! is how a column ends up one element short, which then silently misaligns every feature
//! after it. This is the only intended way to append.

use crate::{
    ActivityMask, CoordOutOfRange, CoordSlice, FeatureIdx, FeatureStore, FixedBBox, FixedCoord,
    GeometryKind, SkiAreaIdx, run_uses_mask,
};
use openskidata_format::{
    FeatureType, LiftType, RunDifficulty, RunGrooming, RunUse, SkiAreaActivity, SourceType,
    SpotType, Status,
};

/// One feature's worth of data, in the terms the store holds it.
#[derive(Debug, Clone)]
pub struct DraftFeature {
    pub feature_type: FeatureType,
    pub geometry_kind: GeometryKind,
    /// Already snapped to the fixed-point grid. Empty for a placeholder geometry.
    pub coords: Vec<FixedCoord>,
    /// True for a ski area whose real position is unknown; see
    /// [`FeatureStore::has_placeholder_geometry`].
    pub has_placeholder_geometry: bool,
    pub activities: ActivityMask,
    pub status: Status,
    pub source_type: SourceType,
    pub source_id: String,
    pub name: Option<String>,
    /// Content hash. May be the deferred sentinel for runs, which are re-hashed after
    /// normalization.
    pub id: String,
    pub run_uses: Vec<RunUse>,
    pub run_difficulty: Option<RunDifficulty>,
    pub run_grooming: Option<RunGrooming>,
    pub lift_type: Option<LiftType>,
    pub spot_type: Option<SpotType>,
    pub is_basis_for_new_ski_area: bool,
    pub is_in_ski_area_polygon: bool,
    pub is_in_ski_area_site: bool,
}

impl DraftFeature {
    /// A minimal feature, for callers that only care about a few fields.
    pub fn new(feature_type: FeatureType, geometry_kind: GeometryKind) -> DraftFeature {
        DraftFeature {
            feature_type,
            geometry_kind,
            coords: Vec::new(),
            has_placeholder_geometry: false,
            activities: ActivityMask::EMPTY,
            status: Status::Operating,
            source_type: SourceType::Openstreetmap,
            source_id: String::new(),
            name: None,
            id: String::new(),
            run_uses: Vec::new(),
            run_difficulty: None,
            run_grooming: None,
            lift_type: None,
            spot_type: None,
            is_basis_for_new_ski_area: false,
            is_in_ski_area_polygon: false,
            is_in_ski_area_site: false,
        }
    }

    pub fn with_coords(mut self, coords: Vec<FixedCoord>) -> DraftFeature {
        self.coords = coords;
        self
    }

    /// Snaps degree pairs onto the grid.
    pub fn with_degrees(mut self, coords: &[(f64, f64)]) -> Result<DraftFeature, CoordOutOfRange> {
        self.coords = coords
            .iter()
            .map(|&(lng, lat)| FixedCoord::from_degrees(lng, lat))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(self)
    }

    pub fn with_activities(mut self, activities: &[SkiAreaActivity]) -> DraftFeature {
        self.activities = ActivityMask::from_slice(activities);
        self
    }

    pub fn with_id(mut self, id: impl Into<String>) -> DraftFeature {
        self.id = id.into();
        self
    }

    pub fn with_status(mut self, status: Status) -> DraftFeature {
        self.status = status;
        self
    }

    pub fn with_lift_type(mut self, lift_type: LiftType) -> DraftFeature {
        self.lift_type = Some(lift_type);
        self
    }

    pub fn with_source(mut self, source_type: SourceType) -> DraftFeature {
        self.source_type = source_type;
        self
    }
}

impl FeatureStore {
    /// Appends a feature, pushing to every column, and returns its index.
    pub fn push(&mut self, draft: DraftFeature) -> FeatureIdx {
        let idx = FeatureIdx(self.feature_type.len() as u32);

        let slice: CoordSlice = self.coords.push_slice(&draft.coords);
        let bbox = bounding_box(&draft.coords);
        let source_id = self.strings.intern(&draft.source_id);
        let name = draft.name.as_deref().map(|n| self.strings.intern(n));
        let id = self.strings.intern(&draft.id);

        self.feature_type.push(draft.feature_type);
        self.geometry_kind.push(draft.geometry_kind);
        self.geometry.push(slice);
        self.geometry_parts.push(CoordSlice::default());
        self.bbox.push(bbox);
        self.has_placeholder_geometry
            .push(draft.has_placeholder_geometry);
        self.activities.push(draft.activities);
        self.status.push(draft.status);
        self.source_type.push(draft.source_type);
        self.source_id.push(source_id);
        self.name.push(name);
        self.id.push(id);
        self.run_uses.push(run_uses_mask(&draft.run_uses));
        self.run_difficulty.push(draft.run_difficulty);
        self.run_grooming.push(draft.run_grooming);
        self.lift_type.push(draft.lift_type);
        self.spot_type.push(draft.spot_type);
        self.assigned_ski_areas.push(Vec::new());
        self.is_basis_for_new_ski_area
            .push(draft.is_basis_for_new_ski_area);
        self.is_in_ski_area_polygon
            .push(draft.is_in_ski_area_polygon);
        self.is_in_ski_area_site.push(draft.is_in_ski_area_site);

        debug_assert!(self.columns_are_aligned());
        idx
    }

    /// Every column holds the same number of entries.
    ///
    /// Checked in debug builds after each append, because a misaligned column does not
    /// fail where it is caused — it silently returns another feature's data.
    pub fn columns_are_aligned(&self) -> bool {
        let n = self.feature_type.len();
        self.geometry_kind.len() == n
            && self.geometry.len() == n
            && self.geometry_parts.len() == n
            && self.bbox.len() == n
            && self.has_placeholder_geometry.len() == n
            && self.activities.len() == n
            && self.status.len() == n
            && self.source_type.len() == n
            && self.source_id.len() == n
            && self.name.len() == n
            && self.id.len() == n
            && self.run_uses.len() == n
            && self.run_difficulty.len() == n
            && self.run_grooming.len() == n
            && self.lift_type.len() == n
            && self.spot_type.len() == n
            && self.assigned_ski_areas.len() == n
            && self.is_basis_for_new_ski_area.len() == n
            && self.is_in_ski_area_polygon.len() == n
            && self.is_in_ski_area_site.len() == n
    }

    /// The feature's id as a string.
    pub fn id_of(&self, idx: FeatureIdx) -> &str {
        self.strings.resolve(self.id[idx.0 as usize])
    }

    /// Records that a feature belongs to a ski area.
    pub fn assign_to_ski_area(&mut self, idx: FeatureIdx, ski_area: SkiAreaIdx) {
        let assigned = &mut self.assigned_ski_areas[idx.0 as usize];
        if !assigned.contains(&ski_area) {
            assigned.push(ski_area);
        }
        // Matches markObjectsAsPartOfSkiArea, which clears this flag when it claims an
        // object so the object cannot later seed a ski area of its own.
        self.is_basis_for_new_ski_area[idx.0 as usize] = false;
    }

    pub fn is_assigned(&self, idx: FeatureIdx) -> bool {
        !self.assigned_ski_areas[idx.0 as usize].is_empty()
    }
}

/// Bounding box of a coordinate run. An empty run yields a degenerate box at the origin,
/// which only occurs for a placeholder geometry and is never used as a search key.
pub fn bounding_box(coords: &[FixedCoord]) -> FixedBBox {
    let mut bbox = FixedBBox {
        min_lng: 0,
        min_lat: 0,
        max_lng: 0,
        max_lat: 0,
    };
    if coords.is_empty() {
        return bbox;
    }
    bbox.min_lng = i32::MAX;
    bbox.min_lat = i32::MAX;
    bbox.max_lng = i32::MIN;
    bbox.max_lat = i32::MIN;
    for coord in coords {
        bbox.min_lng = bbox.min_lng.min(coord.lng);
        bbox.min_lat = bbox.min_lat.min(coord.lat);
        bbox.max_lng = bbox.max_lng.max(coord.lng);
        bbox.max_lat = bbox.max_lat.max(coord.lat);
    }
    bbox
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appending_keeps_every_column_aligned() {
        let mut store = FeatureStore::default();
        store.push(
            DraftFeature::new(FeatureType::Run, GeometryKind::LineString)
                .with_degrees(&[(11.0, 47.0), (11.1, 47.1)])
                .unwrap()
                .with_id("run-1"),
        );
        store
            .push(DraftFeature::new(FeatureType::Lift, GeometryKind::LineString).with_id("lift-1"));
        assert_eq!(store.len(), 2);
        assert!(store.columns_are_aligned());
        assert_eq!(store.id_of(FeatureIdx(0)), "run-1");
        assert_eq!(store.id_of(FeatureIdx(1)), "lift-1");
        assert_eq!(store.coords_of(FeatureIdx(0)).len(), 2);
        assert_eq!(store.coords_of(FeatureIdx(1)).len(), 0);
    }

    #[test]
    fn bounding_box_covers_every_coordinate() {
        let coords = vec![
            FixedCoord { lng: 10, lat: -5 },
            FixedCoord { lng: -3, lat: 20 },
            FixedCoord { lng: 7, lat: 2 },
        ];
        let bbox = bounding_box(&coords);
        assert_eq!(bbox.min_lng, -3);
        assert_eq!(bbox.max_lng, 10);
        assert_eq!(bbox.min_lat, -5);
        assert_eq!(bbox.max_lat, 20);
    }

    #[test]
    fn assigning_to_a_ski_area_clears_the_seed_flag() {
        let mut store = FeatureStore::default();
        let mut draft = DraftFeature::new(FeatureType::Run, GeometryKind::LineString);
        draft.is_basis_for_new_ski_area = true;
        let idx = store.push(draft);

        assert!(!store.is_assigned(idx));
        store.assign_to_ski_area(idx, SkiAreaIdx(0));
        assert!(store.is_assigned(idx));
        assert!(!store.is_basis_for_new_ski_area[idx.0 as usize]);

        // Assigning twice must not duplicate the membership.
        store.assign_to_ski_area(idx, SkiAreaIdx(0));
        assert_eq!(store.assigned_ski_areas[idx.0 as usize].len(), 1);
    }
}
