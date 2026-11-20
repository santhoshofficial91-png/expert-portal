import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.14';
import { ImapFlow } from 'npm:imapflow@1.0.164';

// Payment mail service.
// One thread = one customer + the invoices of its first mail. Reminders go into the same Gmail thread (Reply All).
// Called by the app (user JWT) or by pg_cron every 5 minutes (x-cron-key) for automatic reminders and reply checks.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const pkey = (p: string) => String(p || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 120);
const emails = (v: unknown) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map((x) => String(x).trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const MAIL_USER = Deno.env.get('GMAIL_USER') || 'expertcorporatesolutions2023@gmail.com';
const MAIL_PASS = (Deno.env.get('GMAIL_APP_PASSWORD') || '').replace(/\s+/g, '');
const IST = 330 * 60000;
const istNow = () => new Date(Date.now() + IST);           // shifted clock: read with getUTC*
const TODAY = () => istNow().toISOString().slice(0, 10);
const dn = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };

/* ---------- mail body: generated from supabase/mailtpl.js (same as the app preview) ---------- */
// deno-lint-ignore-file no-explicit-any
// Payment mail body. Used by the app preview (outstanding/index.html) and by the mail service (supabase/send-mail). Keep both copies identical.
// kind: 'inv' = invoice copy mail (first mail), 'out' = outstanding mail (first mail, overdue),
//       'fu'  = follow-up before the due date, 'rem' = Reminder N after the due date.
function mailBody(party: string, rows: any[], kind: string, remN: number, today: string): string {
  const E = (s: any) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const M3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DS = (s: any) => { if (!s) return '—'; const [y, m, d] = s.split('-'); return d + '-' + M3[+m - 1] + '-' + y.slice(2); };
  const DN = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };
  const N2 = (n: number) => (n || 0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
  const RS = (n: number) => '₹' + Math.trunc(n || 0).toLocaleString('en-IN');
  const T = DN(today), od = (e: any) => e.due ? T - DN(e.due) : null, left = (e: any) => e.due ? DN(e.due) - T : null;
  const total = rows.reduce((a, e) => a + (e.amount || 0), 0), over = rows.some(e => e.due && e.due < today);
  if (kind === 'out' && !over) kind = 'fu';
  if (kind === 'fu' && over) kind = 'rem';
  const td = 'border:1px solid #000;padding:5px 10px;';
  const th = (t: string, x?: string) => `<th style="${td}font-weight:normal;text-align:center${x || ''}">${t}</th>`;
  const lastCol = kind === 'inv' ? '' : (over ? 'Overdue' : 'Due');
  const cell = (e: any) => kind === 'inv' ? '' : `<td style="${td}text-align:center">${!e.due ? '—' : over ? (od(e) > 0 ? od(e) : '—') : (left(e) === 0 ? 'Today' : left(e))}</td>`;
  const cols = kind === 'inv' ? 4 : 5;
  const body = rows.map(e => `<tr><td style="${td}text-align:center">${DS(e.date)}</td><td style="${td}text-align:center">${E(e.ref || '—')}</td><td style="${td}text-align:right">${N2(e.amount)}</td><td style="${td}text-align:center">${DS(e.due)}</td>${cell(e)}</tr>`).join('');
  const tot = rows.length > 1 ? `<tr><td style="${td}font-weight:bold" colspan="2">Total</td><td style="${td}text-align:right;font-weight:bold">${N2(total)}</td><td style="${td}" colspan="${cols - 3}"></td></tr>` : '';
  const table = `<table style="border-collapse:collapse;font-family:Verdana,Arial,sans-serif;font-size:13px;margin:10px 0"><tr><td colspan="${cols}" style="${td}text-align:center;font-weight:bold">${E(party)}</td></tr><tr>${th('Date')}${th('Inv Num')}${th(kind === 'inv' ? 'Amount' : 'Pending Amt')}${th('Due Date')}${lastCol ? th(lastCol, ';font-style:italic') : ''}</tr>${body}${tot}</table>`;
  const p = (t: string) => `<p style="margin:0 0 12px">${t}</p>`;
  const sign = (kind === 'inv' ? p('Thank you for your business.') : p('Thank you for your cooperation.')) + `<p style="margin:0">Best Regards,<br>Accounts Department<br>Expert Corporate Solutions</p>`;
  const inv = rows.length > 1 ? 'invoices' : 'invoice', are = rows.length > 1 ? 'are' : 'is';
  const odDays = rows.map(od).filter(x => x > 0), maxOd = odDays.length ? Math.max(...odDays) : 0;
  const dd = rows.map(left).filter(x => x != null), dmin = dd.length ? Math.min(...dd) : null;
  if (kind === 'inv') return p('Dear Customer,') + p(`Please find attached our ${inv} for your reference. Kindly account the same in your books.`) + table +
    p('Kindly arrange the payment on or before the due date as per the agreed payment terms.') + sign;
  if (kind === 'rem') return `<div style="text-align:center;font-weight:bold;font-size:15px;margin:0 0 12px">Reminder ${remN || 1}</div>` + p('Dear Customer,') +
    p(`We have not yet received any reply to our previous mail regarding the outstanding ${inv} below. The payment of ${RS(total)} is still pending.`) + table +
    p('Kindly reply to this mail and confirm the date on which the payment will be released, so that we can update our records accordingly.') + sign;
  if (kind === 'out') return p('Dear Customer,') + p(`This is a gentle reminder regarding the outstanding ${inv} below, which ${are} still pending for payment.`) + table +
    p(`The payment of ${RS(total)} is currently overdue by ${odDays.length > 1 && new Set(odDays).size > 1 ? 'up to ' : ''}${maxOd} days against the agreed payment terms.`) +
    p('We kindly request you to check the status and arrange for the payment release at the earliest. Also, please share the confirmed payment release date so that we can update our records accordingly.') + sign;
  return p('Dear Customer,') + p(`This is a gentle reminder that the payment of ${RS(total)} will become due ${dmin === 0 ? 'today' : dmin == null ? 'soon' : 'in ' + dmin + ' day' + (dmin === 1 ? '' : 's')}, as per the agreed payment terms.`) + table +
    p('We kindly request you to arrange the payment on or before the due date to ensure timely settlement.') + sign;
}
// What the next mail of a thread is: before the due date a follow-up, after it Reminder N.
function nextKind(t: any, rows: any[], today: string): any {
  if (!t) return null;
  const over = rows.some(e => e.due && e.due < today);
  return over ? {kind:'rem', remN:(t.remCount != null ? t.remCount : Math.max(0, (t.count || 1) - 1)) + 1} : {kind:'fu', remN:0};
}

/* ---------- helpers ---------- */
const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const getDoc = async (col: string, id: string) => (await admin.from('docs').select('data').eq('col', col).eq('id', id).maybeSingle()).data?.data ?? null;
const putDoc = (col: string, id: string, data: unknown) => admin.from('docs').upsert({ col, id, data });
async function threadRows(t: any) {
  const { data } = await admin.from('docs').select('id,data').eq('col', 'entries').eq('data->>party', t.party);
  return (data ?? []).map((r: any) => ({ ...r.data, id: r.id })).filter((e: any) => (t.ids ?? []).includes(e.id) || (!(t.ids ?? []).length && (t.invs ?? []).includes(e.ref)));
}
const when = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

async function sendInThread(o: { t: any; id: string; party: string; to: string[]; cc: string[]; html: string; n: number; inv: string[]; ids: string[]; amount: number; by: string; byName: string; auto?: boolean; kind?: string; type?: string; contactId?: string; contactName?: string; files?: { filename: string; content: string; contentType?: string }[] }) {
  const t = o.t, now = new Date();
  const firstSubject = (o.type === 'inv' ? 'Invoice - ' : 'Payment Reminder - ') + o.party + (o.inv.length ? ' - ' + o.inv[0] + (o.inv.length > 1 ? ' & ' + (o.inv.length - 1) + ' more' : '') : '');
  const baseSubject = t ? String(t.subject).replace(/^Re: /, '') : firstSubject;
  const msgId = `<${crypto.randomUUID()}@expertone.org>`;
  const quoted = t?.lastHtml ? `<br><div style="color:#555">On ${esc(when(new Date(t.lastAt)))}, Accounts Department &lt;${esc(MAIL_USER)}&gt; wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${t.lastHtml}</blockquote>` : '';
  const full = `<div style="font-family:Verdana,Arial,sans-serif;font-size:13px;color:#000">${o.html}</div>${quoted}`;
  const refs: string[] = t?.refs ?? [];
  const tr = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASS } });
  await tr.sendMail({
    from: { name: 'Accounts Department - Expert Corporate Solutions', address: MAIL_USER },
    to: o.to, cc: o.cc.length ? o.cc : undefined, subject: t ? 'Re: ' + baseSubject : baseSubject, html: full, messageId: msgId,
    inReplyTo: t?.lastId || undefined, references: refs.length ? refs.join(' ') : undefined,
    attachments: (o.files ?? []).map((f) => ({ filename: f.filename, content: f.content, encoding: 'base64', contentType: f.contentType || undefined })),
  });
  const log = [...(t?.log ?? []), { n: o.n, at: now.toISOString(), by: o.by, byName: o.byName, inv: o.inv, amount: o.amount, to: o.to, cc: o.cc, auto: !!o.auto, kind: o.kind, files: (o.files ?? []).map((f) => f.filename) }];
  const nt = { ...(t ?? {}), party: o.party, subject: baseSubject, count: (t?.count ?? 0) + 1, refs: [...refs, msgId].slice(-30), lastId: msgId, lastAt: now.toISOString(),
    lastHtml: full.length > 300000 ? o.html : full, to: o.to, cc: o.cc, log, startedAt: t?.startedAt ?? now.toISOString(), from: MAIL_USER,
    contactId: t ? (t.contactId ?? '') : (o.contactId || ''), contactName: t ? (t.contactName ?? 'Main contact') : (o.contactName || 'Main contact'),
    ids: t?.ids ?? o.ids, invs: t?.invs ?? o.inv, type: t ? (t.type ?? 'out') : (o.type || o.kind || 'out'),
    remCount: (t ? (t.remCount ?? Math.max(0, (t.count ?? 1) - 1)) : 0) + (o.kind === 'rem' ? 1 : 0), lastDay: TODAY() };
  const { error } = await putDoc('mailthread', o.id, nt);
  if (error) throw new Error('Mail sent, but saving failed: ' + error.message);
  return nt;
}

/* ---------- reply check through Gmail IMAP ---------- */
async function checkReplies(list: { id: string; t: any }[]) {
  if (!list.length || !MAIL_PASS) return 0;
  const cl = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: MAIL_USER, pass: MAIL_PASS }, logger: false });
  await cl.connect();
  let found = 0;
  try {
    const boxes = await cl.list();
    const all = boxes.find((b: any) => b.specialUse === '\\All')?.path || '[Gmail]/All Mail';
    const lock = await cl.getMailboxLock(all);
    try {
      for (const { id, t } of list) {
        let thr = t.gmThread;
        if (!thr && (t.refs ?? []).length) {
          const uids = await cl.search({ header: { 'message-id': t.refs[0] } }, { uid: true });
          if (uids && uids.length) { for await (const m of cl.fetch(uids.slice(-1), { threadId: true }, { uid: true })) thr = m.threadId; }
        }
        const upd: any = { ...t, lastCheck: new Date().toISOString() };
        if (thr) {
          upd.gmThread = thr;
          const uids = await cl.search({ threadId: thr }, { uid: true });
          let best: any = null;
          if (uids && uids.length) {
            for await (const m of cl.fetch(uids, { envelope: true, internalDate: true }, { uid: true })) {
              const fromA = (m.envelope?.from?.[0]?.address || '').toLowerCase();
              const at = new Date(m.internalDate || m.envelope?.date || 0);
              if (!fromA || fromA === MAIL_USER.toLowerCase() || at < new Date(t.startedAt)) continue;
              if (!best || at > best.at) best = { at, from: fromA, name: m.envelope?.from?.[0]?.name || '', subject: m.envelope?.subject || '' };
            }
          }
          if (best && (!t.repliedAt || new Date(t.repliedAt) < best.at)) {
            upd.repliedAt = best.at.toISOString(); upd.replyFrom = best.name ? `${best.name} <${best.from}>` : best.from; upd.replySubject = best.subject;
            found++;
          }
        }
        await putDoc('mailthread', id, upd);
      }
    } finally { lock.release(); }
  } finally { await cl.logout().catch(() => {}); }
  return found;
}

/* ---------- automatic mails (pg_cron every 5 minutes): one mail a day per open thread ---------- */
async function runCron() {
  const { data } = await admin.from('docs').select('id,data').eq('col', 'mailthread');
  const ths = (data ?? []).map((r: any) => ({ id: r.id, t: r.data }));
  const A = (await getDoc('meta', 'mailauto')) ?? {}, on = A.on !== false, time = /^\d\d:\d\d$/.test(A.time || '') ? A.time : '10:00';
  const ist = istNow(), today = ist.toISOString().slice(0, 10), mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const [h, m] = time.split(':').map(Number), sm = h * 60 + m, inWindow = on && mins >= sm && mins - sm < 180;
  const nowMs = Date.now();
  const due = inWindow ? ths.filter(({ t }) => !t.repliedAt && t.lastDay !== today) : [];
  const stale = ths.filter(({ t }) => !t.repliedAt && (!t.lastCheck || nowMs - new Date(t.lastCheck).getTime() > 20 * 60000));
  const toCheck = [...new Map([...due, ...stale].map((x) => [x.id, x])).values()];
  let replied = 0, sent = 0; const errs: string[] = [], skipped: string[] = [];
  const defCc = emails((await getDoc('meta', 'mailcc'))?.cc ?? '');
  try { replied = await checkReplies(toCheck); } catch (e) { errs.push('reply check: ' + (e as Error).message); }
  for (const { id } of due) {
    const t = await getDoc('mailthread', id);
    if (!t || t.repliedAt || t.lastDay === today) continue;
    const c = await getDoc('contacts', pkey(t.party));
    if (c?.autoPaused) { skipped.push(t.party + ' (paused)'); continue; }
    const rows = (await threadRows(t)).filter((e: any) => e.status !== 'Paid').sort((a: any, b: any) => (a.due || '') < (b.due || '') ? -1 : 1);
    if (!rows.length) { await putDoc('mailthread', id, { ...t, lastDay: today, allPaid: true }); continue; }
    const dd = rows.filter((e: any) => e.due).map((e: any) => dn(e.due) - dn(today)), dmin = dd.length ? Math.min(...dd) : null;
    const k = nextKind(t, rows, today);
    if (k.kind === 'fu' && (dmin == null || dmin > 7)) continue;          // follow-ups start 7 days before the due date
    const to = emails(t.to), cc = [...new Map([...emails(t.cc), ...defCc].map((x) => [x.toLowerCase(), x])).values()];
    if (!to.length) { skipped.push(t.party + ' (no mail ID)'); continue; }
    try {
      const amt = rows.reduce((a: number, e: any) => a + (e.amount || 0), 0);
      await sendInThread({ t, id, party: t.party, to, cc, html: mailBody(t.party, rows, k.kind, k.remN, today), n: t.count ?? 0, kind: k.kind, inv: rows.map((e: any) => e.ref), ids: rows.map((e: any) => e.id), amount: amt, by: 'auto', byName: 'Automatic', auto: true });
      await admin.from('docs').upsert({ col: 'activity', id: 'a_auto_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), data: { at: new Date().toISOString(), by: 'auto', byName: 'Automatic mail', action: 'Payment mail', detail: `${t.party} \u00b7 ${k.kind === 'rem' ? 'Reminder ' + k.remN : 'Follow-up (due in ' + dmin + ' days)'} (automatic) \u00b7 ${rows.length} invoice(s) \u20b9${Math.trunc(amt).toLocaleString('en-IN')}` } });
      sent++;
    } catch (e) { errs.push(t.party + ': ' + (e as Error).message); await putDoc('mailthread', id, { ...t, lastDay: today, autoErr: (e as Error).message }); }
  }
  return { on, time, checked: toCheck.length, replied, sent, skipped, errs };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const ck = req.headers.get('x-cron-key');
    if (ck) {
      const { data: s } = await admin.from('app_secrets').select('v').eq('k', 'mail_cron').maybeSingle();
      if (!s || s.v !== ck) return json({ error: 'Bad key' }, 401);
      return json(await runCron());
    }
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);
    const me = await getDoc('users', user.id);
    const role = me?.active === false ? null : me?.role;
    if (role !== 'Admin' && role !== 'Sub Admin') return json({ error: 'Only Admin and Sub Admin can send payment mails' }, 403);
    const body = await req.json();

    if (body.action === 'status') return json({ ready: !!MAIL_PASS, from: MAIL_USER });

    if (body.action === 'check') {
      const { data } = await admin.from('docs').select('id,data').eq('col', 'mailthread');
      const list = (data ?? []).map((r: any) => ({ id: r.id, t: r.data })).filter((x: any) => !body.threadId || x.id === body.threadId);
      return json({ ok: true, replied: await checkReplies(list) });
    }

    const party = String(body.party ?? '').trim();
    if (!party) return json({ error: 'Customer is required' }, 400);
    const threadId = body.threadId ? String(body.threadId) : '';
    let t: any = null;
    if (threadId) { t = await getDoc('mailthread', threadId); if (!t) return json({ error: 'This mail thread was closed. Refresh the page.' }, 409); }

    if (body.action === 'reset') {
      if (t) {
        await putDoc('mailarchive', threadId + '_' + Date.now(), { ...t, closedAt: new Date().toISOString(), closedBy: user.id });
        await admin.from('docs').delete().eq('col', 'mailthread').eq('id', threadId);
      }
      return json({ ok: true });
    }

    if (body.action === 'resume') {
      if (!t) return json({ error: 'Thread not found' }, 404);
      await putDoc('mailthread', threadId, { ...t, repliedAt: null, replyFrom: null, replySubject: null, replyIgnoredAt: new Date().toISOString(), startedAt: new Date().toISOString(), autoErr: null });
      return json({ ok: true });
    }

    if (!MAIL_PASS) return json({ error: 'Mail is not set up yet. Add the Gmail app password for ' + MAIL_USER + ' in Supabase (secret GMAIL_APP_PASSWORD).' }, 400);
    const to = emails(body.to), cc = emails(body.cc);
    if (!to.length) return json({ error: 'Add at least one valid To email ID' }, 400);
    const n = Number(body.n ?? 0), expected = t ? Number(t.count || 0) : 0;
    if (n !== expected) return json({ error: 'This mail thread changed (someone else just sent a reminder). Refresh and try again.' }, 409);
    const html = String(body.html ?? '');
    if (!html) return json({ error: 'Mail body is empty' }, 400);
    // invoice copies: first mail only, picked from the user's PC, sent straight to Gmail (not stored)
    const files = t ? [] : (Array.isArray(body.files) ? body.files : []).filter((f: any) => f && f.filename && f.content).map((f: any) => ({ filename: String(f.filename).slice(0, 150), content: String(f.content), contentType: f.contentType ? String(f.contentType) : undefined }));
    if (files.reduce((a: number, f: any) => a + f.content.length * 0.75, 0) > 15 * 1024 * 1024) return json({ error: 'Attachments are too big. Keep them under 15 MB in total.' }, 400);
    const id = threadId || pkey(party) + '_' + Date.now().toString(36);
    const kind = ['inv', 'out', 'fu', 'rem'].includes(body.kind) ? body.kind : 'out';
    const nt = await sendInThread({ files, kind, type: t ? undefined : (body.type === 'inv' ? 'inv' : 'out'), t, id, party, to, cc, html, n, inv: (body.inv ?? []).map(String), ids: (body.ids ?? []).map(String), amount: Number(body.amount ?? 0), by: user.id, byName: me?.name ?? '', contactId: String(body.contactId || ''), contactName: String(body.contactName || '') });
    const key = pkey(party), c = await getDoc('contacts', key);
    const pid = nt.contactId, ppl: any[] = c?.people ?? [];
    if (pid && ppl.some((x: any) => x.id === pid)) await putDoc('contacts', key, { ...(c ?? {}), party, people: ppl.map((x: any) => x.id === pid ? { ...x, to: to.join(', '), cc: cc.join(', ') } : x) });
    else await putDoc('contacts', key, { ...(c ?? {}), party, to: to.join(', '), cc: cc.join(', ') });
    return json({ ok: true, count: nt.count, threadId: id });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
