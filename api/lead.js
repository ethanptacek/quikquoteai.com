import { configured, notConfigured, rest, clip } from './_lib.js';

// Public endpoint: the marketing-site contact form writes leads into the CRM.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const body = req.body || {};

  // Honeypot: bots fill the hidden field; pretend success and drop it.
  if (body._honey) return res.status(200).json({ ok: true });

  const lead = {
    source: 'website',
    name: clip(body.name, 200),
    email: clip(body.email, 320),
    business: clip(body.business, 300),
    message: clip(body.message, 4000),
  };

  if (!lead.email && !lead.message) {
    return res.status(400).json({ error: 'Nothing to save' });
  }

  if (!configured()) return notConfigured(res);

  try {
    await rest('POST', '/leads', [lead]);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lead insert failed:', err.message);
    return res.status(500).json({ error: 'Could not save lead' });
  }
}
