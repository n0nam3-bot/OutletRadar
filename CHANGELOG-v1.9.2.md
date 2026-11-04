# Outlet Radar v1.9.2

- Expanded product image extraction to recognize more provider-specific and nested image URL fields.
- Catalog image enrichment now covers up to 16 image-less models per uncached browse and includes Flight Club product detail images; successful and unsuccessful detail lookups are cached to avoid repeated credit use.
- Product comparison size lookup now preserves product-level gender when a source listing labels the audience `Unknown`, improving adult/youth size-system interpretation.
- StockX base-type normalization now handles underscore and hyphen variations.
- Availability cache changed to six hours with a new versioned key to prevent older size-system interpretations from being reused.
- Comparison selection collapses the original hero/catalog, keeps a compact “Comparing now” return bar, and automatically scrolls to the comparison panel.
- No database migration or new environment variables required.
- Provider-specific size signals remain distinct: StockX active asks, GOAT availability flags, and Flight Club listed new sizes. They are not checkout guarantees.
