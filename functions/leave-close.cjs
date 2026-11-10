const { createHash } = require('node:crypto')
// Immutable monthly snapshots. Late corrections are netted against all previously
// settled adjustments, so the same correction cannot be deducted twice.
module.exports = function install({ db, admin, onRequest }) {
  const read = async (collection, tx) => (await (tx ? tx.get(db.collection(collection)) : db.collection(collection).get())).docs.map(d=>({id:d.id,...d.data()}))
  async function context(userEmail, tx) {
    const [contracts,leaves,holidays]=await Promise.all(['contracts','leaves','holidays'].map(name=>read(name,tx)))
    return {userEmail,contracts,leaves,holidays}
  }
  async function statement(userEmail, month, monthlyFee, closed, tx) {
    const policy=await import('./leave-policy.mjs')
    if(!policy.ELIGIBLE.includes(userEmail)) throw new Error('Person is not eligible for leave')
    const input=await context(userEmail,tx), result=policy.monthlyStatement(input,month,monthlyFee)
    const adjustments=[]
    for(const old of closed.filter(s=>s.userEmail===userEmail && s.month<month)) {
      const fresh=policy.monthlyStatement(input,old.month,old.monthlyFee)
      if(fresh.errors.length) throw new Error('Resolve missing contracts before closing')
      const settled=closed.filter(s=>s.userEmail===userEmail).flatMap(s=>s.adjustments||[]).filter(a=>a.sourceMonth===old.month).reduce((n,a)=>n+a.amount,0)
      const amount=Math.round((fresh.deduction-old.deduction-settled)*100)/100
      if(amount) adjustments.push({sourceMonth:old.month,amount,reason:'Correction to previously closed leave statement'})
    }
    result.adjustments=adjustments
    result.totalDeduction=Math.round((result.deduction+adjustments.reduce((s,a)=>s+a.amount,0))*100)/100
    // Opening is balances only, not an unbounded historical payload.
    result.opening={personal:result.opening.personal,medical:result.opening.medical}
    result.previewRevision=createHash('sha256').update(JSON.stringify(result)).digest('hex')
    return result
  }
  async function handle(req,res,actor) {
    try {
      const policy=await import('./leave-policy.mjs')
      const data=req.method==='GET'?req.query:req.body
      if (data.action === 'applyOctoberRenewals' && req.method === 'POST') return res.json(await require('./apply-leave-renewals.cjs')(db,admin,actor))
      const {userEmail,month,monthlyFee}=data
      if(req.method==='GET') {
        const closed=await read('leaveCloses')
        if(!month) return res.json({statements:closed.filter(s=>!userEmail || s.userEmail===userEmail)})
        const existing=closed.find(s=>s.id===`${userEmail}_${month}`)
        return res.json(existing || await statement(userEmail,month,monthlyFee,closed))
      }
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= policy.today().slice(0,7)) throw new Error('Only completed calendar months can be closed')
      const saved=await db.runTransaction(async tx=>{
        const closed=await read('leaveCloses',tx), id=`${userEmail}_${month}`
        const existing=closed.find(s=>s.id===id)
        if(existing) return existing
        if(closed.some(s=>s.userEmail===userEmail && s.month>month)) throw new Error('Close months in chronological order; use the next statement for corrections')
        const latest=closed.filter(s=>s.userEmail===userEmail).sort((a,b)=>b.month.localeCompare(a.month))[0]
        if(latest && policy.addMonths(latest.month+'-01',1).slice(0,7)!==month) throw new Error('Close the next unsettled month first')
        const result=await statement(userEmail,month,monthlyFee,closed,tx)
        if(result.errors.length) throw new Error('Resolve missing contracts before closing')
        if(data.previewRevision!==result.previewRevision) throw new Error('Records changed or statement has not been reviewed. Review the statement again before closing.')
        const saved={...result,status:'closed',closedBy:actor,closedAt:admin.firestore.FieldValue.serverTimestamp()}
        tx.create(db.collection('leaveCloses').doc(id),saved)
        return {...saved,id}
      })
      return res.json(saved)
    } catch(err) { return res.status(400).json({error:err.message}) }
  }
  const endpoint=onRequest(async(req,res)=>{
    res.set('Access-Control-Allow-Origin','*')
    res.set('Access-Control-Allow-Headers','Content-Type, Authorization')
    res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS')
    if(req.method==='OPTIONS') return res.status(204).send('')
    if(!['GET','POST'].includes(req.method)) return res.status(405).send('Method not allowed')
    try {
      const token=await admin.auth().verifyIdToken((req.headers.authorization||'').replace(/^Bearer /,''))
      if(!['charu@publicknowledge.co','gyan@publicknowledge.co'].includes(token.email)) return res.status(403).json({error:'Admin only'})
      return await handle(req,res,token.email)
    } catch { return res.status(401).json({error:'Sign in as an admin'}) }
  })
  return {handle,endpoint,context}
}
