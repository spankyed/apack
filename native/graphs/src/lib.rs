//! Thin synchronous transport for the same seeded Leiden implementation used by the native baseline.
//! No database state, asynchronous work, or fallback partition is owned here.
use leiden_rs::{GraphDataBuilder, Leiden, LeidenConfig};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn communities(edges: &[f64], nodes: u32, resolution: f64, seed: u32) -> Result<Vec<u32>, JsValue> {
    if !resolution.is_finite() || resolution < 0.0 || edges.len() % 3 != 0 {
        return Err(JsValue::from_str("Invalid community input"));
    }
    if nodes == 0 && edges.is_empty() { return Ok(Vec::new()); }
    let mut builder = GraphDataBuilder::new(nodes as usize);
    for edge in edges.chunks_exact(3) {
        let (a, b, weight) = (edge[0], edge[1], edge[2]);
        if !a.is_finite() || !b.is_finite() || a < 0.0 || b < 0.0
            || a.fract() != 0.0 || b.fract() != 0.0 || a >= nodes as f64 || b >= nodes as f64
            || !weight.is_finite() || weight < 0.0 {
            return Err(JsValue::from_str("Invalid community edge"));
        }
        builder.add_edge(a as usize, b as usize, weight)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    }
    let data = builder.build().map_err(|error| JsValue::from_str(&error.to_string()))?;
    let config = LeidenConfig { seed: Some(u64::from(seed)), resolution, max_iterations: 100,
        ..LeidenConfig::default() };
    let found = Leiden::new(config).run(&data).map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok((0..nodes as usize).map(|at| found.partition.community_of(at) as u32).collect())
}
