//! Feature id hashing, byte-compatible with `object-hash`.
//!
//! Replaces: `src/transforms/FeatureBuilder.ts`, which derives `properties.id` as
//! `objectHash({ type: "Feature", properties: { type }, geometry })`.
//!
//! # Why compatible rather than a new hash
//!
//! The earlier plan was a cheaper canonical hash and "accept that ids change wholesale".
//! That would invalidate every link and bookmark that holds a feature id, for no benefit to
//! the output. Reproducing `object-hash` exactly is feasible because the input has a fixed
//! shape, so the byte stream it hashes is a template with the geometry's numbers spliced in.
//! The saving that matters -- upstream's cost was JavaScript walking an object graph, not
//! SHA-1 -- is kept: this streams the numbers into the hasher without building anything.
//!
//! # The stream
//!
//! `object-hash` writes `object:N:` for an object with N keys, then for each key (sorted)
//! the key as `string:LEN:key`, a colon, the value, a comma. With its default
//! `respectType`, every plain object also gets three extra leading keys -- `prototype`,
//! `__proto__` and `constructor` -- so an object with one real key is written with four.
//! `prototype` is undefined (`Undefined`); `__proto__` is `Object.prototype`, whose full
//! rendering appears once and thereafter as `[CIRCULAR:1]`; `constructor` is the native
//! `Object` function, likewise rendered once and thereafter as `[CIRCULAR:2]`. Those
//! indexes are positions in the walk's visited list, and the first two objects visited are
//! always these, so they are constants for this shape.
//!
//! # Shared coordinates
//!
//! `object-hash` remembers every object it has visited and writes `[CIRCULAR:n]` for a
//! repeat, `n` being its position in the visit order. So an id depends on JavaScript object
//! *identity*, not just values. For ids that matters for polygon runs that went through
//! `topojson`: `topojson-client` returns the arc's own coordinate arrays rather than copies,
//! so a point appears as the same object wherever the decoded ring reuses it -- a ring
//! rotated by `topojson-server` has its closing point aliased to its first, a ring that walks
//! an arc forward and back repeats that arc's points, and rings that share an arc share its
//! points. Each repeat is written as a back-reference where the point would be, so the same
//! polygon hashes differently depending on how it was assembled. This is reproduced (see
//! [`CoordinateWriter::identified_position`]) because the ids are what consumers hold,
//! whether or not it is what upstream meant.
//!
//! Numbers are `number:` followed by JavaScript's `Number.prototype.toString()`, which is
//! shortest-round-trip digits laid out by ECMAScript's own rules -- see
//! [`js_number_to_string`].
//!
//! Verified against the real library by `tests/feature_ids.rs`.

use sha1::{Digest, Sha1};

/// What `object-hash` writes for the prototype keys the *first* time it meets a plain object
/// (the feature itself). `Object.prototype` and `Object` are rendered in full here.
const FIRST_OBJECT_HEADER: &str = "object:6:\
string:9:prototype:Undefined,\
string:9:__proto__:object:3:string:9:prototype:Undefined,string:9:__proto__:Null,\
string:11:constructor:fn:string:8:[native]string:20:function-name:Objectobject:0:,,\
string:11:constructor:fn:string:8:[native]string:20:function-name:Objectstring:12:[CIRCULAR:2],";

/// The same three keys for every later plain object, where both are back-references.
const LATER_OBJECT_PROTOTYPE_KEYS: &str = "string:9:prototype:Undefined,\
string:9:__proto__:string:12:[CIRCULAR:1],\
string:11:constructor:fn:string:8:[native]string:20:function-name:Objectstring:12:[CIRCULAR:2],";

/// JavaScript's `Number.prototype.toString()` for a finite or non-finite `f64`.
///
/// ECMAScript 2024 §6.1.6.1.20: take the shortest digit string `s` of `k` digits that
/// round-trips, with decimal exponent `n` such that the value is `0.s x 10^n`, and lay it
/// out as an integer, a plain decimal, or exponent form depending on `n`.
pub fn js_number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x == 0.0 {
        return "0".into(); // including -0
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }

    let sign = if x < 0.0 { "-" } else { "" };
    // Rust's `{:e}` is a shortest round-trip representation, as `d.ddde-7`. It fixes the
    // number of digits `k`; the digits themselves are then taken from the exactly rounded
    // k-digit decimal, because when the value sits exactly halfway between two k-digit
    // candidates ECMAScript picks the even one and Rust's shortest search does not (for
    // -889415325901797.25 they print ...797.2 and ...797.3). Such ties need 17 significant
    // digits, so they never arise for coordinates, but the rule is the rule.
    let shortest = format!("{:e}", x.abs());
    let k = shortest
        .split_once('e')
        .expect("exponent present")
        .0
        .replace('.', "")
        .len();
    let scientific = format!("{:.*e}", k - 1, x.abs());
    let (mantissa, exponent) = scientific.split_once('e').expect("exponent present");
    let exponent: i32 = exponent.parse().expect("integer exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exponent + 1;

    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let exp = format!("e{}{}", if e < 0 { "-" } else { "+" }, e.abs());
        if k == 1 {
            format!("{digits}{exp}")
        } else {
            format!("{}.{}{exp}", &digits[..1], &digits[1..])
        }
    };
    format!("{sign}{body}")
}

/// Streams a geometry's coordinates into the hash.
///
/// The caller walks the coordinate nesting: [`array`](Self::array) opens an array of a
/// given length, and [`number`](Self::number) writes a value. A position is
/// [`position`](Self::position).
pub struct CoordinateWriter {
    hasher: Sha1,
    /// The position the next newly visited object takes in `object-hash`'s visit list. The
    /// feature, `Object.prototype`, `Object` and the geometry come first, so the
    /// coordinates array is 4.
    next_index: usize,
    /// Objects already written, by caller-chosen identity, and where they were visited.
    visited: std::collections::HashMap<u64, usize>,
}

impl CoordinateWriter {
    fn write(&mut self, text: &str) {
        self.hasher.update(text.as_bytes());
    }

    /// `array:LEN:`, to be followed by exactly `len` elements.
    pub fn array(&mut self, len: usize) {
        self.next_index += 1;
        self.write("array:");
        self.write(&len.to_string());
        self.write(":");
    }

    pub fn number(&mut self, x: f64) {
        self.write("number:");
        self.write(&js_number_to_string(x));
    }

    /// A back-reference to an object visited earlier, which `object-hash` writes instead of
    /// the object when it meets the same one again.
    pub fn circular(&mut self, index: usize) {
        write_string(&mut self.hasher, &format!("[CIRCULAR:{index}]"));
    }

    /// A position that is identified by `key`: the first time a key is met it is written
    /// out in full; every later time it is written as a back-reference to the first, as
    /// `object-hash` does for an object it has already visited.
    pub fn identified_position(&mut self, position: &[f64], key: u64) {
        if let Some(&index) = self.visited.get(&key) {
            self.circular(index);
        } else {
            self.visited.insert(key, self.next_index);
            self.position(position);
        }
    }

    /// A ring: an array of positions, each with an identity key (see
    /// [`identified_position`](Self::identified_position)).
    pub fn ring(&mut self, positions: &[Vec<f64>], keys: &[u64]) {
        assert_eq!(positions.len(), keys.len());
        self.array(positions.len());
        for (position, &key) in positions.iter().zip(keys) {
            self.identified_position(position, key);
        }
    }

    /// An array of numbers: `[lng, lat]` or `[lng, lat, elevation]`.
    pub fn position(&mut self, position: &[f64]) {
        self.array(position.len());
        for &x in position {
            self.number(x);
        }
    }
}

fn write_string(hasher: &mut Sha1, s: &str) {
    // `string:` + the UTF-16 length + `:` + the text. These are ASCII here.
    hasher.update(format!("string:{}:{s}", s.encode_utf16().count()).as_bytes());
}

/// The id of a feature: the `object-hash` of
/// `{ type: "Feature", properties: { type: feature_type }, geometry: { type: geometry_type,
/// coordinates } }`, as lowercase hex.
///
/// `write_coordinates` streams the `coordinates` value.
pub fn feature_id(
    feature_type: &str,
    geometry_type: &str,
    write_coordinates: impl FnOnce(&mut CoordinateWriter),
) -> String {
    let mut writer = CoordinateWriter {
        hasher: Sha1::new(),
        next_index: 4,
        visited: std::collections::HashMap::new(),
    };
    writer.write(FIRST_OBJECT_HEADER);

    // geometry (keys sorted: coordinates, type)
    write_string(&mut writer.hasher, "geometry");
    writer.write(":object:5:");
    writer.write(LATER_OBJECT_PROTOTYPE_KEYS);
    write_string(&mut writer.hasher, "coordinates");
    writer.write(":");
    write_coordinates(&mut writer);
    writer.write(",");
    write_string(&mut writer.hasher, "type");
    writer.write(":");
    write_string(&mut writer.hasher, geometry_type);
    writer.write(",,");

    // properties
    write_string(&mut writer.hasher, "properties");
    writer.write(":object:4:");
    writer.write(LATER_OBJECT_PROTOTYPE_KEYS);
    write_string(&mut writer.hasher, "type");
    writer.write(":");
    write_string(&mut writer.hasher, feature_type);
    writer.write(",,");

    // type
    write_string(&mut writer.hasher, "type");
    writer.write(":");
    write_string(&mut writer.hasher, "Feature");
    writer.write(",");

    let digest = writer.hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_format_like_javascript() {
        // Each of these is `String(x)` in node.
        for (x, expected) in [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.0, "-1"),
            (11.5, "11.5"),
            (47.25, "47.25"),
            (0.1, "0.1"),
            (0.000001, "0.000001"),
            (0.0000001, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (123456789012345680000.0, "123456789012345680000"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (-2.5e-10, "-2.5e-10"),
            (100.0, "100"),
            (1e20, "100000000000000000000"),
            (0.5, "0.5"),
            (5e-324, "5e-324"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
        ] {
            assert_eq!(js_number_to_string(x), expected, "{x:e}");
        }
        assert_eq!(js_number_to_string(f64::NAN), "NaN");
    }

    #[test]
    fn the_sample_feature_has_the_id_object_hash_gives_it() {
        // `objectHash({type:"Feature",properties:{type:"run"},geometry:{type:"Point",
        // coordinates:[11.5,47.25]}})` in node.
        let id = feature_id("run", "Point", |w| w.position(&[11.5, 47.25]));
        assert_eq!(id, "90a63ba9c365aa80cde86c337e39571131048ced");
    }
}
