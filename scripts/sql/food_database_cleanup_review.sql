-- Gymvyn food_database cleanup review
--
-- Purpose:
--   Review existing dirty food_database rows before any production cleanup.
--   This file does not import foods and does not alter food_logs.
--
-- Safe default:
--   The active statements below are read-only SELECT queries.
--   Cleanup UPDATE / DELETE examples are commented out and must be reviewed,
--   uncommented, and approved by Artaz before use.
--
-- Safety rules:
--   - No DROP.
--   - No TRUNCATE.
--   - No active DELETE.
--   - Do not alter food_logs.
--   - Do not delete rows referenced by food_logs.food_id.

-- ---------------------------------------------------------------------------
-- 1) READ-ONLY AUDIT QUERIES
-- ---------------------------------------------------------------------------

-- 1.1 Overall row counts.
select 'food_database' as table_name, count(*) as row_count from food_database
union all
select 'food_logs', count(*) from food_logs
union all
select 'food_aliases', count(*) from food_aliases
union all
select 'food_portions', count(*) from food_portions
union all
select 'food_country_tags', count(*) from food_country_tags
union all
select 'food_quality', count(*) from food_quality
union all
select 'food_components', count(*) from food_components
order by table_name;

-- 1.2 Rows by source and category.
select source, count(*) as row_count
from food_database
group by source
order by row_count desc, source;

select category, count(*) as row_count
from food_database
group by category
order by row_count desc, category;

-- 1.3 Dirty-row summary using the same rules as scripts/audit-food-database.js.
with food_rows as (
  select
    f.*,
    trim(regexp_replace(lower(coalesce(f.name, '')), '[^a-z0-9]+', ' ', 'g')) as normalized_name_calc,
    lower(trim(coalesce(f.category, ''))) as category_key,
    lower(concat_ws(' ', f.name, f.category, f.serving_description)) as low_text,
    coalesce(l.log_count, 0) as food_log_refs
  from food_database f
  left join (
    select food_id, count(*) as log_count
    from food_logs
    where food_id is not null
    group by food_id
  ) l on l.food_id = f.id
),
duplicate_names as (
  select normalized_name_calc
  from food_rows
  where normalized_name_calc <> ''
  group by normalized_name_calc
  having count(*) > 1
),
category_conflicts as (
  select category_key
  from food_rows
  where category_key <> ''
  group by category_key
  having count(distinct trim(category)) > 1
),
issues as (
  select id, name, source, category, calories_per_serving, serving_size, serving_unit, food_log_refs,
         'invalid_serving_unit' as issue_type
  from food_rows
  where serving_size is null
     or serving_size <= 0
     or trim(coalesce(serving_unit, '')) = ''
     or lower(coalesce(serving_unit, '')) like '%( g)%'
     or lower(coalesce(serving_unit, '')) like '%|%'
     or lower(coalesce(serving_unit, '')) like '%/%'
     or lower(coalesce(serving_unit, '')) like '%~%'

  union all
  select id, name, source, category, calories_per_serving, serving_size, serving_unit, food_log_refs,
         'suspicious_tiny_calories'
  from food_rows
  where calories_per_serving > 0
    and calories_per_serving < 10
    and not (
      low_text like '%black coffee%'
      or low_text like '%green tea%'
      or low_text like '%tea%'
      or low_text like '%coffee%'
      or low_text like '%water%'
      or low_text like '%sparkling water%'
      or low_text like '%soda water%'
      or low_text like '%diet soda%'
      or low_text like '%zero sugar%'
      or low_text like '%zero calorie%'
      or low_text like '%cucumber%'
      or low_text like '%herb%'
      or low_text like '%herbs%'
      or low_text like '%spice%'
      or low_text like '%spices%'
      or low_text like '%seasoning%'
    )

  union all
  select id, name, source, category, calories_per_serving, serving_size, serving_unit, food_log_refs,
         'impossible_macro_totals'
  from food_rows
  where calories_per_serving > 0
    and ((coalesce(protein_g, 0) * 4) + (coalesce(carbs_g, 0) * 4) + (coalesce(fat_g, 0) * 9))
      > ((calories_per_serving * 1.35) + 20)

  union all
  select fr.id, fr.name, fr.source, fr.category, fr.calories_per_serving, fr.serving_size, fr.serving_unit,
         fr.food_log_refs, 'duplicate_normalized_name'
  from food_rows fr
  join duplicate_names d on d.normalized_name_calc = fr.normalized_name_calc

  union all
  select fr.id, fr.name, fr.source, fr.category, fr.calories_per_serving, fr.serving_size, fr.serving_unit,
         fr.food_log_refs, 'category_casing_conflict'
  from food_rows fr
  join category_conflicts c on c.category_key = fr.category_key
)
select
  issue_type,
  count(*) as issue_rows,
  count(distinct id) as distinct_food_rows,
  count(distinct id) filter (where food_log_refs > 0) as dirty_rows_referenced_by_food_logs,
  coalesce(sum(food_log_refs), 0) as total_food_log_refs
from issues
group by issue_type
order by issue_type;

-- 1.4 Distinct dirty rows, bad OpenFoodFacts rows, and food_log references.
with food_rows as (
  select
    f.*,
    trim(regexp_replace(lower(coalesce(f.name, '')), '[^a-z0-9]+', ' ', 'g')) as normalized_name_calc,
    lower(trim(coalesce(f.category, ''))) as category_key,
    lower(concat_ws(' ', f.name, f.category, f.serving_description)) as low_text,
    coalesce(l.log_count, 0) as food_log_refs
  from food_database f
  left join (
    select food_id, count(*) as log_count
    from food_logs
    where food_id is not null
    group by food_id
  ) l on l.food_id = f.id
),
category_conflicts as (
  select category_key
  from food_rows
  where category_key <> ''
  group by category_key
  having count(distinct trim(category)) > 1
),
bad_rows as (
  select id, source, food_log_refs, 'invalid_serving_unit' as reason
  from food_rows
  where serving_size is null
     or serving_size <= 0
     or trim(coalesce(serving_unit, '')) = ''
     or lower(coalesce(serving_unit, '')) like '%( g)%'
     or lower(coalesce(serving_unit, '')) like '%|%'
     or lower(coalesce(serving_unit, '')) like '%/%'
     or lower(coalesce(serving_unit, '')) like '%~%'
  union all
  select id, source, food_log_refs, 'suspicious_tiny_calories'
  from food_rows
  where calories_per_serving > 0
    and calories_per_serving < 10
    and not (
      low_text like '%black coffee%' or low_text like '%green tea%' or low_text like '%tea%'
      or low_text like '%coffee%' or low_text like '%water%' or low_text like '%sparkling water%'
      or low_text like '%soda water%' or low_text like '%diet soda%' or low_text like '%zero sugar%'
      or low_text like '%zero calorie%' or low_text like '%cucumber%' or low_text like '%herb%'
      or low_text like '%herbs%' or low_text like '%spice%' or low_text like '%spices%'
      or low_text like '%seasoning%'
    )
  union all
  select id, source, food_log_refs, 'impossible_macro_totals'
  from food_rows
  where calories_per_serving > 0
    and ((coalesce(protein_g, 0) * 4) + (coalesce(carbs_g, 0) * 4) + (coalesce(fat_g, 0) * 9))
      > ((calories_per_serving * 1.35) + 20)
  union all
  select fr.id, fr.source, fr.food_log_refs, 'category_casing_conflict'
  from food_rows fr
  join category_conflicts c on c.category_key = fr.category_key
),
dirty_rows as (
  select
    id,
    max(food_log_refs) as food_log_refs,
    bool_or(lower(coalesce(source, '')) = 'openfoodfacts') as is_openfoodfacts
  from bad_rows
  group by id
)
select 'all_dirty_distinct_rows' as metric, count(*)::text as value from dirty_rows
union all
select 'dirty_rows_referenced_by_food_logs', count(*)::text from dirty_rows where food_log_refs > 0
union all
select 'total_food_log_refs_to_dirty_rows', coalesce(sum(food_log_refs), 0)::text from dirty_rows
union all
select 'bad_openfoodfacts_distinct_rows', count(*)::text from dirty_rows where is_openfoodfacts
union all
select 'bad_openfoodfacts_referenced_by_food_logs', count(*)::text from dirty_rows where is_openfoodfacts and food_log_refs > 0;

-- 1.5 Exact dirty rows referenced by food_logs.
with referenced_foods as (
  select food_id, count(*) as food_log_refs
  from food_logs
  where food_id is not null
  group by food_id
)
select
  f.id,
  f.name,
  f.source,
  f.category,
  f.calories_per_serving,
  f.serving_size,
  f.serving_unit,
  r.food_log_refs
from food_database f
join referenced_foods r on r.food_id = f.id
where lower(trim(coalesce(f.category, ''))) in (
  select lower(trim(category))
  from food_database
  group by lower(trim(category))
  having count(distinct trim(category)) > 1
)
order by r.food_log_refs desc, f.name;

-- 1.6 Optional deletion candidate review only: bad OpenFoodFacts rows that are
-- unreferenced by food_logs. Review these rows manually before deleting.
with referenced_foods as (
  select distinct food_id
  from food_logs
  where food_id is not null
),
food_rows as (
  select
    f.*,
    lower(concat_ws(' ', f.name, f.category, f.serving_description)) as low_text
  from food_database f
),
bad_openfoodfacts as (
  select distinct f.*
  from food_rows f
  where lower(coalesce(f.source, '')) = 'openfoodfacts'
    and not exists (select 1 from referenced_foods r where r.food_id = f.id)
    and (
      f.serving_size is null
      or f.serving_size <= 0
      or trim(coalesce(f.serving_unit, '')) = ''
      or lower(coalesce(f.serving_unit, '')) like '%( g)%'
      or lower(coalesce(f.serving_unit, '')) like '%|%'
      or lower(coalesce(f.serving_unit, '')) like '%/%'
      or lower(coalesce(f.serving_unit, '')) like '%~%'
      or (
        f.calories_per_serving > 0
        and f.calories_per_serving < 10
        and not (
          low_text like '%black coffee%' or low_text like '%green tea%' or low_text like '%tea%'
          or low_text like '%coffee%' or low_text like '%water%' or low_text like '%sparkling water%'
          or low_text like '%soda water%' or low_text like '%diet soda%' or low_text like '%zero sugar%'
          or low_text like '%zero calorie%' or low_text like '%cucumber%' or low_text like '%herb%'
          or low_text like '%herbs%' or low_text like '%spice%' or low_text like '%spices%'
          or low_text like '%seasoning%'
        )
      )
      or (
        f.calories_per_serving > 0
        and ((coalesce(f.protein_g, 0) * 4) + (coalesce(f.carbs_g, 0) * 4) + (coalesce(f.fat_g, 0) * 9))
          > ((f.calories_per_serving * 1.35) + 20)
      )
    )
)
select
  id,
  name,
  category,
  calories_per_serving,
  protein_g,
  carbs_g,
  fat_g,
  serving_size,
  serving_unit,
  brand,
  barcode,
  off_id
from bad_openfoodfacts
order by calories_per_serving asc, name;

-- ---------------------------------------------------------------------------
-- 2) SAFE NORMALIZATION UPDATES - REVIEW, THEN UNCOMMENT
-- ---------------------------------------------------------------------------

-- Category normalization is low risk because food_logs store denormalized
-- logged food data, and current food search does not require exact title-case
-- category names. Run only after reviewing the audit output above.
--
-- begin;
--
-- update food_database
-- set category = case
--   when lower(trim(category)) = 'protein' then 'protein'
--   when lower(trim(category)) = 'beverages' then 'drink'
--   when lower(trim(category)) = 'grains' then 'grain'
--   when lower(trim(category)) = 'snacks' then 'snack'
--   when lower(trim(category)) = 'fruits' then 'fruit'
--   when lower(trim(category)) = 'other' then 'other'
--   else category
-- end
-- where category in ('Protein', 'Beverages', 'Grains', 'Snacks', 'Fruits', 'Other')
-- returning id, name, source, category;
--
-- rollback;
-- -- Change rollback to commit only after reviewing the returned rows.

-- ---------------------------------------------------------------------------
-- 3) OPTIONAL QUARANTINE UPDATES - REVIEW, THEN UNCOMMENT
-- ---------------------------------------------------------------------------

-- Quarantine means: keep the row for compatibility, mark it needs_review, and
-- lower its future ranking. This is preferred for any row referenced by logs.
-- It is also a safe first step before any deletion.
--
-- begin;
--
-- create temporary table food_cleanup_candidates on commit drop as
--   select distinct f.id
--   from food_database f
--   where lower(coalesce(f.source, '')) = 'openfoodfacts'
--     and (
--       f.serving_size is null
--       or f.serving_size <= 0
--       or trim(coalesce(f.serving_unit, '')) = ''
--       or lower(coalesce(f.serving_unit, '')) like '%( g)%'
--       or lower(coalesce(f.serving_unit, '')) like '%|%'
--       or lower(coalesce(f.serving_unit, '')) like '%/%'
--       or lower(coalesce(f.serving_unit, '')) like '%~%'
--       or (f.calories_per_serving > 0 and f.calories_per_serving < 10)
--       or (
--         f.calories_per_serving > 0
--         and ((coalesce(f.protein_g, 0) * 4) + (coalesce(f.carbs_g, 0) * 4) + (coalesce(f.fat_g, 0) * 9))
--           > ((f.calories_per_serving * 1.35) + 20)
--       )
--     );
--
-- update food_database f
-- set search_priority = -100,
--     popularity_score = 0
-- from food_cleanup_candidates c
-- where f.id = c.id
-- returning f.id, f.name, f.source, f.search_priority, f.popularity_score;
--
-- insert into food_quality (
--   food_id, source, source_detail, confidence_score, validation_status, notes
-- )
-- select
--   c.id,
--   'cleanup_audit',
--   'scripts/sql/food_database_cleanup_review.sql',
--   0.1,
--   'needs_review',
--   'Flagged by production food_database cleanup audit for invalid serving unit, suspicious tiny calories, or impossible macro totals.'
-- from food_cleanup_candidates c
-- on conflict (food_id, source, (coalesce(source_detail, ''))) do update
-- set confidence_score = excluded.confidence_score,
--     validation_status = excluded.validation_status,
--     notes = excluded.notes;
--
-- rollback;
-- -- Change rollback to commit only after reviewing the returned rows.

-- ---------------------------------------------------------------------------
-- 4) OPTIONAL DELETION CANDIDATES - MANUAL APPROVAL ONLY
-- ---------------------------------------------------------------------------

-- Do not run this until:
--   1. Railway has deployed the OpenFoodFacts cache hardening.
--   2. The candidate list in section 1.6 has been reviewed.
--   3. Artaz explicitly approves deleting unreferenced bad OpenFoodFacts rows.
--
-- This block intentionally refuses to delete any row referenced by food_logs.
--
-- begin;
--
-- with referenced_foods as (
--   select distinct food_id
--   from food_logs
--   where food_id is not null
-- ),
-- deletion_candidates as (
--   select distinct f.id
--   from food_database f
--   where lower(coalesce(f.source, '')) = 'openfoodfacts'
--     and not exists (select 1 from referenced_foods r where r.food_id = f.id)
--     and (
--       f.serving_size is null
--       or f.serving_size <= 0
--       or trim(coalesce(f.serving_unit, '')) = ''
--       or lower(coalesce(f.serving_unit, '')) like '%( g)%'
--       or lower(coalesce(f.serving_unit, '')) like '%|%'
--       or lower(coalesce(f.serving_unit, '')) like '%/%'
--       or lower(coalesce(f.serving_unit, '')) like '%~%'
--       or (f.calories_per_serving > 0 and f.calories_per_serving < 10)
--       or (
--         f.calories_per_serving > 0
--         and ((coalesce(f.protein_g, 0) * 4) + (coalesce(f.carbs_g, 0) * 4) + (coalesce(f.fat_g, 0) * 9))
--           > ((f.calories_per_serving * 1.35) + 20)
--       )
--     )
-- )
-- delete from food_database f
-- using deletion_candidates d
-- where f.id = d.id
-- returning f.id, f.name, f.source, f.category, f.calories_per_serving, f.serving_size, f.serving_unit;
--
-- rollback;
-- -- Change rollback to commit only after explicit manual approval.
