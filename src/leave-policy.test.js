import { describe, it, expect } from 'vitest'
import { calculate, completedMonths, monthlyStatement, workingDays, isHoliday } from '../functions/leave-policy.mjs'
const email='sharang@publicknowledge.co'
const c={id:'new',userEmail:email,startDate:'2026-10-01',endDate:'2027-03-31'}
const leave=(id,date,type='personal',halfDay=false)=>({id,userEmail:email,startDate:date,endDate:date,type,halfDay,status:'approved'})
const input=leaves=>({userEmail:email,contracts:[c],leaves})
describe('shared leave and payroll policy',()=>{
  it('earns only at completed service month boundaries, including clamped anniversaries',()=>{
    expect(completedMonths(c,'2026-10-31')).toBe(0)
    expect(completedMonths(c,'2026-11-01')).toBe(1)
    expect(completedMonths({...c,startDate:'2026-10-20'},'2026-11-19')).toBe(0)
    expect(completedMonths({...c,startDate:'2026-10-20'},'2026-11-20')).toBe(1)
    expect(completedMonths({...c,startDate:'2026-01-31'},'2026-02-28')).toBe(1)
  })
  it('does not retroactively cover unpaid October leave with November accrual',()=>{
    const result=calculate({...input([leave('a','2026-10-05'),leave('b','2026-11-02')]),asOf:'2026-11-06'})
    expect(result.entries.map(e=>e.unpaidDays)).toEqual([1,0])
    expect(result.personal.available).toBe(0)
  })
  it('deducts first-month leave but preserves later earned credit',()=>{
    const result=calculate({...input([leave('a','2026-10-05')]),asOf:'2026-11-06'})
    expect(result.personal.available).toBe(1)
    expect(result.personal.unpaid).toBe(1)
  })
  it('resets balances at renewal without carrying prior leave or overtime',()=>{
    const old={...c,id:'old',startDate:'2026-04-01',endDate:'2026-09-30'}
    const result=calculate({...input([leave('a','2026-09-03'),leave('b','2026-10-05')]),contracts:[old,c],asOf:'2026-10-31'})
    expect(result.personal.used).toBe(1)
    expect(result.personal.accrued).toBe(0)
    expect(result.personal.unpaid).toBe(1)
  })
  it('provides three medical days up front for six months; excess is unpaid',()=>{
    const result=calculate({...input([3,4,5,6].map((n,i)=>leave(String(i),`2026-11-0${n}`,'medical'))),asOf:'2026-11-30'})
    expect(result.entries.reduce((s,e)=>s+e.paidDays,0)).toBe(3)
    expect(result.entries.reduce((s,e)=>s+e.unpaidDays,0)).toBe(1)
    expect(result.medical.available).toBe(0)
  })
  it('does not treat religious holidays as studio holidays without explicit approval',()=>{
    expect(isHoliday('2026-10-02')).toBe(true)
    expect(isHoliday('2026-10-20',[{date:'2026-10-20',name:'Festival'}])).toBe(false)
    expect(isHoliday('2026-10-20',[{date:'2026-10-20',studioApproved:true}])).toBe(true)
    expect(workingDays('2026-10-01','2026-10-31')).toBe(21)
    const result=calculate({...input([leave('a','2026-10-02'),leave('b','2026-10-03', 'personal',true)]),asOf:'2026-10-31'})
    expect(result.entries).toHaveLength(0)
  })
  it('credits overtime only after explicit approval and only within the same contract',()=>{
    const ot={...leave('ot','2026-10-03','overtime'),creditApproved:true}
    const result=calculate({...input([ot,leave('a','2026-10-05')]),asOf:'2026-10-31'})
    expect(result.personal.unpaid).toBe(0)
    expect(calculate({...input([{...ot,creditApproved:false},leave('a','2026-10-05')]),asOf:'2026-10-31'}).personal.unpaid).toBe(1)
  })
  it('splits multi-day leave by the balance on each date across a month boundary',()=>{
    const result=calculate({...input([{...leave('a','2026-10-30'),endDate:'2026-11-02'}]),asOf:'2026-11-30'})
    expect(result.entries.map(e=>[e.date,e.paidDays,e.unpaidDays])).toEqual([['2026-10-30',0,1],['2026-11-02',1,0]])
  })
  it('ignores cancelled leave and rejects overlapping notices',()=>{
    expect(calculate({...input([{...leave('a','2026-10-05'),status:'cancelled'}]),asOf:'2026-10-31'}).entries).toEqual([])
    expect(()=>calculate({...input([leave('a','2026-10-05'),leave('b','2026-10-05')]),asOf:'2026-10-31'})).toThrow('Overlapping')
  })
  it('builds a monthly deduction at the affected month working-day rate',()=>{
    const s=monthlyStatement(input([leave('a','2026-10-05','personal',true)]),'2026-10',63000)
    expect(s.scheduledWorkingDays).toBe(21)
    expect(s.unpaidDays).toBe(.5)
    expect(s.deduction).toBe(1500)
    expect(s.closing.personal.accrued).toBe(0)
  })
  it('excludes non-full-time members and flags missing contracts',()=>{
    expect(calculate({...input([]),userEmail:'charu@publicknowledge.co'}).eligible).toBe(false)
    expect(calculate({...input([leave('a','2026-10-05')]),contracts:[],asOf:'2026-10-31'}).entries[0].error).toBeTruthy()
  })
})
