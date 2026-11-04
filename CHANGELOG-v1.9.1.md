# Outlet Radar v1.9.1

- Removed the nearby physical-store directory and its navigation/footer links. The app focuses on product discovery and online retailer comparisons.
- Changed catalog refinements to keep products whose size, color, audience, price or sale attributes are not supplied by providers as clearly labelled possible matches; known mismatches are still excluded.
- Promoted products with confirmed attribute matches above products with incomplete source metadata.
- Aggregated size and color attributes from product-level and retailer-listing records.
- Avoided inferring `onSale: false` when a provider supplied no price or sale signal.
- Changed product image tiles to square, padded frames with `object-fit: contain` to show the full provided image consistently.
- No database migration or new environment variables required.
- No SQL migration or new environment variables required.
