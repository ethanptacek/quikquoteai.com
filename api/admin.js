import { configured, notConfigured, rest, auth, clip, tempPassword } from './_lib.js';

// Owner-only actions that need the service role: creating client logins,
// resetting their passwords, revoking access. The caller's Supabase JWT is
// verified server-side and must belong to an 'owner' profile.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  if (!configured()) return notConfigured(res);

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in required' });

  let caller;
  try {
    caller = await auth('GET', '/user', undefined, jwt);
  } catch {
    return res.status(401).json({ error: 'Invalid session' });
  }
  if (!caller?.id) return res.status(401).json({ error: 'Invalid session' });

  try {
    const me = await rest(
      'GET',
      `/profiles?user_id=eq.${caller.id}&select=role`
    );
    if (me?.[0]?.role !== 'owner') {
      return res.status(403).json({ error: 'Owner access required' });
    }

    const { action } = req.body || {};

    if (action === 'create_client') {
      const email = clip(req.body.email, 320).toLowerCase();
      const fullName = clip(req.body.full_name, 200);
      const businessId = clip(req.body.business_id, 40);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: 'Valid email required' });
      }
      if (!businessId) {
        return res.status(400).json({ error: 'business_id required' });
      }

      // Existing user? profiles mirrors auth.users via trigger.
      const existing = await rest(
        'GET',
        `/profiles?email=eq.${encodeURIComponent(email)}&select=user_id,role`
      );

      let userId = existing?.[0]?.user_id;
      let password = null;

      if (!userId) {
        password = tempPassword();
        const created = await auth('POST', '/admin/users', {
          email,
          password,
          email_confirm: true,
          app_metadata: { role: 'client' },
          user_metadata: { full_name: fullName, must_change_password: true },
        });
        userId = created.id;
      }

      await rest(
        'POST',
        '/business_members',
        [{ business_id: businessId, user_id: userId }],
        { Prefer: 'resolution=merge-duplicates' }
      );

      await rest('POST', '/activities', [{
        business_id: businessId,
        author: caller.id,
        kind: 'system',
        body: `Portal access granted to ${email}.`,
      }]);

      return res.status(200).json({
        ok: true,
        user_id: userId,
        existed: !password,
        temp_password: password,
      });
    }

    if (action === 'reset_password') {
      const targetId = clip(req.body.user_id, 40);
      const target = await rest(
        'GET',
        `/profiles?user_id=eq.${targetId}&select=user_id,role`
      );
      if (!target?.[0]) return res.status(404).json({ error: 'User not found' });
      if (target[0].role !== 'client' && target[0].user_id !== caller.id) {
        return res.status(403).json({ error: 'Can only reset client passwords' });
      }
      // Merge metadata so full_name survives the update.
      const current = await auth('GET', `/admin/users/${targetId}`);
      const password = tempPassword();
      await auth('PUT', `/admin/users/${targetId}`, {
        password,
        user_metadata: {
          ...(current?.user_metadata || {}),
          must_change_password: true,
        },
      });
      return res.status(200).json({ ok: true, temp_password: password });
    }

    if (action === 'revoke_access') {
      const targetId = clip(req.body.user_id, 40);
      const businessId = clip(req.body.business_id, 40);
      await rest(
        'DELETE',
        `/business_members?business_id=eq.${businessId}&user_id=eq.${targetId}`
      );
      await rest('POST', '/activities', [{
        business_id: businessId,
        author: caller.id,
        kind: 'system',
        body: 'Portal access revoked for a member.',
      }]);
      return res.status(200).json({ ok: true });
    }

    if (action === 'clear_samples') {
      // Removes the clearly-labelled sample rows seeded at setup.
      await rest('DELETE', '/quotes?is_sample=eq.true');
      await rest('DELETE', '/leads?is_sample=eq.true');
      await rest('DELETE', '/businesses?is_sample=eq.true');
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('admin action failed:', err.message || err);
    return res.status(500).json({ error: err.message || 'Action failed' });
  }
}
