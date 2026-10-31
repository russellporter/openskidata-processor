//! The coordinate arena.

use crate::COORD_SCALE;

/// A coordinate in fixed-point degrees: `round(degrees * 1e7)`.
///
/// 8 bytes, against roughly 80 for a JS `[number, number]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
pub struct FixedCoord {
    pub lng: i32,
    pub lat: i32,
}

impl FixedCoord {
    /// Snap a floating-point degree pair onto the grid.
    ///
    /// Must round half-away-from-zero to match JS `toFixed(7)`, which the TypeScript
    /// `PointMultiMap` uses as its node key. In particular `-0.0` and `0.0` must land on
    /// the same value here, whereas `(-0).toFixed(7)` yields the *string* `"-0.0000000"`
    /// and `(0).toFixed(7)` yields `"0.0000000"` — two distinct keys upstream. That
    /// discrepancy is a real behaviour difference and is called out in `osd_normalize`.
    pub fn from_degrees(_lng: f64, _lat: f64) -> FixedCoord {
        todo!("snap to the 1e-7 grid with JS-compatible rounding")
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

    /// Append a run of coordinates and return the slice describing them.
    pub fn push_slice(&mut self, _coords: &[FixedCoord]) -> CoordSlice {
        todo!("append and return the CoordSlice")
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
