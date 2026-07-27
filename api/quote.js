import { configured, notConfigured, rest } from './_lib.js';

const SELECT =
  'id,est_no,customer_name,service,details,window_label,status,is_sample,created_at,updated_at,businesses(name),quote_items(label,qty,low,high,sort)';

// Public quote page endpoints, keyed by unguessable share token.
// GET  /api/quote?t=<token>          -> quote JSON for q.html
// POST /api/quote {t, action}        -> customer accepts/declines a sent quote
export default async function handler(req, res) {
  if (!configured()) return notConfigured(res);

  const token = String(
    (req.method === 'GET' ? req.query.t : req.body?.t) || ''
  ).trim();
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(token)) {
    return res.status(400).json({ error: 'Bad token' });
  }

  try {
    const rows = await rest(
      'GET',
      `/quotes?share_token=eq.${token}&select=${encodeURIComponent(SELECT)}`
    );
    const quote = rows?.[0];
    if (!quote) return res.status(404).json({ error: 'Quote not found' });

    if (req.method === 'POST') {
      const action = req.body?.action;
      if (!['accept', 'decline'].includes(action)) {
        return res.status(400).json({ error: 'Bad action' });
      }
      if (quote.status !== 'sent') {
        return res.status(409).json({ error: 'This quote is no longer open' });
      }
      const status = action === 'accept' ? 'accepted' : 'declined';
      await rest('PATCH', `/quotes?id=eq.${quote.id}`, { status });
      await rest('POST', '/activities', [{
        quote_id: quote.id,
        kind: 'system',
        body: `Customer ${status} estimate Nº ${String(quote.est_no).padStart(4, '0')} from the public quote page.`,
      }]);
      quote.status = status;
    }

    const items = (quote.quote_items || []).sort((a, b) => a.sort - b.sort);
    return res.status(200).json({
      est_no: quote.est_no,
      business: quote.businesses?.name || 'QuikQuoteAI',
      customer_name: quote.customer_name,
      service: quote.service,
      details: quote.details,
      window_label: quote.window_label,
      status: quote.status,
      is_sample: quote.is_sample,
      created_at: quote.created_at,
      items: items.map(({ label, qty, low, high }) => ({ label, qty, low, high })),
    });
  } catch (err) {
    console.error('quote endpoint failed:', err.message);
    return res.status(500).json({ error: 'Lookup failed' });
  }
}
