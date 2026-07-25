-- Trainer Marketplace: dual-confirm delivery + plan library + admin dispute
-- resolution. Applied to the live Supabase project across Prompts 6-8 via
-- the Supabase MCP apply_migration tool; mirrored here (previously missing)
-- so this repo's migrations/ directory stays the complete source of truth,
-- matching every other migration file in this directory. Definitions below
-- were pulled directly from pg_get_functiondef() against the live project,
-- so this file is byte-for-byte what's actually deployed.

-- Atomic buyer/seller confirm for marketplace_purchases. A single UPDATE
-- statement is race-safe under Postgres row-level locking: whichever of the
-- two concurrent confirm calls acquires the row lock second sees the first
-- call's already-committed side, so the status-flip CASE only fires once.
-- Delegates delivery to marketplace_deliver_purchase() so the admin
-- dispute-resolve path can reuse the exact same delivery mechanics instead
-- of duplicating them.
CREATE OR REPLACE FUNCTION public.marketplace_confirm_purchase(p_purchase_id uuid, p_caller_id uuid, p_side text)
 RETURNS marketplace_purchases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result marketplace_purchases;
begin
  if p_side not in ('buyer', 'seller') then
    raise exception 'invalid side: %', p_side;
  end if;

  if p_side = 'buyer' then
    update marketplace_purchases
    set buyer_confirmed_at = now(),
        status = case
          when seller_confirmed_at is not null and status = 'pending_confirmation'
          then 'payment_confirmed'
          else status
        end,
        updated_at = now()
    where id = p_purchase_id
      and buyer_id = p_caller_id
      and status = 'pending_confirmation'
    returning * into result;
  else
    update marketplace_purchases
    set seller_confirmed_at = now(),
        status = case
          when buyer_confirmed_at is not null and status = 'pending_confirmation'
          then 'payment_confirmed'
          else status
        end,
        updated_at = now()
    where id = p_purchase_id
      and seller_id = p_caller_id
      and status = 'pending_confirmation'
    returning * into result;
  end if;

  if result.id is null then
    return result;
  end if;

  if result.status = 'payment_confirmed' then
    result := marketplace_deliver_purchase(result);
  end if;

  return result;
end;
$function$;

-- Copies purchased template content into the buyer's plan library and marks
-- the purchase delivered. Shared by marketplace_confirm_purchase() (normal
-- dual-confirm) and marketplace_admin_resolve_purchase() (admin approves a
-- dispute) — one delivery mechanism, two call sites. Because a plpgsql
-- function body is one transaction, a failed delivery step rolls back
-- everything from the calling function's invocation too — the confirm/
-- resolve attempt simply errors out and can be retried, with nothing
-- partial ever left committed.
CREATE OR REPLACE FUNCTION public.marketplace_deliver_purchase(p_purchase marketplace_purchases)
 RETURNS marketplace_purchases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result marketplace_purchases;
  v_wt_template record;
  v_dt_template record;
  v_assigned_plan_id uuid;
  v_day record;
  v_meal record;
  v_new_day_id uuid;
  v_new_meal_id uuid;
begin
  if p_purchase.template_type = 'workout' then
    select * into v_wt_template from trainer_templates where id = p_purchase.template_id;

    insert into assigned_plans (
      trainer_id, client_id, template_id, type, name, plan_data,
      status, source, source_purchase_id, starts_at
    ) values (
      p_purchase.seller_id, p_purchase.buyer_id, p_purchase.template_id, 'workout',
      coalesce(v_wt_template.name, 'Purchased Plan'),
      coalesce(v_wt_template.template_data, '{}'::jsonb),
      'owned', 'marketplace_purchase', p_purchase.id, current_date
    );

  elsif p_purchase.template_type = 'diet' then
    select * into v_dt_template from diet_plan_templates where id = p_purchase.template_id;

    insert into assigned_diet_plans (
      template_id, trainer_id, client_id, detail_level, name,
      calories_target, protein_g, carbs_g, fat_g,
      is_active, source, source_purchase_id, library_status
    ) values (
      p_purchase.template_id, p_purchase.seller_id, p_purchase.buyer_id,
      coalesce(v_dt_template.detail_level, 'macros'),
      coalesce(v_dt_template.name, 'Purchased Plan'),
      v_dt_template.calories_target, v_dt_template.protein_g, v_dt_template.carbs_g, v_dt_template.fat_g,
      false, 'marketplace_purchase', p_purchase.id, 'owned'
    ) returning id into v_assigned_plan_id;

    for v_day in
      select * from diet_plan_days where template_id = p_purchase.template_id order by day_number
    loop
      insert into assigned_diet_days (assigned_plan_id, day_number, calories_target, protein_g, carbs_g, fat_g, notes)
      values (v_assigned_plan_id, v_day.day_number, v_day.calories_target, v_day.protein_g, v_day.carbs_g, v_day.fat_g, v_day.notes)
      returning id into v_new_day_id;

      for v_meal in
        select * from diet_plan_meals where day_id = v_day.id order by meal_order
      loop
        insert into assigned_diet_meals (assigned_day_id, meal_name, meal_order, calories, protein_g, carbs_g, fat_g, notes)
        values (v_new_day_id, v_meal.meal_name, v_meal.meal_order, v_meal.calories, v_meal.protein_g, v_meal.carbs_g, v_meal.fat_g, v_meal.notes)
        returning id into v_new_meal_id;

        insert into assigned_diet_foods (assigned_meal_id, food_name, quantity_g, calories, protein_g, carbs_g, fat_g)
        select v_new_meal_id, food_name, quantity_g, calories, protein_g, carbs_g, fat_g
        from diet_plan_foods where meal_id = v_meal.id;
      end loop;
    end loop;
  else
    raise exception 'unknown template_type on purchase %: %', p_purchase.id, p_purchase.template_type;
  end if;

  update marketplace_purchases
  set status = 'delivered', delivered_at = now(), updated_at = now()
  where id = p_purchase.id
  returning * into result;

  return result;
end;
$function$;

-- Atomic demote-current-active/promote-target-to-active swap for a member's
-- plan library. Single transaction — mirrors the existing deactivate-then-
-- insert discipline already used by trainerRoutes.js's assign-plan flow,
-- applied here to a status swap instead of an insert.
CREATE OR REPLACE FUNCTION public.plan_library_make_active(p_type text, p_plan_id uuid, p_caller_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner_id uuid;
begin
  if p_type = 'workout' then
    select client_id into v_owner_id from assigned_plans where id = p_plan_id;
    if v_owner_id is null then
      raise exception 'not_found';
    end if;
    if v_owner_id <> p_caller_id then
      raise exception 'not_authorized';
    end if;

    update assigned_plans
    set status = 'owned', updated_at = now()
    where client_id = p_caller_id and type = 'workout' and status = 'active';

    update assigned_plans
    set status = 'active', updated_at = now()
    where id = p_plan_id;

  elsif p_type = 'diet' then
    select client_id into v_owner_id from assigned_diet_plans where id = p_plan_id;
    if v_owner_id is null then
      raise exception 'not_found';
    end if;
    if v_owner_id <> p_caller_id then
      raise exception 'not_authorized';
    end if;

    update assigned_diet_plans
    set library_status = 'owned', is_active = false
    where client_id = p_caller_id and library_status = 'active';

    update assigned_diet_plans
    set library_status = 'active', is_active = true
    where id = p_plan_id;

  else
    raise exception 'invalid type: %', p_type;
  end if;
end;
$function$;

-- Admin dispute resolution. Approve reuses marketplace_deliver_purchase()
-- for the exact same delivery mechanics as a normal dual-confirm; reject
-- just records the terminal state with no delivery. One transaction, so a
-- failed delivery on approve rolls back the resolve too.
CREATE OR REPLACE FUNCTION public.marketplace_admin_resolve_purchase(p_purchase_id uuid, p_admin_id uuid, p_decision text)
 RETURNS marketplace_purchases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result marketplace_purchases;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  if p_decision = 'approve' then
    update marketplace_purchases
    set status = 'resolved_confirmed',
        admin_resolved_by = p_admin_id,
        admin_resolved_at = now(),
        updated_at = now()
    where id = p_purchase_id and status = 'disputed'
    returning * into result;

    if result.id is not null then
      result := marketplace_deliver_purchase(result);
    end if;
  else
    update marketplace_purchases
    set status = 'resolved_rejected',
        admin_resolved_by = p_admin_id,
        admin_resolved_at = now(),
        updated_at = now()
    where id = p_purchase_id and status = 'disputed'
    returning * into result;
  end if;

  return result;
end;
$function$;
