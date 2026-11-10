import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const install=require('../functions/leave-close.cjs')
const email='sharang@publicknowledge.co'
function setup() {
  const data={contracts:{c:{userEmail:email,startDate:'2026-10-01',endDate:'2027-03-31'}},leaves:{a:{userEmail:email,startDate:'2026-10-05',endDate:'2026-10-05',type:'personal',status:'approved'}},holidays:{},leaveCloses:{}}
  const db={collection:name=>({name,doc:id=>({name,id}),get:async()=>({docs:Object.entries(data[name]).map(([id,d])=>({id,data:()=>d}))})}),runTransaction:async fn=>fn({get:ref=>ref.get(),create:(ref,value)=>{if(data[ref.name][ref.id]) throw new Error('duplicate');data[ref.name][ref.id]=value}})}
  const admin={firestore:{FieldValue:{serverTimestamp:()=> 'timestamp'}}}
  const service=install({db,admin,onRequest:f=>f})
  const call=async(method,body)=>{
    let code=200, result
    const res={status:n=>{code=n;return res},json:v=>{result=v;return res}}
    await service.handle({method,body,query:body},res,'charu@publicknowledge.co')
    return {code,result}
  }
  return {data,call}
}
afterEach(()=>vi.useRealTimers())
describe('monthly leave close persistence',()=>{
  it('requires reviewed inputs, locks a statement, and retries without duplication',async()=>{
    const {call,data}=setup(), request={userEmail:email,month:'2026-10',monthlyFee:63000}
    const preview=await call('GET',request)
    expect(preview.result.deduction).toBe(3000)
    expect((await call('POST',request)).code).toBe(400)
    const closed=await call('POST',{...request,previewRevision:preview.result.previewRevision})
    expect(closed.result.status).toBe('closed')
    expect((await call('POST',{...request,monthlyFee:1})).result.monthlyFee).toBe(63000)
    expect(Object.keys(data.leaveCloses)).toHaveLength(1)
  })
  it('rejects changes after review and current-month closes',async()=>{
    const {call,data}=setup(), request={userEmail:email,month:'2026-10',monthlyFee:63000}
    const preview=await call('GET',request)
    data.leaves.a.halfDay=true
    expect((await call('POST',{...request,previewRevision:preview.result.previewRevision})).result.error).toContain('Records changed')
    expect((await call('POST',{...request,month:'2099-01'})).code).toBe(400)
  })
  it('credits late cancellations at the original month rate exactly once',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2027-01-05T10:00:00Z'))
    const {call,data}=setup()
    const close=async(month)=>{
      const request={userEmail:email,month,monthlyFee:63000}
      const preview=await call('GET',request)
      return (await call('POST',{...request,previewRevision:preview.result.previewRevision})).result
    }
    await close('2026-10')
    data.leaves.a.status='cancelled'
    const november=await close('2026-11')
    expect(november.adjustments).toEqual([{sourceMonth:'2026-10',amount:-3000,reason:'Correction to previously closed leave statement'}])
    expect(november.totalDeduction).toBe(-3000)
    expect((await close('2026-12')).adjustments).toEqual([])
    expect(data.leaveCloses[email+'_2026-10'].deduction).toBe(3000)
  })
})
