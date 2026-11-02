//! JavaScript's string-to-number conversions.
//!
//! Numeric OSM tags (`aerialway:occupancy`, `aerialway:duration`, ...) reach upstream's
//! output through `Number()`, `parseFloat()` and `parseInt()`, and their quirks are visible
//! in the data: an empty `aerialway:occupancy` is `0`, `0x10` is `16`, `1e3` is `1000`, and
//! `5:` is `NaN`. These are ported rather than approximated with Rust's own parsers, which
//! accept different things (`inf`, `nan`) and reject others (`0x10`, `""`).

/// JavaScript's whitespace and line terminators, which is not the same set as Unicode's
/// `White_Space` (it includes U+FEFF and excludes U+0085).
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// `String.prototype.trim`: strips JavaScript whitespace and line terminators from both
/// ends. Not the same set as Rust's `str::trim`, which uses Unicode `White_Space`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// The length in bytes of the longest prefix of `s` that is a decimal literal
/// (`StrDecimalLiteral`), or `None`. `Infinity` is a literal.
fn decimal_literal_prefix(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut i = 0;
    if matches!(bytes.first(), Some(b'+' | b'-')) {
        i += 1;
    }
    if s[i..].starts_with("Infinity") {
        return Some(i + "Infinity".len());
    }
    let digits = |from: usize| {
        bytes[from..]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count()
    };

    let int_digits = digits(i);
    i += int_digits;
    let mut frac_digits = 0;
    if bytes.get(i) == Some(&b'.') {
        frac_digits = digits(i + 1);
        // A trailing dot is part of the literal when digits precede it ("5."), and a
        // leading dot needs digits after it (".5"); a lone "." is nothing.
        if int_digits > 0 || frac_digits > 0 {
            i += 1 + frac_digits;
        }
    }
    if int_digits == 0 && frac_digits == 0 {
        return None;
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        let mut j = i + 1;
        if matches!(bytes.get(j), Some(b'+' | b'-')) {
            j += 1;
        }
        let exp_digits = digits(j);
        if exp_digits > 0 {
            i = j + exp_digits;
        }
    }
    Some(i)
}

fn parse_decimal_literal(literal: &str) -> f64 {
    match literal {
        "Infinity" | "+Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        // Rust's parser is correctly rounded, like V8's, and accepts "5." and ".5".
        _ => literal.parse().unwrap_or(f64::NAN),
    }
}

/// `Number(s)`.
pub fn number(s: &str) -> f64 {
    let s = s.trim_matches(is_js_space);
    if s.is_empty() {
        return 0.0;
    }

    let radix = match s.as_bytes() {
        [b'0', b'x' | b'X', ..] => Some(16),
        [b'0', b'o' | b'O', ..] => Some(8),
        [b'0', b'b' | b'B', ..] => Some(2),
        _ => None,
    };
    if let Some(radix) = radix {
        let digits = &s[2..];
        if digits.is_empty() {
            return f64::NAN;
        }
        // Accumulating in f64 matches V8 for the magnitudes tags carry.
        let mut value = 0.0f64;
        for c in digits.chars() {
            match c.to_digit(radix) {
                Some(d) => value = value * f64::from(radix) + f64::from(d),
                None => return f64::NAN,
            }
        }
        return value;
    }

    match decimal_literal_prefix(s) {
        Some(len) if len == s.len() => parse_decimal_literal(s),
        _ => f64::NAN,
    }
}

/// `parseFloat(s)`.
pub fn parse_float(s: &str) -> f64 {
    let s = s.trim_start_matches(is_js_space);
    match decimal_literal_prefix(s) {
        Some(len) => parse_decimal_literal(&s[..len]),
        None => f64::NAN,
    }
}

/// `parseInt(s)` with no radix: decimal, unless the digits start with `0x`.
pub fn parse_int(s: &str) -> f64 {
    let s = s.trim_start_matches(is_js_space);
    let (negative, s) = match s.as_bytes().first() {
        Some(b'-') => (true, &s[1..]),
        Some(b'+') => (false, &s[1..]),
        _ => (false, s),
    };
    let (radix, s) = match s.as_bytes() {
        [b'0', b'x' | b'X', ..] => (16, &s[2..]),
        _ => (10, s),
    };

    let mut value = 0.0f64;
    let mut any = false;
    for c in s.chars() {
        match c.to_digit(radix) {
            Some(d) => {
                value = value * f64::from(radix) + f64::from(d);
                any = true;
            }
            None => break,
        }
    }
    if !any {
        return f64::NAN;
    }
    if negative { -value } else { value }
}

/// `Math.round`, which rounds ties toward positive infinity (Rust's `round` rounds them
/// away from zero, so `-2.5` differs).
pub fn round(x: f64) -> f64 {
    if !x.is_finite() || x.fract() == 0.0 {
        return x;
    }
    let floor = x.floor();
    let rounded = if x - floor >= 0.5 { floor + 1.0 } else { floor };
    // Math.round(-0.4) is -0; keep the sign so a later `=== 0` and 1/x behave alike.
    if rounded == 0.0 && x < 0.0 {
        -0.0
    } else {
        rounded
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_follows_javascript() {
        assert_eq!(number(""), 0.0);
        assert_eq!(number("   "), 0.0);
        assert_eq!(number(" 5 "), 5.0);
        assert_eq!(number("0x10"), 16.0);
        assert_eq!(number("0b11"), 3.0);
        assert_eq!(number("0o17"), 15.0);
        assert_eq!(number("1e3"), 1000.0);
        assert_eq!(number(".5"), 0.5);
        assert_eq!(number("5."), 5.0);
        assert_eq!(number("+5"), 5.0);
        assert_eq!(number("-3"), -3.0);
        assert_eq!(number("07"), 7.0);
        assert_eq!(number("Infinity"), f64::INFINITY);
        assert_eq!(number("-Infinity"), f64::NEG_INFINITY);
        assert_eq!(number("1e400"), f64::INFINITY);
        for nan in [
            "NaN", "inf", "infinity", "1_0", "1,5", "5 min", "0x", "0xg", "-0x10", ".", "e5", "1e",
            "5:30",
        ] {
            assert!(number(nan).is_nan(), "Number({nan:?}) should be NaN");
        }
    }

    #[test]
    fn parse_float_takes_the_longest_numeric_prefix() {
        assert_eq!(parse_float("5 min"), 5.0);
        assert_eq!(parse_float("0x10"), 0.0);
        assert_eq!(parse_float("  1.5e2xyz"), 150.0);
        assert_eq!(parse_float("1e"), 1.0);
        assert_eq!(parse_float("Infinity and beyond"), f64::INFINITY);
        assert!(parse_float("").is_nan());
        assert!(parse_float("abc").is_nan());
        assert!(parse_float(".").is_nan());
    }

    #[test]
    fn parse_int_reads_a_decimal_prefix_unless_hex() {
        assert_eq!(parse_int("42abc"), 42.0);
        assert_eq!(parse_int("1.5"), 1.0);
        assert_eq!(parse_int("-7"), -7.0);
        assert_eq!(parse_int("0x1f"), 31.0);
        assert_eq!(parse_int("  9"), 9.0);
        assert!(parse_int("").is_nan());
        assert!(parse_int("x1").is_nan());
        assert!(parse_int("-").is_nan());
    }

    #[test]
    fn round_sends_ties_toward_positive_infinity() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(-0.5), 0.0);
        assert!(round(-0.4).is_sign_negative());
        assert_eq!(round(7.5 * 60.0), 450.0);
    }
}
