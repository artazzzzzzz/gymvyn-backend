# Local chat-security test database

This setup is deliberately local-only. It creates an unsafe, production-shaped
baseline so the Phase 1 and Phase 2 chat-security migrations can be tested.
It must never be linked to or run against the Gymvyn production project.

## What is already present

- Supabase CLI `2.109.1`
- Docker Desktop/daemon
- Local Supabase config at `supabase/config.toml`
- The test-only baseline at `supabase/tests/chat_security_baseline.sql`

The repository's normal `.env` may point at production. Do not source it and
do not run the backend server while doing these database tests.

## Start and load the local baseline

Run each command from `~/Desktop/gymvyn-backend`:

```bash
supabase start
cp .env.chat-test.local.example .env.chat-test.local
npm run chat:test-db:check
npm run test:chat-db
```

`test:chat-db` loads only `supabase/tests/chat_security_baseline.sql` and
`supabase/tests/chat_security_seed.sql` into the separate local database
`gymvyn_chat_security_test`, applies Phase 1, runs its tests, applies Phase 2,
and runs its tests again. It never invokes `supabase db reset`, `supabase link`,
`db push`, or the normal migration chain. The guard reads only
`.env.chat-test.local`, requires the local-only marker and fixed test database,
rejects production mode and the production project reference
`jaxnqttycxeavwhcsoyv`, and checks the local Docker/Supabase stack.

The fixture drops and recreates schemas only inside that dedicated test
database. It does not change the normal local `postgres` database.

## Provide local credentials to the test process

No key is needed: tests connect through the local database container and use
PostgreSQL `SET ROLE` to exercise `anon`, `authenticated`, and `service_role`
separately. Run the production-independent checks too:

```bash
npm run test:chat-security
```

## Stop and remove the local stack

```bash
supabase stop
```

Use `supabase stop --no-backup` only when the local test data does not need to
be retained. Neither command contacts production.
