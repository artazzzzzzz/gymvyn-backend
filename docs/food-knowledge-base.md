# Food knowledge base foundation

Gymvyn keeps `food_database` as the canonical, backward-compatible food table. Existing food search and food logging continue to use its current columns, and `food_logs` remains denormalized with optional `food_id`.

New imports should add metadata in companion tables:

- `food_aliases`: common, Hindi, Hinglish, regional, brand, and misspelling names.
- `food_portions`: household portions and metric equivalents separate from the canonical food row.
- `food_country_tags`: country, cuisine, and popularity tags for regional ranking.
- `food_quality`: source, confidence, validation status, and import notes.
- `food_components`: optional decomposition for combo foods like dal chawal, roti sabzi, biryani, and thali.

Portion standards live in [food-portion-standards.md](food-portion-standards.md). Future seeds should give every household portion a gram or ml estimate and every food a simple metric anchor for scaling.

Import rules:

1. Insert or update one canonical row in `food_database` per real food concept.
2. Keep aliases out of `food_database.name`; put them in `food_aliases`.
3. Keep alternate serving sizes out of canonical food columns; put them in `food_portions`.
4. Mark source and validation status in `food_quality`.
5. Add country/cuisine tags for any regional import batch.
6. For combo foods, keep the loggable combo in `food_database` and optionally add components in `food_components`.
7. Do not import noisy Open Food Facts rows unless they pass the cache validator and get `food_quality.validation_status = 'imported'` or better.
8. Large global imports should be staged and audited before being exposed to search.

Future search should query `food_database.name`, `food_database.normalized_name`, and `food_aliases.normalized_alias`, then rank exact alias/name matches, verified/common foods, India/core foods, and higher popularity scores first.

## Production cleanup workflow

Use `scripts/sql/food_database_cleanup_review.sql` before cleaning existing production foods. Run the read-only audit sections first, deploy OpenFoodFacts cache hardening before deleting any cached OFF rows, and never delete a `food_database` row referenced by `food_logs.food_id`.

Preferred cleanup order:

1. Normalize safe category casing/mapping.
2. Mark questionable rows in `food_quality` as `needs_review`.
3. Lower `search_priority` / `popularity_score` for rows that should not rank.
4. Delete only clearly invalid, unreferenced rows after explicit manual approval.
