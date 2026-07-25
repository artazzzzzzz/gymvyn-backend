# Gymvyn Backend Agent Instructions

## Project
This is the Gymvyn backend repo.

Path:
~/Desktop/gymvyn-backend

Sibling frontend repo:
~/Desktop/gymvyn-frontend

Do not move folders. Do not create a parent workspace. Claude, GitHub, and the existing workflow depend on the current sibling repo layout.

## User context
The user is Artaz, solo founder of Gymvyn. The user is not deeply technical. Final explanations to the user should be short, plain-language, direct, and candid. Separate verified facts from assumptions.

## Non-negotiable rules
- Stay on main branch. No worktrees.
- Do not make unrelated changes.
- Diagnose before editing.
- One task at a time.
- Do not treat "prompt sent" as "done."
- Always provide verification commands before finishing.
- Mark anything unverified clearly.

## Backend stack
- Node.js + Express.
- Railway production backend.
- Backend deploys only with:
  cd ~/Desktop/gymvyn-backend && railway up
- Never assume git push deploys backend.
- Never rename the Railway service mid-beta.

## Environment/security rules
- SUPABASE_SERVICE_KEY is the backend env key.
- Do not use SUPABASE_SERVICE_ROLE_KEY unless the codebase already does and the user explicitly approves migration.
- AI API keys stay backend-only.
- Never expose AI keys in frontend or VITE_* vars.
- Feature flags must be respected.
- Cost logging must not break user-facing flows.

## Database facts
- users table has no email column. Email lives in auth.users only.
- users.id requires explicit crypto.randomUUID() where relevant.
- Starting weight is not a users column. It is stored in progress_entries.
- progress_entries.logged_at must be a full ISO timestamp.
- weight_kg may be stored as text in progress_entries; parse before math/comparison.
- Cloudinary paths must stay as fitforge/exercises/.

## Frontend awareness
Frontend repo is at:
~/Desktop/gymvyn-frontend

If a backend task affects UI behavior, inspect the frontend sibling repo before guessing.

Do not edit frontend files unless the user explicitly asks or the task clearly requires a coordinated frontend/backend fix.

## Security testing standard
For any auth, ownership, gym/member, trainer/client, chat, or relationship-status change, test:

1. Unauthorized user is blocked.
2. Resource owner/self is allowed.
3. Legitimately linked different party is allowed.
4. Inactive/stale relationship is blocked.

Do not claim security-sensitive work is complete unless these cases are verified or clearly marked unverified.

## Required final report
Before finishing any future task, provide:

1. Files changed
2. Exact root cause found
3. Exact fix made
4. Commands run
5. Whether frontend changed
6. Whether backend changed
7. Whether Railway deploy is needed
8. Manual/API verification steps
9. Anything still unverified
