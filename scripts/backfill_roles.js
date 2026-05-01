/*
Backfill role metadata for Supabase users.
Usage:
  DRY RUN (no changes):
    node scripts/backfill_roles.js --dry

  APPLY (will update users):
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill_roles.js --apply

Notes:
- This script requires the Supabase JS client and Node 18+ (fetch available).
- It uses the Admin service role key to list and update users.
- All users default to role = 'dokter_patologi'.
*/

import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const apply = args.includes('--apply');

if (!dry && !apply) {
  console.log('Please specify --dry to preview or --apply to perform updates.');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function listUsers(page = 1, perPage = 100) {
  const start = (page - 1) * perPage;
  const end = start + perPage - 1;
  const { data, error } = await supabase.auth.admin.listUsers({
    page, perPage,
  });
  if (error) throw error;
  return data?.users || [];
}

function deriveRoleFromMetadata(user) {
  return 'dokter_patologi';
}

(async () => {
  try {
    console.log(`Running backfill (${dry ? 'DRY RUN' : 'APPLY'}) against ${SUPABASE_URL}`);

    let page = 1;
    let totalUpdated = 0;
    while (true) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw error;
      const users = data?.users || [];
      if (!users.length) break;

      for (const u of users) {
        const hasRole = !!u.user_metadata?.role;
        if (!hasRole) {
          const derived = deriveRoleFromMetadata(u);
          console.log(`[${u.id}] will set role=${derived} (summary_mode=${u.user_metadata?.summary_mode})`);
          if (apply) {
            const newMeta = { ...u.user_metadata, role: derived };
            const { error: upErr } = await supabase.auth.admin.updateUserById(u.id, { user_metadata: newMeta });
            if (upErr) {
              console.error(`Failed to update ${u.id}:`, upErr.message || upErr);
            } else {
              totalUpdated++;
            }
          }
        }
      }

      if ((data?.total || 0) <= page * 100) break;
      page++;
    }

    console.log(`Done. totalUpdated=${totalUpdated}`);
    process.exit(0);
  } catch (err) {
    console.error('Script failed:', err);
    process.exit(2);
  }
})();
