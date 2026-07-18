const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'friendRoutes.js'), 'utf8');

test('friend discovery and block list routes are authenticated and expose only safe profile fields', () => {
  assert.match(source, /router\.get\('\/search', auth/);
  assert.match(source, /router\.get\('\/blocks', auth/);
  assert.match(source, /select\('id,full_name,role'\)/);
  assert.doesNotMatch(source, /select\([^\n]*(?:email|phone)/);
});

test('friend search excludes the caller and users blocked in either direction', () => {
  assert.match(source, /\.neq\('id', req\.userId\)/);
  assert.match(source, /filter\(user => !blockedIds\.has\(user\.id\)\)/);
});

test('friend list and requests include the friendship identity and safe other-user data needed by the API client', () => {
  assert.match(source, /friendship_id: row\.id/);
  assert.match(source, /other_user:/);
});
