//! Geohashes, as `ngeohash` computes them.
//!
//! Upstream keys the elevation cache by a 10-character geohash (a cell of about one metre) and
//! the geocoding caches by a 6-character one. A geohash is the longitude and latitude bits of
//! a coordinate interleaved, longitude first, five bits to a character -- a Morton code -- so
//! a cell is exactly an integer of `5 * characters` bits. That integer is the key here, which
//! carries every cached value across under the cell it was fetched for; a grid of our own
//! would split those cells differently and lose the equivalence.
//!
//! The comparisons are `ngeohash`'s: a coordinate exactly on a bisection midpoint falls in the
//! lower half, and `NaN` in the lower half too.

const BASE32: &[u8; 32] = b"0123456789bcdefghjkmnpqrstuvwxyz";

/// The longest geohash that fits a `u64` key.
pub const MAX_CHARS: usize = 12;

/// The cell of a coordinate: `5 * chars` bits, longitude first.
pub fn encode(latitude: f64, longitude: f64, chars: usize) -> u64 {
    assert!((1..=MAX_CHARS).contains(&chars), "1 to 12 characters");
    let (mut min_lat, mut max_lat) = (-90.0, 90.0);
    let (mut min_lon, mut max_lon) = (-180.0, 180.0);
    let mut hash = 0u64;
    for bit in 0..chars * 5 {
        hash <<= 1;
        if bit % 2 == 0 {
            let mid = (max_lon + min_lon) / 2.0;
            if longitude > mid {
                hash |= 1;
                min_lon = mid;
            } else {
                max_lon = mid;
            }
        } else {
            let mid = (max_lat + min_lat) / 2.0;
            if latitude > mid {
                hash |= 1;
                min_lat = mid;
            } else {
                max_lat = mid;
            }
        }
    }
    hash
}

/// The centre of a cell, as `(latitude, longitude)`.
pub fn decode(hash: u64, chars: usize) -> (f64, f64) {
    assert!((1..=MAX_CHARS).contains(&chars), "1 to 12 characters");
    let (mut min_lat, mut max_lat) = (-90.0, 90.0);
    let (mut min_lon, mut max_lon) = (-180.0, 180.0);
    for bit in 0..chars * 5 {
        let set = (hash >> (chars * 5 - 1 - bit)) & 1 == 1;
        if bit % 2 == 0 {
            let mid = (max_lon + min_lon) / 2.0;
            if set {
                min_lon = mid;
            } else {
                max_lon = mid;
            }
        } else {
            let mid = (max_lat + min_lat) / 2.0;
            if set {
                min_lat = mid;
            } else {
                max_lat = mid;
            }
        }
    }
    ((min_lat + max_lat) / 2.0, (min_lon + max_lon) / 2.0)
}

/// The geohash string of a cell.
pub fn to_string(hash: u64, chars: usize) -> String {
    (0..chars)
        .map(|i| BASE32[((hash >> (5 * (chars - 1 - i))) & 31) as usize] as char)
        .collect()
}

/// The cell of a geohash string (any case), or `None` if it is not `chars` valid characters.
pub fn from_str(text: &str, chars: usize) -> Option<u64> {
    if text.len() != chars || !(1..=MAX_CHARS).contains(&chars) {
        return None;
    }
    text.bytes().try_fold(0u64, |hash, byte| {
        let index = BASE32
            .iter()
            .position(|&c| c == byte.to_ascii_lowercase())?;
        Some((hash << 5) | index as u64)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_round_trip() {
        let hash = from_str("u0yjjd6gqe", 10).unwrap();
        assert_eq!(to_string(hash, 10), "u0yjjd6gqe");
        assert_eq!(from_str("U0YJJD6GQE", 10), Some(hash));
        assert_eq!(from_str("u0yjjd6gq", 10), None, "too short");
        assert_eq!(from_str("u0yjjd6gqa", 10), None, "a is not in the alphabet");
    }
}
