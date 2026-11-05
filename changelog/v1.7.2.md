# v1.7.2 — Impact verification type fix

- Fixed the production TypeScript build error in `app/layout.tsx`.
- Preserves Impact's exact required `name="impact-site-verification"` and `value="..."` attributes.
- Uses a narrow React attribute type intersection; no database, API, or application behavior changed.
