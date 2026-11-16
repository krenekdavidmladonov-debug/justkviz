import { seedEmulatorMembership } from '../../functions/lib/dev/seed-membership.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc } from 'firebase/firestore';
import { requireFullEmulatorEnvironment } from '../../tools/local-emulator-environment.mjs';
const env = requireFullEmulatorEnvironment(process.env, 'Referee E2E');
const require = createRequire(new URL('../../functions/package.json', import.meta.url)), sdk = require('firebase-admin/app');
const adminApp = sdk.initializeApp({ projectId: env.projectId }, 'referee-fixtures');
const db = require('firebase-admin/firestore').getFirestore(adminApp), adminAuth = require('firebase-admin/auth').getAuth(adminApp);
const apps = [], users = [];
function client(name) { const app = initializeApp({ apiKey: 'demo-api-key', projectId: env.projectId }, name); apps.push(app); const auth = getAuth(app); connectAuthEmulator(auth, `http://${env.authEndpoint.host}:${env.authEndpoint.port}`, { disableWarnings: true }); const functions = getFunctions(app, 'europe-west1'); connectFunctionsEmulator(functions, env.functionsEndpoint.host, env.functionsEndpoint.port); const store = getFirestore(app); connectFirestoreEmulator(store,env.firestoreEndpoint.host,env.firestoreEndpoint.port); return { auth, store, call: async (name, data) => (await httpsCallable(functions, name)(data)).data }; }
const staff = client('ref-admin'), mod = client('ref-mod'), anon = client('ref-anon');
async function login(c, role) { const email = randomUUID()+'@example.test', password = randomUUID(); const user = await adminAuth.createUser({email,password}); users.push(user.uid); await adminAuth.setCustomUserClaims(user.uid,{role}); await seedEmulatorMembership(user.uid, role); await signInWithEmailAndPassword(c.auth,email,password); }
const denied = (p,code='permission-denied') => assert.rejects(p,e=>e.code==='functions/'+code);
const expiry = () => new Date(Date.now()+86400000).toISOString();
let checks=0;const pass=()=>checks++;
try {
 await login(staff,'admin'); await login(mod,'moderator');
 async function event(title) { const e = await staff.call('createEvent',{expectedRevision:0,event:{title,startsAt:'2031-11-20T18:00:00Z',timeZone:'Europe/Prague',venue:{name:'Synthetic',publicLocation:'Synthetic'},teamCapacity:10,peopleCapacity:40,teamSizeMin:2,teamSizeMax:4}}); const ref=db.doc('events/'+e.eventId); const r=await staff.call('adminAddEventTeam',{eventId:e.eventId,requestId:randomUUID(),teamName:'Synthetic team',memberCount:2,contactEmail:'private-contact@example.test'}); const locked=await staff.call('lockEventQuiz',{eventId:e.eventId,expectedRevision:(await ref.get()).data().revision,quizId:'preflight-ready-e2e',expectedQuizRevision:0,acknowledgeWarnings:false});return {...e,ref,teamId:r.registrationId,snapshotId:locked.snapshotId}; }
 const a=await event('Referee A'), b=await event('Referee B');
 const issueData={eventId:a.eventId,requestId:randomUUID(),label:'Rozhodčí A',expiresAt:expiry()};
 await denied(anon.call('issueRefereeAccess',issueData),'unauthenticated');await denied(mod.call('issueRefereeAccess',issueData));
 await seedEmulatorMembership(staff.auth.currentUser.uid, 'moderator');await denied(staff.call('issueRefereeAccess',issueData));await seedEmulatorMembership(staff.auth.currentUser.uid, 'admin');pass();
 const grant=await staff.call('issueRefereeAccess',issueData), c={eventId:a.eventId,accessId:grant.accessId,key:grant.key};
 assert.equal(typeof grant.key,'string');const storedGrant=(await db.doc(`events/${a.eventId}/refereeAccess/${c.accessId}`).get()).data();assert(!JSON.stringify(storedGrant).includes(grant.key));
 const retry=await staff.call('issueRefereeAccess',issueData);assert.equal(retry.accessId,grant.accessId);assert.equal(retry.key,null);assert.equal((await staff.call('listRefereeAccess',{eventId:a.eventId})).length,1);pass();
 for(const x of await staff.call('listRefereeAccess',{eventId:a.eventId}))assert.deepEqual(Object.keys(x).sort(),['accessId','expiresAt','label','status','version']);
 const payload=await anon.call('readRefereeEvent',c);assert.deepEqual(Object.keys(payload).sort(),['eventId','label','rounds','scores','snapshotId','teams','title']);assert.deepEqual(Object.keys(payload.teams[0]).sort(),['id','name']);assert.deepEqual(Object.keys(payload.rounds[0]).sort(),['id','title']);assert(!JSON.stringify(payload).includes('private-contact'));assert.equal(anon.auth.currentUser,null);pass();
 await denied(anon.call('readRefereeEvent',{...c,eventId:b.eventId}));await denied(anon.call('readRefereeEvent',{...c,key:'x'.repeat(43)}));await denied(anon.call('listRefereeAccess',{eventId:a.eventId,...c}),'unauthenticated');
 for(const endpoint of ['updateEvent','lockEventQuiz','createLiveSession','createQuizSlide','adminAddEventTeam'])await assert.rejects(anon.call(endpoint,{...c,credential:c,eventId:a.eventId}),e=>['functions/permission-denied','functions/unauthenticated'].includes(e.code));pass();
 const roundId=payload.rounds[0].id;let revision=0;
 const score=(patch={})=>({eventId:a.eventId,snapshotId:a.snapshotId,teamId:a.teamId,roundId,requestId:randomUUID(),expectedRevision:revision,halfPoints:5,reason:'',...patch});
 const save=(credential,request)=>anon.call('saveRefereeScore',{credential,score:request});
 const initial=score();const [one,two]=await Promise.all([save(c,initial),save(c,initial)]);assert.deepEqual(one,two);revision=1;assert.equal((await a.ref.get()).data().updatedByAccessId,c.accessId);assert.equal((await a.ref.get()).data().updatedBy,undefined);pass();
 await denied(save(c,score({halfPoints:7})),'invalid-argument');await denied(save(c,score({halfPoints:.5})),'invalid-argument');await denied(save(c,score({actorLabel:'forged',halfPoints:7,reason:'forged'})),'invalid-argument');await denied(save(c,score({eventId:b.eventId})));
 await denied(save(c,score({teamId:b.teamId,reason:'foreign'})),'not-found');
 await save(c,score({halfPoints:7,reason:'Referee correction'}));revision=2;
 const historyRef=db.collection(`events/${a.eventId}/scores/${one.scoreId}/history`);let h=(await historyRef.orderBy('revision').get()).docs.map(d=>d.data());assert.equal(h.length,2);assert(h.every(x=>x.actorAccessId===c.accessId&&x.actorLabel==='Rozhodčí A'&&!('actorUid'in x)));pass();
 const safeHistory=await anon.call('readRefereeHistory',{...c,teamId:a.teamId,roundId});assert.deepEqual(Object.keys(safeHistory[0]).sort(),['actorLabel','createdAt','halfPoints','previousHalfPoints','reason','revision']);assert(!JSON.stringify(safeHistory).includes(staff.auth.currentUser.uid));pass();
 const grant2=await staff.call('issueRefereeAccess',{...issueData,requestId:randomUUID(),label:'Rozhodčí B'}), c2={...c,accessId:grant2.accessId,key:grant2.key};
 for(const contenders of [()=>[save(c,score({halfPoints:8,reason:'first'})),staff.call('saveEventScore',score({halfPoints:9,reason:'staff'}))],()=>[save(c,score({halfPoints:10,reason:'ref one'})),save(c2,score({halfPoints:11,reason:'ref two'}))]]){const results=await Promise.allSettled(contenders());assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'functions/aborted');revision++;}pass();
 assert.deepEqual(await save(c,initial),one);assert.equal((await historyRef.get()).size,4);pass();
 for(const path of [`events/${a.eventId}`,`events/${a.eventId}/registrations/${a.teamId}`,`quizSnapshots/${a.snapshotId}`,`quizSnapshots/${a.snapshotId}/rounds/${roundId}`,`events/${a.eventId}/refereeAccess/${c.accessId}`,`events/${a.eventId}/scores/${one.scoreId}`,`events/${a.eventId}/scores/${one.scoreId}/history/1`]){await assert.rejects(getDoc(doc(anon.store,path)),e=>e.code==='permission-denied');await assert.rejects(setDoc(doc(anon.store,path),{forged:true}),e=>e.code==='permission-denied');}pass();
 await staff.call('configureEventRegistration',{eventId:a.eventId,expectedRevision:(await a.ref.get()).data().revision,registrationOpensAt:'2020-01-01T00:00:00Z',registrationClosesAt:'2031-01-01T00:00:00Z',published:true});
 const registration=await anon.call('createEventRegistration',{eventId:a.eventId,teamName:'Public boundary',memberCount:2,contactEmail:'public@example.test'});const managed=await anon.call('getEventRegistration',{eventId:a.eventId,registrationId:registration.registrationId,token:registration.managementToken});for(const data of[registration,managed])assert(Object.keys(data).every(k=>['eventId','registrationId','teamName','memberCount','contactEmail','status','managementToken'].includes(k)));
 await denied(anon.call('readRefereeEvent',{...c,key:registration.managementToken}));pass();
 const batchTeams=[];for(const name of ['Round Alfa','Round Beta'])batchTeams.push((await staff.call('adminAddEventTeam',{eventId:a.eventId,requestId:randomUUID(),teamName:name,memberCount:2})).registrationId);
 const roundInput={eventId:a.eventId,snapshotId:a.snapshotId,roundId,requestId:randomUUID(),scores:batchTeams.map((teamId,index)=>({teamId,expectedRevision:0,halfPoints:index===0?0:5,reason:''}))};
 const saveRound=(credential,input=roundInput)=>anon.call('saveRefereeScore',{credential,score:input});
 const batch=await saveRound(c);assert.equal(batch.scores.length,2);assert.deepEqual(await saveRound(c),batch);
 for(const item of batch.scores){const history=(await db.collection(`events/${a.eventId}/scores/${item.scoreId}/history`).get()).docs.map(doc=>doc.data());assert.equal(history.length,1);assert.equal(history[0].actorAccessId,c.accessId);assert(!('actorUid'in history[0]));}
 await denied(saveRound(c,{...roundInput,eventId:b.eventId}));
 await denied(saveRound(c,{...roundInput,requestId:randomUUID(),scores:roundInput.scores.map((item,index)=>({...item,expectedRevision:index===0?0:1,halfPoints:7,reason:'Conflict'}))}),'aborted');
 for(const item of batch.scores)assert.equal((await db.doc(`events/${a.eventId}/scores/${item.scoreId}`).get()).data().revision,1);
 pass();
 const rotated=await staff.call('changeRefereeAccess',{eventId:a.eventId,accessId:c.accessId,expectedVersion:1,action:'rotate',expiresAt:expiry()});await denied(anon.call('readRefereeEvent',c));await denied(save(c,initial));await denied(saveRound(c));c.key=rotated.key;await anon.call('readRefereeEvent',c);await denied(staff.call('changeRefereeAccess',{eventId:a.eventId,accessId:c.accessId,expectedVersion:1,action:'rotate',expiresAt:expiry()}),'aborted');pass();
 const grantRef=db.doc(`events/${a.eventId}/refereeAccess/${c.accessId}`);await grantRef.update({expiresAt:require('firebase-admin/firestore').Timestamp.fromMillis(Date.now()-1)});await denied(anon.call('readRefereeEvent',c));await denied(save(c,initial));await denied(saveRound(c));await grantRef.update({expiresAt:require('firebase-admin/firestore').Timestamp.fromMillis(Date.now()+60000)});pass();
 const race=await Promise.allSettled([save(c,score({halfPoints:14,reason:'racing revoke'})),staff.call('changeRefereeAccess',{eventId:a.eventId,accessId:c.accessId,expectedVersion:2,action:'revoke'})]);assert.equal(race[1].status,'fulfilled');if(race[0].status==='rejected')assert.equal(race[0].reason.code,'functions/permission-denied');await denied(save(c,score({halfPoints:15,reason:'after revoke'})));await denied(anon.call('readRefereeEvent',c));await denied(anon.call('readRefereeHistory',{...c,teamId:a.teamId,roundId}));assert((await historyRef.get()).size>=4);pass();
 await staff.call('cancelEvent',{eventId:a.eventId,expectedRevision:(await a.ref.get()).data().revision});await denied(anon.call('readRefereeEvent',c2));await staff.call('archiveEvent',{eventId:a.eventId,expectedRevision:(await a.ref.get()).data().revision});await denied(save(c2,score({reason:'archived'})));pass();
 const counters = await db.collection('refereeRateLimits').get();assert(counters.size > 0);
 for(const counter of counters.docs)await counter.ref.update({count:180,until:Date.now()+60000});
 await denied(anon.call('readRefereeEvent',c2),'resource-exhausted');
 for(const counter of counters.docs)await counter.ref.set(counter.data());pass();
 console.log(`Referee emulator contract: ${checks} scenario groups PASS; no access keys logged.`);
} finally { for(const uid of users)await adminAuth.deleteUser(uid);await Promise.all(apps.map(deleteApp));await sdk.deleteApp(adminApp); }
