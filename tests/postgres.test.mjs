import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,"..");
function moduleFromTs(name,deps={}){const code=ts.transpileModule(readFileSync(path.join(root,name),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,result={exports:{}};new Function("require","module","exports",code)(id=>id in deps?deps[id]:require(id),result,result.exports);return result.exports;}
const {PostgresDatabase,postgresSql}=moduleFromTs("db/postgres.ts");
async function fixture(t,stock=1){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const file of readdirSync(path.join(root,"supabase/migrations")).filter(f=>f.endsWith(".sql")).sort())await pg.exec(readFileSync(path.join(root,"supabase/migrations",file),"utf8"));
  let tail=Promise.resolve();
  const pool={async connect(){let release;const prior=tail;tail=new Promise(r=>release=r);await prior;return{async query(sql,values){const result=await pg.query(sql,values);return{rows:result.rows,rowCount:result.affectedRows??result.rows.length};},release};}};
  const db=new PostgresDatabase(pool),z=require("zod").z;
  class ApiError extends Error{constructor(message,status=400,code="INVALID_REQUEST"){super(message);this.status=status;this.code=code;}}
  const core={ApiError,database:()=>db,now:()=>new Date().toISOString(),uid:()=>crypto.randomUUID(),parse:(value,fallback)=>{try{return JSON.parse(value);}catch{return fallback;}},binding:()=>"",text:(max=200)=>z.string().trim().max(max),money:z.number().int().min(0).max(100000000),all:async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results,first:async(sql,...args)=>db.prepare(sql).bind(...args).first(),run:async(sql,...args)=>db.prepare(sql).bind(...args).run(),audit:async()=>{}};
  const settingsModule=moduleFromTs("lib/server/settings.ts",{"./core":core});
  const settings={...settingsModule.defaultSettings,checkoutEnabled:true,legalReviewed:true,merchant:{company:"QA only",cui:"TEST",address:"QA test address",email:"qa@example.test",phone:""},shipping:{enabled:true,cost:1900,freeThreshold:null,codFee:0},payments:{cod:true,online:false},policies:{delivery:"QA",returns:"QA",warranty:"",terms:"QA",privacy:"QA",cookies:""}};
  await core.run("INSERT INTO settings(id,payload,updated_at) VALUES('shop',?,?)",JSON.stringify(settings),new Date().toISOString());
  await core.run("INSERT INTO products(id,slug,name,brand,sku,category,subcategory,price,stock,image,images,is_demo,description,variants,compatibility,created_at,updated_at) VALUES('p1','qa-product','QA product','QA','QA-1','auto','',10000,?,'/qa.png','[]',0,'QA product','[]','[\"BMW 320 2020\"]',?,?)",stock,new Date().toISOString(),new Date().toISOString());
  const catalog=moduleFromTs("lib/server/catalog.ts",{"./core":core,"./settings":settingsModule,"@/lib/catalog":{categories:[{id:"auto",name:"Auto"}],demoProducts:[]}}),commerce=moduleFromTs("lib/server/commerce.ts"),protocol=moduleFromTs("lib/server/stripe-protocol.ts"),stripe=moduleFromTs("lib/server/stripe.ts",{"./core":core,"./stripe-protocol":protocol});
  const orders=moduleFromTs("lib/server/orders.ts",{"./core":core,"@/lib/catalog":{demoProducts:[]},"./catalog":catalog,"./commerce":commerce,"./settings":settingsModule,"./stripe":stripe});
  const admin=moduleFromTs("lib/server/admin.ts",{"./core":core,"@/lib/catalog":{categories:[{id:"auto",name:"Auto"}],demoProducts:[]},"./catalog":catalog,"./orders":orders,"./settings":settingsModule,"./stripe":stripe});
  const payload={items:[{productId:"p1",quantity:1}],customer:{name:"QA Client",email:"qa@example.test",phone:"0712345678",county:"Ilfov",city:"Test City",address:"Test street 1",postalCode:"123456"},shippingMethod:"standard",paymentMethod:"cod",consent:true,idempotencyKey:crypto.randomUUID()};
  return{db,pg,core,catalog,orders,admin,payload};
}
test("PostgreSQL placeholder conversion preserves quoted question marks and prepared parameters",()=>{
  assert.equal(postgresSql("SELECT '?' AS value, ? AS createdAt"),"SELECT '?' AS value, $1 AS \"createdAt\"");
  assert.equal(postgresSql("INSERT OR IGNORE INTO favorites(id) VALUES(?)"),"INSERT INTO favorites(id) VALUES($1) ON CONFLICT DO NOTHING");
});
test("actual PostgreSQL migration, catalog JSON filters, aliases and media bytes work",async t=>{
  const f=await fixture(t);
  const result=await f.catalog.catalog(new URLSearchParams({category:"auto",compatibility:"BMW",min:"9000",max:"10000",sort:"price-asc"}));
  assert.equal(result.total,1);assert.equal(result.products[0].price,10000);assert.ok(result.products[0].createdAt);
  await f.core.run("INSERT INTO media(key,content,mime,etag,created_at) VALUES(?,?,?,?,?)","products/qa.png",Buffer.from([1,2,3]),"image/png","qa",new Date().toISOString());
  assert.deepEqual([...((await f.core.first("SELECT content FROM media WHERE key=?","products/qa.png")).content)],[1,2,3]);
  const rls=await f.pg.query("SELECT relrowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid=relnamespace WHERE nspname='gtune' AND relname='orders'");assert.equal(rls.rows[0].relrowsecurity,true);
});
test("PostgreSQL checkout stock transaction, retries, guest dashboard and cancellation are consistent",async t=>{
  const f=await fixture(t,1);
  const attempts=await Promise.allSettled([f.orders.checkout(f.payload,null),f.orders.checkout({...f.payload,idempotencyKey:crypto.randomUUID()},null)]);
  assert.equal(attempts.filter(a=>a.status==="fulfilled").length,1);
  const order=attempts.find(a=>a.status==="fulfilled").value.order;
  assert.equal(order.total,11900);assert.equal(order.paymentStatus,"unpaid");assert.equal(Number((await f.core.first("SELECT stock FROM products WHERE id='p1'")).stock),0);
  const snapshot=await f.admin.snapshot();assert.equal(snapshot.stats.orders,1);assert.equal(snapshot.customers[0].email,"qa@example.test");assert.ok(snapshot.customers[0].createdAt);
  const replay=await f.orders.checkout(f.payload,null);assert.equal(replay.order.id,order.id);
  await f.orders.changeOrderStatus({id:order.id,status:"cancelled"},"qa");assert.equal(Number((await f.core.first("SELECT stock FROM products WHERE id='p1'")).stock),1);
  await assert.rejects(()=>f.orders.changeOrderStatus({id:order.id,status:"cancelled"},"qa"));
  assert.equal(Number((await f.core.first("SELECT stock FROM products WHERE id='p1'")).stock),1);
});
test("public catalog hides demo products and never repopulates an empty catalog",async t=>{
  const f=await fixture(t);
  await f.core.run("UPDATE products SET is_demo=1 WHERE id=?","p1");
  const hidden=await f.catalog.catalog(new URLSearchParams());
  assert.deepEqual(hidden.products,[]);assert.equal(hidden.total,0);assert.deepEqual(hidden.brands,[]);assert.equal(hidden.demoMode,false);
  await assert.rejects(()=>f.catalog.productDetail("qa-product"),error=>error.status===404);
  await assert.rejects(()=>f.catalog.productDetail("p1"),error=>error.status===404);
  await f.core.run("UPDATE products SET is_demo=0 WHERE id=?","p1");
  assert.equal((await f.catalog.productDetail("qa-product")).product.id,"p1");
  await f.core.run("DELETE FROM products WHERE id=?","p1");
  const empty=await f.catalog.catalog(new URLSearchParams());
  assert.deepEqual(empty.products,[]);assert.equal(empty.total,0);assert.equal(empty.demoMode,false);
});

test("PostgreSQL batch errors roll back every prior change",async t=>{
  const {db,core}=await fixture(t,3);
  await assert.rejects(()=>db.batch([db.prepare("UPDATE products SET stock=0 WHERE id=?").bind("p1"),db.prepare("INSERT INTO missing_table(id) VALUES(?)").bind("qa")]));
  assert.equal(Number((await core.first("SELECT stock FROM products WHERE id='p1'")).stock),3);
});
