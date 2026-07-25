-- Harden user_diet_plans row ownership policies.
--
-- Backend routes use the service-role client and enforce the same owner check
-- in Express. These policies keep the table safe if it is ever reached through
-- Supabase Data API with an authenticated user's JWT.

DROP POLICY IF EXISTS "Users can update own diet plans" ON user_diet_plans;
CREATE POLICY "Users can update own diet plans"
  ON user_diet_plans
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own diet plans" ON user_diet_plans;
CREATE POLICY "Users can delete own diet plans"
  ON user_diet_plans
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);
