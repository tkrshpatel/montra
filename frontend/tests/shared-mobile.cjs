// Mobile-width web smoke test with mocked API responses; not a native-device test.
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname, '../dist');
 const server=http.createServer((req,res)=>{let p=path.join(root,decodeURI(req.url.split('?')[0]));if(!fs.existsSync(p)||fs.statSync(p).isDirectory())p=path.join(root,'index.html');res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.html')?'text/html':p.endsWith('.ttf')?'font/ttf':'application/octet-stream');res.end(fs.readFileSync(p));});
 await new Promise(r=>server.listen(8081,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('splitsync_session_token','test-only'));
 const group={group_id:'grp_test',name:'Goa trip',currency:'INR',created_at:new Date().toISOString(),members:[{user_id:'alice',name:'Alice',role:'owner',active:true},{user_id:'bob',name:'Bob',role:'member',active:true}]};
 let entries=[],net={alice:0,bob:0},posted;
 await page.route('http://localhost:8000/api/**',async route=>{const req=route.request(),u=new URL(req.url());let data={},status=200;
 if(u.pathname.endsWith('/auth/me'))data={user_id:'alice',name:'Alice',email:'test@example.com',currency:'INR'};
 else if(u.pathname.endsWith('/fx'))data={rates:{USD:1,INR:83,EUR:.9,GBP:.8,JPY:150}};
 else if(u.pathname.endsWith('/shared/groups'))data={items:[group],has_more:false};
 else if(u.pathname.endsWith('/balances'))data={currency:'INR',total_expenses_minor:entries.length?10000:0,net,suggestions:[]};
 else if(u.pathname.endsWith('/entries'))data={items:entries,next_cursor:null};
 else if(u.pathname.endsWith('/expenses')&&req.method()==='POST'){posted=req.postDataJSON();data={entry_id:'entry1',kind:'expense',description:posted.description,amount_minor:10000,currency:'INR',paid_by:posted.paid_by,created_by:'alice',created_at:new Date().toISOString(),allocations:{alice:5000,bob:5000},voided:false};entries=[data];net={alice:5000,bob:-5000};}
 else if(u.pathname.endsWith('/settlements')&&req.method()==='POST'){posted=req.postDataJSON();data={entry_id:'entry2'};net={alice:0,bob:0};}
 else if(u.pathname.endsWith('/invitation'))data={code:'test-invitation-code-123456',expires_at:new Date().toISOString()};
 else if(u.pathname.endsWith('/grp_test'))data=group;
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto('http://127.0.0.1:8081/together');
 await page.getByTestId('shared-group-grp_test').click();
 await page.getByTestId('add-shared-expense').click();
 await page.getByTestId('shared-amount').fill('100');await page.getByTestId('shared-description').fill('Dinner');
 await page.getByTestId('save-shared-entry').click();
 await page.getByTestId('shared-entry-entry1').waitFor();assert.equal(posted.amount,'100');assert.deepEqual(posted.participants,['alice','bob']);
 
 await page.getByRole('button',{name:'Record a payment',exact:true}).click();
 await page.getByText('I received',{exact:true}).click();await page.getByTestId('shared-amount').fill('50');
 await page.getByTestId('save-shared-entry').click();await page.getByTestId('add-shared-expense').waitFor();assert.equal(posted.paid_by,'bob');assert.equal(posted.paid_to,'alice');
 await page.getByRole('button',{name:'Create invitation code',exact:true}).click();await page.getByText('test-invitation-code-123456',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 assert.deepEqual(errors,[]);console.log('PASS: mobile-width group navigation, expense submission, received payment, invitation and no horizontal overflow/runtime errors');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
