// Payment mail body. Used by the app preview (outstanding/index.html) and by the mail service (supabase/send-mail). Keep both copies identical.
// kind: 'inv' = invoice copy mail (first mail), 'out' = outstanding mail (first mail, overdue),
//       'fu'  = follow-up before the due date, 'rem' = Reminder N after the due date.
function mailBody(party, rows, kind, remN, today){
  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const M3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DS = s => { if (!s) return '—'; const [y, m, d] = s.split('-'); return d + '-' + M3[+m - 1] + '-' + y.slice(2); };
  const DN = s => { const [y, m, d] = s.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };
  const N2 = n => (n || 0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
  const RS = n => '₹' + Math.trunc(n || 0).toLocaleString('en-IN');
  const T = DN(today), od = e => e.due ? T - DN(e.due) : null, left = e => e.due ? DN(e.due) - T : null;
  const total = rows.reduce((a, e) => a + (e.amount || 0), 0), over = rows.some(e => e.due && e.due < today);
  if (kind === 'out' && !over) kind = 'fu';
  if (kind === 'fu' && over) kind = 'rem';
  const td = 'border:1px solid #000;padding:5px 10px;';
  const th = (t, x) => `<th style="${td}font-weight:normal;text-align:center${x || ''}">${t}</th>`;
  const lastCol = kind === 'inv' ? '' : (over ? 'Overdue' : 'Due');
  const cell = e => kind === 'inv' ? '' : `<td style="${td}text-align:center">${!e.due ? '—' : over ? (od(e) > 0 ? od(e) : '—') : (left(e) === 0 ? 'Today' : left(e))}</td>`;
  const cols = kind === 'inv' ? 4 : 5;
  const body = rows.map(e => `<tr><td style="${td}text-align:center">${DS(e.date)}</td><td style="${td}text-align:center">${E(e.ref || '—')}</td><td style="${td}text-align:right">${N2(e.amount)}</td><td style="${td}text-align:center">${DS(e.due)}</td>${cell(e)}</tr>`).join('');
  const tot = rows.length > 1 ? `<tr><td style="${td}font-weight:bold" colspan="2">Total</td><td style="${td}text-align:right;font-weight:bold">${N2(total)}</td><td style="${td}" colspan="${cols - 3}"></td></tr>` : '';
  const table = `<table style="border-collapse:collapse;font-family:Verdana,Arial,sans-serif;font-size:13px;margin:10px 0"><tr><td colspan="${cols}" style="${td}text-align:center;font-weight:bold">${E(party)}</td></tr><tr>${th('Date')}${th('Inv Num')}${th(kind === 'inv' ? 'Amount' : 'Pending Amt')}${th('Due Date')}${lastCol ? th(lastCol, ';font-style:italic') : ''}</tr>${body}${tot}</table>`;
  const p = t => `<p style="margin:0 0 12px">${t}</p>`;
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
function nextKind(t, rows, today){
  if (!t) return null;
  const over = rows.some(e => e.due && e.due < today);
  return over ? {kind:'rem', remN:(t.remCount != null ? t.remCount : Math.max(0, (t.count || 1) - 1)) + 1} : {kind:'fu', remN:0};
}
