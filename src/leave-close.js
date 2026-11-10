import { isAdmin, getAttendanceTeam } from './config.js'

const endpoint='https://us-central1-workdotpk-a06dc.cloudfunctions.net/leaveClose'
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export function renderMonthlyClose(container, ctx, month) {
  if(!container) return
  if(!isAdmin(ctx.currentUser.email)) { container.innerHTML=''; return }
  container.innerHTML=`<div class="attendance-holidays-section"><h3>Monthly leave close · ${esc(month)}</h3>
    <p>Review each statement before closing the month. Deductions are applied to the monthly payout; unused leave expires at renewal.</p>
    <details><summary>October 2026 contract setup</summary><p>Set Sharang and Mohit to October 1, 2026–March 31, 2027, with three medical days each. End overlapping earlier terms on September 30. No leave transfers.</p><button id="close-renewals" class="btn-ghost">Apply agreed October renewals</button></details>
    <label>Person <select id="close-person" class="form-select">${getAttendanceTeam().map(m=>`<option value="${m.email}">${esc(m.name)} · Full Time</option>`).join('')}</select></label>
    <label>Monthly fee (INR) <input id="close-fee" class="form-input" type="number" min="0" step="0.01" placeholder="Agreed fee for this month"></label>
    <button id="close-preview" class="btn-ghost">Review statement</button>
    <div id="close-statement" aria-live="polite"></div></div>`
  const output=container.querySelector('#close-statement')
  container.querySelector('#close-renewals').onclick=async()=>{
    const button=container.querySelector('#close-renewals');button.disabled=true
    try {
      const token=await ctx.currentUser.getIdToken()
      const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'applyOctoberRenewals'})})
      const result=await response.json();if(!response.ok) throw new Error(result.error)
      output.textContent='October renewals saved for Sharang and Mohit. Balances start fresh.'
    } catch(err) {output.textContent=err.message;button.disabled=false}
  }
  container.querySelector('#close-preview').onclick=async()=>{
    const userEmail=container.querySelector('#close-person').value, raw=container.querySelector('#close-fee').value
    if(raw==='') { output.textContent='Enter the agreed monthly fee.'; return }
    output.textContent='Loading statement…'
    try {
      const token=await ctx.currentUser.getIdToken()
      const response=await fetch(endpoint+'?'+new URLSearchParams({userEmail,month,monthlyFee:raw}),{headers:{Authorization:`Bearer ${token}`}})
      const statement=await response.json()
      if(!response.ok) throw new Error(statement.error)
      show(statement,token)
    } catch(err) { output.textContent=err.message }
  }
  function show(s,token) {
    const fmt=n=>Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2})
    output.innerHTML=`<h4>${esc(s.userEmail)} · ${esc(s.month)} · ${esc(s.status)}</h4>
      <p>Opening personal: ${fmt(s.opening.personal.available)} · Opening medical: ${fmt(s.opening.medical.available)}<br>
      Closing personal: ${fmt(s.closing.personal.available)} · Closing medical: ${fmt(s.closing.medical.available)}</p>
      ${(s.credits||[]).map(c=>`<p>${esc(c.date)}: +${fmt(c.days)} ${esc(c.type)} (${esc(c.reason)})</p>`).join('')}
      <table><thead><tr><th>Date</th><th>Type</th><th>Days</th><th>Paid</th><th>Unpaid</th></tr></thead><tbody>${s.entries.map(e=>`<tr><td>${esc(e.date)}</td><td>${esc(e.type)}</td><td>${fmt(e.days)}</td><td>${fmt(e.paidDays)}</td><td>${fmt(e.unpaidDays)} ${esc(e.error||'')}</td></tr>`).join('')}</tbody></table>
      <p>Fee ₹${fmt(s.monthlyFee)} ÷ ${fmt(s.scheduledWorkingDays)} working days × ${fmt(s.unpaidDays)} unpaid days = <strong>₹${fmt(s.deduction)}</strong></p>
      ${(s.adjustments||[]).map(a=>`<p>${esc(a.sourceMonth)} correction: ₹${fmt(a.amount)}</p>`).join('')}
      <p><strong>Total payout deduction: ₹${fmt(s.totalDeduction)}</strong>${s.totalDeduction<0?' (credit)':''}</p>
      <p>January 26, August 15, October 2 and explicitly approved studio holidays are excluded. No deduction is sent to PK Money automatically.</p>
      <button id="close-download" class="btn-ghost">Download statement</button>
      ${s.status==='closed'?`<p>Locked by ${esc(s.closedBy)}. Corrections will appear on a subsequent close.</p>`:'<button id="close-finalize" class="btn-primary">Close month and lock statement</button>'}`
    output.querySelector('#close-download').onclick=()=>{
      const content=output.cloneNode(true)
      content.querySelectorAll('button').forEach(b=>b.remove())
      const html=`<!doctype html><html><head><meta charset="utf-8"><title>PK Work leave statement</title><style>body{font:15px system-ui;max-width:900px;margin:40px auto;color:#17202a}table{border-collapse:collapse;width:100%}td,th{padding:9px;border-bottom:1px solid #ddd;text-align:left}h1{font-size:24px}@media print{body{margin:0}}</style></head><body><h1>PK Work · Monthly leave deduction statement</h1>${content.innerHTML}</body></html>`
      const blob=new Blob([html],{type:'text/html'})
      const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download=`leave-${s.userEmail}-${s.month}.html`;a.click();URL.revokeObjectURL(url)
    }
    const button=output.querySelector('#close-finalize')
    if(button) button.onclick=async()=>{
      if(!confirm(`Lock ${s.month} with a ₹${fmt(s.totalDeduction)} payout deduction?`)) return
      button.disabled=true
      try {
        const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({userEmail:s.userEmail,month:s.month,monthlyFee:s.monthlyFee,previewRevision:s.previewRevision})})
        const saved=await response.json();if(!response.ok) throw new Error(saved.error)
        show(saved,token)
      } catch(err) { button.disabled=false;alert(err.message) }
    }
  }
}
