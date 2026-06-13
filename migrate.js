require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function run() {
  try {
    const { error } = await supabase.from('check_ins').select('id').limit(1);
    console.log("check_ins error:", error ? error.message : "None (table exists)");
    
    // Attempting to run DDL via REST API will fail because it's forbidden, but let's see if we can do an RPC call just in case
    const q = `
    CREATE TABLE IF NOT EXISTS check_ins (
      id UUID PRIMARY KEY,
      gym_id UUID NOT NULL,
      member_id UUID NOT NULL,
      user_id UUID,
      checked_in_at TIMESTAMPTZ DEFAULT NOW(),
      checked_out_at TIMESTAMPTZ,
      method TEXT DEFAULT 'manual'
    );
    `;
    const res = await supabase.rpc('exec_sql', { query: q });
    if (res.error) {
       console.log("exec_sql error:", res.error.message);
    } else {
       console.log("exec_sql success");
    }
  } catch (err) {
    console.error(err);
  }
}

run();
