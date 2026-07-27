import { configured, notConfigured, rest, auth, clip } from './_lib.js';
import { runAgent } from './_agent.js';

// The SMS front door. Two callers:
//  - Twilio (or any SMS provider) webhooks: form-encoded {To, From, Body} —
//    routed to the business whose phone_line matches To. Replies with TwiML.
//  - The in-app simulator: JSON {simulate:true, business_id, from, body} with
//    a user JWT — same pipeline, JSON reply. Lets the flow run before a real
//    number is wired up.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!configured()) return notConfigured(res);

  const body = req.body || {};
  const isSim = body.simulate === true;

  try {
    let business = null;
    let customerPhone = '';
    let inbound = '';

    if (isSim) {
      // Simulator requires a signed-in workspace user with access to the business.
      const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!jwt) return res.status(401).json({ error: 'Sign in required' });
      let caller;
      try {
        caller = await auth('GET', '/user', undefined, jwt);
      } catch {
        return res.status(401).json({ error: 'Invalid session' });
      }
      const businessId = clip(body.business_id, 40);
      const profile = await rest('GET', `/profiles?user_id=eq.${caller.id}&select=role`);
      const isOwner = profile?.[0]?.role === 'owner';
      if (!isOwner) {
        const member = await rest(
          'GET',
          `/business_members?business_id=eq.${businessId}&user_id=eq.${caller.id}&select=user_id`
        );
        if (!member?.length) return res.status(403).json({ error: 'No access to this business' });
      }
      const rows = await rest('GET', `/businesses?id=eq.${businessId}&select=*`);
      business = rows?.[0];
      customerPhone = clip(body.from, 30) || 'simulator';
      inbound = clip(body.body, 500);
    } else {
      // Provider webhook: route by the receiving number.
      const to = normalizePhone(body.To);
      customerPhone = clip(body.From, 30);
      inbound = clip(body.Body, 500);
      if (to) {
        const rows = await rest(
          'GET',
          `/businesses?phone_line=eq.${encodeURIComponent(to)}&select=*`
        );
        business = rows?.[0];
      }
      if (!business) return twiml(res, null); // unknown number: stay silent
    }

    if (!business) return res.status(404).json({ error: 'Business not found' });
    if (!inbound) return isSim ? res.status(400).json({ error: 'Empty message' }) : twiml(res, null);

    // Find or open the conversation for this customer.
    const convos = await rest(
      'GET',
      `/conversations?business_id=eq.${business.id}&customer_phone=eq.${encodeURIComponent(customerPhone)}&status=neq.closed&order=created_at.desc&limit=1`
    );
    let convo = convos?.[0];
    if (!convo) {
      const created = await rest(
        'POST',
        '/conversations',
        [{
          business_id: business.id,
          customer_phone: customerPhone,
          channel: isSim ? 'simulator' : 'sms',
        }],
        { Prefer: 'return=representation' }
      );
      convo = created[0];
    }

    // Cap runaway threads (public endpoint hygiene).
    const history = await rest(
      'GET',
      `/messages?conversation_id=eq.${convo.id}&select=direction,body,created_at&order=created_at.asc&limit=40`
    );
    if (history.length >= 38) {
      const capMsg = `This thread is getting long — ${business.name} will take it from here. 👋`;
      return isSim ? res.status(200).json({ reply: capMsg, capped: true }) : twiml(res, capMsg);
    }

    await rest('POST', '/messages', [{ conversation_id: convo.id, direction: 'in', body: inbound }]);

    // Quoted conversations get a gentle wrap-up instead of re-quoting.
    if (convo.status === 'quoted') {
      const done = `Your estimate is in — ${business.name} will follow up shortly. Reply here if anything changed and the owner will see it.`;
      await rest('POST', '/messages', [{ conversation_id: convo.id, direction: 'out', body: done }]);
      return isSim ? res.status(200).json({ reply: done }) : twiml(res, done);
    }

    const out = await runAgent({ business, conversation: convo, history, inbound });

    let reply = out.reply;
    let quote = null;

    if (out.estimate) {
      quote = await createQuote(business, convo, customerPhone, out.estimate);
      const lo = out.estimate.items.reduce((s, i) => s + (i.qty || 1) * (i.low || 0), 0);
      const hi = out.estimate.items.reduce((s, i) => s + (i.qty || 1) * (i.high || 0), 0);
      const range = lo || hi ? `$${lo}–$${hi}` : 'price to be confirmed';
      const link = `https://www.quikquoteai.com/q?t=${quote.share_token}`;
      const estText = `${out.estimate.customer_name.split(/\s/)[0]}, here's your estimate from ${business.name}: ${out.estimate.service} — ${range}. Full receipt (you can accept right there): ${link}`;
      reply = reply ? `${reply}\n${estText}` : estText;
    }

    if (!reply) reply = `Got it — ${business.name} will follow up shortly.`;

    await rest('POST', '/messages', [{ conversation_id: convo.id, direction: 'out', body: reply }]);
    await rest('PATCH', `/conversations?id=eq.${convo.id}`, {
      slots: out.slots || convo.slots,
      ...(quote ? { status: 'quoted', quote_id: quote.id, customer_name: out.estimate.customer_name } : {}),
    });

    return isSim
      ? res.status(200).json({ reply, quote: quote ? { id: quote.id, est_no: quote.est_no, share_token: quote.share_token } : null })
      : twiml(res, reply);
  } catch (err) {
    console.error('sms handler failed:', err.message || err);
    if (isSim) return res.status(500).json({ error: err.message || 'SMS pipeline failed' });
    return twiml(res, 'Sorry — something hiccuped on our end. The owner has been notified; please try again in a bit.');
  }
}

async function createQuote(business, convo, customerPhone, est) {
  const [quote] = await rest(
    'POST',
    '/quotes',
    [{
      business_id: business.id,
      customer_name: clip(est.customer_name, 200) || 'SMS customer',
      customer_phone: customerPhone === 'simulator' ? '' : customerPhone,
      service: clip(est.service, 300),
      details: clip(est.details, 2000),
      window_label: clip(est.window_label, 120),
      status: 'sent',
    }],
    { Prefer: 'return=representation' }
  );

  const items = (est.items || [])
    .filter((i) => String(i.label || '').trim())
    .slice(0, 12)
    .map((i, idx) => ({
      quote_id: quote.id,
      label: clip(i.label, 300),
      qty: Number(i.qty) || 1,
      low: Number(i.low) || 0,
      high: Number(i.high) || 0,
      sort: idx,
    }));
  if (items.length) await rest('POST', '/quote_items', items);

  await rest('POST', '/activities', [{
    business_id: business.id,
    quote_id: quote.id,
    kind: 'system',
    body: `Text agent sent estimate Nº ${String(quote.est_no).padStart(4, '0')} to ${quote.customer_name} over ${convo.channel === 'simulator' ? 'the simulator' : 'SMS'}.`,
  }]);

  return quote;
}

function normalizePhone(v) {
  const digits = String(v || '').replace(/[^\d+]/g, '');
  return digits.length >= 7 ? digits : '';
}

function twiml(res, message) {
  res.setHeader('Content-Type', 'text/xml');
  const inner = message
    ? `<Message>${String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>`
    : '';
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);
}
