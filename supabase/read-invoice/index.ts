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

const PURCHASE = `This is an Indian GST purchase invoice. ${OUR}
Extract the whole invoice:
- inv_no: the invoice number. inv_date: the invoice date as YYYY-MM-DD.
- supplier_name and supplier_gstin: the SELLER who issued the invoice (never our own companies). supplier_addr1, supplier_addr2, supplier_addr3: the seller's address in up to 3 short lines without name, GSTIN, phone or email (city and pincode in the last used line). supplier_pincode (6 digits), supplier_mobile (10 digits or ""), supplier_email (or "").
- lines: one entry per product row of the goods table, in order. For each: name (description as printed), hsn (HSN/SAC code digits), qty (number), unit (e.g. NOS, PCS), rate (price per unit before tax, number), taxable (taxable value / amount of that row before tax, number), gst (GST rate % of that row, e.g. 18 or 5; if only CGST and SGST rates are printed, add them). Also suggest, from the product description, brand (the maker or brand name if it is written, else ""), category (a short general product group such as Drinkware, Bags, Stationery, Apparel, Electronics, Gifts) and sub_category (a narrower group such as Bottles, Backpacks, Pens, T-Shirts).
- po_ref: the buyer's purchase order number if it is printed (labels like "PO reference", "PO No", "Your Order No", "Buyer's Order No"); if it only says something like "order by mail", use "".
- cgst, sgst, igst: total tax amounts printed on the invoice (0 if not printed). total: the grand total of the invoice.
Numbers must be plain numbers without commas or currency signs. Skip rows that are only totals, freight notes or blank. Return only JSON.`;
const PURCHASE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    inv_no: { type: 'STRING' }, inv_date: { type: 'STRING' }, supplier_name: { type: 'STRING' }, supplier_gstin: { type: 'STRING' },
    supplier_addr1: { type: 'STRING' }, supplier_addr2: { type: 'STRING' }, supplier_addr3: { type: 'STRING' }, supplier_pincode: { type: 'STRING' }, supplier_mobile: { type: 'STRING' }, supplier_email: { type: 'STRING' },
    lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, hsn: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING' }, rate: { type: 'NUMBER' }, taxable: { type: 'NUMBER' }, gst: { type: 'NUMBER' }, brand: { type: 'STRING' }, category: { type: 'STRING' }, sub_category: { type: 'STRING' } }, required: ['name', 'hsn', 'qty', 'unit', 'rate', 'taxable', 'gst', 'brand', 'category', 'sub_category'] } },
    po_ref: { type: 'STRING' }, cgst: { type: 'NUMBER' }, sgst: { type: 'NUMBER' }, igst: { type: 'NUMBER' }, total: { type: 'NUMBER' },
  },
  required: ['inv_no', 'inv_date', 'supplier_name', 'supplier_gstin', 'lines', 'po_ref', 'cgst', 'sgst', 'igst', 'total'],
};
const DC = `This is a delivery challan, sample DC or receipt note for goods (samples) given to or returned by a customer. ${OUR}
Extract: doc_no (the challan / note number), doc_date (YYYY-MM-DD), party (the customer name, never our own companies), lines: one entry per product row with name, qty (number) and value (row value in rupees, number, 0 if not printed). Return only JSON.`;
const DC_SCHEMA = {
  type: 'OBJECT',
  properties: {
    doc_no: { type: 'STRING' }, doc_date: { type: 'STRING' }, party: { type: 'STRING' },
    lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, qty: { type: 'NUMBER' }, value: { type: 'NUMBER' } }, required: ['name', 'qty', 'value'] } },
  },
  required: ['doc_no', 'doc_date', 'party', 'lines'],
};
const PO = `This is a PURCHASE ORDER issued BY one of our own companies TO a supplier (usually printed from Tally). ${OUR}
Extract:
- po_no: the purchase order / voucher number (for example PO/991/26-27). po_date: the PO date as YYYY-MM-DD.
- enq: the enquiry number if printed (often under "Other References", or written like "ENQ-1234" or "8521-D"); the number with any letter suffix (for example 8478 or 8521-D), else "".
- supplier_name and supplier_gstin: the SUPPLIER the order is placed with (printed as "Supplier (Bill from)", "To" or "Vendor"), never our own companies. supplier_addr1, supplier_addr2, supplier_addr3: the supplier's address in up to 3 short lines (city and pincode in the last used line).
- lines: one entry per product row of the goods table, in order. For each: name (the full description; if it wraps over several lines or is split with hyphens, join it back into one readable name, and keep any trailing enquiry number such as "-8478"), hsn, qty (number, the quantity ordered / to bill), unit, rate (price per unit before tax), amount (the row amount before tax), gst (GST rate %). Also suggest, from the product description, brand (the maker or brand name if written, else ""), category (a short general product group such as Drinkware, Bags, Stationery, Apparel, Electronics, Gifts) and sub_category (a narrower group such as Bottles, Backpacks, Pens, Power Banks).
- total: the grand total (with tax).
Numbers must be plain numbers without commas or currency signs. Skip tax, round-off and total rows. Return only JSON.`;
const PO_SCHEMA = {
  type: 'OBJECT',
  properties: {
    po_no: { type: 'STRING' }, po_date: { type: 'STRING' }, enq: { type: 'STRING' }, supplier_name: { type: 'STRING' }, supplier_gstin: { type: 'STRING' },
    supplier_addr1: { type: 'STRING' }, supplier_addr2: { type: 'STRING' }, supplier_addr3: { type: 'STRING' },
    lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, hsn: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING' }, rate: { type: 'NUMBER' }, amount: { type: 'NUMBER' }, gst: { type: 'NUMBER' }, brand: { type: 'STRING' }, category: { type: 'STRING' }, sub_category: { type: 'STRING' } }, required: ['name', 'hsn', 'qty', 'unit', 'rate', 'amount', 'gst', 'brand', 'category', 'sub_category'] } },
    total: { type: 'NUMBER' },
  },
  required: ['po_no', 'po_date', 'enq', 'supplier_name', 'supplier_gstin', 'lines', 'total'],
};
const SALE = `This is an Indian GST SALES invoice issued BY one of our own companies TO a customer (usually printed from Tally). ${OUR}
Extract:
- inv_no: the invoice number (for example ECS/1639/26-27). inv_date: the invoice date as YYYY-MM-DD.
- enq: the enquiry number if printed (often under "Other References", written like "ENQ-8478"); digits only, else "".
- order_no: the "Buyer's Order No." or "Reference No." if printed, else "".
- buyer_name: the customer under "Buyer (Bill to)" (never our own companies). buyer_gstin. buyer_addr1, buyer_addr2, buyer_addr3: the buyer's address in up to 3 short lines (city and pincode in the last used line).
- ship_name and ship_addr1, ship_addr2, ship_addr3: the "Consignee (Ship to)" if it is printed and different, else "".
- lines: one entry per product row of the goods table, in order. For each: name (the full description as printed, keep any trailing enquiry number such as "-8478"), hsn, qty (number), unit, rate (price per unit before tax), amount (row amount before tax).
- total: the grand total.
Numbers must be plain numbers without commas or currency signs. Skip tax, round-off and total rows. Return only JSON.`;
const SALE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    inv_no: { type: 'STRING' }, inv_date: { type: 'STRING' }, enq: { type: 'STRING' }, order_no: { type: 'STRING' },
    buyer_name: { type: 'STRING' }, buyer_gstin: { type: 'STRING' }, buyer_addr1: { type: 'STRING' }, buyer_addr2: { type: 'STRING' }, buyer_addr3: { type: 'STRING' },
    ship_name: { type: 'STRING' }, ship_addr1: { type: 'STRING' }, ship_addr2: { type: 'STRING' }, ship_addr3: { type: 'STRING' },
    lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, hsn: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING' }, rate: { type: 'NUMBER' }, amount: { type: 'NUMBER' } }, required: ['name', 'hsn', 'qty', 'unit', 'rate', 'amount'] } },
    total: { type: 'NUMBER' },
  },
  required: ['inv_no', 'inv_date', 'enq', 'order_no', 'buyer_name', 'buyer_gstin', 'buyer_addr1', 'buyer_addr2', 'buyer_addr3', 'lines', 'total'],
};
const KINDS: Record<string, [string, unknown]> = { supplier: [PROMPT, schema], purchase: [PURCHASE, PURCHASE_SCHEMA], dc: [DC, DC_SCHEMA], po: [PO, PO_SCHEMA], sale: [SALE, SALE_SCHEMA] };

async function ask(model: string, mime: string, data: string, ms: number, prompt = PROMPT, sch: unknown = schema) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    signal: AbortSignal.timeout(ms),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data } }, { text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: sch },
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
    if (body.action === 'classify') {
      // brand / category / sub category for new stock items (from product names only)
      const names = (Array.isArray(body.names) ? body.names : []).map((x: unknown) => String(x).slice(0, 300)).slice(0, 100);
      if (!names.length) return json({ ok: true, result: [] });
      const cats = (Array.isArray(body.cats) ? body.cats : []).map(String).slice(0, 200), brands = (Array.isArray(body.brands) ? body.brands : []).map(String).slice(0, 300);
      const prompt = `For each product name below, suggest brand (the maker or brand name if it is in the name, else ""), category (a short general product group) and sub_category (a narrower group). Prefer these existing categories when one fits: ${JSON.stringify(cats)}. Prefer these existing brands when one fits: ${JSON.stringify(brands)}. Return a JSON array in the same order, one object per product.\nProducts:\n${names.map((n: string, i: number) => `${i + 1}. ${n}`).join('\n')}`;
      const sch = { type: 'ARRAY', items: { type: 'OBJECT', properties: { brand: { type: 'STRING' }, category: { type: 'STRING' }, sub_category: { type: 'STRING' } }, required: ['brand', 'category', 'sub_category'] } };
      for (const m of MODELS) {
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, signal: AbortSignal.timeout(20000),
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: sch } }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) continue;
          return json({ ok: true, model: m, result: JSON.parse(j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '[]') });
        } catch (_) { /* next model */ }
      }
      return json({ error: 'Could not suggest groups.' }, 502);
    }
    const mime = String(body.mime || '');
    const data = String(body.data || '');
    if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(mime)) return json({ error: 'Send a photo or a PDF.' }, 400);
    if (!data || data.length > 14_000_000) return json({ error: 'The file is too large (max about 10 MB).' }, 400);
    const kind = KINDS[String(body.kind || 'supplier')] || KINDS.supplier;
    // whole request must finish well inside the app's 40 s wait
    const t0 = Date.now();
    let last: Error | null = null;
    for (const m of MODELS) {
      const left = 38_000 - (Date.now() - t0);
      if (left < 4_000) break;
      try { return json({ ok: true, model: m, ms: Date.now() - t0, result: await ask(m, mime, data, left, kind[0], kind[1]) }); }
      catch (e) { last = e as Error; console.log('gemini', m, last.name, last.message); if ((e as { status?: number }).status === 400 && !/model/i.test(last.message)) break; }
    }
    return json({ error: last?.message || 'Could not read the invoice.' }, 502);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
