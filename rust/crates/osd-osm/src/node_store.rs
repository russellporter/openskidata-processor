//! Node coordinates in parallel arrays, sorted by id and found by binary search.
//!
//! Replaces `NodeStore` in `OSMToGeoJSONConverter.ts`, whose own comment notes that
//! planet-scale extracts hold millions of nodes and that this is several times more compact
//! than a map of objects. That layout carries over unchanged.

use crate::element::Position;
use crate::geometry::js_round;

#[derive(Debug, Default)]
pub struct NodeStore {
    ids: Vec<i64>,
    lons: Vec<f64>,
    lats: Vec<f64>,
    sorted: bool,
    started: bool,
}

/// Iron out floating-point noise in a coordinate by rounding it at 1e-12.
///
/// Upstream's `Math.round(x * 1e12) / 1e12`. At this scale it removes binary representation
/// error without moving a coordinate by anything a map could show.
pub fn round_coordinate(value: f64) -> f64 {
    js_round(value * 1e12) / 1e12
}

impl NodeStore {
    pub fn new() -> NodeStore {
        NodeStore {
            sorted: true,
            ..NodeStore::default()
        }
    }

    pub fn add(&mut self, id: i64, lon: f64, lat: f64) {
        assert!(!self.started, "cannot add nodes after lookups have started");
        if let Some(&last) = self.ids.last() {
            if id <= last {
                self.sorted = false;
            }
        }
        self.ids.push(id);
        self.lons.push(round_coordinate(lon));
        self.lats.push(round_coordinate(lat));
    }

    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// Sorts by id if needed. Overpass emits nodes in ascending id order, so this is
    /// normally a no-op; PBF files are also sorted by convention.
    ///
    /// The sort is stable, so duplicate ids keep their arrival order, as upstream's does.
    pub fn finish(&mut self) {
        self.started = true;
        if self.sorted {
            return;
        }
        let mut order: Vec<usize> = (0..self.ids.len()).collect();
        order.sort_by_key(|&i| self.ids[i]);
        self.ids = order.iter().map(|&i| self.ids[i]).collect();
        self.lons = order.iter().map(|&i| self.lons[i]).collect();
        self.lats = order.iter().map(|&i| self.lats[i]).collect();
        self.sorted = true;
    }

    /// Binary search, written out exactly as upstream's so that a duplicated id resolves to
    /// the same entry.
    pub fn index_of(&self, id: i64) -> Option<usize> {
        let mut low: isize = 0;
        let mut high: isize = self.ids.len() as isize - 1;
        while low <= high {
            let mid = ((low + high) as usize) >> 1;
            let value = self.ids[mid];
            if value < id {
                low = mid as isize + 1;
            } else if value > id {
                high = mid as isize - 1;
            } else {
                return Some(mid);
            }
        }
        None
    }

    pub fn has(&self, id: i64) -> bool {
        self.index_of(id).is_some()
    }

    pub fn id_at(&self, index: usize) -> i64 {
        self.ids[index]
    }

    pub fn position_at(&self, index: usize) -> Position {
        [self.lons[index], self.lats[index]]
    }

    /// The position of a node known to exist.
    ///
    /// # Panics
    ///
    /// If the node is absent. Callers only pass ids that were filtered for presence.
    pub fn position(&self, id: i64) -> Position {
        let index = self
            .index_of(id)
            .unwrap_or_else(|| panic!("node {id} is not in the store"));
        self.position_at(index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nodes_added_out_of_order_are_found_after_finishing() {
        let mut store = NodeStore::new();
        store.add(30, 3.0, 30.0);
        store.add(10, 1.0, 10.0);
        store.add(20, 2.0, 20.0);
        store.finish();

        assert_eq!(store.position(10), [1.0, 10.0]);
        assert_eq!(store.position(20), [2.0, 20.0]);
        assert_eq!(store.position(30), [3.0, 30.0]);
        assert!(store.index_of(15).is_none());
        assert_eq!(store.id_at(0), 10, "ids are ascending once finished");
    }

    #[test]
    fn coordinates_are_rounded_at_one_trillionth_of_a_degree() {
        assert_eq!(round_coordinate(11.123456789012349), 11.123456789012);
        // Already clean values survive unchanged.
        assert_eq!(round_coordinate(11.5), 11.5);
        assert_eq!(round_coordinate(-47.25), -47.25);
    }

    #[test]
    #[should_panic(expected = "after lookups have started")]
    fn adding_after_finishing_is_a_bug() {
        let mut store = NodeStore::new();
        store.add(1, 0.0, 0.0);
        store.finish();
        store.add(2, 0.0, 0.0);
    }
}
