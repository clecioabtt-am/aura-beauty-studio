import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/index.js';

const migration=readFileSync(new URL('../migrations/0003_admin_credentials.sql',import.meta.url),'utf8');
const seedHash=migration.match(/pbkdf2_sha256\$210000\$[0-9a-f]{32}\$[0-9a-f]{64}/)?.[0];
assert.ok(seedHash,'Migração deve conter hash PBKDF2 e não senha legível');

function dbMock(){
  const credentials={email:'gerente@aura.com',password_hash:seedHash,must_change_password:1};
  const sessions=new Map();const limits=new Map();
  function prepared(query,values=[]){
    return {
      bind(...args){return prepared(query,args)},
      async first(){
        if(query.includes('FROM request_limits'))return limits.get(values[0])||null;
        if(query.includes('FROM admin_sessions'))return sessions.get(values[0])?.expires_at>values[1]?{token_hash:values[0]}:null;
        if(query.includes('FROM admin_credentials'))return {...credentials};
        throw Error('Unexpected first: '+query);
      },
      async run(){
        if(query.startsWith('INSERT INTO request_limits')){limits.set(values[0],{hits:1,started_at:values[1]});return {meta:{changes:1}}}
        if(query.startsWith('UPDATE request_limits')){limits.get(values[0]).hits++;return {meta:{changes:1}}}
        if(query.startsWith('INSERT INTO admin_sessions')){sessions.set(values[0],{expires_at:values[2]});return {meta:{changes:1}}}
        if(query.startsWith('DELETE FROM admin_sessions WHERE token_hash')){sessions.delete(values[0]);return {meta:{changes:1}}}
        if(query.startsWith('UPDATE admin_credentials')){
          if(credentials.password_hash!==values[1])return {meta:{changes:0}};
          credentials.password_hash=values[0];credentials.must_change_password=0;
          return {meta:{changes:1}};
        }
        if(query.startsWith('DELETE FROM admin_sessions')){sessions.clear();return {meta:{changes:1}}}
        throw Error('Unexpected run: '+query);
      }
    };
  }
  return {prepare(query){return prepared(query)},async batch(commands){const results=[];for(const cmd of commands)results.push(await cmd.run());return results}};
}
async function request(env,path,method='GET',data=null,cookie=''){
  const headers={'Origin':'https://example.workers.dev'};
  if(data)headers['Content-Type']='application/json';
  if(cookie)headers.Cookie=cookie;
  return worker.fetch(new Request('https://example.workers.dev/api'+path,{method,headers,body:data?JSON.stringify(data):undefined}),env);
}

test('Login inicial / troca obrigatória / alteração de senha / invalidação de sessões',async()=>{
  const env={DB:dbMock(), SALON_TIMEZONE:'America/Manaus'};
  const login=await request(env,'/admin/login','POST',{email:'gerente@aura.com',password:'123'});
  assert.equal(login.status,200);
  assert.equal((await login.json()).must_change_password,true);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const me=await request(env,'/admin/me','GET',null,cookie);
  assert.deepEqual(await me.json(),{email:'gerente@aura.com',must_change_password:true});
  const dashboard=await request(env,'/admin/dashboard','GET',null,cookie);
  assert.equal(dashboard.status,403,'Dados do salão bloqueados até trocar senha temporária');
  const weak=await request(env,'/admin/password','PATCH',{current_password:'123',new_password:'abcdef123',confirm_password:'abcdef123'},cookie);
  assert.equal(weak.status,422);
  const wrong=await request(env,'/admin/password','PATCH',{current_password:'invalida',new_password:'MinhaNovaSenhaSegura123',confirm_password:'MinhaNovaSenhaSegura123'},cookie);
  assert.equal(wrong.status,401);
  const changed=await request(env,'/admin/password','PATCH',{current_password:'123',new_password:'MinhaNovaSenhaSegura123',confirm_password:'MinhaNovaSenhaSegura123'},cookie);
  assert.equal(changed.status,200);
  assert.match(changed.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await request(env,'/admin/me','GET',null,cookie)).status,401,'Sessões devem ser revogadas');
  assert.equal((await request(env,'/admin/login','POST',{email:'gerente@aura.com',password:'123'})).status,401,'Senha inicial deixa de funcionar');
  const newLogin=await request(env,'/admin/login','POST',{email:'gerente@aura.com',password:'MinhaNovaSenhaSegura123'});
  assert.equal(newLogin.status,200);
  assert.equal((await newLogin.json()).must_change_password,false);
  const newCookie=newLogin.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(await (await request(env,'/admin/me','GET',null,newCookie)).json(),{email:'gerente@aura.com',must_change_password:false});
});
