const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const test = require('node:test'), assert = require('node:assert/strict')
function object(value) {
  if (Array.isArray(value)) return value.map(object)
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([k,v]) => [k,object(v)]))
  for (const [name,type] of [['getString','string'],['getNumber','number'],['getBoolean','boolean'],['getJSON','object']]) Object.defineProperty(result,name,{value:k=>typeof result[k] === type?result[k]:null})
  return result
}
function fixture() {
  const session = {authenticated:true,tenantId:'tenant',userId:'sales',revision:1,permissions:[]}, requests=[]
  let handler=()=>({data:{}})
  const modules={
    './session.uts':{session}, './customer-cache.uts':{invalidateCustomerCache:()=>{}},
    './api.uts':{requestApi:(url,method,body,ok,fail)=>{requests.push({url,method,body});Promise.resolve().then(()=>handler(url,body)).then(r=>ok(object(r)),e=>fail(e.message))}},
    './sales-profile.uts':{}, './location.uts':{},
  }
  for(const file of ['crm','wecom']) {
    const ctx={UTSJSONObject:{keys:Object.keys},exports:{},require:p=>modules[p],Error,Date,JSON:{parse:s=>object(JSON.parse(s)),stringify:JSON.stringify}}
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/services/'+file+'.uts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx)
    modules['./'+file+'.uts']=ctx.exports
  }
  return {crm:modules['./crm.uts'],api:modules['./wecom.uts'],session,requests,respond:f=>{handler=f}}
}
const stats={dataStatus:'READY',activeContacts:0,linkedContacts:0,pendingContacts:0,newContacts:0,syncedAt:'2026-11-17T08:00:00Z'}
test('WeCom distinguishes an unsynced unknown from a confirmed zero and rejects missing counts',async()=>{
  const f=fixture(); f.respond(()=>({data:{...stats,dataStatus:'NOT_CONNECTED',activeContacts:null}}))
  assert.equal((await f.api.wecomSummary()).active,'—')
  f.respond(()=>({data:stats}));assert.equal((await f.api.wecomSummary()).active,'0')
  f.respond(()=>({data:{...stats,activeContacts:-1}}));await assert.rejects(f.api.wecomSummary(),/数量/)
  const missing={...stats};delete missing.activeContacts;f.respond(()=>({data:missing}));await assert.rejects(f.api.wecomSummary(),/字段缺失/)
})
test('personal relationships show every real store name and preserve server total during pagination',async()=>{
  const f=fixture();f.respond(()=>({data:{total:32,nextCursor:'9',items:[{id:'10',contactId:'20',name:'王老板',linked:true,stores:[{id:'1',name:'一号店'},{id:'2',name:'二号店'}],relations:[{employeeName:'张三',addedAt:'2026-11-17T08:00:00Z'}]}]}}))
  const page=await f.api.wecomPeople(false,'11');assert.equal(page.total,32);assert.equal(page.items.length,1);assert.equal(page.items[0].storeNames,'一号店、二号店');assert.match(f.requests[0].url,/cursor=11/)
})
test('binding without a telephone keeps the idempotency key across a network retry',async()=>{
  const f=fixture();let calls=0;f.respond(()=>{if(++calls===1)throw Error('network');return {data:{id:'20'}}})
  await assert.rejects(f.api.wecomBind('10','1','','王老板','老板','现场确认'),/network/)
  await f.api.wecomBind('10','1','','王老板','老板','现场确认')
  assert.equal(f.requests[0].body.requestId,f.requests[1].body.requestId);assert.equal(f.requests[0].body.contactId,null);assert.equal('phone' in f.requests[0].body,false)
})
test('manual WeChat hints do not create an official WeCom badge; phone and WeCom can coexist',()=>{
  const f=fixture();const raw={id:'1',name:'王老板',status:'ACTIVE',methods:[{id:'2',type:'WECHAT_HINT',value:'昵称',status:'PENDING'}],wecomRelations:[]}
  assert.equal(f.crm.crmContact(object(raw)).wecom,false);assert.equal(f.crm.crmContact(object(raw)).hasPhone,false)
  raw.methods.push({id:'3',type:'PHONE',value:'13800000000',status:'PENDING'});raw.wecomRelations.push({employeeId:'2',employeeName:'张三',status:'ACTIVE',addedAt:'2026-11-17'})
  const person=f.crm.crmContact(object(raw));assert.equal(person.wecom,true);assert.equal(person.hasPhone,true)
})
test('account changes discard a delayed WeCom response instead of displaying another user data',async()=>{
  const f=fixture();let resolve;f.respond(()=>new Promise(r=>{resolve=r}));const request=f.api.wecomSummary();await Promise.resolve();f.session.userId='other';resolve({data:stats});await assert.rejects(request,/账号已变更/)
})
