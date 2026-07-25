#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { createClient } = require('@supabase/supabase-js');

const PAGE_SIZE = 1000;

const LOW_CALORIE_TERMS = [
  'black coffee',
  'green tea',
  'tea',
  'coffee',
  'water',
  'sparkling water',
  'soda water',
  'diet soda',
  'zero sugar',
  'zero calorie',
  'cucumber',
  'herb',
  'herbs',
  'spice',
  'spices',
  'seasoning',
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isBrokenServingUnit(unit) {
  const normalized = String(unit || '').trim().toLowerCase();
  if (!normalized) return true;
  if (/\(\s*g\s*\)/i.test(normalized)) return true;
  if (/[|/~]/.test(normalized)) return true;
  if (/^(portion|pack|meal|box|serving|packets?)\b.*\(\s*g\s*\)/i.test(normalized)) return true;
  return false;
}

function isLowCalorieException(row) {
  const text = normalizeText(`${row.name} ${row.category} ${row.serving_description}`);
  return LOW_CALORIE_TERMS.some(term => text.includes(term));
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = String(row[key] || '(blank)');
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function addIssue(issues, row, type, detail) {
  issues.push({
    type,
    id: row.id,
    name: row.name || '(missing name)',
    source: row.source || '(blank)',
    category: row.category || '(blank)',
    calories_per_serving: row.calories_per_serving,
    serving_size: row.serving_size,
    serving_unit: row.serving_unit,
    detail,
  });
}

async function fetchAllFoodRows(supabase) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('food_database')
      .select('id,name,category,calories_per_serving,protein_g,carbs_g,fat_g,serving_size,serving_unit,serving_description,source,created_at,barcode,off_id,brand')
      .range(from, to);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function auditRows(rows) {
  const issues = [];
  const names = new Map();
  const categoryCasings = new Map();

  rows.forEach(row => {
    const normalizedName = normalizeText(row.name);
    const category = String(row.category || '').trim();
    const categoryKey = category.toLowerCase();
    const calories = Number(row.calories_per_serving);
    const protein = Number(row.protein_g);
    const carbs = Number(row.carbs_g);
    const fat = Number(row.fat_g);
    const servingSize = Number(row.serving_size);

    if (normalizedName) {
      const existing = names.get(normalizedName) || [];
      existing.push(row);
      names.set(normalizedName, existing);
    }

    if (categoryKey) {
      const casings = categoryCasings.get(categoryKey) || new Set();
      casings.add(category);
      categoryCasings.set(categoryKey, casings);
    }

    if (!Number.isFinite(servingSize) || servingSize <= 0 || isBrokenServingUnit(row.serving_unit)) {
      addIssue(issues, row, 'invalid_serving_unit', `serving_size=${row.serving_size}, serving_unit="${row.serving_unit}"`);
    }

    if (Number.isFinite(calories) && calories > 0 && calories < 10 && !isLowCalorieException(row)) {
      addIssue(issues, row, 'suspicious_tiny_calories', `calories_per_serving=${calories}`);
    }

    if (Number.isFinite(calories) && calories > 0 && [protein, carbs, fat].every(Number.isFinite)) {
      const macroCalories = (protein * 4) + (carbs * 4) + (fat * 9);
      if (macroCalories > (calories * 1.35) + 20) {
        addIssue(issues, row, 'impossible_macro_totals', `macros imply ${Math.round(macroCalories)} kcal`);
      }
    }
  });

  for (const [normalizedName, duplicates] of names.entries()) {
    if (duplicates.length > 1) {
      duplicates.forEach(row => {
        addIssue(issues, row, 'duplicate_normalized_name', `normalized_name="${normalizedName}", duplicate_count=${duplicates.length}`);
      });
    }
  }

  for (const [categoryKey, casings] of categoryCasings.entries()) {
    if (casings.size > 1) {
      rows.forEach(row => {
        if (String(row.category || '').trim().toLowerCase() === categoryKey) {
          addIssue(issues, row, 'category_casing_conflict', `category variants: ${Array.from(casings).join(', ')}`);
        }
      });
    }
  }

  return issues;
}

function printObject(title, object) {
  console.log(`\n${title}`);
  const entries = Object.entries(object).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    console.log('(none)');
    return;
  }
  entries.forEach(([key, value]) => console.log(`- ${key}: ${value}`));
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. This script is read-only and does not use SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const rows = await fetchAllFoodRows(supabase);
  const issues = auditRows(rows);
  const issueCounts = countBy(issues, 'type');
  const offRows = rows.filter(row => String(row.source || '').toLowerCase() === 'openfoodfacts');

  console.log('Food database quality audit');
  console.log(`Total food_database rows: ${rows.length}`);
  console.log(`Open Food Facts cached rows: ${offRows.length}`);
  printObject('Rows by source', countBy(rows, 'source'));
  printObject('Rows by category', countBy(rows, 'category'));
  printObject('Issues by type', issueCounts);

  console.log('\nTop 50 suspicious rows to review');
  issues.slice(0, 50).forEach((issue, index) => {
    console.log(
      `${index + 1}. [${issue.type}] ${issue.name} | source=${issue.source} | category=${issue.category} | ` +
      `cal=${issue.calories_per_serving} | serving=${issue.serving_size} ${issue.serving_unit || ''} | ${issue.detail}`
    );
  });

  if (issues.length === 0) {
    console.log('No quality issues found.');
  } else {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
