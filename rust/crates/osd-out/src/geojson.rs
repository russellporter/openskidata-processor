//! GeoJSON `FeatureCollection` output.
//!
//! Reproduces `src/transforms/FeatureCollection.ts`, which writes one feature per line
//! between a fixed prelude and epilogue. `src/scripts/merge_outputs.ts` splits these files
//! on that separator, so the shape is part of the contract, not an accident of formatting:
//!
//! ```text
//! {"type": "FeatureCollection", "features":[
//! {feature}
//! ,
//! {feature}
//! ]}
//! ```
//!
//! An empty collection is the prelude and epilogue with nothing between them.

use serde_json::{Number, Value};
use std::io::{self, Write};

const OPEN: &str = "{\"type\": \"FeatureCollection\", \"features\":[\n";
const SEPARATOR: &str = "\n,\n";
const CLOSE: &str = "\n]}\n";

/// Rewrites whole-valued floats as integers, the way JavaScript prints them (`2400`, not
/// `2400.0`), so consumers that distinguish integers from floats see what they always have.
/// Negative zero becomes `0`.
pub fn js_style_numbers(value: &mut Value) {
    match value {
        Value::Number(n) => {
            if let Some(f) = n.as_f64()
                && n.is_f64()
                && f.fract() == 0.0
                && f.abs() < 9.0e15
            {
                *value = Value::Number(Number::from(f as i64));
            }
        }
        Value::Array(items) => items.iter_mut().for_each(js_style_numbers),
        Value::Object(map) => map.values_mut().for_each(js_style_numbers),
        _ => {}
    }
}

/// Writes `features` as a `FeatureCollection`, one feature at a time.
pub fn write_feature_collection<W: Write>(
    mut out: W,
    features: impl IntoIterator<Item = Value>,
) -> io::Result<()> {
    let mut wrote_any = false;
    for mut feature in features {
        js_style_numbers(&mut feature);
        out.write_all(if wrote_any { SEPARATOR } else { OPEN }.as_bytes())?;
        wrote_any = true;
        serde_json::to_writer(&mut out, &feature)?;
    }
    if !wrote_any {
        out.write_all(OPEN.as_bytes())?;
    }
    out.write_all(CLOSE.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn render(features: Vec<Value>) -> String {
        let mut out = Vec::new();
        write_feature_collection(&mut out, features).unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn whole_floats_print_as_integers() {
        let text = render(vec![json!({"a": 2400.0, "b": [11.0, 47.5], "c": -0.0})]);
        assert_eq!(
            text.lines().nth(1),
            Some("{\"a\":2400,\"b\":[11,47.5],\"c\":0}")
        );
    }

    #[test]
    fn an_empty_collection_is_still_valid_geojson() {
        let text = render(vec![]);
        assert_eq!(
            text,
            "{\"type\": \"FeatureCollection\", \"features\":[\n\n]}\n"
        );
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["features"], json!([]));
    }

    #[test]
    fn features_are_separated_by_a_comma_on_its_own_line() {
        let text = render(vec![json!({"a": 1}), json!({"b": 2})]);
        assert_eq!(
            text,
            "{\"type\": \"FeatureCollection\", \"features\":[\n{\"a\":1}\n,\n{\"b\":2}\n]}\n"
        );
    }
}
