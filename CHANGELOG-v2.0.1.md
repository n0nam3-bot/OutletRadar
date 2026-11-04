# Outlet Radar v2.0.1

## Audience-specific comparison offers

- Pass the shopper's selected audience (Men, Women, Kids, Unisex, or All) into both the exact-offer and size-availability endpoints.
- Filter individual retailer listings after exact-model matching so Men/Women comparisons do not include listings explicitly marked PS, GS, Kids, Grade School, Preschool, Youth, Toddler, or Infant.
- Restrict marketplace size quotes to the selected size system. Men's comparisons show Men's/Unisex adult signals only; Women's comparisons show Women's/Unisex adult signals only; Kids comparisons show youth signals only.
- Do not interpret unlabeled numeric size quotes as adult sizes. Keep their status unverified by omitting them from audience-specific size displays.
- Filter seller-provided size labels as well, preventing the UI fallback from reintroducing youth sizes after adult quotes are filtered out.
- Improve StockX, GOAT, and Flight Club size-system normalization using provider size-category metadata plus explicit M/W/Y, GS, and PS markers. Explicit youth markers override contradictory adult fallbacks.
- Version comparison and size caches so older audience-mixed results cannot be reused.
- Display the selected audience in the expanded comparison header.

No database migration or new environment variables are required.
