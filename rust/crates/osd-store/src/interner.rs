//! String interning.
//!
//! OSM name, website and source-id strings repeat heavily across features, and the
//! TypeScript pipeline holds a separate heap string for each occurrence. Interning
//! collapses them to a `u32` in the property columns.

/// A handle to an interned string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Symbol(pub u32);

/// Append-only string table.
#[derive(Debug, Default)]
pub struct StringInterner {
    // One backing buffer plus (offset, len) pairs, rather than many small `String`
    // allocations.
    _buffer: String,
    _spans: Vec<(u32, u32)>,
}

impl StringInterner {
    /// Intern a string, returning an existing handle when it is already present.
    pub fn intern(&mut self, _value: &str) -> Symbol {
        todo!("hash-lookup then append")
    }

    pub fn resolve(&self, _symbol: Symbol) -> &str {
        todo!("slice the backing buffer")
    }

    pub fn len(&self) -> usize {
        self._spans.len()
    }

    pub fn is_empty(&self) -> bool {
        self._spans.is_empty()
    }
}
