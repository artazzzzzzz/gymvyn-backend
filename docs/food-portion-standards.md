# Gymvyn food portion standards

Gymvyn stores food nutrition on the canonical food row, then stores practical serving choices in `food_portions`. Household portions are estimates for macro scaling, not medical-grade measurements.

## Default household units

Use food-specific estimates when available. These defaults are fallbacks for future seed work:

| Unit | Default equivalent |
| --- | --- |
| small katori | 100g or 100ml |
| katori | 150g or 150ml |
| large katori | 200g or 200ml |
| small bowl | 150g or 150ml |
| bowl | 250g or 250ml |
| large bowl | 350g or 350ml |
| small plate | 200g |
| plate | 300g |
| large plate | 450g |
| glass | 250ml |
| cup | 240ml |
| tablespoon / tbsp | 15ml, or about 15g for dense solids |
| teaspoon / tsp | 5ml, or about 5g for dense solids |
| scoop | 30g for whey/protein powder unless food-specific |
| slice | food-specific grams |
| piece | food-specific grams |
| roll / wrap | food-specific grams |
| serving | fallback only; avoid when a clearer unit exists |

## Metric and imperial conversions

Metric and imperial portions should include their base equivalent:

- `1g` = `1` gram
- `100g` = `100` grams
- `1 kg` = `1000` grams
- `100ml` = `100` ml
- `1 l` = `1000` ml
- `1 oz` = `28.35` grams
- `1 lb` = `453.6` grams

The app can scale from these anchors for exact user-entered quantities.

## Seed rules

Each canonical food should have:

1. One default practical portion, usually a household serving.
2. One exact metric anchor where relevant, usually `100g` for solids or `100ml` for liquids.
3. `grams_equivalent` or `ml_equivalent` for every household portion.
4. `is_estimated` set explicitly.
5. `portion_note` whenever `is_estimated` is true.

Food-specific portions override these defaults. For example, a chapati piece is about 35g, a phulka piece about 25g, a naan about 90g, cooked rice is about 150g per katori, milk is 250ml per glass, whey is 30g per scoop, pizza is about 100-120g per slice, and chicken biryani is about 300g per plate.

All values are practical estimates and can vary by home, restaurant, recipe, and serving style.
