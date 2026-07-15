'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuthUserCache } = require('../services/authUserCache');

test('loader is called once no matter how many times getAuthUsers is called', async () => {
  let calls = 0;
  const getAuthUsers = createAuthUserCache(async () => {
    calls += 1;
    return [{ id: 'u1' }, { id: 'u2' }];
  });

  const results = await Promise.all([getAuthUsers(), getAuthUsers(), getAuthUsers()]);
  await getAuthUsers();

  assert.equal(calls, 1);
  for (const result of results) assert.deepEqual(result, [{ id: 'u1' }, { id: 'u2' }]);
});

test('concurrent calls before the loader resolves share the same in-flight promise', async () => {
  let calls = 0;
  let resolveLoad;
  const getAuthUsers = createAuthUserCache(() => {
    calls += 1;
    return new Promise(resolve => { resolveLoad = resolve; });
  });

  const first = getAuthUsers();
  const second = getAuthUsers();
  resolveLoad(['a', 'b']);

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(firstResult, secondResult);
});

test('separate cache instances load independently', async () => {
  let calls = 0;
  const load = async () => { calls += 1; return []; };
  const cacheA = createAuthUserCache(load);
  const cacheB = createAuthUserCache(load);

  await cacheA();
  await cacheA();
  await cacheB();

  assert.equal(calls, 2);
});
