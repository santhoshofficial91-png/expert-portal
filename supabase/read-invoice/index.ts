// Reads supplier details from a purchase invoice (photo or PDF) with Google Gemini.
// The key stays here as the GEMINI_API_KEY secret; the browser never sees it.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const KEY = Deno.env.get('GEMINI_API_KEY') || '';
const MODELS = (Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.8-flash').split(',').map((s) => s.trim()).filter(Boolean);
const OUR = 'Our own companies (the BUYER, never the supplier): Branditude / Excoso (GSTIN 33AAHCB4086D1ZX) and Expert Corporate Solutions (GSTIN 33AAEFE2799Q1ZS), pincode 600077.';

const PROMPT = `This is an Indian GST purchase invoice. Extract the SUPPLIER (seller / the company that issued the invoice) details.
${OUR}
Rules:
- name: the supplier's legal/trade name exactly as printed (not a logo tagline, not an invoice number, not a date).
- addr1, addr2, addr3: the supplier's address split into up to 3 short lines, in order, without the company name, GSTIN, phone or email. Put the city and pincode in the last used line.
- gstin: the supplier's 15-character GSTIN. pincode: 6 digits. mobile: 10 digits without +91, or "". email: or "".
- If a value is not printed, use "".
Return only JSON.`;

const schema = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' }, addr1: { type: 'STRING' }, addr2: { type: 'STRING' }, addr3: { type: 'STRING' },
    gstin: { type: 'STRING' }, pincode: { type: 'STRING' }, mobile: { type: 'STRING' }, email: { type: 'STRING' },
  },
  required: ['name', 'addr1', 'addr2', 'addr3', 'gstin', 'pincode', 'mobile', 'email'],
};

async function ask(model: string, mime: string, data: string, ms: number) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    signal: AbortSignal.timeout(ms),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || `Gemini error ${r.status}`), { status: r.status });
  const txt = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  return JSON.parse(txt);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const ck = req.headers.get('x-cron-key');
    let ok = false;
    if (ck) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: s } = await admin.from('app_secrets').select('v').eq('k', 'mail_cron').maybeSingle();
      ok = !!s?.v && s.v === ck;
    } else {
      const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
      const { data: { user } } = await caller.auth.getUser();
      ok = !!user;
    }
    if (!ok) return json({ error: 'Please sign in again.' }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === 'status') return json({ ready: !!KEY });
    if (!KEY) return json({ error: 'not_configured' }, 503);
    const mime = String(body.mime || '');
    const data = String(body.data || '');
    if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mime)) return json({ error: 'Send a photo or a PDF.' }, 400);
    if (!data || data.length > 14_000_000) return json({ error: 'The file is too large (max about 10 MB).' }, 400);
    // whole request must finish well inside the app's 40 s wait
    const t0 = Date.now();
    let last: Error | null = null;
    for (const m of MODELS) {
      const left = 34_000 - (Date.now() - t0);
      if (left < 4_000) break;
      try { return json({ ok: true, model: m, ms: Date.now() - t0, result: await ask(m, mime, data, left) }); }
      catch (e) { last = e as Error; console.log('gemini', m, last.name, last.message); if ((e as { status?: number }).status === 400 && !/model/i.test(last.message)) break; }
    }
    return json({ error: last?.message || 'Could not read the invoice.' }, 502);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
