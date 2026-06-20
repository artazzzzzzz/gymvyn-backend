# FitForge UI Verification Checklist (Phase 3)

> Manual browser pass against the seeded `TEST_FF_*` ecosystem.
> Password for every test user: **`TestFF!2026`**
> Test gym: **`TEST_FF_Gym_Alpha`** · join code **`TFFAL1`**
> Frontend: whatever Vercel URL is current. Backend: prod Railway (already deployed with Phase 2 fixes).

## Universal visual checks (apply to every screen)

- [ ] Primary CTAs are **white bg / 1px black border / black text** — not solid black
- [ ] No green anywhere — accent color is **`#007AFF`** blue only
- [ ] Icons are **lucide-react only** (no emoji icons, no other icon libs)
- [ ] Page background is **`#F2F2F7`**; cards are **white** with **1px border** and **16px radius**
- [ ] Sheets/modals slide up from bottom, not from the side
- [ ] Tap targets ≥ 44px (no microscopic icon-only buttons)

## Known-deferred items — DO NOT report these as bugs

- ⏭ **Diet macro ring card** styling (the calorie/macro ring on /diet)
- ⏭ **Dark mode** functional theming (only the swatch preview in Settings works)
- ⏭ **Trainer screen redesigns** (functional but not yet restyled to new system)
- ⏭ **Member-facing locker view** (owner-only by design in v1)

## Phase 2 fix watch-list (pay extra attention to these — they were 500'ing before)

- ⚠️ `/community` (was `GET /posts` 500 — implicit users embed)
- ⚠️ `/leaderboard` (was `GET /leaderboard` 500 — wrong column names)
- ⚠️ `/progress` (was `GET /progress-photos` 500 — wrong column names)
- ⚠️ `/xp` weekly challenges (was `GET /api/xp/challenges` 500 — wrong column name)
- ⚠️ Community comments thread (same embed pattern as posts feed)

---

# Gym Owner — `test_ff_owner_1@fitforge.test`

> Owner of TEST_FF_Gym_Alpha. After login should land on `/gym/dashboard`.

## /gym/dashboard

- [ ] Loads without error, header shows **TEST_FF_Gym_Alpha**
- [ ] Member count tile shows **10**
- [ ] Recent check-ins tile shows recent entries (20 seeded over last 30 days)
- [ ] Revenue tile shows non-zero number (10 active memberships × monthly fees)
- [ ] Each tile card is white-bg / 1px border / 16px radius
- [ ] Sidebar / bottom nav navigates between owner sections without flashing white

## /gym/members

- [ ] Lists all **10** TEST_FF members (Member 1 through Member 10)
- [ ] Names render correctly (not "—" placeholder) — this was a known v7 bug
- [ ] Membership type badges show mix of monthly / quarterly / annual
- [ ] Search bar: typing "TEST_FF Member 5" filters to one row
- [ ] Tap **TEST_FF Member 1** → navigates to `/gym/members/<uuid>` detail page

## /gym/members/:memberId (detail of Member 1)

- [ ] Page loads, **not** "Member not found" (known v7 bug)
- [ ] Shows TEST_FF Member 1 name, age, weight, gender
- [ ] Membership card shows type=monthly, status=active, end_date in the past or near term
- [ ] Workout activity tile shows **5** seeded workout_logs
- [ ] Food log tile shows recent meals (28 seeded across 7 days)
- [ ] Assign trainer / renew / delete actions visible

## /gym/import

- [ ] Page loads, CSV upload area visible (do NOT actually upload — that's gym-altering)

## /gym/payments

- [ ] Outstanding payments tab shows rows (or correctly empty if all paid)
- [ ] Summary card shows total revenue figure consistent with dashboard tile
- [ ] Tap a payment → mark-as-paid sheet opens; pick cash → confirms

## /gym/schedule

- [ ] Page loads. Schedule is empty (no class_schedule rows were seeded) — should show empty state, not crash
- [ ] "Add class" CTA visible and styled per universal rules

## /gym/announcements

- [ ] Lists the **2 seeded announcements** ("TEST_FF Welcome" normal, "TEST_FF Urgent" high priority)
- [ ] High-priority announcement has a visual distinction (e.g. red dot, badge)
- [ ] Tap **+** → compose sheet opens → write a TEST_FF announcement → posts → appears at top
- [ ] Swipe / tap delete on a TEST_FF announcement → it disappears

## /gym/trainers

- [ ] Lists **2 gym-affiliated trainers** (trainer_2, trainer_3) — trainer_1 is independent and should NOT appear
- [ ] Invite trainer CTA opens InviteClientSheet equivalent
- [ ] Manual trainer add works

## /gym/settings

- [ ] Gym name, city, address, phone editable; save persists across refresh
- [ ] Operating hours editor renders for all 7 days
- [ ] Membership plans list shows 3 (Monthly, Quarterly, Annual)
- [ ] "Lockers enabled" toggle is **ON** for the test gym

## /gym/checkin

- [ ] QR code renders for the gym
- [ ] Manual check-in input accepts member id/phone
- [ ] Recent check-ins list updates after a successful check-in

## /gym/insights

- [ ] Page loads, charts render (or graceful empty state for ML scores — fitforge-ml is not deployed)
- [ ] **Activity heatmap** renders with seeded check-in data

## /gym/supplements

> ⚠️ **Phase 2 fix area:** order-status PATCH and payment PATCH endpoints both green in API sweep — re-verify in UI.

- [ ] **Products** tab shows **5 seeded products**:
  - [ ] "TEST_FF Whey Protein 1kg" — normal stock
  - [ ] "TEST_FF Creatine 300g" — normal stock
  - [ ] "TEST_FF Pre-workout" — **low-stock badge** (3 ≤ threshold 5)
  - [ ] "TEST_FF Multivitamin" — **out-of-stock badge** (0 stock)
  - [ ] "TEST_FF Discontinued Bar" — visually marked inactive
- [ ] **Add product** sheet — opens, lets you create a TEST_FF product, appears in list
- [ ] **Edit** an existing TEST_FF product — price update persists
- [ ] **Delete** a TEST_FF product — disappears
- [ ] **Orders** tab — if Member flow below has been run, shows the order with status=ready_for_pickup → mark Completed → status updates to completed
- [ ] Payment column on orders correctly shows paid/unpaid + method

## /gym/expenses

- [ ] Lists all **8 seeded expenses** across 6 categories
- [ ] Summary card shows correct total
- [ ] By-category breakdown shows non-zero values for rent, equipment, salaries, etc.
- [ ] **Add expense** sheet — creates a TEST_FF expense, appears in list
- [ ] Edit expense (change amount) persists
- [ ] Delete expense removes it

## /gym/lockers

> ⚠️ Flow test below — read full flow before clicking around.

- [ ] Lists all **6 seeded lockers** (A1, A2, VIP-1, VIP-2, B1, B2)
- [ ] **A1** — Available, free (no price chip)
- [ ] **A2** — Occupied by Member 1 (long-term, ~30 days remaining)
- [ ] **VIP-1** — Occupied by Member 2, **2-day urgency styling** (amber/red badge — this was specifically seeded for urgency testing)
- [ ] **VIP-2** — Available, ₹500 price chip
- [ ] **B1** — Maintenance (status badge)
- [ ] **B2** — Available, ₹300 price chip, paid

### Flow: locker assignment lifecycle

- [ ] Tap **VIP-2** → assign sheet opens → pick TEST_FF Member 5 → 30-day duration → submit
- [ ] VIP-2 now shows Occupied by Member 5
- [ ] Mark VIP-2 payment as paid (cash) — payment chip updates
- [ ] End VIP-2 assignment early — locker returns to Available
- [ ] Locker now has assignment history → attempting DELETE should be blocked with "has assignment history" message (this is by design)

---

# Trainer — `test_ff_trainer_1@fitforge.test`

> Independent trainer with 3 linked clients (client_1, client_2, client_3) and templates.
> **Trainer screens are in the deferred-redesign list** — verify they FUNCTION, don't grade the styling.

## /trainer/dashboard

- [ ] Page loads, shows client count = 3
- [ ] Trainer code visible (was set to `TF1` style in seed)

## /trainer/clients

- [ ] Lists **3 clients**: TEST_FF Client One, Two, Three — all status=active
- [ ] Tap **Client One** → navigates to `/trainer/client/<uuid>`

## /trainer/client/:clientId (Client One)

- [ ] Client info card renders
- [ ] **Assigned plan** section shows the seeded "TEST_FF Assigned Plan" (1 day, Squat/Bench)
- [ ] Open chat link works → `/trainer/chat/<convoId>`

## /trainer/templates

- [ ] Lists the **1 seeded template** "TEST_FF PPL 4-day"
- [ ] Tap template → goes to edit page

## /trainer/templates/new

- [ ] Builder loads, can add days/exercises (don't have to save unless you want)

## /trainer/assign-plan

- [ ] Page loads, can pick a client + template

## /trainer/chat & /trainer/chat/:convoId

- [ ] Conversations list shows **5 conversations** (3 with clients, 2 with member_1 and member_2)
- [ ] Tap conversation with Client One → 2 seeded messages render
- [ ] Send a new message "TEST_FF sweep msg" → appears in thread immediately
- [ ] Switch to Client Two conversation → both threads remain independent

## /trainer/settings

- [ ] Trainer profile editable (bio, specializations, hourly rate)
- [ ] Toggle "accepting clients" persists

---

# Linked Member (Titan L12) — `test_ff_member_1@fitforge.test`

> Gym member of TEST_FF_Gym_Alpha. **XP profile**: total_xp=9000, level=12 Titan, current_streak=12, longest_streak=30. Has 5 workout logs, 28 food logs over 7 days, 4 progress photos, conversation with trainer_1, assigned trainer membership.

## /home

- [ ] Loads, shows greeting with name "TEST_FF Member 1"
- [ ] Today's workout / quick actions visible
- [ ] No console errors

## /workout

- [ ] Workout plan loads (seeded plan: Push/Pull with Bench + OHP + Deadlift + Pull-ups)
- [ ] Start workout CTA visible and styled per universal rules

### Flow: live workout → XP toast

- [ ] Tap **Start workout** → `/workout/live` loads
- [ ] Log a set or two on Bench Press (any weight/reps)
- [ ] Finish workout → navigates to `/workout/summary`
- [ ] Summary shows exercises logged (not blank, not 0kg volume — was a known v7 bug)
- [ ] **⚠️ XP toast** should appear (XPToastProvider wraps the Router) — should show XP awarded for the workout
- [ ] Return to /home → streak indicator unchanged or incremented (member_1 last_active is today)

## /exercise-library

- [ ] Library renders, exercise cards have thumbnails or fallback
- [ ] Search/filter works

## /exercise/Bench%20Press (and /exercise/:name in general)

- [ ] Detail page loads, metadata renders
- [ ] **Stats tab** — shows member_1's history on Bench Press (5 sessions seeded)
- [ ] **History tab** — chronological list, weights increment over the 5 sessions
- [ ] Bookmark toggle works (tap → bookmark; tap again → removed)

## /diet

- [ ] ⏭ Macro ring card styling — **DO NOT REPORT** (deferred)
- [ ] Today's food logs render (4 meals × 7 days seeded — today's row should have breakfast/lunch/snack/dinner)
- [ ] Tap **+ log food** → FoodLoggerSheet opens
- [ ] Manual food entry works → appears in today's list
- [ ] Delete a TEST_FF food entry → removed

## /progress

> ⚠️ **Phase 2 fix:** GET /progress-photos was 500'ing on `public_id` column — now returns the 4 seeded photos.

- [ ] Page loads — **does not 500 / does not show error toast**
- [ ] Photos tab shows **4 seeded photos** for member_1 (placeholder URLs — they may fail to render as images, that's OK, but the rows themselves must list)
- [ ] Notes "TEST_FF progress week 1/2/3/4" visible on each row
- [ ] Stats tab renders (weight, body metrics)

## /community

> ⚠️ **Phase 2 fix:** GET /posts was 500'ing on FK relationship — now returns empty array (no posts seeded for TEST_FF users).

- [ ] Page loads — **does not 500 / does not show error toast**
- [ ] Empty state renders gracefully (no posts in the system right now)
- [ ] Create a post: tap **+** → write "TEST_FF community test" → submit → appears in feed
- [ ] Tap your new post → comments thread opens (was the other 500 — `GET /posts/:postId/comments`)
- [ ] Post a comment "TEST_FF comment" → appears in thread
- [ ] Like the post → like count increments
- [ ] Delete your TEST_FF post when done

## /form-coach

- [ ] Page loads (functional check only — AI form analysis is not exercised)

## /my-gym

- [ ] Shows linked gym **TEST_FF_Gym_Alpha** with address/phone
- [ ] Announcements section shows the 2 seeded announcements
- [ ] Schedule section empty (none seeded) — graceful empty state
- [ ] Member should NOT see a locker management UI here (deferred)

## /my-gym/supplements (consumer catalog)

> ⚠️ **Phase 2 fix area:** order create + status + payment all green in API sweep — verify the UI flow.

### Flow: supplement order lifecycle

- [ ] Catalog shows the in-stock TEST_FF products (Whey, Creatine, Pre-workout); out-of-stock Multivitamin is either hidden or shown with a disabled "Out of stock" badge
- [ ] Tap **Whey Protein** → product detail or add-to-cart flow
- [ ] Add to cart → cart badge increments
- [ ] Go to `/my-gym/supplements/cart` → item listed with correct price/qty
- [ ] **Place order** → success state, navigates to `/my-gym/orders`
- [ ] New order appears with status=pending, payment=unpaid
- [ ] (Switch to Owner browser tab → `/gym/supplements` → Orders tab → mark Ready → mark Completed with Cash)
- [ ] Refresh `/my-gym/orders` → status updates to Ready → Completed
- [ ] Tap the order → `/my-gym/orders/:orderId` detail shows all items, prices, totals, status timeline

## /my-trainer

- [ ] Shows linked trainer if any (member_1 may not have a trainer link — check the data; if no link, should show join-by-code form, not crash)

## /client/chat

- [ ] If member_1 has trainer chat (yes — 1 conversation seeded with trainer_1): thread loads with 2 seeded messages
- [ ] Send "TEST_FF member→trainer test" → appears immediately

## /chat (AI chat)

- [ ] Page loads (don't send an actual message — AI is skipped in API sweep too)

## /xp

> ⚠️ **Phase 2 fix:** GET /api/xp/challenges was 500'ing on `progress` column — now works.

- [ ] Profile shows **Titan / Level 12 / 9000 XP**
- [ ] Streak shows **12 days**, longest streak **30**
- [ ] XP progress bar to next level rendered
- [ ] **Weekly challenges** section loads — **does not 500** — generates 3 challenges based on member_1's last week of workout data
- [ ] Challenge cards show title, target, xp_reward
- [ ] Muscle balance chart renders
- [ ] Freezes remaining shows **6**

## /leaderboard

> ⚠️ **Phase 2 fix:** GET /leaderboard was 500'ing on `users.username` — now returns top 10 by current_streak with full_name + total_xp + level.

- [ ] Page loads — **does not 500**
- [ ] **TEST_FF Member 1** appears at or near top with current_streak=12, level=12, 9000 XP (highest seeded streak among test users)
- [ ] **TEST_FF Member 2** appears with current_streak=5, level=6, 1500 XP
- [ ] **TEST_FF Member 3** appears with current_streak=1, level=1, 50 XP
- [ ] Names render correctly (not "username")
- [ ] No null/undefined rows

## /settings

- [ ] Profile fields editable (name, age, weight, height, gender)
- [ ] Save persists across refresh
- [ ] Logout button works → returns to /login

---

# Second Member (Rookie L1) — `test_ff_member_3@fitforge.test`

> Same gym, but **fresh XP state**: total_xp=50, level=1 Rookie, current_streak=1. Use this to validate the **Rookie / low-level rendering paths** that Titan member_1 doesn't exercise. Member 3 also has 5 workout logs and 28 food logs seeded.

## /home

- [ ] Loads as Rookie — no broken assumption that user has a streak/level
- [ ] Greets "TEST_FF Member 3"

## /xp

- [ ] Profile shows **Rookie / Level 1 / 50 XP**
- [ ] Progress bar to Level 2 (100 XP) shows ~50% fill
- [ ] Streak shows **1 day** — single-day streak rendering OK
- [ ] Weekly challenges renders (member_3 also has 5 workout_logs, should generate from same data shape as member_1)
- [ ] Muscle balance chart renders even with low data

## /leaderboard

- [ ] Page loads
- [ ] **TEST_FF Member 3** appears in the list (may be near bottom of the top 10 with current_streak=1)
- [ ] Page does not crash when a row has very low totals

## /progress

- [ ] Renders even though member_3 has **0 progress photos** seeded — empty state, not crash

## /community

- [ ] Renders even with no posts authored by this user

---

# Solo User — `test_ff_solo_1@fitforge.test`

> Consumer with **no gym link, no trainer link, no workout/food data**. Use this to verify **empty states and the join flow**.

## /home

- [ ] Loads as consumer — no gym sidebar entries
- [ ] No-data tiles render gracefully (no crashes, no "undefined" strings)

## /workout

- [ ] Empty plan state — should offer "Create plan" or "Generate plan" CTA

## /diet

- [ ] No food logs → empty state with "Log first meal" CTA

## /progress

- [ ] 0 photos → empty state

## /community

- [ ] Renders (same global feed as members)

## /my-gym

> ⚠️ **Flow test — gym join**

- [ ] Solo user with no gym should see **join flow** (not "Member not found", not crash)
- [ ] Input for gym code visible
- [ ] Enter code **`TFFAL1`** → submit → success → page now shows TEST_FF_Gym_Alpha as linked gym
- [ ] After joining, member-side features (announcements, schedule) appear

## /my-trainer

- [ ] No trainer linked → shows join-by-code form (trainer codes start with `TF`)

## /xp

- [ ] Profile shows Level 1, 0 XP (ensureXPProfile lazily creates row on first visit)
- [ ] Weekly challenges may show empty / "log a workout to generate challenges" copy

## /settings

- [ ] Onboarding-derived fields populated from signup
- [ ] Can edit + save

---

# Cross-role flow tests

> These exercise interactions between two users. Use two browser windows / incognito tabs.

## Flow A — Supplement order end-to-end

> Already covered piecewise above. Verify the full chain once.

1. Browser 1 (member_1): /my-gym/supplements → add Whey to cart → place order
2. Browser 2 (owner_1): /gym/supplements → Orders tab → see the new order pending
3. Browser 2 (owner_1): mark **Ready for pickup**
4. Browser 1 (member_1): /my-gym/orders → status now **Ready**
5. Browser 2 (owner_1): mark **Completed** with Cash payment
6. Browser 1 (member_1): /my-gym/orders → status now **Completed**, payment Paid (Cash)

## Flow B — Locker urgency + assignment lifecycle (owner only)

Already covered under /gym/lockers above.

## Flow C — Trainer ↔ Client chat

1. Browser 1 (trainer_1): /trainer/chat → open Client One conversation
2. Browser 2 (client_1): /client/chat → open conversation with trainer_1
3. Browser 1 sends "Trainer hello"
4. Browser 2: message appears within ~2 polling intervals
5. Browser 2 replies "Client hello back"
6. Browser 1: reply appears

## Flow D — XP toast on workout finish

> Single browser, member_1.

1. /workout → Start workout
2. Log 2–3 sets (any weight/reps)
3. Finish workout
4. Summary page → **XP toast appears** (XPToastProvider in App.jsx)
5. /xp → total_xp incremented vs the 9000 baseline

## Flow E — Gym join

> Already in Solo User section. Verify the linked-state is real:

1. Solo_1 joins TEST_FF_Gym_Alpha with code `TFFAL1`
2. After join: /my-gym shows the gym
3. /home shows gym-related tiles
4. Owner browser: /gym/members now lists solo_1 as a new member (11 total)

---

# Reporting bugs

For each ❌, please capture:

- The role you were testing as
- The exact URL
- The action taken
- What you expected
- What happened (paste error toast, screenshot, console error if any)

Skip anything in the **deferred** list above — those are not bugs for this pass.

---

# Cleanup

When you're done testing, paste this in Supabase SQL editor to nuke all TEST_FF data. Then manually delete the `test_ff_*` users from the Auth dashboard (Authentication → Users → filter "test_ff").

```sql
DELETE FROM xp_events     WHERE user_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM user_xp       WHERE user_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM weekly_challenges WHERE user_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM messages      WHERE conversation_id IN (SELECT id FROM conversations WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%'));
DELETE FROM conversations WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM trainer_clients   WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM assigned_plans    WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM trainer_templates WHERE trainer_id IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM trainer_profiles  WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM food_logs         WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM workout_logs      WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM workout_plans     WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM progress_photos   WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM posts             WHERE user_id    IN (SELECT id FROM users WHERE full_name LIKE 'TEST_FF%');
DELETE FROM locker_payments    WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM locker_assignments WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM gym_lockers        WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM check_ins          WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM gym_expenses       WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM supplement_order_items WHERE order_id IN (SELECT id FROM supplement_orders WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%'));
DELETE FROM supplement_orders   WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM supplement_products WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM announcements      WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM gym_memberships    WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM payments           WHERE gym_id IN (SELECT id FROM gyms WHERE name LIKE 'TEST_FF%');
DELETE FROM gyms               WHERE name LIKE 'TEST_FF%';
DELETE FROM users              WHERE full_name LIKE 'TEST_FF%';
-- Finally: Supabase Dashboard → Authentication → Users → filter "test_ff" → delete.
```
