#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'seeds', 'indian_foods.sql');

const SQL_COLUMNS = [
  'name',
  'name_hindi',
  'category',
  'calories_per_serving',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'serving_size',
  'serving_unit',
  'serving_description',
  'is_combo',
  'is_indian',
  'source',
];

const VALID_SERVING_UNITS = new Set([
  'g',
  'gram',
  'kg',
  'ml',
  'l',
  'oz',
  'lb',
  'piece',
  'slice',
  'cup',
  'glass',
  'katori',
  'plate',
  'bowl',
  'scoop',
  'tbsp',
  'tsp',
  'serving',
  'handful',
  'roll',
  'wrap',
]);

const VALID_PHASE1_CATEGORIES = new Set([
  'roti_rice',
  'dal_sabzi',
  'protein',
  'breakfast',
  'snack',
  'drink',
  'dessert',
  'combo',
  'fruit',
  'vegetable',
  'grain',
  'dairy',
  'global_basic',
  'restaurant_fast_food',
  'gym_food',
]);

const VALID_ALIAS_TYPES = new Set([
  'common',
  'hindi',
  'hinglish',
  'regional',
  'brand',
  'misspelling',
  'barcode',
  'other',
]);

const VALID_POPULARITY_TIERS = new Set(['core', 'common', 'niche']);
const VALID_QUALITY_STATUSES = new Set(['verified', 'estimated', 'imported', 'needs_review', 'rejected']);

const HOUSEHOLD_PORTION_UNITS = new Set([
  'piece',
  'slice',
  'cup',
  'glass',
  'katori',
  'plate',
  'bowl',
  'scoop',
  'tbsp',
  'tsp',
  'serving',
  'handful',
  'roll',
  'wrap',
]);

const EXACT_MEASUREMENT_UNITS = new Set(['g', 'gram', 'kg', 'ml', 'l', 'oz', 'lb']);

const UNIT_EQUIVALENTS = {
  g: { grams: 1 },
  gram: { grams: 1 },
  kg: { grams: 1000 },
  oz: { grams: 28.35 },
  lb: { grams: 453.6 },
  ml: { ml: 1 },
  l: { ml: 1000 },
};

const LOW_CALORIE_ALLOWLIST = new Set([
  'black coffee',
  'green tea',
  'tea',
  'coffee',
  'water',
  'diet soda',
  'zero soda',
  'zero calorie soda',
]);

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function readRows(filePath) {
  const absolutePath = path.resolve(filePath || DEFAULT_FILE);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const ext = path.extname(absolutePath).toLowerCase();

  if (ext === '.json') {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { absolutePath, rows: parsed, seed: null, format: 'legacy_json_array' };
    }
    if (!parsed || !Array.isArray(parsed.foods)) {
      throw new Error(`Expected ${absolutePath} to contain a JSON array or a seed object with a foods array`);
    }
    return { absolutePath, rows: parsed.foods, seed: parsed, format: 'phase1_expansion' };
  }

  if (ext === '.sql') {
    return { absolutePath, rows: parseSqlSeed(raw), seed: null, format: 'legacy_sql' };
  }

  throw new Error(`Unsupported file type: ${ext || '(none)'}`);
}

function parseSqlSeed(sql) {
  const uncommentedSql = sql.replace(/--.*$/gm, '');
  const valuesIndex = uncommentedSql.search(/\bVALUES\b/i);
  if (valuesIndex === -1) throw new Error('SQL seed has no VALUES block');

  const rows = [];
  let i = valuesIndex;
  while (i < uncommentedSql.length) {
    if (uncommentedSql[i] === ';') break;
    if (uncommentedSql[i] !== '(') {
      i += 1;
      continue;
    }

    const { tuple, nextIndex } = readTuple(uncommentedSql, i);
    i = nextIndex;

    const fields = splitSqlFields(tuple);
    if (fields.length !== SQL_COLUMNS.length) {
      throw new Error(`Expected ${SQL_COLUMNS.length} fields, found ${fields.length}: (${tuple.slice(0, 120)}...)`);
    }

    const row = {};
    SQL_COLUMNS.forEach((column, index) => {
      row[column] = parseSqlValue(fields[index]);
    });
    rows.push(row);
  }

  return rows;
}

function readTuple(sql, startIndex) {
  let inString = false;
  let tuple = '';

  for (let i = startIndex + 1; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" && inString && next === "'") {
      tuple += "''";
      i += 1;
      continue;
    }

    if (char === "'") {
      inString = !inString;
      tuple += char;
      continue;
    }

    if (char === ')' && !inString) {
      return { tuple, nextIndex: i + 1 };
    }

    tuple += char;
  }

  throw new Error('Unclosed SQL tuple');
}

function splitSqlFields(tuple) {
  const fields = [];
  let inString = false;
  let current = '';

  for (let i = 0; i < tuple.length; i += 1) {
    const char = tuple[i];
    const next = tuple[i + 1];

    if (char === "'" && inString && next === "'") {
      current += "''";
      i += 1;
      continue;
    }

    if (char === "'") {
      inString = !inString;
      current += char;
      continue;
    }

    if (char === ',' && !inString) {
      fields.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current.trim());
  return fields;
}

function parseSqlValue(value) {
  if (/^null$/i.test(value)) return null;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function isInvalidServingUnit(unit) {
  const normalized = String(unit || '').trim().toLowerCase();
  if (!normalized) return true;
  if (VALID_SERVING_UNITS.has(normalized)) return false;
  if (/\(\s*g\s*\)/i.test(normalized)) return true;
  if (/[|/~]/.test(normalized)) return true;
  if (/^(portion|pack|meal|box|packets?)\b/i.test(normalized)) return true;
  return true;
}

function addIssue(issues, type, rowNumber, row, detail) {
  issues.push({
    type,
    row: rowNumber,
    name: row.name || '(missing name)',
    detail,
  });
}

function validateRows(rows) {
  const issues = [];
  const normalizedNames = new Map();
  const categoryCasings = new Map();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const name = String(row.name || '').trim();
    const normalizedName = normalizeName(name);
    const category = String(row.category || '').trim();
    const categoryKey = category.toLowerCase();
    const calories = Number(row.calories_per_serving);
    const protein = Number(row.protein_g);
    const carbs = Number(row.carbs_g);
    const fat = Number(row.fat_g);
    const servingSize = Number(row.serving_size);

    if (!name) addIssue(issues, 'missing_name', rowNumber, row, 'Food row has no name');

    if (normalizedName) {
      const existing = normalizedNames.get(normalizedName) || [];
      existing.push(rowNumber);
      normalizedNames.set(normalizedName, existing);
    }

    if (categoryKey) {
      const casings = categoryCasings.get(categoryKey) || new Set();
      casings.add(category);
      categoryCasings.set(categoryKey, casings);
    }

    if (!Number.isFinite(calories) || !Number.isFinite(protein) || !Number.isFinite(carbs) || !Number.isFinite(fat)) {
      addIssue(issues, 'missing_calories_or_macros', rowNumber, row, 'Calories/protein/carbs/fat must all be numeric');
    }

    if (!Number.isFinite(servingSize) || servingSize <= 0 || isInvalidServingUnit(row.serving_unit)) {
      addIssue(issues, 'invalid_serving_unit', rowNumber, row, `serving_size=${row.serving_size}, serving_unit="${row.serving_unit}"`);
    }

    if (
      Number.isFinite(calories) &&
      calories > 0 &&
      calories < 10 &&
      !LOW_CALORIE_ALLOWLIST.has(normalizedName)
    ) {
      addIssue(issues, 'tiny_calories_per_serving', rowNumber, row, `calories_per_serving=${calories}`);
    }

    if ([protein, carbs, fat].some(value => Number.isFinite(value) && value < 0)) {
      addIssue(issues, 'negative_macro', rowNumber, row, `protein=${protein}, carbs=${carbs}, fat=${fat}`);
    }

    if (Number.isFinite(calories) && calories > 0 && [protein, carbs, fat].every(Number.isFinite)) {
      const macroCalories = (protein * 4) + (carbs * 4) + (fat * 9);
      if (macroCalories > (calories * 1.35) + 20) {
        addIssue(
          issues,
          'impossible_macro_totals',
          rowNumber,
          row,
          `macros imply ${Math.round(macroCalories)} kcal, row says ${calories} kcal`
        );
      }
    }
  });

  for (const [normalizedName, rowNumbers] of normalizedNames.entries()) {
    if (rowNumbers.length > 1) {
      rowNumbers.forEach(rowNumber => {
        addIssue(issues, 'duplicate_normalized_name', rowNumber, rows[rowNumber - 1], `normalized_name="${normalizedName}", rows=${rowNumbers.join(',')}`);
      });
    }
  }

  for (const [categoryKey, casings] of categoryCasings.entries()) {
    if (casings.size > 1) {
      rows.forEach((row, index) => {
        if (String(row.category || '').trim().toLowerCase() === categoryKey) {
          addIssue(issues, 'inconsistent_category_casing', index + 1, row, `category variants: ${Array.from(casings).join(', ')}`);
        }
      });
    }
  }

  return issues;
}

function addExpansionIssue(issues, type, rowNumber, row, detail) {
  addIssue(issues, `phase1_${type}`, rowNumber, row, detail);
}

function validateNumeric(value) {
  return Number.isFinite(Number(value));
}

function effectivePortionValue(portion, row, key) {
  return portion[key] === undefined || portion[key] === null ? row[key] : portion[key];
}

function hasPositiveNumeric(value) {
  return validateNumeric(value) && Number(value) > 0;
}

function assertEquivalentClose(actual, expected) {
  return Math.abs(Number(actual) - expected) <= Math.max(0.5, expected * 0.01);
}

function validateExpansionSeed(seed, rows) {
  const issues = [];
  const normalizedNames = new Map();

  if (!seed.version) {
    issues.push({
      type: 'phase1_missing_version',
      row: 0,
      name: '(seed)',
      detail: 'Seed object must include a version',
    });
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const name = String(row.name || '').trim();
    const normalizedName = String(row.normalized_name || '').trim();
    const category = String(row.category || '').trim();
    const quality = row.quality || {};
    const aliases = Array.isArray(row.aliases) ? row.aliases : null;
    const portions = Array.isArray(row.portions) ? row.portions : null;
    const countryTags = Array.isArray(row.country_tags) ? row.country_tags : null;
    const components = Array.isArray(row.components) ? row.components : [];

    if (!normalizedName) {
      addExpansionIssue(issues, 'missing_normalized_name', rowNumber, row, 'Food row must include normalized_name');
    } else {
      const existing = normalizedNames.get(normalizedName) || [];
      existing.push(rowNumber);
      normalizedNames.set(normalizedName, existing);

      if (normalizedName !== normalizeName(name)) {
        addExpansionIssue(issues, 'normalized_name_mismatch', rowNumber, row, `normalized_name="${normalizedName}", expected="${normalizeName(name)}"`);
      }
    }

    if (!VALID_PHASE1_CATEGORIES.has(category)) {
      addExpansionIssue(issues, 'invalid_category', rowNumber, row, `category="${category}"`);
    }

    if (category !== category.toLowerCase()) {
      addExpansionIssue(issues, 'category_not_normalized', rowNumber, row, `category="${category}"`);
    }

    if (!Number.isInteger(Number(row.search_priority)) || Number(row.search_priority) < 0 || Number(row.search_priority) > 100) {
      addExpansionIssue(issues, 'invalid_search_priority', rowNumber, row, `search_priority=${row.search_priority}`);
    }

    if (!validateNumeric(row.popularity_score) || Number(row.popularity_score) < 0 || Number(row.popularity_score) > 1) {
      addExpansionIssue(issues, 'invalid_popularity_score', rowNumber, row, `popularity_score=${row.popularity_score}`);
    }

    if (row.source !== 'curated_phase1') {
      addExpansionIssue(issues, 'invalid_food_source', rowNumber, row, `source="${row.source}"`);
    }

    if (!aliases) {
      addExpansionIssue(issues, 'aliases_not_array', rowNumber, row, 'aliases must be an array, even when empty');
    } else {
      const seenAliases = new Set();
      aliases.forEach((alias, aliasIndex) => {
        const aliasText = String(alias.alias || '').trim();
        const normalizedAlias = normalizeName(aliasText);
        if (!aliasText) {
          addExpansionIssue(issues, 'missing_alias', rowNumber, row, `alias ${aliasIndex + 1} has no alias text`);
        }
        if (seenAliases.has(normalizedAlias)) {
          addExpansionIssue(issues, 'duplicate_alias', rowNumber, row, `alias="${aliasText}"`);
        }
        seenAliases.add(normalizedAlias);
        if (!alias.language) {
          addExpansionIssue(issues, 'missing_alias_language', rowNumber, row, `alias="${aliasText}"`);
        }
        if (!VALID_ALIAS_TYPES.has(alias.alias_type)) {
          addExpansionIssue(issues, 'invalid_alias_type', rowNumber, row, `alias="${aliasText}", alias_type="${alias.alias_type}"`);
        }
        if (!Number.isInteger(Number(alias.priority)) || Number(alias.priority) < 0 || Number(alias.priority) > 100) {
          addExpansionIssue(issues, 'invalid_alias_priority', rowNumber, row, `alias="${aliasText}", priority=${alias.priority}`);
        }
      });
    }

    if (!portions || portions.length === 0) {
      addExpansionIssue(issues, 'missing_portions', rowNumber, row, 'Each food needs at least one practical portion');
    } else {
      const defaultCount = portions.filter(portion => portion.is_default === true).length;
      if (defaultCount === 0) {
        addExpansionIssue(issues, 'missing_default_portion', rowNumber, row, 'Each food needs one default practical portion');
      }
      if (defaultCount > 1) {
        addExpansionIssue(issues, 'multiple_default_portions', rowNumber, row, `default portions=${defaultCount}`);
      }

      const seenPortions = new Set();
      const hasMetricAnchor = portions.some(portion => EXACT_MEASUREMENT_UNITS.has(String(portion.serving_unit || '').trim().toLowerCase()));
      if (!hasMetricAnchor) {
        addExpansionIssue(issues, 'missing_metric_anchor_portion', rowNumber, row, 'Each food needs at least one exact g/ml/oz/kg/l/lb portion anchor');
      }

      portions.forEach((portion, portionIndex) => {
        const portionName = String(portion.portion_name || '').trim();
        const portionKey = portionName.toLowerCase();
        const portionUnit = String(portion.serving_unit || '').trim().toLowerCase();
        if (!portionName) {
          addExpansionIssue(issues, 'missing_portion_name', rowNumber, row, `portion ${portionIndex + 1} has no portion_name`);
        }
        if (seenPortions.has(portionKey)) {
          addExpansionIssue(issues, 'duplicate_portion_name', rowNumber, row, `portion_name="${portionName}"`);
        }
        seenPortions.add(portionKey);

        if (!validateNumeric(portion.serving_size) || Number(portion.serving_size) <= 0 || isInvalidServingUnit(portion.serving_unit)) {
          addExpansionIssue(issues, 'invalid_portion_unit', rowNumber, row, `portion="${portionName}", serving_size=${portion.serving_size}, serving_unit="${portion.serving_unit}"`);
        }

        if (HOUSEHOLD_PORTION_UNITS.has(portionUnit) && !hasPositiveNumeric(portion.grams_equivalent) && !hasPositiveNumeric(portion.ml_equivalent)) {
          addExpansionIssue(issues, 'missing_household_portion_equivalent', rowNumber, row, `portion="${portionName}" needs grams_equivalent or ml_equivalent`);
        }

        if (portion.is_estimated !== true && portion.is_estimated !== false) {
          addExpansionIssue(issues, 'missing_portion_estimate_flag', rowNumber, row, `portion="${portionName}" needs is_estimated true/false`);
        }

        if (portion.is_estimated === true && !String(portion.portion_note || '').trim()) {
          addExpansionIssue(issues, 'missing_portion_note', rowNumber, row, `portion="${portionName}" is estimated and needs portion_note`);
        }

        if (EXACT_MEASUREMENT_UNITS.has(portionUnit)) {
          const equivalent = UNIT_EQUIVALENTS[portionUnit];
          if (equivalent?.grams) {
            const expectedGrams = Number(portion.serving_size) * equivalent.grams;
            if (!hasPositiveNumeric(portion.grams_equivalent) || !assertEquivalentClose(portion.grams_equivalent, expectedGrams)) {
              addExpansionIssue(issues, 'invalid_metric_gram_equivalent', rowNumber, row, `portion="${portionName}" expected grams_equivalent around ${expectedGrams}`);
            }
          }
          if (equivalent?.ml) {
            const expectedMl = Number(portion.serving_size) * equivalent.ml;
            if (!hasPositiveNumeric(portion.ml_equivalent) || !assertEquivalentClose(portion.ml_equivalent, expectedMl)) {
              addExpansionIssue(issues, 'invalid_metric_ml_equivalent', rowNumber, row, `portion="${portionName}" expected ml_equivalent around ${expectedMl}`);
            }
          }
        }

        ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'].forEach(key => {
          const sourceKey = key === 'calories' ? 'calories_per_serving' : key;
          const value = effectivePortionValue(portion, row, key === 'calories' ? 'calories_per_serving' : key);
          if (!validateNumeric(value)) {
            addExpansionIssue(issues, 'invalid_portion_macro', rowNumber, row, `portion="${portionName}", ${key}=${portion[key] ?? row[sourceKey]}`);
          }
        });
      });
    }

    if (!countryTags || countryTags.length === 0) {
      addExpansionIssue(issues, 'missing_country_tags', rowNumber, row, 'Each food needs at least one country/cuisine tag');
    } else {
      countryTags.forEach(tag => {
        const countryCode = String(tag.country_code || '').trim();
        if (!/^[A-Z]{2,3}$/.test(countryCode)) {
          addExpansionIssue(issues, 'invalid_country_code', rowNumber, row, `country_code="${tag.country_code}"`);
        }
        if (!tag.country_name) {
          addExpansionIssue(issues, 'missing_country_name', rowNumber, row, `country_code="${tag.country_code}"`);
        }
        if (!VALID_POPULARITY_TIERS.has(tag.popularity_tier)) {
          addExpansionIssue(issues, 'invalid_popularity_tier', rowNumber, row, `popularity_tier="${tag.popularity_tier}"`);
        }
      });
    }

    if (quality.source !== 'curated') {
      addExpansionIssue(issues, 'invalid_quality_source', rowNumber, row, `quality.source="${quality.source}"`);
    }
    if (!VALID_QUALITY_STATUSES.has(quality.validation_status)) {
      addExpansionIssue(issues, 'invalid_validation_status', rowNumber, row, `validation_status="${quality.validation_status}"`);
    }
    if (!validateNumeric(quality.confidence_score) || Number(quality.confidence_score) < 0 || Number(quality.confidence_score) > 1) {
      addExpansionIssue(issues, 'invalid_confidence_score', rowNumber, row, `confidence_score=${quality.confidence_score}`);
    }
    if (quality.validation_status === 'estimated' && !quality.notes) {
      addExpansionIssue(issues, 'missing_estimate_notes', rowNumber, row, 'Estimated foods need notes');
    }

    components.forEach((component, componentIndex) => {
      if (!String(component.component_name || '').trim()) {
        addExpansionIssue(issues, 'missing_component_name', rowNumber, row, `component ${componentIndex + 1} has no component_name`);
      }
      if (!validateNumeric(component.quantity) || Number(component.quantity) <= 0) {
        addExpansionIssue(issues, 'invalid_component_quantity', rowNumber, row, `component="${component.component_name}", quantity=${component.quantity}`);
      }
    });
  });

  for (const [normalizedName, rowNumbers] of normalizedNames.entries()) {
    if (rowNumbers.length > 1) {
      rowNumbers.forEach(rowNumber => {
        addExpansionIssue(issues, 'duplicate_normalized_name', rowNumber, rows[rowNumber - 1], `normalized_name="${normalizedName}", rows=${rowNumbers.join(',')}`);
      });
    }
  }

  return issues;
}

function groupByType(issues) {
  return issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {});
}

function main() {
  const filePath = process.argv[2] || DEFAULT_FILE;
  const { absolutePath, rows, seed, format } = readRows(filePath);
  const issues = [
    ...validateRows(rows),
    ...(format === 'phase1_expansion' ? validateExpansionSeed(seed, rows) : []),
  ];
  const counts = groupByType(issues);

  console.log(`Validated ${rows.length} food rows in ${absolutePath}`);
  if (format === 'phase1_expansion') {
    const aliasCount = rows.reduce((sum, row) => sum + (Array.isArray(row.aliases) ? row.aliases.length : 0), 0);
    const portionCount = rows.reduce((sum, row) => sum + (Array.isArray(row.portions) ? row.portions.length : 0), 0);
    const tagCount = rows.reduce((sum, row) => sum + (Array.isArray(row.country_tags) ? row.country_tags.length : 0), 0);
    const componentCount = rows.reduce((sum, row) => sum + (Array.isArray(row.components) ? row.components.length : 0), 0);
    const categories = [...new Set(rows.map(row => row.category))].sort();
    console.log(`Expansion metadata: ${aliasCount} aliases, ${portionCount} portions, ${tagCount} country/cuisine tags, ${rows.length} quality records, ${componentCount} components.`);
    console.log(`Categories covered: ${categories.join(', ')}`);
  }
  if (issues.length === 0) {
    console.log('No food seed issues found.');
    return;
  }

  console.log(`Found ${issues.length} issue(s):`);
  for (const [type, count] of Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`- ${type}: ${count}`);
  }

  console.log('\nFirst 50 issues:');
  issues.slice(0, 50).forEach(issue => {
    console.log(`- [${issue.type}] row ${issue.row}: ${issue.name} — ${issue.detail}`);
  });

  process.exitCode = 1;
}

main();
