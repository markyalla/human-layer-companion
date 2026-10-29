const {spawn}=require('child_process');const fs=require('fs'),os=require('os'),path=require('path');
// Privacy audit: what the big screen and other phones receive, who can export, and what "Not right now" stores. TEST DATA.
const root=path.join(__dirname,'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const ok=(n,c,d)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':'  -> '+d));if(!c)fails++};
(async()=>{const PORT=6800+Math.floor(Math.random()*150),B='http://127.0.0.1:'+PORT;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pv-'));
const srv=spawn(process.execPath,[root+'/server.js'],{env:{...process.env,PORT,ORGANISER_PASSWORD:'pw',DATA_DIR:dir},stdio:'pipe'});await new Promise(r=>srv.stdout.on('data',d=>String(d).includes('on :')&&r()));
let ck='';const call=async(m,p,b,h)=>{const r=await fetch(B+p,{method:m,headers:{'Content-Type':'application/json',Cookie:ck,...(h||{})},body:b?JSON.stringify(b):undefined});const t=await r.text();if(p.endsWith('login'))ck=r.headers.get('set-cookie').split(';')[0];let j={};try{j=JSON.parse(t)}catch(e){}return {status:r.status,json:j,text:t}};
await call('POST','/api/host/login',{password:'pw'});
for(const privacy of ['named','aggregate']){
 const code=(await call('POST','/api/host/sessions',{name:'TEST',privacy})).json.code;const key=(await call('GET','/api/host/s/'+code+'/view')).json.screenKey;
 const act=(a,id)=>call('POST','/api/host/s/'+code+'/action',{action:a,activityId:id});
 const names=['Zanele Secretname','Bongani Secretname','Thandi Secretname'];const P=[];
 for(const n of names)P.push((await call('POST','/api/s/'+code+'/join',{consent:true,name:n})).json.pid);
 await act('open','onboard');for(const p of P){await call('POST','/api/s/'+code+'/view',{pid:p,activityId:'onboard'});await call('POST','/api/s/'+code+'/respond',{pid:p,activityId:'onboard',answers:{orgtype:'Bank or fintech',role:'Leader'}})}
 await act('close','onboard');
 await act('open','jobA');for(const p of P)await call('POST','/api/s/'+code+'/view',{pid:p,activityId:'jobA'});
 await call('POST','/api/s/'+code+'/respond',{pid:P[0],activityId:'jobA',choice:'efua',reason:'gut'});await call('POST','/api/s/'+code+'/respond',{pid:P[1],activityId:'jobA',choice:'ama',reason:'track'});
 await act('close','jobA');await act('open','interest');
 await call('POST','/api/s/'+code+'/respond',{pid:P[0],activityId:'interest',choice:'consult',email:'zanele.secret@example.test',company:'SecretBank Ltd',problem:'Our payroll problem is SECRETPROBLEM',uses:['cust']});
 await act('close','interest');await act('open','rate');await call('POST','/api/s/'+code+'/respond',{pid:P[1],activityId:'rate',choice:'5',second:'very',note:'SECRETNOTE about the talk'});
 await act('reveal','rate');
 const secrets=['Zanele','Bongani','Thandi','zanele.secret','SecretBank','SECRETPROBLEM','SECRETNOTE'];
 const stream=async(url)=>{const r=await fetch(B+url);const rd=r.body.getReader();let t='';const end=Date.now()+1500;while(Date.now()<end&&!t.includes('\n\n')){const {value,done}=await Promise.race([rd.read(),sleep(1500).then(()=>({done:true}))]);if(done)break;t+=new TextDecoder().decode(value)}rd.cancel();return t};
 // big screen at every phase (current phase: revealed on rate)
 const scr=await stream('/api/screen/'+code+'/stream?k='+key);
 const leaked=secrets.filter(s=>scr.includes(s));ok('['+privacy+'] Big screen payload contains no names, email, company, problem or comment (checked: '+secrets.join(', ')+')',leaked.length===0,leaked.join(','));
 ok('['+privacy+'] Big screen payload has no screen key or participant ids',!scr.includes(key)&&!P.some(p=>scr.includes(p)));
 // another participant's phone stream must not carry other people's data
 const ph=await stream('/api/s/'+code+'/stream?pid='+P[2]);
 const l2=['Zanele','Bongani','zanele.secret','SecretBank','SECRETPROBLEM','SECRETNOTE'].filter(s=>ph.includes(s));ok('['+privacy+'] A different participant phone stream contains none of those details',l2.length===0,l2.join(','));
 // host export contents
 const lead=await call('GET','/api/host/s/'+code+'/export?type=leads');
 ok('['+privacy+'] Leads export (host only) contains the email, company and problem',lead.text.includes('zanele.secret@example.test')&&lead.text.includes('SecretBank')&&lead.text.includes('SECRETPROBLEM'));
 ok('['+privacy+'] Leads export '+(privacy==='named'?'includes the display name':'has no display name'),privacy==='named'?lead.text.includes('Zanele'):!lead.text.includes('Zanele'),lead.text.split('\n')[1]);
 const resp=await call('GET','/api/host/s/'+code+'/export?type=responses');
 ok('['+privacy+'] Responses export holds the private reasons and the comment',resp.text.includes('gut')&&resp.text.includes('SECRETNOTE'));
 for(const t of ['leads','responses','participants','summary','all']){const n=await fetch(B+'/api/host/s/'+code+'/export?type='+t);ok('['+privacy+'] Export '+t+' refuses a visitor who is not signed in',n.status===401,n.status)}
 const hv=await fetch(B+'/api/host/s/'+code+'/view');ok('['+privacy+'] Host view refuses a visitor who is not signed in',hv.status===401,hv.status);
 const hs=await fetch(B+'/api/host/s/'+code+'/stream');ok('['+privacy+'] Host stream refuses a visitor who is not signed in',hs.status===401,hs.status);
 const info=await (await fetch(B+'/api/s/'+code+'/info')).text();ok('['+privacy+'] The public join info shows only the session name, status and privacy mode',!secrets.some(s=>info.includes(s)),info);
}
const pid=(await call('POST','/api/s/'+(await call('POST','/api/host/sessions',{name:'x',privacy:'named'})).json.code+'/join',{consent:true,name:'A'})).json.pid;ok('Participant ids are long random strings ('+pid.length+' chars)',pid.length>=16,pid);
{ // "Not right now" and "interested but no email": what the code really does
 const code=(await call('POST','/api/host/sessions',{name:'TEST nr',privacy:'named'})).json.code;
 const act=(a,id)=>call('POST','/api/host/s/'+code+'/action',{action:a,activityId:id});
 const A=(await call('POST','/api/s/'+code+'/join',{consent:true,name:'NotNow Person'})).json.pid,Bq=(await call('POST','/api/s/'+code+'/join',{consent:true,name:'NoEmail Person'})).json.pid,C=(await call('POST','/api/s/'+code+'/join',{consent:true,name:'Full Person'})).json.pid;
 await act('open','interest');
 await call('POST','/api/s/'+code+'/respond',{pid:A,activityId:'interest',choice:'notnow',email:'sneaky.notnow@example.test',company:'NotNowCo',problem:'NOTNOWPROBLEM',uses:['cust']});
 await call('POST','/api/s/'+code+'/respond',{pid:Bq,activityId:'interest',choice:'consult',problem:'NOEMAILPROBLEM'});
 await call('POST','/api/s/'+code+'/respond',{pid:C,activityId:'interest',choice:'demo',email:'full@example.test',company:'FullCo',problem:'FULLPROBLEM',uses:['cust']});
 const lead=(await call('GET','/api/host/s/'+code+'/export?type=leads')).text, resp=(await call('GET','/api/host/s/'+code+'/export?type=responses')).text, all=(await call('GET','/api/host/s/'+code+'/export?type=all')).text;
 ok('Leads: someone who tapped "Not right now" is NOT a row',!lead.includes('NotNow Person'),lead);
 ok('Leads: nothing from a "Not right now" tap is stored (email, company, problem)',!lead.includes('sneaky.notnow')&&!resp.includes('sneaky.notnow')&&!all.includes('sneaky.notnow')&&!all.includes('NotNowCo')&&!all.includes('NOTNOWPROBLEM'));
 ok('Responses: the "Not right now" tap is recorded as a response (choice notnow, no contact details)',/notnow/.test(resp));
 ok('Leads: someone interested with no email IS a row, flagged "no email given: cannot follow up"',lead.includes('NoEmail Person')&&lead.includes('no email given: cannot follow up'),lead);
 ok('Leads: a full answer IS a row with email, company and problem',lead.includes('full@example.test')&&lead.includes('FullCo')&&lead.includes('FULLPROBLEM'));
 ok('Responses CSV never contains emails, company names or problem text',!resp.includes('full@example.test')&&!resp.includes('FullCo')&&!resp.includes('FULLPROBLEM'));
 ok('The Everything JSON does contain them (host only, keep it safe)',all.includes('full@example.test')&&all.includes('FULLPROBLEM'));
 const sum=(await call('GET','/api/host/s/'+code+'/export?type=summary')).text; ok('Summary CSV has no emails or names',!sum.includes('@')&&!sum.includes('Person'));
}
srv.kill();console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0)})();
