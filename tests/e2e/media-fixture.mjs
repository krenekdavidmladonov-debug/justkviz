import { seedEmptyQuiz } from './legacy-quiz-fixture.mjs';
import { seedEmulatorMembership } from '../../functions/lib/dev/seed-membership.js';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getStorage, connectStorageEmulator, ref, uploadBytes } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { PNG } from 'pngjs';
import { mediaEventFixture } from './media-event-fixture.mjs';
import { requireFullEmulatorEnvironment, localEmulatorEndpoint } from '../../tools/local-emulator-environment.mjs';
export function syntheticImage() { const image = new PNG({width: 8,height: 4}); for(let i=0;i<image.data.length;i+=4) { image.data[i]=35;image.data[i+1]=180;image.data[i+2]=90;image.data[i+3]=255; } return PNG.sync.write(image); }
export function syntheticAudio(seconds = 4) {
  const samples = 8000 * seconds, b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/8000)*300),44+i*2); return b;
}
export function mediaSlide(kind, extra = {}) { return {kind,title: '',text: kind === 'image' ? 'Syntetický obrázek' : kind === 'audio' ? 'Syntetické audio' : 'Syntetický ' + kind, moderatorNote: '', options: [], correctAnswer: ['image','audio'].includes(kind) ? 'Soukromá odpověď' : '', media: [], presentation: { videoStart:null,videoEnd:null,audioTrigger:null,backgroundOverlay:null,answerOverlay:null,sourceQuestionNumber:null }, backgroundImage:'',questionImage:kind==='image'?'https://example.test/legacy.png':'',answerImage:'',mediaSource:kind==='audio'?'abcdefghijk':'',backgroundOverlay:0,clipStartSeconds:kind==='audio'?1:null,clipEndSeconds:kind==='audio'?2:null,...extra }; }
export async function mediaFixture() {
  const env = requireFullEmulatorEnvironment(process.env, 'Media fixture');
  const storageEndpoint = localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Storage emulator');
  const f = await mediaEventFixture();
  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const adminApp = require('firebase-admin/app').initializeApp({projectId:env.projectId},'media-'+randomUUID());
  const authAdmin = require('firebase-admin/auth').getAuth(adminApp), bucket = require('firebase-admin/storage').getStorage(adminApp).bucket(env.projectId+'.appspot.com');
  const clients=[], users=[], snapshots=new Set(), sessions=new Set();
  async function client(email, password) {
    const app=initializeApp({projectId:env.projectId,apiKey:'demo-api-key',storageBucket:env.projectId+'.appspot.com'},randomUUID());clients.push(app);
    const auth=getAuth(app);connectAuthEmulator(auth,'http://'+env.authEndpoint.host+':'+env.authEndpoint.port,{disableWarnings:true});
    const storage=getStorage(app);connectStorageEmulator(storage,storageEndpoint.host,storageEndpoint.port);
    const functions=getFunctions(app,'europe-west1');connectFunctionsEmulator(functions,env.functionsEndpoint.host,env.functionsEndpoint.port);
    if(email) await signInWithEmailAndPassword(auth,email,password);
    return {auth,storage,call:async(name,data)=>(await httpsCallable(functions,name)(data)).data};
  }
  const admin=await client(f.loginEmail,f.loginPassword), anonymous=await client();
  async function roleClient(role) { const email='media-'+randomUUID()+'@example.test',password=randomUUID();const user=await authAdmin.createUser({email,password});users.push(user.uid);await authAdmin.setCustomUserClaims(user.uid,{role});await seedEmulatorMembership(user.uid, role);return client(email,password); }
  const {quizId}=await seedEmptyQuiz(f.db, 'Syntetická vlastní média', { uid: admin.auth.currentUser.uid });
  const quizRef=f.db.collection('quizzes').doc(quizId);
  const ids={}; let revision=0;
  for(const kind of ['intro','round','image','audio','recap','end']) {const result=await admin.call('createQuizSlide',{quizId,expectedRevision:revision,position:revision+1,slide:mediaSlide(kind,{title:kind==='round'?'Média':kind==='intro'?'Vlastní média':''})});revision=result.revision;ids[kind]=result.selectedSlideId;}
  const begin=(kind,bytes,contentType,who=admin)=>who.call('beginQuizMediaUpload',{quizId,requestId:randomUUID(),kind,contentType,size:bytes.length});
  async function upload(kind,bytes,contentType) {const target=await begin(kind,bytes,contentType);await uploadBytes(ref(admin.storage,target.path),bytes,{contentType});await admin.call('finalizeQuizMediaUpload',{quizId,assetId:target.assetId});return target;}
  async function update(kind,extra) {const q=(await quizRef.get()).data();return admin.call('updateQuizSlide',{quizId,slideId:ids[kind],expectedRevision:q.revision,slide:mediaSlide(kind,extra)});}
  async function lock() {const q=(await quizRef.get()).data(),event=(await f.eventRef.get()).data();await admin.call('lockEventQuiz',{eventId:f.eventId,quizId,expectedRevision:event.revision,expectedQuizRevision:q.revision,acknowledgeWarnings:true});const id=(await f.eventRef.get()).data().quizAssignment.snapshotId;snapshots.add(id);return id;}
  async function live() {const event=(await f.eventRef.get()).data();const result=await admin.call('createEventLiveSession',{eventId:f.eventId,expectedRevision:event.revision});sessions.add(result.sessionId);return result.sessionId;}
  async function navigate(sessionId,position) {const session=(await f.db.doc('sessions/'+sessionId).get()).data();return admin.call('goToSlide',{sessionId,expectedRevision:session.revision,position});}
  async function read(reference,{who=admin,sessionId,range}={}) {const url=new URL('http://'+env.functionsEndpoint.host+':'+env.functionsEndpoint.port+'/'+env.projectId+'/europe-west1/readQuizMedia');url.searchParams.set('reference',reference);const headers={};if(sessionId)url.searchParams.set('sessionId',sessionId);else if(who.auth.currentUser)headers.Authorization='Bearer '+await who.auth.currentUser.getIdToken();if(range)headers.Range=range;return fetch(url,{headers});}
  return {...f,quizId,quizRef,ids,admin,anonymous,roleClient,begin,upload,update,lock,live,navigate,read,bucket,
    async dispose() {requireFullEmulatorEnvironment(process.env,'Media cleanup');localEmulatorEndpoint(process.env.FIREBASE_STORAGE_EMULATOR_HOST,'Storage cleanup');
      await bucket.deleteFiles({prefix:'quiz-assets/'+quizId+'/'});await f.db.recursiveDelete(quizRef);
      for(const id of sessions){await f.db.doc('sessions/'+id).delete();await f.db.doc('publicSessions/'+id).delete();}
      for(const id of snapshots)await f.db.recursiveDelete(f.db.doc('quizSnapshots/'+id));
      await Promise.all(users.map(uid=>authAdmin.deleteUser(uid)));await Promise.all(clients.map(app=>deleteApp(app)));await require('firebase-admin/app').deleteApp(adminApp);await f.dispose();
    }};
}
