import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { createHmac } from "node:crypto";

const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,"..");
function moduleFromTs(name,dependencies={}){const source=readFileSync(path.join(root,name),"utf8");const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const result={exports:{}};new Function("require","module","exports",javascript)(id=>id in dependencies?dependencies[id]:require(id),result,result.exports);return result.exports;}
const commerce=moduleFromTs("lib/server/commerce.ts");

test("integer money: discounts, thresholds and COD are transparent",()=>{
  assert.deepEqual(commerce.calculateTotals(10001,{type:"percent",value:15},{cost:1900,freeThreshold:10000,codFee:500},"cod"),{subtotal:10001,discount:1500,shipping:2400,total:10901});
  assert.deepEqual(commerce.calculateTotals(10000,{type:"fixed",value:15000},{cost:1900,freeThreshold:0,codFee:0},"cod"),{subtotal:10000,discount:10000,shipping:0,total:0});
  assert.equal(commerce.calculateTotals(10000,null,{cost:null,freeThreshold:null,codFee:0},"cod").total,null);
});
test("order transitions protect terminal states",()=>{
  assert.equal(commerce.canTransition("placed","confirmed"),true);
  assert.equal(commerce.canTransition("placed","delivered"),false);
  assert.equal(commerce.canTransition("cancelled","confirmed"),false);
  assert.equal(commerce.canTransition("delivered","cancelled"),false);
});

function fixture({stock=1,demo=false,configured=true,payments=false}={}){
  const sqlite=new DatabaseSync(":memory:");
  for(const name of readdirSync(path.join(root,"drizzle")).filter(name=>name.endsWith(".sql")).sort())sqlite.exec(readFileSync(path.join(root,"drizzle",name),"utf8"));
  const db={prepare(sql){return{bind(...args){return{async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async run(){const result=sqlite.prepare(sql).run(...args);return{meta:{changes:Number(result.changes)}};}};}};},async batch(statements){sqlite.exec("BEGIN IMMEDIATE");try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec("COMMIT");return result;}catch(error){sqlite.exec("ROLLBACK");throw error;}}};
  const settings={checkoutEnabled:configured,legalReviewed:configured,merchant:{company:"Test retailer",cui:"TEST",address:"Test address",email:"merchant@example.com",phone:""},shipping:{enabled:true,cost:1900,freeThreshold:50000,codFee:0},payments:{cod:true,online:payments},policies:{delivery:"Configured test terms",returns:"Configured test returns",warranty:"",terms:"Configured test terms",privacy:"Configured test privacy",cookies:""},claims:[],seo:{title:"Test",description:"Test"}};
  sqlite.prepare("INSERT INTO settings(id,payload,updated_at) VALUES('shop',?,?)").run(JSON.stringify(settings),new Date().toISOString());
  sqlite.prepare("INSERT INTO products(id,slug,name,brand,sku,category,subcategory,price,stock,image,images,is_demo,description,created_at,updated_at) VALUES('p1','test-product','Test product','Test','TEST-1','auto','',10000,?,'/test.jpg','[]',?,'Test product',?,?)").run(stock,demo?1:0,new Date().toISOString(),new Date().toISOString());
  class ApiError extends Error{constructor(message,status=400,code="INVALID_REQUEST"){super(message);this.status=status;this.code=code;}}
  const environment=payments?{STRIPE_SECRET_KEY:"sk_test_unit",STRIPE_WEBHOOK_SECRET:"whsec_unit",PUBLIC_SITE_URL:"https://shop.example"}:{};
  const core={ApiError,database:()=>db,now:()=>new Date().toISOString(),uid:()=>crypto.randomUUID(),parse:(value,fallback)=>{try{return JSON.parse(value);}catch{return fallback;}},text:(max=200)=>require("zod").z.string().trim().max(max),binding:key=>environment[key]||"",all:async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results,first:async(sql,...args)=>db.prepare(sql).bind(...args).first()};
  const protocol=moduleFromTs("lib/server/stripe-protocol.ts");
  const stripe=moduleFromTs("lib/server/stripe.ts",{"./core":core,"./stripe-protocol":protocol});
  const orders=moduleFromTs("lib/server/orders.ts",{"@/lib/catalog":{demoProducts:[]},"./core":core,"./catalog":{productFromRow:r=>({id:r.id,name:r.name,sku:r.sku,image:r.image,price:r.price,stock:r.stock,isDemo:Boolean(r.is_demo),variants:JSON.parse(r.variants)})},"./commerce":commerce,"./stripe":stripe,"./settings":{readSettings:async()=>JSON.parse(sqlite.prepare("SELECT payload FROM settings WHERE id='shop'").get().payload),checkoutReady:s=>s.checkoutEnabled&&s.legalReviewed}});
  const payload={items:[{productId:"p1",quantity:1}],customer:{name:"Test Client",email:"client@example.com",phone:"0712345678",county:"Ilfov",city:"Test City",address:"Test street 1",postalCode:"123456"},shippingMethod:"standard",paymentMethod:"cod",consent:true,idempotencyKey:crypto.randomUUID()};
  return{sqlite,orders,payload,settings,core,stripe,environment,protocol};
}
test("checkout persists a placed unpaid order and decrements stock exactly once on retry",async()=>{
  const{sqlite,orders,payload}=fixture({stock:2});const first=await orders.checkout(payload,null);const second=await orders.checkout(payload,null);
  assert.equal(first.order.status,"placed");assert.equal(first.order.paymentStatus,"unpaid");assert.equal(first.order.total,11900);assert.equal(second.order.id,first.order.id);assert.equal(second.replayed,true);assert.equal(sqlite.prepare("SELECT stock FROM products").get().stock,1);assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM orders").get().n,1);assert.equal(sqlite.prepare("SELECT status FROM outbox").get().status,"queued");sqlite.close();
});
test("concurrent checkout for the last unit never oversells",async()=>{
  const{sqlite,orders,payload}=fixture();const results=await Promise.allSettled([orders.checkout(payload,null),orders.checkout({...payload,idempotencyKey:crypto.randomUUID()},null)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(sqlite.prepare("SELECT stock FROM products").get().stock,0);assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM orders").get().n,1);sqlite.close();
});
test("demo products, incomplete configuration and unavailable online payment cannot create orders",async()=>{
  for(const options of[{demo:true},{configured:false},{}]){const{sqlite,orders,payload}=fixture(options);if(!options.demo&&!Object.hasOwn(options,"configured"))payload.paymentMethod="online";await assert.rejects(()=>orders.checkout(payload,null),/demonstrative|pregătire|online/);assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM orders").get().n,0);assert.equal(sqlite.prepare("SELECT stock FROM products").get().stock,1);sqlite.close();}
});
test("cancellation restores stock once and refuses terminal status replay",async()=>{
  const{sqlite,orders,payload}=fixture();const result=await orders.checkout(payload,null);await orders.changeOrderStatus({id:result.order.id,status:"cancelled"},"test-admin");assert.equal(sqlite.prepare("SELECT stock FROM products").get().stock,1);await assert.rejects(()=>orders.changeOrderStatus({id:result.order.id,status:"cancelled"},"test-admin"),/tranziție/);assert.equal(sqlite.prepare("SELECT stock FROM products").get().stock,1);sqlite.close();
});
test("changed request cannot reuse an existing checkout idempotency key",async()=>{
  const{sqlite,orders,payload}=fixture({stock:3});await orders.checkout(payload,null);await assert.rejects(()=>orders.checkout({...payload,notes:"different content"},null),/alte date/);assert.equal(sqlite.prepare("SELECT stock FROM products").get().stock,2);sqlite.close();
});
test("server prices override client totals and limited coupons cannot exceed their usage cap",async()=>{
  const{sqlite,orders,payload}=fixture({stock:3});sqlite.prepare("INSERT INTO coupons(id,code,type,value,min_subtotal,max_uses,used,active) VALUES('c1','ONCE','percent',10,0,1,0,1)").run();
  const result=await orders.checkout({...payload,coupon:"once",total:1,shipping:0},null);assert.equal(result.order.total,10900);assert.equal(sqlite.prepare("SELECT used FROM coupons").get().used,1);await assert.rejects(()=>orders.checkout({...payload,coupon:"once",idempotencyKey:crypto.randomUUID()},null),/promoțional/);await orders.changeOrderStatus({id:result.order.id,status:"cancelled"},"test-admin");assert.equal(sqlite.prepare("SELECT used FROM coupons").get().used,0);sqlite.close();
});
test("duplicate cart rows cannot bypass a pooled stock limit",async()=>{
  const{sqlite,orders,payload}=fixture({stock:1});await assert.rejects(()=>orders.checkout({...payload,items:[{productId:"p1",quantity:1},{productId:"p1",quantity:1}]},null),/Stoc insuficient|duplicate/);assert.equal(sqlite.prepare("SELECT stock FROM products").get().stock,1);sqlite.close();
});
test("write origin and admin permissions are explicit",async t=>{
  const environment={ADMIN_USER_IDS:"allowed-user",LOCAL_ADMIN_ENABLED:"false"};const previousEnv={ADMIN_USER_IDS:process.env.ADMIN_USER_IDS,LOCAL_ADMIN_ENABLED:process.env.LOCAL_ADMIN_ENABLED};Object.assign(process.env,environment);t.after(()=>{for(const key of Object.keys(previousEnv)){if(previousEnv[key]===undefined)delete process.env[key];else process.env[key]=previousEnv[key];}});const core=moduleFromTs("lib/server/core.ts",{"@/db/postgres":{getStoreDatabase:()=>null},"@/app/chatgpt-auth":{getChatGPTUser:async()=>null}});
  assert.throws(()=>core.safeWrite(new Request("https://shop.example/api/store",{method:"POST",headers:{origin:"https://evil.example"}})),/Originea/);
  assert.throws(()=>core.safeWrite(new Request("https://shop.example/api/store",{method:"POST"})),/Originea/);
  core.safeWrite(new Request("https://shop.example/api/store",{method:"POST",headers:{origin:"https://shop.example"}}));
  assert.equal(core.isAdmin({userId:"first-user"},new Request("https://shop.example")),false);
  assert.equal(core.isAdmin({userId:"local_seedy"},new Request("https://shop.example")),false);
  assert.equal(core.isAdmin({userId:"allowed-user"},new Request("https://shop.example")),true);
  await assert.rejects(()=>core.limitedBody(new Request("https://shop.example",{method:"POST",body:"123456789"}),4),/prea mare/);
});
test("shipment requires an AWB; audited AWB corrections cannot restore inventory",async()=>{
  const{sqlite,orders,payload}=fixture();const result=await orders.checkout(payload,null);const id=result.order.id;await orders.changeOrderStatus({id,status:"confirmed"},"admin");await orders.changeOrderStatus({id,status:"preparing"},"admin");await assert.rejects(()=>orders.changeOrderStatus({id,status:"shipped"},"admin"),/AWB/);await orders.changeOrderStatus({id,status:"shipped",awb:"12345"},"admin");await orders.changeOrderStatus({id,status:"shipped",awb:"54321"},"admin");assert.equal(sqlite.prepare("SELECT awb FROM orders").get().awb,"54321");assert.equal(sqlite.prepare("SELECT stock FROM products").get().stock,0);await assert.rejects(()=>orders.changeOrderStatus({id,status:"shipped",awb:""},"admin"),/AWB/);await assert.rejects(()=>orders.changeOrderStatus({id,status:"cancelled"},"admin"),/tranziție/);sqlite.close();
});
test("signed orders stay owned by stable identity even when the buyer enters another user's email",async()=>{
  const{sqlite,orders,payload,core}=fixture({stock:3});await orders.checkout(payload,{userId:"alice",email:"alice@example.com"});let identity={userId:"bob",email:"client@example.com",fullName:"Bob"};
  const route=moduleFromTs("app/api/store/route.ts",{"@/app/chatgpt-auth":{getChatGPTUser:async()=>identity},"@/lib/catalog":{demoProducts:[]},"@/lib/server/admin":{},"@/lib/server/catalog":{},"@/lib/server/core":{...core,isAdmin:()=>false,fail:error=>{throw error;}},"@/lib/server/orders":orders,"@/lib/server/settings":{},"@/lib/server/stripe":{}});
  const request=new Request("https://shop.example/api/store?action=session");let response=await route.GET(request);let result=await response.json();assert.equal(result.data.orders.length,0);
  await orders.checkout({...payload,idempotencyKey:crypto.randomUUID()},null);response=await route.GET(request);result=await response.json();assert.equal(result.data.orders.length,1);assert.equal(result.data.orders[0].userId,null);
  identity={userId:"alice",email:"alice@example.com",fullName:"Alice"};response=await route.GET(request);result=await response.json();assert.equal(result.data.orders.length,1);assert.equal(result.data.orders[0].userId,"alice");sqlite.close();
});
test("catalog filters actual database records and ignores prototype sort names",async()=>{
  const{sqlite,core,settings}=fixture({stock:4});sqlite.prepare("INSERT INTO products(id,slug,name,brand,sku,category,subcategory,price,old_price,stock,image,images,description,compatibility,created_at,updated_at) VALUES('p2','golf-led','Golf LED','Other','TEST-2','auto','LED',20000,25000,0,'/led.jpg','[]','LED kit','[\"VW Golf 2018\"]',?,?)").run(new Date().toISOString(),new Date().toISOString());
  const catalog=moduleFromTs("lib/server/catalog.ts",{"@/lib/catalog":{demoProducts:[],categories:[]},"./core":core,"./settings":{defaultSettings:settings,readSettings:async()=>settings}});
  let result=await catalog.catalog(new URLSearchParams("category=auto&brand=Other&compatibility=Golf&sale=1&min=15000&max=21000"));assert.deepEqual(result.products.map(p=>p.id),["p2"]);assert.equal(result.demoMode,false);
  result=await catalog.catalog(new URLSearchParams("inStock=1&sort=constructor"));assert.deepEqual(result.products.map(p=>p.id),["p1"]);assert.equal(result.demoMode,false);
  result=await catalog.catalog(new URLSearchParams("q=%25"));assert.equal(result.total,0);
  sqlite.prepare("UPDATE products SET active=0 WHERE id='p2'").run();await assert.rejects(()=>catalog.productDetail("golf-led"),/nu a fost găsit/);sqlite.close();
});
test("admin dashboard uses persisted order totals and includes shoppers without a saved profile",async()=>{
  const{sqlite,orders,payload,core,settings,stripe}=fixture();const result=await orders.checkout(payload,null);const z=require("zod").z;
  const admin=moduleFromTs("lib/server/admin.ts",{"@/lib/catalog":{demoProducts:[],categories:[]},"./core":{...core,money:z.number().int().min(0).max(100_000_000)},"./catalog":{productFromRow:r=>({id:r.id,isDemo:Boolean(r.is_demo),stock:r.stock,active:Boolean(r.active)}),readCategories:async()=>[]},"./orders":orders,"./stripe":stripe,"./settings":{readSettings:async()=>settings}});
  let data=await admin.snapshot();assert.equal(data.stats.orders,1);assert.equal(data.stats.pending,1);assert.equal(data.stats.sales,0);assert.equal(data.customers.length,1);assert.equal(data.customers[0].email,payload.customer.email);assert.equal(data.orders[0].history[0].actor,"guest");assert.equal(result.order.history[0].actor,undefined);
  for(const status of["confirmed","preparing","shipped","delivered"])await orders.changeOrderStatus({id:result.order.id,status,...(status==="shipped"?{awb:"TEST-AWB"}:{})},"admin");data=await admin.snapshot();assert.equal(data.stats.sales,11900);assert.equal(data.stats.pending,0);assert.equal(data.stats.revenue[0].total,11900);sqlite.close();
});
// Stripe's HTTP transport is replaced in tests; all totals, migrations and state
// transitions below execute the actual application modules against SQLite.
function stripeTransport(t) {
  const original=globalThis.fetch, sessions=new Map(), creates=[], calls=[];
  t.after(()=>{globalThis.fetch=original;});
  let failNext=false;
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(url);assert.equal(parsed.origin,'https://api.stripe.com');assert.match(options.headers.Authorization,/^Bearer sk_test_/);calls.push({path:parsed.pathname,...options});
    if(failNext){failNext=false;throw new Error('Network interrupted');}
    if(parsed.pathname==='/v1/checkout/sessions'){
      const params=new URLSearchParams(options.body),key=options.headers['Idempotency-Key'];
      if(!creates.some(call=>call.key===key)){
        const id=`cs_test_session${creates.length+1}`;
        const session={id,object:'checkout.session',mode:'payment',status:'open',payment_status:'unpaid',amount_total:Number(params.get('line_items[0][price_data][unit_amount]')),currency:'ron',client_reference_id:params.get('client_reference_id'),metadata:{order_id:params.get('metadata[order_id]'),order_number:params.get('metadata[order_number]')},url:`https://checkout.stripe.com/c/pay/${id}`,expires_at:Number(params.get('expires_at')),payment_intent:null,livemode:false};
        sessions.set(id,session);creates.push({key,id,params});
      }
      return Response.json(sessions.get(creates.find(call=>call.key===key).id));
    }
    const id=parsed.pathname.split('/')[4],session=sessions.get(id);assert.ok(session,`unknown fixture session ${id}`);
    if(parsed.pathname.endsWith('/expire')){if(session.status!=='open')return Response.json({error:'already completed'},{status:400});session.status='expired';session.url=null;}
    return Response.json(session);
  };
  return{sessions,creates,calls,failNext(){failNext=true;}};
}
function eventFor(session,type='checkout.session.completed',id='evt_test1'){return{id,type,data:{object:{id:session.id}}};}

test('Stripe signature authenticates raw body and rejects stale, forged or modified payloads',async()=>{
  const protocol=moduleFromTs('lib/server/stripe-protocol.ts'),raw=new TextEncoder().encode('{"id":"evt_test"}'),timestamp=1800000000;
  const sign=(body=raw,time=timestamp)=>`t=${time},v1=${createHmac('sha256','whsec_test').update(`${time}.`).update(body).digest('hex')}`;
  assert.equal(await protocol.verifyStripeSignature(raw,sign(),'whsec_test',timestamp),true);
  assert.equal(await protocol.verifyStripeSignature(raw,sign(),'whsec_test',timestamp+301),false);
  assert.equal(await protocol.verifyStripeSignature(new TextEncoder().encode('{"id":"evt_other"}'),sign(),'whsec_test',timestamp),false);
  assert.equal(await protocol.verifyStripeSignature(raw,sign(),'wrong',timestamp),false);
  assert.equal(await protocol.verifyStripeSignature(raw,`t=${timestamp},t=${timestamp},v1=${'0'.repeat(64)}`,'whsec_test',timestamp),false);
});

test('online checkout uses trusted totals and idempotency, pending until a signed verified webhook',async t=>{
  const transport=stripeTransport(t),{sqlite,orders,payload,stripe,core,protocol}=fixture({stock:2,payments:true});t.after(()=>sqlite.close());payload.paymentMethod='online';
  const quote=await orders.quote(payload);assert.equal(quote.codAvailable,true);assert.equal(quote.onlineAvailable,true);
  const result=await orders.checkout({...payload,total:1},null), replay=await orders.checkout({...payload,total:1},null);
  assert.equal(result.order.paymentStatus,'pending');assert.equal(result.order.status,'placed');assert.match(result.checkoutUrl,/^https:\/\/checkout.stripe.com\//);assert.equal(replay.order.id,result.order.id);assert.equal(transport.creates.length,1);assert.equal(sqlite.prepare('SELECT stock FROM products').get().stock,1);
  assert.equal(transport.creates[0].params.get('line_items[0][price_data][unit_amount]'),'11900');assert.equal(transport.creates[0].params.get('payment_method_types[0]'),'card');assert.match(transport.creates[0].params.get('success_url'),/\/plata\?order=/);
  let status=await stripe.paymentStatus(result.order.id,transport.creates[0].id);assert.equal(status.paymentStatus,'pending');assert.deepEqual(Object.keys(status).sort(),['number','paymentStatus','status','total']);
  await assert.rejects(()=>orders.changeOrderStatus({id:result.order.id,status:'confirmed'},'admin'),/nu a fost confirmată/);
  const session=transport.sessions.get(transport.creates[0].id);session.status='complete';session.payment_status='paid';session.payment_intent='pi_test1';
  const webhook=moduleFromTs('app/api/stripe/webhook/route.ts',{'@/lib/server/core':{...core,limitedBody:async request=>new Uint8Array(await request.arrayBuffer()),fail:error=>{throw error;}},'@/lib/server/stripe-protocol':protocol,'@/lib/server/stripe':stripe,'@/lib/server/orders':orders});
  const raw=JSON.stringify(eventFor(session)),timestamp=Math.floor(Date.now()/1000),signature=`t=${timestamp},v1=${createHmac('sha256','whsec_unit').update(`${timestamp}.${raw}`).digest('hex')}`;
  await assert.rejects(()=>webhook.POST(new Request('https://shop.example/api/stripe/webhook',{method:'POST',body:raw,headers:{'stripe-signature':'forged'}})),/Semnătură/);
  assert.equal((await stripe.paymentStatus(result.order.id,session.id)).paymentStatus,'pending');
  const response=await webhook.POST(new Request('https://shop.example/api/stripe/webhook',{method:'POST',body:raw,headers:{'stripe-signature':signature}}));assert.equal(response.status,200);assert.equal((await stripe.paymentStatus(result.order.id,session.id)).paymentStatus,'paid');
  await stripe.processStripeEvent(eventFor(session));await stripe.processStripeEvent(eventFor(session,'checkout.session.completed','evt_second'));
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM order_history WHERE actor='stripe'").get().n,1);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM outbox WHERE subject LIKE '%plată confirmată%'").get().n,1);
  await orders.changeOrderStatus({id:result.order.id,status:'confirmed'},'admin');await assert.rejects(()=>orders.changeOrderStatus({id:result.order.id,status:'cancelled'},'admin'),/Rambursarea/);
});

test('expired Stripe session releases stock and coupon once, even for duplicate/out-of-order events',async t=>{
  const transport=stripeTransport(t),{sqlite,orders,payload,stripe}=fixture({payments:true});t.after(()=>sqlite.close());payload.paymentMethod='online';sqlite.prepare("INSERT INTO coupons(id,code,type,value,min_subtotal,used,active) VALUES('c1','TEST','percent',10,0,0,1)").run();payload.coupon='TEST';
  const result=await orders.checkout(payload,null),session=transport.sessions.get(transport.creates[0].id);session.status='expired';session.url=null;
  await stripe.processStripeEvent(eventFor(session,'checkout.session.expired'));await stripe.processStripeEvent(eventFor(session,'checkout.session.expired'));await stripe.processStripeEvent(eventFor(session,'checkout.session.completed','evt_late'));
  assert.equal(sqlite.prepare('SELECT stock FROM products').get().stock,1);assert.equal(sqlite.prepare('SELECT used FROM coupons').get().used,0);assert.equal((await stripe.paymentStatus(result.order.id,session.id)).status,'cancelled');assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM order_history WHERE status='cancelled'").get().n,1);
});

test('Stripe amount/currency/ownership mismatch cannot mark paid or release reserved inventory',async t=>{
  const transport=stripeTransport(t),{sqlite,orders,payload,stripe}=fixture({payments:true});t.after(()=>sqlite.close());payload.paymentMethod='online';const result=await orders.checkout(payload,null),session=transport.sessions.get(transport.creates[0].id);session.status='complete';session.payment_status='paid';
  for(const [key,value] of [['amount_total',1],['currency','eur'],['client_reference_id','other-order'],['livemode',true]]){const before=session[key];session[key]=value;await assert.rejects(()=>stripe.processStripeEvent(eventFor(session)),/nu corespunde/);session[key]=before;}
  assert.equal((await stripe.paymentStatus(result.order.id,session.id)).paymentStatus,'pending');assert.equal(sqlite.prepare('SELECT stock FROM products').get().stock,0);await assert.rejects(()=>stripe.paymentStatus(result.order.id,'cs_test_other'),/Nu am găsit/);
});

test('admin cancels pending online order only after authoritative session expiry',async t=>{
  const transport=stripeTransport(t),{sqlite,orders,payload}=fixture({payments:true});t.after(()=>sqlite.close());payload.paymentMethod='online';const result=await orders.checkout(payload,null);await orders.changeOrderStatus({id:result.order.id,status:'cancelled'},'admin');
  assert.equal(transport.sessions.get(transport.creates[0].id).status,'expired');assert.equal(sqlite.prepare('SELECT stock FROM products').get().stock,1);await assert.rejects(()=>orders.changeOrderStatus({id:result.order.id,status:'cancelled'},'admin'),/Plata este în curs|tranziție|reconciliată|expir/);assert.equal(sqlite.prepare('SELECT stock FROM products').get().stock,1);
});

test('ambiguous Stripe network failure preserves one reservation for safe retry',async t=>{
  const transport=stripeTransport(t),{sqlite,orders,payload}=fixture({payments:true});t.after(()=>sqlite.close());payload.paymentMethod='online';transport.failNext();await assert.rejects(()=>orders.checkout(payload,null),/nu a răspuns/);
  assert.equal(sqlite.prepare('SELECT stock FROM products').get().stock,0);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM orders').get().n,1);const result=await orders.checkout(payload,null);assert.match(result.checkoutUrl,/checkout.stripe.com/);assert.equal(transport.creates.length,1);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM orders').get().n,1);
});



test('email transport bounds network time and retries failures without inventing delivery',async t=>{
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});
  const{sqlite,orders,payload,environment}=fixture();t.after(()=>sqlite.close());await orders.checkout(payload,null);environment.RESEND_API_KEY='test-mail-key';environment.EMAIL_FROM='test@example.com';
  let emailKey='';globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.ok(options.signal instanceof AbortSignal);emailKey=options.headers['Idempotency-Key'];throw new DOMException('timed out','TimeoutError');};
  const failed=await orders.flushEmail();assert.equal(failed.sent,0);assert.equal(sqlite.prepare('SELECT status FROM outbox').get().status,'queued');assert.equal(sqlite.prepare('SELECT attempts FROM outbox').get().attempts,1);
  globalThis.fetch=async(url,options)=>{assert.equal(options.headers['Idempotency-Key'],emailKey);return Response.json({id:'email_test_ack'});};
  const sent=await orders.flushEmail();assert.equal(sent.sent,1);assert.equal(sqlite.prepare('SELECT status FROM outbox').get().status,'sent');assert.ok(sqlite.prepare('SELECT sent_at FROM outbox').get().sent_at);
});
