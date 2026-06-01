// ============================================
// trainerRoutes.js — Add to fitforge-backend
// Import in server.js: require('./trainerRoutes')(app, supabase)
// ============================================

module.exports = function (app, supabase) {

  // ──────────────────────────────────────────
  // TRAINER ONBOARDING & PROFILE
  // ──────────────────────────────────────────

  // POST /api/trainer/onboard — become a trainer (from consumer or new)
  app.post('/api/trainer/onboard', async (req, res) => {
    try {
      const {
        userId, bio, specializations, experienceYears,
        hourlyRate, isIndependent, phone, city, gymId
      } = req.body;

      if (!userId) return res.status(400).json({ error: 'userId required' });

      // Generate unique invite code
      const { data: codeData } = await supabase.rpc('generate_invite_code');
      const inviteCode = codeData || Math.random().toString(36).substring(2, 8).toUpperCase();

      // Upsert trainer_profiles
      const { data: profile, error: profileErr } = await supabase
        .from('trainer_profiles')
        .upsert({
          user_id: userId,
          bio: bio || '',
          specializations: specializations || [],
          experience_years: experienceYears || 0,
          hourly_rate: hourlyRate || null,
          is_independent: isIndependent !== false,
          phone: phone || null,
          city: city || null,
          gym_id: isIndependent ? null : (gymId || null),
          invite_code: inviteCode,
          is_accepting_clients: true,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })
        .select()
        .single();

      if (profileErr) throw profileErr;

      // Update user role to 'trainer'
      const { error: roleErr } = await supabase
        .from('users')
        .update({ role: 'trainer' })
        .eq('id', userId);

      if (roleErr) throw roleErr;

      res.json({ success: true, profile });
    } catch (err) {
      console.error('Trainer onboard error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/trainer/profile/:userId
  app.get('/api/trainer/profile/:userId', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('trainer_profiles')
        .select('*, users!inner(full_name, goal, experience)')
        .eq('user_id', req.params.userId)
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      res.status(404).json({ error: 'Trainer profile not found' });
    }
  });

  // PATCH /api/trainer/profile/:userId — update profile
  app.patch('/api/trainer/profile/:userId', async (req, res) => {
    try {
      const updates = { ...req.body, updated_at: new Date().toISOString() };
      delete updates.user_id; // prevent overwriting FK
      delete updates.invite_code; // prevent code tampering

      const { data, error } = await supabase
        .from('trainer_profiles')
        .update(updates)
        .eq('user_id', req.params.userId)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────
  // CLIENT MANAGEMENT
  // ──────────────────────────────────────────

  // POST /api/trainer/invite-client — send invite
  app.post('/api/trainer/invite-client', async (req, res) => {
    try {
      const { trainerId, clientEmail, clientPhone, gymId, notes } = req.body;
      if (!trainerId) return res.status(400).json({ error: 'trainerId required' });

      // Generate a short invite code for this specific invite
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      // Check if client already exists by email in auth.users
      let clientId = null;
      if (clientEmail) {
        const { data: authUsers } = await supabase.auth.admin.listUsers();
        const found = authUsers?.users?.find(u => u.email === clientEmail);
        if (found) clientId = found.id;
      }

      const { data, error } = await supabase
        .from('trainer_clients')
        .insert({
          trainer_id: trainerId,
          client_id: clientId,
          gym_id: gymId || null,
          status: clientId ? 'active' : 'pending',
          invited_via: 'code',
          invite_code: inviteCode,
          invite_email: clientEmail || null,
          invite_phone: clientPhone || null,
          notes: notes || null,
          started_at: clientId ? new Date().toISOString() : null
        })
        .select()
        .single();

      if (error) throw error;

      // If client exists, create conversation
      if (clientId) {
        await supabase.from('conversations').insert({
          trainer_id: trainerId,
          client_id: clientId
        });
      }

      res.json({ success: true, invite: data, inviteCode });
    } catch (err) {
      console.error('Invite client error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/trainer/accept-invite — client accepts trainer invite
  app.post('/api/trainer/accept-invite', async (req, res) => {
    try {
      const { clientId, inviteCode } = req.body;
      if (!clientId || !inviteCode) {
        return res.status(400).json({ error: 'clientId and inviteCode required' });
      }

      // Find pending invite by code (either from trainer_clients or trainer_profiles)
      // First check trainer_clients for direct invite
      let { data: invite } = await supabase
        .from('trainer_clients')
        .select('*')
        .eq('invite_code', inviteCode.toUpperCase())
        .eq('status', 'pending')
        .single();

      // If not found, check trainer_profiles invite_code (general link)
      if (!invite) {
        const { data: trainer } = await supabase
          .from('trainer_profiles')
          .select('user_id, gym_id')
          .eq('invite_code', inviteCode.toUpperCase())
          .single();

        if (!trainer) {
          return res.status(404).json({ error: 'Invalid or expired invite code' });
        }

        // Check if relationship already exists
        const { data: existing } = await supabase
          .from('trainer_clients')
          .select('id')
          .eq('trainer_id', trainer.user_id)
          .eq('client_id', clientId)
          .in('status', ['pending', 'active'])
          .single();

        if (existing) {
          return res.status(409).json({ error: 'Already connected to this trainer' });
        }

        // Create new relationship from general invite
        const { data: newRel, error: insertErr } = await supabase
          .from('trainer_clients')
          .insert({
            trainer_id: trainer.user_id,
            client_id: clientId,
            gym_id: trainer.gym_id || null,
            status: 'active',
            invited_via: 'link',
            invite_code: inviteCode.toUpperCase(),
            started_at: new Date().toISOString()
          })
          .select()
          .single();

        if (insertErr) throw insertErr;
        invite = newRel;
      } else {
        // Activate the pending direct invite
        const { error: updateErr } = await supabase
          .from('trainer_clients')
          .update({
            client_id: clientId,
            status: 'active',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', invite.id);

        if (updateErr) throw updateErr;
        invite.client_id = clientId;
        invite.status = 'active';
      }

      // Create conversation for this pair
      await supabase.from('conversations').upsert({
        trainer_id: invite.trainer_id,
        client_id: clientId
      }, { onConflict: 'trainer_id,client_id' });

      // Update trainer total_clients count
      const { count } = await supabase
        .from('trainer_clients')
        .select('*', { count: 'exact', head: true })
        .eq('trainer_id', invite.trainer_id)
        .eq('status', 'active');

      await supabase
        .from('trainer_profiles')
        .update({ total_clients: count || 0 })
        .eq('user_id', invite.trainer_id);

      res.json({ success: true, relationship: invite });
    } catch (err) {
      console.error('Accept invite error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/trainer/clients/:trainerId — list all clients
  app.get('/api/trainer/clients/:trainerId', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select(`
          *,
          client:users!trainer_clients_client_id_fkey(
            id, full_name, goal, experience, current_weight, 
            target_weight, age, gender, created_at
          )
        `)
        .eq('trainer_id', req.params.trainerId)
        .in('status', ['active', 'pending'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      // For each active client, get their latest stats
      const enriched = await Promise.all((data || []).map(async (rel) => {
        if (!rel.client_id || rel.status !== 'active') return rel;

        // Last workout
        const { data: lastWorkout } = await supabase
          .from('workout_logs')
          .select('completed_at, duration_minutes')
          .eq('user_id', rel.client_id)
          .not('completed_at', 'is', null)
          .order('completed_at', { ascending: false })
          .limit(1)
          .single();

        // Workout count (last 7 days)
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { count: weeklyWorkouts } = await supabase
          .from('workout_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', rel.client_id)
          .not('completed_at', 'is', null)
          .gte('completed_at', weekAgo);

        // Active assigned plan count
        const { count: activePlans } = await supabase
          .from('assigned_plans')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', rel.client_id)
          .eq('trainer_id', req.params.trainerId)
          .eq('status', 'active');

        return {
          ...rel,
          stats: {
            lastWorkout: lastWorkout?.completed_at || null,
            lastWorkoutDuration: lastWorkout?.duration_minutes || null,
            weeklyWorkouts: weeklyWorkouts || 0,
            activePlans: activePlans || 0
          }
        };
      }));

      res.json(enriched);
    } catch (err) {
      console.error('Get clients error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/trainer/my-trainer/:clientId — client gets their trainer info
  app.get('/api/trainer/my-trainer/:clientId', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('trainer_clients')
        .select(`
          *,
          trainer:users!trainer_clients_trainer_id_fkey(
            id, full_name
          ),
          trainer_profile:trainer_profiles!inner(
            bio, specializations, experience_years, 
            profile_photo_url, is_independent, city
          )
        `)
        .eq('client_id', req.params.clientId)
        .eq('status', 'active')
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      res.json(data || null);
    } catch (err) {
      console.error('My trainer error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/trainer/client/:relationshipId — update status (pause, remove)
  app.patch('/api/trainer/client/:relationshipId', async (req, res) => {
    try {
      const { status, notes } = req.body;
      const { data, error } = await supabase
        .from('trainer_clients')
        .update({
          status,
          notes: notes || undefined,
          updated_at: new Date().toISOString()
        })
        .eq('id', req.params.relationshipId)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────
  // TEMPLATES (reusable workout/diet templates)
  // ──────────────────────────────────────────

  // POST /api/trainer/templates — create template
  app.post('/api/trainer/templates', async (req, res) => {
    try {
      const { trainerId, type, name, description, templateData, tags } = req.body;
      if (!trainerId || !type || !name) {
        return res.status(400).json({ error: 'trainerId, type, name required' });
      }

      const { data, error } = await supabase
        .from('trainer_templates')
        .insert({
          trainer_id: trainerId,
          type,
          name,
          description: description || '',
          template_data: templateData || {},
          tags: tags || []
        })
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/trainer/templates/:trainerId?type=workout
  app.get('/api/trainer/templates/:trainerId', async (req, res) => {
    try {
      let query = supabase
        .from('trainer_templates')
        .select('*')
        .eq('trainer_id', req.params.trainerId)
        .order('updated_at', { ascending: false });

      if (req.query.type) query = query.eq('type', req.query.type);

      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/trainer/templates/:templateId
  app.patch('/api/trainer/templates/:templateId', async (req, res) => {
    try {
      const updates = { ...req.body, updated_at: new Date().toISOString() };
      delete updates.trainer_id;

      const { data, error } = await supabase
        .from('trainer_templates')
        .update(updates)
        .eq('id', req.params.templateId)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/trainer/templates/:templateId
  app.delete('/api/trainer/templates/:templateId', async (req, res) => {
    try {
      const { error } = await supabase
        .from('trainer_templates')
        .delete()
        .eq('id', req.params.templateId);

      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────
  // ASSIGNED PLANS
  // ──────────────────────────────────────────

  // POST /api/trainer/assign-plan — assign a plan to client
  app.post('/api/trainer/assign-plan', async (req, res) => {
    try {
      const { trainerId, clientId, templateId, type, name, planData, notes, startsAt, endsAt } = req.body;
      if (!trainerId || !clientId || !type || !name) {
        return res.status(400).json({ error: 'trainerId, clientId, type, name required' });
      }

      // Deactivate any existing active plan of same type for this client from this trainer
      await supabase
        .from('assigned_plans')
        .update({ status: 'replaced', updated_at: new Date().toISOString() })
        .eq('trainer_id', trainerId)
        .eq('client_id', clientId)
        .eq('type', type)
        .eq('status', 'active');

      const { data, error } = await supabase
        .from('assigned_plans')
        .insert({
          trainer_id: trainerId,
          client_id: clientId,
          template_id: templateId || null,
          type,
          name,
          plan_data: planData || {},
          notes: notes || null,
          starts_at: startsAt || new Date().toISOString().split('T')[0],
          ends_at: endsAt || null
        })
        .select()
        .single();

      if (error) throw error;

      // Increment template times_assigned
      if (templateId) {
        await supabase.rpc('increment_template_assigned', { tid: templateId });
      }

      // Send system message in chat
      const { data: convo } = await supabase
        .from('conversations')
        .select('id')
        .eq('trainer_id', trainerId)
        .eq('client_id', clientId)
        .single();

      if (convo) {
        await supabase.from('messages').insert({
          conversation_id: convo.id,
          sender_id: trainerId,
          content: `Assigned new ${type} plan: ${name}`,
          message_type: 'plan_share',
          metadata: { plan_id: data.id, plan_type: type }
        });

        await supabase.from('conversations').update({
          last_message_at: new Date().toISOString(),
          last_message_preview: `New ${type} plan: ${name}`,
          client_unread: supabase.sql`client_unread + 1`
        }).eq('id', convo.id);
      }

      res.json(data);
    } catch (err) {
      console.error('Assign plan error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/trainer/assigned-plans/:clientId — get client's assigned plans
  app.get('/api/trainer/assigned-plans/:clientId', async (req, res) => {
    try {
      let query = supabase
        .from('assigned_plans')
        .select('*, trainer:users!assigned_plans_trainer_id_fkey(full_name)')
        .eq('client_id', req.params.clientId)
        .order('created_at', { ascending: false });

      if (req.query.status) query = query.eq('status', req.query.status);
      if (req.query.type) query = query.eq('type', req.query.type);

      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────
  // CHAT / MESSAGING
  // ──────────────────────────────────────────

  // GET /api/trainer/conversations/:userId — list conversations
  app.get('/api/trainer/conversations/:userId', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          trainer:users!conversations_trainer_id_fkey(id, full_name),
          client:users!conversations_client_id_fkey(id, full_name)
        `)
        .or(`trainer_id.eq.${req.params.userId},client_id.eq.${req.params.userId}`)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (error) throw error;
      res.json(data || []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/trainer/messages/:conversationId — get messages
  app.get('/api/trainer/messages/:conversationId', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const before = req.query.before; // cursor pagination

      let query = supabase
        .from('messages')
        .select('*, sender:users!messages_sender_id_fkey(full_name)')
        .eq('conversation_id', req.params.conversationId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (before) query = query.lt('created_at', before);

      const { data, error } = await query;
      if (error) throw error;
      res.json((data || []).reverse()); // return chronological
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/trainer/messages — send message
  app.post('/api/trainer/messages', async (req, res) => {
    try {
      const { conversationId, senderId, content, messageType, metadata } = req.body;
      if (!conversationId || !senderId || !content) {
        return res.status(400).json({ error: 'conversationId, senderId, content required' });
      }

      const { data: msg, error: msgErr } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          content,
          message_type: messageType || 'text',
          metadata: metadata || {}
        })
        .select('*, sender:users!messages_sender_id_fkey(full_name)')
        .single();

      if (msgErr) throw msgErr;

      // Get conversation to figure out who the other person is
      const { data: convo } = await supabase
        .from('conversations')
        .select('trainer_id, client_id')
        .eq('id', conversationId)
        .single();

      if (convo) {
        const isTrainer = senderId === convo.trainer_id;
        const unreadField = isTrainer ? 'client_unread' : 'trainer_unread';

        // Raw SQL increment since supabase-js doesn't support increment natively
        const { error: convoErr } = await supabase
          .from('conversations')
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: content.substring(0, 100)
          })
          .eq('id', conversationId);

        // Increment unread via raw SQL
        await supabase.rpc('increment_unread', {
          convo_id: conversationId,
          field_name: unreadField
        });
      }

      res.json(msg);
    } catch (err) {
      console.error('Send message error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/trainer/messages/read — mark messages as read
  app.post('/api/trainer/messages/read', async (req, res) => {
    try {
      const { conversationId, userId } = req.body;

      // Mark all unread messages from the other person as read
      await supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .is('read_at', null);

      // Get conversation to reset the right unread counter
      const { data: convo } = await supabase
        .from('conversations')
        .select('trainer_id, client_id')
        .eq('id', conversationId)
        .single();

      if (convo) {
        const isTrainer = userId === convo.trainer_id;
        const field = isTrainer ? 'trainer_unread' : 'client_unread';
        await supabase
          .from('conversations')
          .update({ [field]: 0 })
          .eq('id', conversationId);
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────
  // CLIENT PROGRESS (trainer reads client data)
  // ──────────────────────────────────────────

  // GET /api/trainer/client-progress/:trainerId/:clientId
  app.get('/api/trainer/client-progress/:trainerId/:clientId', async (req, res) => {
    try {
      const { trainerId, clientId } = req.params;

      // Verify trainer-client relationship exists
      const { data: rel } = await supabase
        .from('trainer_clients')
        .select('id')
        .eq('trainer_id', trainerId)
        .eq('client_id', clientId)
        .eq('status', 'active')
        .single();

      if (!rel) {
        return res.status(403).json({ error: 'Not authorized to view this client' });
      }

      // Fetch client profile
      const { data: client } = await supabase
        .from('users')
        .select('*')
        .eq('id', clientId)
        .single();

      // Recent workout logs (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: workoutLogs } = await supabase
        .from('workout_logs')
        .select('*')
        .eq('user_id', clientId)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false });

      // Recent food logs (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const { data: foodLogs } = await supabase
        .from('food_logs')
        .select('*')
        .eq('user_id', clientId)
        .gte('log_date', weekAgo)
        .order('log_date', { ascending: false });

      // Progress entries
      const { data: progressEntries } = await supabase
        .from('progress_entries')
        .select('*')
        .eq('user_id', clientId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Progress photos (last 5)
      const { data: progressPhotos } = await supabase
        .from('progress_photos')
        .select('*')
        .eq('user_id', clientId)
        .order('created_at', { ascending: false })
        .limit(5);

      // Personal records
      const { data: prs } = await supabase
        .from('personal_records')
        .select('*')
        .eq('user_id', clientId)
        .order('achieved_at', { ascending: false })
        .limit(10);

      // Macros
      const { data: macros } = await supabase
        .from('user_macros')
        .select('*')
        .eq('user_id', clientId)
        .single();

      // Active assigned plans from this trainer
      const { data: assignedPlans } = await supabase
        .from('assigned_plans')
        .select('*')
        .eq('client_id', clientId)
        .eq('trainer_id', trainerId)
        .order('created_at', { ascending: false });

      res.json({
        client,
        macros,
        workoutLogs: workoutLogs || [],
        foodLogs: foodLogs || [],
        progressEntries: progressEntries || [],
        progressPhotos: progressPhotos || [],
        personalRecords: prs || [],
        assignedPlans: assignedPlans || []
      });
    } catch (err) {
      console.error('Client progress error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  console.log('✅ Trainer routes loaded');
};
