//! Partitioning runs into spatially-connected components.
//!
//! See the crate docs for why this is sound and what the partition key has to dominate.
//! The short version: topology couples runs that share coordinates, the coupling is
//! transitive, and the key must be at least as coarse as the coarsest relation that joins
//! two runs — which is `PointMultiMap`'s 1e-7 node key, not TopoJSON's exact float
//! equality.

use osd_store::FixedCoord;
use std::collections::HashMap;

/// Identifies a spatially-connected group of runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ComponentId(pub u32);

/// Disjoint-set forest with union by size and path halving.
#[derive(Debug, Default)]
struct DisjointSet {
    parent: Vec<u32>,
    size: Vec<u32>,
}

impl DisjointSet {
    fn make_set(&mut self) -> u32 {
        let id = self.parent.len() as u32;
        self.parent.push(id);
        self.size.push(1);
        id
    }

    fn find(&mut self, mut node: u32) -> u32 {
        while self.parent[node as usize] != node {
            // Path halving: point the node at its grandparent as we walk up, which keeps
            // the tree flat without a second pass.
            let grandparent = self.parent[self.parent[node as usize] as usize];
            self.parent[node as usize] = grandparent;
            node = grandparent;
        }
        node
    }

    fn union(&mut self, a: u32, b: u32) {
        let (mut root_a, mut root_b) = (self.find(a), self.find(b));
        if root_a == root_b {
            return;
        }
        // Attach the smaller tree under the larger.
        if self.size[root_a as usize] < self.size[root_b as usize] {
            core::mem::swap(&mut root_a, &mut root_b);
        }
        self.parent[root_b as usize] = root_a;
        self.size[root_a as usize] += self.size[root_b as usize];
    }
}

/// Maps each run to the component it belongs to.
///
/// Built from coordinates alone: the features themselves are not retained, which is what
/// lets pass one stream the whole dataset without holding it.
#[derive(Debug, Default)]
pub struct ComponentIndex {
    sets: DisjointSet,
    /// Grid point to its node in the forest.
    nodes: HashMap<FixedCoord, u32>,
    /// Component assigned to each run, in the order the runs were added.
    run_roots: Vec<u32>,
}

impl ComponentIndex {
    /// Adds one run's coordinates, joining every grid point it touches.
    ///
    /// Every coordinate participates, not just the endpoints: an interior point shared
    /// between two runs creates a junction in the topology, which changes the arc
    /// decomposition of both, so two runs crossing mid-way have to land in the same
    /// component.
    ///
    /// A run with no coordinates still consumes an index, so run numbering stays aligned
    /// with the caller's iteration order.
    pub fn add_run(&mut self, coords: &[FixedCoord]) {
        let mut representative: Option<u32> = None;

        for &coord in coords {
            let node = match self.nodes.get(&coord) {
                Some(&node) => node,
                None => {
                    let node = self.sets.make_set();
                    self.nodes.insert(coord, node);
                    node
                }
            };
            match representative {
                None => representative = Some(node),
                Some(first) => self.sets.union(first, node),
            }
        }

        // A coordinate-less run gets a component of its own so it is never silently
        // merged with another.
        let root = match representative {
            Some(node) => node,
            None => self.sets.make_set(),
        };
        self.run_roots.push(root);
    }

    /// The component a previously added run belongs to.
    ///
    /// Call after every run has been added: unions from a later run can merge components
    /// that earlier runs were placed in.
    pub fn component_of_run(&mut self, run_index: usize) -> ComponentId {
        let root = self.run_roots[run_index];
        ComponentId(self.sets.find(root))
    }

    /// The component containing a grid point, if any run touched it.
    pub fn component_of(&mut self, coord: FixedCoord) -> Option<ComponentId> {
        let node = *self.nodes.get(&coord)?;
        Some(ComponentId(self.sets.find(node)))
    }

    pub fn run_count(&self) -> usize {
        self.run_roots.len()
    }

    /// Number of distinct components across all added runs.
    pub fn component_count(&mut self) -> usize {
        let mut roots: Vec<u32> = (0..self.run_roots.len())
            .map(|i| self.component_of_run(i).0)
            .collect();
        roots.sort_unstable();
        roots.dedup();
        roots.len()
    }

    /// Groups run indices by component, each group in ascending run order.
    ///
    /// The ordering matters: `mergeOverlappingRuns` folds over its input in order and
    /// compares accumulated state including that order, so a partition has to preserve
    /// the global relative order of the runs it contains.
    pub fn groups(&mut self) -> Vec<(ComponentId, Vec<usize>)> {
        let mut by_component: HashMap<u32, Vec<usize>> = HashMap::new();
        for run_index in 0..self.run_roots.len() {
            let root = self.component_of_run(run_index).0;
            by_component.entry(root).or_default().push(run_index);
        }
        let mut groups: Vec<(ComponentId, Vec<usize>)> = by_component
            .into_iter()
            .map(|(root, runs)| (ComponentId(root), runs))
            .collect();
        // Sorted by the first run each component contains, so the component order is
        // itself a function of the input order rather than of hash iteration.
        groups.sort_by_key(|(_, runs)| runs[0]);
        groups
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coord(lng: f64, lat: f64) -> FixedCoord {
        FixedCoord::from_degrees(lng, lat).unwrap()
    }

    #[test]
    fn runs_sharing_an_endpoint_are_one_component() {
        let mut index = ComponentIndex::default();
        index.add_run(&[coord(11.0, 47.0), coord(11.1, 47.0)]);
        index.add_run(&[coord(11.1, 47.0), coord(11.2, 47.0)]);

        assert_eq!(index.component_count(), 1);
        assert_eq!(index.component_of_run(0), index.component_of_run(1));
    }

    #[test]
    fn runs_sharing_nothing_are_separate_components() {
        let mut index = ComponentIndex::default();
        index.add_run(&[coord(11.0, 47.0), coord(11.1, 47.0)]);
        index.add_run(&[coord(12.0, 48.0), coord(12.1, 48.0)]);

        assert_eq!(index.component_count(), 2);
        assert_ne!(index.component_of_run(0), index.component_of_run(1));
    }

    /// Precondition: interior shared points create junctions, so indexing only endpoints
    /// would split a pair of crossing runs that the topology couples.
    #[test]
    fn runs_sharing_only_an_interior_point_are_one_component() {
        let mut index = ComponentIndex::default();
        // A crossing at (11.1, 47.0), interior to both runs.
        index.add_run(&[coord(11.0, 47.0), coord(11.1, 47.0), coord(11.2, 47.0)]);
        index.add_run(&[coord(11.1, 46.9), coord(11.1, 47.0), coord(11.1, 47.1)]);

        assert_eq!(index.component_count(), 1);
    }

    /// Precondition: the key has to be at least as coarse as PointMultiMap's node key.
    /// Snapping to the 1e-7 grid gives that for free — two coordinates closer together
    /// than the grid resolution become the same grid point, so runs that
    /// `combineRunSegments` would join cannot be split across partitions.
    #[test]
    fn coordinates_within_one_grid_cell_are_the_same_point() {
        let mut index = ComponentIndex::default();
        index.add_run(&[coord(11.0, 47.0), coord(11.00000001, 47.0)]);
        index.add_run(&[coord(11.00000002, 47.0), coord(11.2, 47.0)]);

        assert_eq!(
            index.component_count(),
            1,
            "a sub-grid-resolution difference must not separate two runs"
        );
    }

    /// Connectivity is transitive, so a chain joined only at successive endpoints is one
    /// component however long it is.
    #[test]
    fn a_long_chain_is_a_single_component() {
        let mut index = ComponentIndex::default();
        for i in 0..50 {
            let lng = 11.0 + 0.001 * i as f64;
            index.add_run(&[coord(lng, 47.0), coord(lng + 0.001, 47.0)]);
        }
        assert_eq!(index.run_count(), 50);
        assert_eq!(index.component_count(), 1);
    }

    /// A union discovered late must merge components the earlier runs were placed in,
    /// which is why component_of_run has to be read after every run is added.
    #[test]
    fn a_late_run_merges_earlier_components() {
        let mut index = ComponentIndex::default();
        index.add_run(&[coord(11.0, 47.0), coord(11.1, 47.0)]);
        index.add_run(&[coord(12.0, 47.0), coord(12.1, 47.0)]);
        assert_eq!(index.component_count(), 2);

        // A bridging run touching both.
        index.add_run(&[coord(11.1, 47.0), coord(12.0, 47.0)]);
        assert_eq!(index.component_count(), 1);
        assert_eq!(index.component_of_run(0), index.component_of_run(1));
    }

    #[test]
    fn a_run_without_coordinates_gets_its_own_component() {
        let mut index = ComponentIndex::default();
        index.add_run(&[]);
        index.add_run(&[]);
        assert_eq!(index.component_count(), 2);
    }

    #[test]
    fn groups_preserve_global_run_order_within_and_between_components() {
        let mut index = ComponentIndex::default();
        // Component X: runs 0 and 2. Component Y: runs 1 and 3.
        index.add_run(&[coord(11.0, 47.0), coord(11.1, 47.0)]);
        index.add_run(&[coord(20.0, 47.0), coord(20.1, 47.0)]);
        index.add_run(&[coord(11.1, 47.0), coord(11.2, 47.0)]);
        index.add_run(&[coord(20.1, 47.0), coord(20.2, 47.0)]);

        let groups = index.groups();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].1, vec![0, 2], "runs must stay in global order");
        assert_eq!(groups[1].1, vec![1, 3]);
    }
}
