'use strict';

// Memoizes a single in-flight/completed call to loadAuthUsers() so a batch
// operation that needs the full auth-user list for many rows (e.g. CSV
// member import) fetches it once instead of once per row. The promise is
// cached immediately (not after resolution) so concurrent callers within the
// same request also share the one in-flight request.
function createAuthUserCache(loadAuthUsers) {
  let promise = null;
  return function getAuthUsers() {
    if (!promise) promise = loadAuthUsers();
    return promise;
  };
}

module.exports = { createAuthUserCache };
