//! Small EARS adaptations over the pinned upstream matcher and regex-syntax APIs.
use wasm_bindgen::prelude::*;

/// Preserve the native substring contract: lowercase each Unicode scalar independently.
#[wasm_bindgen]
pub fn folded(text: &str) -> String {
    text.chars().flat_map(char::to_lowercase).collect()
}

/// A conservative common prefix of every extracted regex prefix. None means verification must scan.
#[wasm_bindgen(js_name = requiredLiteral)]
pub fn required_literal(pattern: &str) -> Option<String> {
    let hir = regex_syntax::Parser::new().parse(pattern).ok()?;
    let sequence = regex_syntax::hir::literal::Extractor::new().extract(&hir);
    let literals = sequence.literals()?;
    let first = literals.first()?.as_bytes();
    let mut length = first.len();
    for literal in literals.iter().skip(1) {
        length = first[..length].iter().zip(literal.as_bytes()).take_while(|(a, b)| a == b).count();
    }
    while std::str::from_utf8(&first[..length]).is_err() { length -= 1; }
    let prefix = folded(std::str::from_utf8(&first[..length]).ok()?);
    (prefix.chars().count() >= 3 && !prefix.contains('\0')).then_some(prefix)
}

#[wasm_bindgen]
pub fn contains(text: &str, needle: &str) -> bool { text.contains(needle) }

#[wasm_bindgen(js_name = containsFolded)]
pub fn contains_folded(text: &str, needle: &str) -> bool { folded(text).contains(needle) }
