// The estimating agent behind the SMS line. Two modes:
//  - AI mode (Claude, official SDK) when ANTHROPIC_API_KEY is set — converses
//    naturally, quotes strictly from the business's price book.
//  - Scripted mode otherwise — deterministic slot-filling over the same
//    price book, so the pipeline works before any AI key exists.
// Both return { reply, slots, estimate|null } and never throw.

import Anthropic from '@anthropic-ai/sdk';

/* ---------- price book ---------- */

// Lines like "Deep clean · 3bd: 240-320" (also tolerates $ signs and en dashes).
export function parsePriceBook(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)[:\-–—]\s*\$?\s*([\d,]+)\s*[-–—]\s*\$?\s*([\d,]+)\s*$/);
    if (m) {
      const low = Number(m[2].replace(/,/g, ''));
      const high = Number(m[3].replace(/,/g, ''));
      if (m[1].trim() && low > 0 && high >= low) {
        out.push({ label: m[1].trim(), low, high });
      }
    }
  }
  return out;
}

function matchOffering(book, text) {
  const words = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  let best = null;
  let bestScore = 0;
  for (const item of book) {
    const labelWords = item.label.toLowerCase().match(/[a-z0-9]+/g) || [];
    let score = 0;
    for (const w of words) {
      if (w.length < 2 && !/\d/.test(w)) continue; // keep bare digits: "3" should hit "3bd"
      if (labelWords.some((lw) => lw === w || lw.startsWith(w) || w.startsWith(lw))) score++;
    }
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore >= 1 ? best : null;
}

/* ---------- scripted mode ---------- */

function scriptedAgent({ business, slots, inbound }) {
  const book = parsePriceBook(business.price_book);
  const s = { stage: 'service', ...slots };

  const menu = () =>
    book.slice(0, 6).map((b) => `• ${b.label} ($${b.low}–$${b.high})`).join('\n');

  if (s.stage === 'service') {
    const hit = book.length ? matchOffering(book, inbound) : null;
    if (hit) {
      s.service = hit.label; s.low = hit.low; s.high = hit.high; s.stage = 'timing';
      return {
        slots: s,
        reply: `Got it — ${hit.label} usually runs $${hit.low}–$${hit.high}. When would you want it done?`,
        estimate: null,
      };
    }
    if (book.length) {
      s.stage = 'service';
      return {
        slots: s,
        reply: `Hi! I can price these right away for ${business.name}:\n${menu()}\nWhich is closest to what you need?`,
        estimate: null,
      };
    }
    // No price book yet — capture the request, the owner confirms the number.
    s.service = String(inbound).slice(0, 200); s.low = 0; s.high = 0; s.stage = 'timing';
    return {
      slots: s,
      reply: `Got it. When would you want it done? (${business.name} will confirm the price before anything is booked.)`,
      estimate: null,
    };
  }

  if (s.stage === 'timing') {
    s.window = String(inbound).slice(0, 80);
    s.stage = 'name';
    return { slots: s, reply: 'Last thing — what name should go on the estimate?', estimate: null };
  }

  if (s.stage === 'name') {
    s.name = String(inbound).slice(0, 120).replace(/^(i'?m|it'?s|this is)\s+/i, '').trim() || 'SMS customer';
    s.stage = 'done';
    return {
      slots: s,
      reply: null, // caller composes the estimate text + link
      estimate: {
        customer_name: s.name,
        service: s.service || 'Requested job',
        window_label: s.window || '',
        details: '',
        items: [{ label: s.service || 'Requested job', qty: 1, low: s.low || 0, high: s.high || 0 }],
      },
    };
  }

  return {
    slots: s,
    reply: `This estimate is already on its way — ${business.name} will follow up. Text a new request anytime!`,
    estimate: null,
  };
}

/* ---------- AI mode ---------- */

const ESTIMATE_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'The SMS reply to send the customer. Plain text, under 400 characters.',
    },
    ready: {
      type: 'boolean',
      description: 'True only when service, timing and customer name are collected and an estimate should be issued.',
    },
    estimate: {
      anyOf: [
        {
          type: 'object',
          properties: {
            customer_name: { type: 'string' },
            service: { type: 'string' },
            window_label: { type: 'string' },
            details: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  qty: { type: 'integer' },
                  low: { type: 'number' },
                  high: { type: 'number' },
                },
                required: ['label', 'qty', 'low', 'high'],
                additionalProperties: false,
              },
            },
          },
          required: ['customer_name', 'service', 'window_label', 'details', 'items'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
  },
  required: ['reply', 'ready', 'estimate'],
  additionalProperties: false,
};

async function aiAgent({ business, history, inbound }) {
  const client = new Anthropic();

  const book = String(business.price_book || '').trim();
  const system = `You are "Quik", the SMS estimating assistant for ${business.name}${business.industry ? ` (${business.industry})` : ''}.
A customer is texting the business number. Your job: scope the job, give an honest price range, capture the lead.

Price book (the ONLY prices you may quote from):
${book || '(none provided — never state a number; say the owner will confirm the price)'}

Rules:
- SMS medium: plain text, warm and brief — one or two sentences, under 400 characters. No markdown, no emoji spam (one at most).
- Ask only what changes the price or is needed for the estimate: the service (match it to a price book line), timing, and finally the customer's name.
- Quote ranges straight from the price book. Never invent prices, never promise a final figure — ranges are confirmed by the owner before work is booked.
- If the request doesn't match the price book, pick the closest line or set the range to 0 and say the owner will confirm pricing.
- One question per message. When you already have service + timing + name, set ready=true and fill the estimate (items from the price book; qty 1 unless they said otherwise).
- If asked something you can't know (availability, discounts, exact scheduling), say the owner will follow up on it.`;

  const messages = history.map((m) => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.body,
  }));
  messages.push({ role: 'user', content: inbound });

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1000,
    system,
    messages,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: ESTIMATE_SCHEMA },
    },
  });

  if (response.stop_reason === 'refusal') {
    return {
      reply: `Happy to help with ${business.name} quotes — what job can I price for you?`,
      estimate: null,
    };
  }

  const text = response.content.find((b) => b.type === 'text')?.text || '{}';
  const out = JSON.parse(text);
  return {
    reply: out.reply || null,
    estimate: out.ready && out.estimate?.items?.length ? out.estimate : null,
  };
}

/* ---------- entry point ---------- */

export async function runAgent({ business, conversation, history, inbound }) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const out = await aiAgent({ business, history, inbound });
      return { slots: conversation.slots || {}, ...out };
    } catch (err) {
      console.error('AI agent failed, falling back to scripted:', err.message);
    }
  }
  return scriptedAgent({ business, slots: conversation.slots || {}, inbound });
}
