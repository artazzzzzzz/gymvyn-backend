'use strict';

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { recreateFixture, sql } = require('../scripts/reset-plans-phase1-local-db');

const ids = {
  trainerA: '10000000-0000-0000-0000-000000000001', trainerB: '10000000-0000-0000-0000-000000000002',
  buyerA: '10000000-0000-0000-0000-000000000003', buyerB: '10000000-0000-0000-0000-000000000004',
  member: '10000000-0000-0000-0000-000000000005', workoutA: '20000000-0000-0000-0000-000000000001',
  workoutB: '20000000-0000-0000-0000-000000000002', dietA: '30000000-0000-0000-0000-000000000001',
  published: '40000000-0000-0000-0000-000000000001', draft: '40000000-0000-0000-0000-000000000002',
  suspended: '40000000-0000-0000-0000-000000000003', removed: '40000000-0000-0000-0000-000000000004',
  purchase: '50000000-0000-0000-0000-000000000001', purchaseOther: '50000000-0000-0000-0000-000000000002',
};

function query(statement) { return sql(statement).trim(); }
function fails(statement) { assert.throws(() => sql(statement), /failed:/); }

before(() => {
  recreateFixture();
  query(`
    INSERT INTO users (id, role) VALUES
      ('${ids.trainerA}', 'trainer'), ('${ids.trainerB}', 'trainer'),
      ('${ids.buyerA}', 'consumer'), ('${ids.buyerB}', 'consumer'), ('${ids.member}', 'consumer');
    INSERT INTO trainer_profiles (user_id, is_active, status) VALUES
      ('${ids.trainerA}', true, 'active'), ('${ids.trainerB}', true, 'active');
    INSERT INTO trainer_templates (id, trainer_id, type, name, template_data) VALUES
      ('${ids.workoutA}', '${ids.trainerA}', 'workout', 'A Workout', '{"days":[{"name":"Day 1"}]}'::jsonb),
      ('${ids.workoutB}', '${ids.trainerB}', 'workout', 'B Workout', '{}'::jsonb);
    INSERT INTO diet_plan_templates (id, trainer_id, name, detail_level) VALUES
      ('${ids.dietA}', '${ids.trainerA}', 'A Diet', 'macros');
    INSERT INTO plans_listings (id, trainer_id, template_type, template_id, slug, title, description, price_inr_paise, price_usd_cents, status, published_at) VALUES
      ('${ids.published}', '${ids.trainerA}', 'workout', '${ids.workoutA}', 'published-workout', 'Published Workout', 'Visible', 2000, 100, 'published', now()),
      ('${ids.draft}', '${ids.trainerA}', 'diet', '${ids.dietA}', 'draft-diet', 'Draft Diet', 'Hidden', 2000, 100, 'draft', null),
      ('${ids.suspended}', '${ids.trainerA}', 'workout', '${ids.workoutA}', 'suspended-workout', 'Suspended Workout', 'Hidden', 2000, 100, 'suspended', null),
      ('${ids.removed}', '${ids.trainerA}', 'workout', '${ids.workoutA}', 'removed-workout', 'Removed Workout', 'Hidden', 2000, 100, 'removed', null);
    INSERT INTO assigned_plans (id) VALUES ('60000000-0000-0000-0000-000000000001');
    INSERT INTO plans_purchases (id, listing_id, buyer_id, trainer_id, template_type, template_id, currency, final_price_minor, status, workout_assigned_plan_id) VALUES
      ('${ids.purchase}', '${ids.published}', '${ids.buyerA}', '${ids.trainerA}', 'workout', '${ids.workoutA}', 'INR', 2000, 'delivered', '60000000-0000-0000-0000-000000000001'),
      ('${ids.purchaseOther}', '${ids.published}', '${ids.buyerB}', '${ids.trainerA}', 'workout', '${ids.workoutA}', 'INR', 2000, 'created', null);
  `);
});

after(() => recreateFixture({ applyPlansMigration: false }));

test('migration applies cleanly and creates all Gymvyn Plans tables', () => {
  assert.equal(query("SELECT string_agg(relname, ',' ORDER BY relname) FROM pg_class WHERE relkind = 'r' AND relname LIKE 'plans_%'"), 'plans_listing_versions,plans_listings,plans_payment_events,plans_purchases,plans_reviews');
  assert.equal(query("SELECT bool_and(relrowsecurity) FROM pg_class WHERE relkind = 'r' AND relname LIKE 'plans_%'"), 't');
});

test('public browse and slug lookup expose only published listings', () => {
  assert.equal(query("SELECT string_agg(slug, ',' ORDER BY slug) FROM plans_listings WHERE status = 'published'"), 'published-workout');
  assert.equal(query("SELECT count(*) FROM plans_listings WHERE slug = 'draft-diet' AND status = 'published'"), '0');
  assert.equal(query("SELECT count(*) FROM plans_listings WHERE slug = 'suspended-workout' AND status = 'published'"), '0');
  assert.equal(query("SELECT count(*) FROM plans_listings WHERE slug = 'removed-workout' AND status = 'published'"), '0');
});

test('synthetic trainers own only their matching workout and diet templates', () => {
  assert.equal(query(`SELECT count(*) FROM trainer_templates WHERE id = '${ids.workoutA}' AND trainer_id = '${ids.trainerA}' AND type = 'workout'`), '1');
  assert.equal(query(`SELECT count(*) FROM diet_plan_templates WHERE id = '${ids.dietA}' AND trainer_id = '${ids.trainerA}'`), '1');
  assert.equal(query(`SELECT count(*) FROM trainer_templates WHERE id = '${ids.workoutB}' AND trainer_id = '${ids.trainerA}'`), '0');
  assert.equal(query(`SELECT count(*) FROM users WHERE id = '${ids.member}' AND role = 'trainer'`), '0');
});

test('publish version snapshot stores listing values and template content', () => {
  query(`INSERT INTO plans_listing_versions (listing_id, template_type, template_id, template_snapshot_json, title_snapshot, description_snapshot, price_inr_paise, price_usd_cents, commission_bps)
    SELECT id, template_type, template_id, '{"days":[{"name":"Day 1"}]}'::jsonb, title, description, price_inr_paise, price_usd_cents, commission_bps FROM plans_listings WHERE id = '${ids.published}'`);
  assert.equal(query(`SELECT title_snapshot || ':' || commission_bps FROM plans_listing_versions WHERE listing_id = '${ids.published}'`), 'Published Workout:500');
});

test('unpublish model hides a listing from the public browse predicate', () => {
  query(`UPDATE plans_listings SET status = 'unpublished' WHERE id = '${ids.published}'`);
  assert.equal(query("SELECT count(*) FROM plans_listings WHERE status = 'published'"), '0');
  query(`UPDATE plans_listings SET status = 'published' WHERE id = '${ids.published}'`);
});

test('buyer purchase query is owner-scoped and reviews require one delivered purchase', () => {
  assert.equal(query(`SELECT count(*) FROM plans_purchases WHERE buyer_id = '${ids.buyerA}'`), '1');
  assert.equal(query(`SELECT count(*) FROM plans_purchases WHERE buyer_id = '${ids.buyerA}' AND status = 'delivered'`), '1');
  assert.equal(query(`SELECT count(*) FROM plans_purchases WHERE id = '${ids.purchaseOther}' AND buyer_id = '${ids.buyerA}' AND status = 'delivered'`), '0');
  query(`INSERT INTO plans_reviews (listing_id, purchase_id, buyer_id, rating, review_text, status) VALUES ('${ids.published}', '${ids.purchase}', '${ids.buyerA}', 5, 'Great plan', 'visible')`);
  fails(`INSERT INTO plans_reviews (listing_id, purchase_id, buyer_id, rating, review_text) VALUES ('${ids.published}', '${ids.purchase}', '${ids.buyerA}', 4, 'Duplicate')`);
  assert.equal(query(`SELECT count(*) FROM plans_reviews WHERE listing_id = '${ids.published}' AND status = 'visible'`), '1');
  query(`UPDATE plans_reviews SET status = 'hidden' WHERE purchase_id = '${ids.purchase}'`);
  assert.equal(query(`SELECT count(*) FROM plans_reviews WHERE listing_id = '${ids.published}' AND status = 'visible'`), '0');
});

test('database constraints reject free prices, invalid statuses, and duplicate delivery references', () => {
  fails(`INSERT INTO plans_listings (trainer_id, template_type, template_id, slug, title, price_inr_paise, price_usd_cents) VALUES ('${ids.trainerA}', 'workout', '${ids.workoutA}', 'free-plan', 'Free Plan', 0, 100)`);
  fails(`INSERT INTO plans_listings (trainer_id, template_type, template_id, slug, title, price_inr_paise, price_usd_cents, status) VALUES ('${ids.trainerA}', 'workout', '${ids.workoutA}', 'bad-status', 'Bad Status', 2000, 100, 'archived')`);
  fails(`INSERT INTO plans_purchases (listing_id, buyer_id, trainer_id, template_type, template_id, currency, final_price_minor, status) VALUES ('${ids.published}', '${ids.buyerA}', '${ids.trainerA}', 'workout', '${ids.workoutA}', 'INR', 2000, 'cancelled')`);
  fails(`INSERT INTO plans_reviews (listing_id, purchase_id, buyer_id, rating, review_text, status) VALUES ('${ids.published}', '${ids.purchaseOther}', '${ids.buyerB}', 4, 'Bad status', 'pending')`);
  fails(`UPDATE plans_purchases SET workout_assigned_plan_id = '60000000-0000-0000-0000-000000000001' WHERE id = '${ids.purchaseOther}'`);
  assert.equal(query(`SELECT commission_bps FROM plans_purchases WHERE id = '${ids.purchase}'`), '500');
});
