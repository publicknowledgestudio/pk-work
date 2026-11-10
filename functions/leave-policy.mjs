// Single policy engine used by the browser and REST API. All dates are ISO studio dates.
export const ELIGIBLE = ['sharang@publicknowledge.co', 'mohit@publicknowledge.co', 'rakesh@publicknowledge.co']
export const POLICY_VERSION = '2026-11-completed-months-v1'
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date())
const date = s => new Date(s + 'T00:00:00Z')
export const nextDay = s => new Date(date(s).getTime() + 86400000).toISOString().slice(0,10)
export function addMonths(s, n) {
  const d = date(s), day = d.getUTCDate()
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0,10)
}
export function completedMonths(c, asOf = today()) {
  if (!c || asOf < c.startDate) return 0
  const cap = c.endDate && nextDay(c.endDate) < asOf ? nextDay(c.endDate) : asOf
  let n = 0; while (addMonths(c.startDate, n + 1) <= cap) n++
  return n
}
export function contractAt(contracts, email, day) {
  return contracts.filter(c => c.userEmail === email && c.startDate <= day && (!c.endDate || c.endDate >= day))
    .sort((a,b) => b.startDate.localeCompare(a.startDate))[0] || null
}
export function isHoliday(day, holidays = []) {
  return ['01-26','08-15','10-02'].includes(day.slice(5)) || holidays.some(h => h.date === day && h.studioApproved === true)
}
export function workingDay(day, holidays = []) {
  return ![0,6].includes(date(day).getUTCDay()) && !isHoliday(day, holidays)
}
export function workingDays(start, end, holidays = []) {
  let n=0; for(let d=start; d<=end; d=nextDay(d)) if(workingDay(d,holidays)) n++
  return n
}
export function calculate({userEmail, contracts = [], leaves = [], holidays = [], asOf = today()}) {
  const entries = [], balances = new Map(), seen = new Set()
  if (!ELIGIBLE.includes(userEmail)) return { eligible:false, entries, personal:{accrued:0,used:0,available:0}, medical:{accrued:0,used:0,available:0} }
  const relevant = leaves.filter(l => l.userEmail === userEmail && l.status === 'approved').sort((a,b)=>a.startDate.localeCompare(b.startDate) || ((a.type === 'overtime' ? 0 : 1) - (b.type === 'overtime' ? 0 : 1)) || String(a.id).localeCompare(String(b.id)))
  for(const l of relevant) {
    if(!['personal','medical','overtime'].includes(l.type)) continue
    const end = l.halfDay || l.type === 'overtime' ? l.startDate : (l.endDate || l.startDate)
    for(let d=l.startDate; d<=end && d<=asOf; d=nextDay(d)) {
      const c = contractAt(contracts,userEmail,d)
      if(!c) { entries.push({leaveId:l.id || '',date:d,type:l.type,days:0,paidDays:0,unpaidDays:0,error:'No contract covering leave'}); continue }
      const key = c.id || c.startDate
      if(!balances.has(key)) balances.set(key,{personalUsed:0,personalPaid:0,medicalUsed:new Map(),overtimeCredit:0})
      const b = balances.get(key), days = l.halfDay ? .5 : 1
      if(l.type === 'overtime') {
        if(l.creditApproved !== true) continue
        b.overtimeCredit += days
        entries.push({leaveId:l.id || '',date:d,type:l.type,days,paidDays:0,unpaidDays:0}); continue
      }
      if(!workingDay(d,holidays)) continue
      // Reject overlapping notices rather than charging the same absence twice.
      if(seen.has(d)) throw new Error('Overlapping leave on ' + d + ' for ' + userEmail)
      seen.add(d)
      let paidDays
      if(l.type === 'personal') {
        paidDays = Math.min(days,Math.max(0,completedMonths(c,d)+b.overtimeCredit-b.personalPaid))
        b.personalUsed += days; b.personalPaid += paidDays
      } else {
        let period=0; while(addMonths(c.startDate,(period+1)*6)<=d) period++
        const used=b.medicalUsed.get(period)||0, pool=c.medicalLeaveTotal ?? 3
        paidDays=Math.min(days,Math.max(0,pool-used)); b.medicalUsed.set(period,used+paidDays)
      }
      entries.push({leaveId:l.id || '',date:d,type:l.type,days,paidDays,unpaidDays:days-paidDays})
    }
  }
  let c = contractAt(contracts,userEmail,asOf)
  if(!c) c=contracts.filter(c=>c.userEmail===userEmail && c.startDate<=asOf).sort((a,b)=>b.startDate.localeCompare(a.startDate))[0]
  const b=balances.get(c?.id || c?.startDate) || {personalUsed:0,personalPaid:0,medicalUsed:new Map(),overtimeCredit:0}
  const accrued=completedMonths(c,asOf), termEntries=entries.filter(e=>c && e.date>=c.startDate && (!c.endDate || e.date<=c.endDate))
  let period=0; if(c) while(addMonths(c.startDate,(period+1)*6)<=asOf && (!c.endDate || addMonths(c.startDate,(period+1)*6)<=c.endDate)) period++
  const medicalUsed=b.medicalUsed.get(period)||0, pool=c ? (c.medicalLeaveTotal??3) : 0
  const expired=!!(c?.endDate && asOf>c.endDate)
  return {eligible:true,policyVersion:POLICY_VERSION,contract:c || null,entries,
    personal:{accrued,used:b.personalUsed,paidUsed:b.personalPaid,overtimeCredit:b.overtimeCredit,available:expired ? 0 : Math.max(0,accrued+b.overtimeCredit-b.personalPaid),unpaid:termEntries.filter(e=>e.type==='personal').reduce((s,e)=>s+e.unpaidDays,0)},
    medical:{accrued:pool,used:medicalUsed,totalUsed:termEntries.filter(e=>e.type==='medical').reduce((s,e)=>s+e.days,0),available:expired ? 0 : Math.max(0,pool-medicalUsed),unpaid:termEntries.filter(e=>e.type==='medical').reduce((s,e)=>s+e.unpaidDays,0)}}
}
export function monthlyStatement(input, month, monthlyFee) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month')
  const start=month+'-01', end=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10)
  const result=calculate({...input,asOf:end}), entries=result.entries.filter(e=>e.date>=start && e.date<=end)
  const errors=entries.filter(e=>e.error)
  const unpaidDays=entries.reduce((s,e)=>s+e.unpaidDays,0)
  const scheduledWorkingDays=workingDays(start,end,input.holidays)
  const credits=[]
  for(const c of input.contracts.filter(c=>c.userEmail===input.userEmail)) {
    for(let n=1; addMonths(c.startDate,n)<=end && (!c.endDate || addMonths(c.startDate,n)<=c.endDate); n++) {
      const date=addMonths(c.startDate,n)
      if(date>=start) credits.push({date,type:'personal',days:1,reason:'Completed service month'})
    }
    for(let n=0; addMonths(c.startDate,n*6)<=end && (!c.endDate || addMonths(c.startDate,n*6)<=c.endDate); n++) {
      const date=addMonths(c.startDate,n*6)
      if(date>=start) credits.push({date,type:'medical',days:c.medicalLeaveTotal??3,reason:'New six-month medical period'})
    }
  }
  const fee=Number(monthlyFee)
  if(!Number.isFinite(fee)||fee<0) throw new Error('Monthly fee must be a non-negative number')
  return {policyVersion:POLICY_VERSION,month,userEmail:input.userEmail,monthlyFee:fee,scheduledWorkingDays,unpaidDays,deduction:scheduledWorkingDays ? Math.round(fee/scheduledWorkingDays*unpaidDays*100)/100 : 0,opening:calculate({...input,asOf:new Date(date(start).getTime()-86400000).toISOString().slice(0,10)}),closing:{personal:result.personal,medical:result.medical},credits,entries,errors,status:'draft'}
}
