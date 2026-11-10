// Explicit, idempotent migration for Charu's agreed October 2026 renewals.
module.exports = async function applyLeaveRenewals(db, admin, actor) {
  const people=['sharang@publicknowledge.co','mohit@publicknowledge.co']
  return db.runTransaction(async tx=>{
    const snap=await tx.get(db.collection('contracts'))
    const contracts=snap.docs.map(d=>({id:d.id,...d.data()})), changes=[]
    for(const email of people) {
      if(contracts.some(c=>c.userEmail===email && c.startDate>'2026-10-01' && c.startDate<='2027-03-31')) throw new Error('Conflicting future contract for '+email+'; reconcile before migration')
      const existing=contracts.filter(c=>c.userEmail===email && c.startDate==='2026-10-01')
      if(existing.length>1) throw new Error('Duplicate October contracts for '+email+'; reconcile before migration')
      const id=existing[0]?.id || `${email.split('@')[0]}_2026-10-01`
      for(const old of contracts.filter(c=>c.userEmail===email && c.id!==id && c.startDate<'2026-10-01' && (!c.endDate || c.endDate>='2026-10-01'))) {
        tx.update(db.collection('contracts').doc(old.id),{endDate:'2026-09-30',updatedAt:admin.firestore.FieldValue.serverTimestamp()})
        changes.push({id:old.id,endDate:'2026-09-30'})
      }
      const data={userEmail:email,startDate:'2026-10-01',endDate:'2027-03-31',medicalLeaveTotal:3,engagementRole:'full_time',updatedBy:actor,updatedAt:admin.firestore.FieldValue.serverTimestamp()}
      tx.set(db.collection('contracts').doc(id),data,{merge:true})
      changes.push({id,userEmail:email,startDate:data.startDate,endDate:data.endDate,medicalLeaveTotal:3})
    }
    return {changes}
  })
}
