import { it, expect } from 'vitest'
import { createRequire } from 'node:module'
const apply=createRequire(import.meta.url)('../functions/apply-leave-renewals.cjs')
it('sets both October renewals once, ends overlapping terms, and preserves unrelated people',async()=>{
  const data={old:{userEmail:'sharang@publicknowledge.co',startDate:'2026-07-01',endDate:null},rakesh:{userEmail:'rakesh@publicknowledge.co',startDate:'2026-03-01',endDate:null}}
  const db={collection:()=>({doc:id=>({id})}),runTransaction:async fn=>fn({get:async()=>({docs:Object.entries(data).map(([id,d])=>({id,data:()=>d}))}),update:(r,d)=>Object.assign(data[r.id],d),set:(r,d)=>{data[r.id]={...data[r.id],...d}}})}
  const admin={firestore:{FieldValue:{serverTimestamp:()=> 'timestamp'}}}
  await apply(db,admin,'charu@publicknowledge.co')
  await apply(db,admin,'charu@publicknowledge.co')
  expect(data.old.endDate).toBe('2026-09-30')
  expect(data.rakesh.endDate).toBe(null)
  expect(Object.keys(data)).toHaveLength(4)
  for(const name of ['sharang','mohit']) {
    expect(data[name+'_2026-10-01']).toMatchObject({startDate:'2026-10-01',endDate:'2027-03-31',medicalLeaveTotal:3})
  }
})
