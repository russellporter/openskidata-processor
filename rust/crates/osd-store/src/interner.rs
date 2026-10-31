//! String interning.
//!
//! OSM name, website and source-id strings repeat heavily across features, and the
//! TypeScript pipeline holds a separate heap string for each occurrence. Interning
//! collapses them to a `u32` in the property columns.

use std::collections::HashMap;

/// A handle to an interned string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Symbol(pub u32);

/// Append-only string table.
///
/// One backing buffer plus `(offset, len)` spans, rather than many small `String`
/// allocations. Strings are never removed, which is what makes the handles stable.
#[derive(Debug, Default)]
pub struct StringInterner {
    buffer: String,
    spans: Vec<(u32, u32)>,
    /// Maps content to its handle. The key is an owned copy, which costs one extra
    /// allocation per *distinct* string; the saving is on the repeats, which dominate.
    lookup: HashMap<String, Symbol>,
}

impl StringInterner {
    /// Interns a string, returning an existing handle when it is already present.
    pub fn intern(&mut self, value: &str) -> Symbol {
        if let Some(&symbol) = self.lookup.get(value) {
            return symbol;
        }

        let offset = self.buffer.len();
        assert!(
            offset + value.len() <= u32::MAX as usize,
            "string interner exceeded u32 addressing"
        );
        self.buffer.push_str(value);

        let symbol = Symbol(self.spans.len() as u32);
        self.spans.push((offset as u32, value.len() as u32));
        self.lookup.insert(value.to_owned(), symbol);
        symbol
    }

    pub fn resolve(&self, symbol: Symbol) -> &str {
        let (offset, len) = self.spans[symbol.0 as usize];
        let start = offset as usize;
        &self.buffer[start..start + len as usize]
    }

    pub fn len(&self) -> usize {
        self.spans.len()
    }

    pub fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }

    /// Resident bytes of string payload and index, for stage memory reporting.
    pub fn heap_bytes(&self) -> usize {
        self.buffer.capacity() + self.spans.capacity() * core::mem::size_of::<(u32, u32)>()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_string_interns_to_the_same_handle() {
        let mut interner = StringInterner::default();
        let first = interner.intern("Oberauer Skiabfahrt");
        let second = interner.intern("Oberauer Skiabfahrt");
        assert_eq!(first, second);
        assert_eq!(interner.len(), 1, "the repeat must not be stored twice");
    }

    #[test]
    fn distinct_strings_resolve_to_themselves() {
        let mut interner = StringInterner::default();
        let a = interner.intern("Zugspitze");
        let b = interner.intern("Garmisch");
        let c = interner.intern("");
        assert_ne!(a, b);
        assert_eq!(interner.resolve(a), "Zugspitze");
        assert_eq!(interner.resolve(b), "Garmisch");
        assert_eq!(interner.resolve(c), "");
        assert_eq!(interner.len(), 3);
    }

    /// Spans index bytes, so a multi-byte character must not be split.
    #[test]
    fn handles_non_ascii_names() {
        let mut interner = StringInterner::default();
        let a = interner.intern("Kitzbühel");
        let b = interner.intern("蔵王温泉スキー場");
        let c = interner.intern("Val d'Isère");
        assert_eq!(interner.resolve(a), "Kitzbühel");
        assert_eq!(interner.resolve(b), "蔵王温泉スキー場");
        assert_eq!(interner.resolve(c), "Val d'Isère");
    }

    /// A shared prefix must not make one string resolve to another's bytes.
    #[test]
    fn prefixes_are_not_confused() {
        let mut interner = StringInterner::default();
        let short = interner.intern("Alpe");
        let long = interner.intern("Alpendorf");
        assert_eq!(interner.resolve(short), "Alpe");
        assert_eq!(interner.resolve(long), "Alpendorf");
    }
}
