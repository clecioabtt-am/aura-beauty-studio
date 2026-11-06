import {discountPrice, saneText, validDate, validTime, dateForTimezone, withinBookingWindow, proposedSlots, slotsForDay, upperVoucher, weekday, errorMessage} from './lib.js';

const COOKIE='aura_session';
const SESSION_DAYS=7;
// Limite da API Web Crypto PBKDF2 no Cloudflare Workers de produção.
const MAX_PBKDF2_ITERATIONS=100000;
class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
const fail=(status,message)=>{throw new HttpError(status,message);};
const json=(obj,status=200,headers={})=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const today=(env)=>dateForTimezone(env.SALON_TIMEZONE||'America/Manaus');
const datetime=(days=0)=>new Date(Date.now()+days*86400000).toISOString();
const cleanCode=(v)=>upperVoucher(v);
const uuid=()=>crypto.randomUUID();
const randToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),x=>x.toString(16).padStart(2,'0')).join('');
const strEq=(a,b)=>{if(a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;};
async function verifyPassword(password, stored) {
  const fields=(stored||'').split('$');
  if(fields.length!==4 || fields[0]!=='pbkdf2_sha256') return false;
  const rounds=Number(fields[1]);
  if(!Number.isInteger(rounds)||rounds<100000||!/^[a-f0-9]{32}$/.test(fields[2])||!/^[a-f0-9]{64}$/.test(fields[3]))return false;
  if(rounds>MAX_PBKDF2_ITERATIONS)fail(503,'Hash da senha incompatível com Cloudflare Workers. Execute as migrações pendentes do D1 (0004).');
  const salt=Uint8Array.from(fields[2].match(/../g),x=>parseInt(x,16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const raw=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:rounds,hash:'SHA-256'},key,256);
  const actual=Array.from(new Uint8Array(raw),x=>x.toString(16).padStart(2,'0')).join('');
  return strEq(actual,fields[3]);
}
async function passwordHash(password) {
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const derived=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:MAX_PBKDF2_ITERATIONS,hash:'SHA-256'},key,256);
  const hex=buf=>Array.from(new Uint8Array(buf),x=>x.toString(16).padStart(2,'0')).join('');
  return `pbkdf2_sha256$${MAX_PBKDF2_ITERATIONS}$${hex(salt)}$${hex(derived)}`;
}
function sessionCookie(token, request, maxAge) {
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secure}`;
}
const readCookie=(req,name)=>req.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`))?.slice(name.length+1)||'';
async function admin(req,env) {
  const token=readCookie(req,COOKIE);
  if(!/^[a-f0-9]{64}$/.test(token))fail(401,'Acesso administrativo necessário.');
  const entry=await env.DB.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token),datetime()).first();
  if(!entry)fail(401,'Sua sessão expirou. Faça login novamente.');
  const credentials=await env.DB.prepare('SELECT email,must_change_password FROM admin_credentials WHERE id=1').first();
  if(!credentials)fail(503,'Execute a migração de credenciais no D1.');
  return credentials;
}
function validateOrigin(req) {
  if(!['POST','PATCH','PUT','DELETE'].includes(req.method))return;
  const origin=req.headers.get('Origin');
  if(origin && origin!==new URL(req.url).origin)fail(403,'Origem não autorizada.');
}
async function body(req) {
  if(!(req.headers.get('content-type')||'').includes('application/json'))fail(415,'Envie JSON.');
  try { const txt=await req.text();if(txt.length>25000)fail(413,'Dados muito grandes.');return JSON.parse(txt); }
  catch(e){if(e instanceof HttpError)throw e;fail(400,'JSON inválido.');}
}
const asId=(v)=>saneText(v,100);
const price=(v)=>Number(v);
async function rateLimit(env,req,namespace,limit,periodSeconds){
  const raw=req.headers.get('CF-Connecting-IP')||'unknown';
  const ipHash=await hash(`${namespace}|${raw}|${env.RATE_LIMIT_SALT||'aura-rate-limiter'}`);
  const key=`${namespace}:${ipHash}`;
  const from=new Date(Date.now()-periodSeconds*1000).toISOString();
  const row=await env.DB.prepare('SELECT hits,started_at FROM request_limits WHERE key=?').bind(key).first();
  if(!row || row.started_at < from){await env.DB.prepare('INSERT INTO request_limits(key,hits,started_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=1,started_at=excluded.started_at').bind(key,datetime()).run();return;}
  if(row.hits>=limit)fail(429,'Muitas tentativas. Tente novamente mais tarde.');
  await env.DB.prepare('UPDATE request_limits SET hits=hits+1 WHERE key=?').bind(key).run();
}
function hoursFor(settings,date){ const hours=JSON.parse(settings.opening_hours_json);return hours[String(weekday(date))]||null;}
async function salon(env){return await env.DB.prepare('SELECT * FROM salon_settings WHERE id=1').first();}
async function freeTimes(env,service,date){
  const settings=await salon(env);
  const taken=await env.DB.prepare('SELECT slot_key FROM booking_slots WHERE slot_key>=? AND slot_key<?').bind(date+'T00:00',date+'T23:59').all();
  return slotsForDay(date,service.duration_min,hoursFor(settings,date),new Set(taken.results.map(x=>x.slot_key)),today(env));
}
const publicService=s=>({id:s.id,name:s.name,category:s.category,description:s.description,duration_min:s.duration_min,price_cents:s.price_cents,image_key:s.image_key});
async function getPublicVouchers(env) {
  const now=today(env).date;
  const result=await env.DB.prepare(`SELECT v.id,v.code,v.title,v.description,v.service_id,v.discount_pct,v.valid_until,v.image_key,s.name AS service_name
   FROM vouchers v JOIN services s ON s.id=v.service_id
   WHERE v.active=1 AND v.public_visible=1 AND v.valid_until>=? AND s.active=1
   AND (SELECT COUNT(*) FROM bookings b WHERE b.voucher_id=v.id AND b.status IN ('pending','confirmed','completed'))<v.max_uses
   ORDER BY v.created_at DESC LIMIT 30`).bind(now).all();
  return result.results;
}
async function voucherFromCode(env,code,serviceId,date) {
  const v=await env.DB.prepare(`SELECT v.*, (SELECT COUNT(*) FROM bookings b WHERE b.voucher_id=v.id AND b.status IN ('pending','confirmed','completed')) AS used_count FROM vouchers v WHERE code=? COLLATE NOCASE`).bind(code).first();
  if(!v||!v.active||v.service_id!==serviceId||v.valid_until<today(env).date||v.used_count>=v.max_uses)fail(422,'Voucher inválido, vencido ou esgotado para este serviço/data.');
  return v;
}
function parseService(x) {
  const name=saneText(x.name,70),category=saneText(x.category,40),description=saneText(x.description,400);
  const duration=Number(x.duration_min), cents=Number(x.price_cents);
  if(name.length<2||category.length<2||!Number.isInteger(duration)||duration<30||duration>240||duration%30||!Number.isInteger(cents)||cents<0||cents>2000000)fail(422,'Revise nome, categoria, duração (30 a 240 min) e preço.');
  const image_key=x.image_key ? saneText(x.image_key,150):null;
  if(image_key&&!/^salon\/[a-f0-9-]+\.(jpg|png|webp)$/.test(image_key))fail(422,'Imagem inválida.');
  return {name,category,description,duration,cents,image_key,active:x.active===false?0:1};
}
function parseVoucher(x){
  const title=saneText(x.title,70),desc=saneText(x.description,240),serviceId=asId(x.service_id);
  const discount=Number(x.discount_pct),maxUses=Number(x.max_uses),expiry=saneText(x.valid_until,10);
  if(title.length<3||!Number.isInteger(discount)||discount<1||discount>90||!Number.isInteger(maxUses)||maxUses<1||maxUses>100000||!validDate(expiry)||expiry<today({}).date)fail(422,'Revise título, percentual (1–90%), validade e quantidade de usos.');
  const image_key=x.image_key ? saneText(x.image_key,150):null;
  if(image_key&&!/^salon\/[a-f0-9-]+\.(jpg|png|webp)$/.test(image_key))fail(422,'Imagem inválida.');
  return {title,desc,serviceId,discount,maxUses,expiry,image_key,public_visible:x.public_visible===false?0:1,active:x.active===false?0:1,code:cleanCode(x.code)};
}
async function route(req,env){
  const url=new URL(req.url),p=url.pathname,m=req.method;
  validateOrigin(req);
  if(!env.DB)fail(503,'Banco D1 não configurado.');
  if(m==='GET'&&p==='/api/public'){
    const [settings,services,vouchers]=await Promise.all([salon(env),env.DB.prepare('SELECT * FROM services WHERE active=1 ORDER BY sort_order,name').all(),getPublicVouchers(env)]);
    return json({salon:{salon_name:settings.salon_name,tagline:settings.tagline,whatsapp:settings.whatsapp,address:settings.address,instagram:settings.instagram,opening_hours:JSON.parse(settings.opening_hours_json)},services:services.results.map(publicService),vouchers,today:today(env).date});
  }
  if(m==='GET'&&p==='/api/slots'){
    const serviceId=asId(url.searchParams.get('service_id'));
    const date=url.searchParams.get('date');
    const s=await env.DB.prepare('SELECT * FROM services WHERE id=? AND active=1').bind(serviceId).first();
    if(!s)fail(404,'Serviço não encontrado.');
    if(!validDate(date)||!withinBookingWindow(date,'23:30',today(env)))fail(422,'Data fora da janela de 60 dias.');
    return json({slots:await freeTimes(env,s,date)});
  }
  if(m==='POST'&&p==='/api/vouchers/validate'){
    await rateLimit(env,req,'validate',45,3600);
    const x=await body(req);const s=await env.DB.prepare('SELECT * FROM services WHERE id=? AND active=1').bind(asId(x.service_id)).first();
    if(!s)fail(404,'Serviço indisponível.');
    if(!validDate(x.date))fail(422,'Selecione uma data válida.');
    const v=await voucherFromCode(env,cleanCode(x.code),s.id,x.date);
    return json({title:v.title,discount_pct:v.discount_pct,final_price_cents:discountPrice(s.price_cents,v.discount_pct)});
  }
  if(m==='POST'&&p==='/api/bookings'){
    await rateLimit(env,req,'booking',12,3600);
    const x=await body(req);if(x.website)fail(422,'Não foi possível enviar o formulário.');
    const s=await env.DB.prepare('SELECT * FROM services WHERE id=? AND active=1').bind(asId(x.service_id)).first();
    if(!s)fail(404,'Serviço não encontrado.');
    const date=saneText(x.date,10),time=saneText(x.time,5),now=today(env);
    if(!withinBookingWindow(date,time,now))fail(422,'Escolha um dia e horário futuros (até 60 dias).');
    const settings=await salon(env),hours=hoursFor(settings,date);
    const start=Number(time.slice(0,2))*60+Number(time.slice(3));
    if(!hours||start<Number(hours[0].slice(0,2))*60+Number(hours[0].slice(3))||start+s.duration_min>Number(hours[1].slice(0,2))*60+Number(hours[1].slice(3)))fail(422,'Fora do horário de funcionamento.');
    const name=saneText(x.customer_name,100),phone=String(x.customer_phone||'').replace(/\D/g,''),email=saneText(x.customer_email,180),notes=saneText(x.notes,300);
    if(name.length<3||phone.length<10||phone.length>13||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))fail(422,'Informe nome, telefone válido e e-mail válido (se preenchido).');
    const voucher=x.code?await voucherFromCode(env,cleanCode(x.code),s.id,date):null;
    const percent=voucher?.discount_pct||0,finalCents=discountPrice(s.price_cents,percent);
    const id=uuid(),token=randToken(),tokenHash=await hash(token),slots=proposedSlots(date,time,s.duration_min);
    try{
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO bookings(id,service_id,voucher_id,customer_name,customer_phone,customer_email,notes,appointment_date,appointment_time,redeemed_on,duration_min,original_price_cents,discount_pct,final_price_cents,tracking_hash)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,s.id,voucher?.id||null,name,phone,email||null,notes,date,time,now.date,s.duration_min,s.price_cents,percent,finalCents,tokenHash),
        ...slots.map(slot=>env.DB.prepare('INSERT INTO booking_slots(booking_id,slot_key) VALUES(?,?)').bind(id,slot))
      ]);
    }catch(e){if(String(e?.message||'').includes('UNIQUE')||String(e?.message||'').includes('VOUCHER_INVALID'))fail(409,errorMessage(e));throw e;}
    return json({booking_id:id,tracking_token:token,status:'pending',service_name:s.name,date,time,original_price_cents:s.price_cents,discount_pct:percent,final_price_cents:finalCents},201);
  }
  if(m==='GET'&&p==='/api/booking-status'){
    const token=url.searchParams.get('token')||'';
    if(!/^[a-f0-9]{64}$/.test(token))fail(404,'Agendamento não encontrado.');
    const b=await env.DB.prepare('SELECT b.id,b.appointment_date,b.appointment_time,b.final_price_cents,b.discount_pct,b.status,s.name AS service_name FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.tracking_hash=?').bind(await hash(token)).first();
    if(!b)fail(404,'Agendamento não encontrado.');return json(b);
  }
  if(m==='GET'&&p.startsWith('/api/media/')){
    const key=decodeURIComponent(p.slice('/api/media/'.length));
    if(!/^salon\/[a-f0-9-]+\.(jpg|png|webp)$/.test(key))fail(404,'Imagem não encontrada.');
    if(!env.MEDIA)fail(503,'Armazenamento R2 não configurado.');
    const object=await env.MEDIA.get(key);if(!object)fail(404,'Imagem não encontrada.');
    return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'image/jpeg','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
  }
  if(m==='POST'&&p==='/api/admin/login'){
    await rateLimit(env,req,'login',8,900);
    const x=await body(req);
    const email=saneText(x.email,180).toLowerCase(),password=String(x.password||'');
    const credentials=await env.DB.prepare('SELECT email,password_hash,must_change_password FROM admin_credentials WHERE id=1').first();
    if(!credentials)fail(503,'Execute a migração de credenciais no D1.');
    if(password.length>250||!strEq(email,credentials.email.toLowerCase())||!await verifyPassword(password,credentials.password_hash))fail(401,'E-mail ou senha incorretos.');
    const token=randToken();
    await env.DB.prepare('INSERT INTO admin_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)').bind(await hash(token),datetime(),datetime(SESSION_DAYS)).run();
    return json({ok:true,must_change_password:!!credentials.must_change_password},200,{'Set-Cookie':sessionCookie(token,req,SESSION_DAYS*86400)});
  }
  if(p.startsWith('/api/admin/')){
    const credentials=await admin(req,env);
    if(m==='GET'&&p==='/api/admin/me')return json({email:credentials.email,must_change_password:!!credentials.must_change_password});
    if(m==='POST'&&p==='/api/admin/logout'){
      const token=readCookie(req,COOKIE);
      await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await hash(token)).run();
      return json({ok:true},200,{'Set-Cookie':sessionCookie('',req,0)});
    }
    if(m==='PATCH'&&p==='/api/admin/password'){
      await rateLimit(env,req,'password-change',12,3600);
      const x=await body(req);
      const current=String(x.current_password||''),next=String(x.new_password||''),confirm=String(x.confirm_password||'');
      if(next!==confirm)fail(422,'A confirmação da nova senha não confere.');
      if(next.length<12||next.length>128||new TextEncoder().encode(next).length>256)fail(422,'A nova senha deve ter entre 12 e 128 caracteres.');
      if(!/[a-zA-ZÀ-ÿ]/.test(next)||!/[0-9]/.test(next))fail(422,'A nova senha deve conter letras e números.');
      if(current===next)fail(422,'A nova senha precisa ser diferente da atual.');
      if(current.length>250)fail(401,'Senha atual incorreta.');
      const old=await env.DB.prepare('SELECT password_hash FROM admin_credentials WHERE id=1').first();
      if(!old||!await verifyPassword(current,old.password_hash))fail(401,'Senha atual incorreta.');
      const updated=await env.DB.batch([
        env.DB.prepare('UPDATE admin_credentials SET password_hash=?,must_change_password=0,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND password_hash=?').bind(await passwordHash(next),old.password_hash),
        env.DB.prepare('DELETE FROM admin_sessions')
      ]);
      if(!updated[0].meta?.changes)fail(409,'A senha foi alterada em outra sessão. Faça login novamente.');
      return json({ok:true,relogin_required:true},200,{'Set-Cookie':sessionCookie('',req,0)});
    }
    if(credentials.must_change_password)fail(403,'Por segurança, altere a senha inicial antes de usar o painel.');
    if(m==='GET'&&p==='/api/admin/dashboard'){
      const [bookings,services,vouchers,settings]=await Promise.all([
        env.DB.prepare(`SELECT b.*,s.name AS service_name,v.code AS voucher_code FROM bookings b JOIN services s ON s.id=b.service_id LEFT JOIN vouchers v ON v.id=b.voucher_id ORDER BY b.appointment_date DESC,b.appointment_time DESC,b.created_at DESC LIMIT 400`).all(),
        env.DB.prepare('SELECT * FROM services ORDER BY sort_order,name').all(),
        env.DB.prepare(`SELECT v.*,s.name AS service_name,(SELECT COUNT(*) FROM bookings b WHERE b.voucher_id=v.id AND b.status IN ('pending','confirmed','completed')) AS used_count FROM vouchers v JOIN services s ON s.id=v.service_id ORDER BY v.created_at DESC`).all(),salon(env)
      ]);
      return json({bookings:bookings.results,services:services.results,vouchers:vouchers.results,settings:{...settings,opening_hours:JSON.parse(settings.opening_hours_json)}});
    }
    if(m==='POST'&&p==='/api/admin/services'){
      const x=parseService(await body(req));const id=uuid();
      await env.DB.prepare('INSERT INTO services (id,name,category,description,duration_min,price_cents,image_key,active,sort_order) VALUES(?,?,?,?,?,?,?,?,99)').bind(id,x.name,x.category,x.description,x.duration,x.cents,x.image_key,x.active).run();return json({id},201);
    }
    if(m==='PATCH'&&/^\/api\/admin\/services\/[^/]+$/.test(p)){
      const id=asId(p.split('/').pop());const x=parseService(await body(req));
      const r=await env.DB.prepare('UPDATE services SET name=?,category=?,description=?,duration_min=?,price_cents=?,image_key=?,active=? WHERE id=?').bind(x.name,x.category,x.description,x.duration,x.cents,x.image_key,x.active,id).run();
      if(!r.meta.changes)fail(404,'Serviço não encontrado.');return json({ok:true});
    }
    if(m==='POST'&&p==='/api/admin/vouchers'){
      const x=parseVoucher(await body(req));const service=await env.DB.prepare('SELECT id FROM services WHERE id=?').bind(x.serviceId).first();if(!service)fail(422,'Serviço não existe.');
      const code=x.code||`AURA-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
      if(code.length<5)fail(422,'Código precisa ter ao menos 5 caracteres.');
      try{await env.DB.prepare(`INSERT INTO vouchers(id,code,title,description,service_id,discount_pct,max_uses,valid_until,image_key,public_visible,active)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(uuid(),code,x.title,x.desc,x.serviceId,x.discount,x.maxUses,x.expiry,x.image_key,x.public_visible,x.active).run();}
      catch(e){if(String(e).includes('UNIQUE'))fail(409,'Este código já está em uso.');throw e;}
      return json({code},201);
    }
    if(m==='PATCH'&&/^\/api\/admin\/vouchers\/[^/]+$/.test(p)){
      const id=asId(p.split('/').pop()),x=parseVoucher(await body(req));
      const existing=await env.DB.prepare('SELECT * FROM vouchers WHERE id=?').bind(id).first();if(!existing)fail(404,'Voucher não encontrado.');
      // Vouchers já utilizados não podem ter serviço e percentual alterados retroativamente.
      const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE voucher_id=? AND status IN ('pending','confirmed','completed')").bind(id).first();
      if(count.n&&(x.serviceId!==existing.service_id||x.discount!==existing.discount_pct||x.maxUses<count.n))fail(422,'Voucher utilizado: não altere serviço, desconto ou limite abaixo do uso atual. Crie outro voucher.');
      try{await env.DB.prepare(`UPDATE vouchers SET code=?,title=?,description=?,service_id=?,discount_pct=?,max_uses=?,valid_until=?,image_key=?,public_visible=?,active=? WHERE id=?`).bind(x.code||existing.code,x.title,x.desc,x.serviceId,x.discount,x.maxUses,x.expiry,x.image_key,x.public_visible,x.active,id).run();}
      catch(e){if(String(e).includes('UNIQUE'))fail(409,'Código já existente.');throw e;}
      return json({ok:true});
    }
    if(m==='PATCH'&&/^\/api\/admin\/bookings\/[^/]+\/status$/.test(p)){
      const parts=p.split('/'),id=asId(parts[4]);const x=await body(req);
      const status=String(x.status||'');if(!['confirmed','rejected','cancelled','completed'].includes(status))fail(422,'Status inválido.');
      const b=await env.DB.prepare('SELECT status FROM bookings WHERE id=?').bind(id).first();if(!b)fail(404,'Agendamento não encontrado.');
      if(!['pending','confirmed'].includes(b.status)|| (status==='rejected'&&b.status!=='pending') || (status==='completed'&&b.status!=='confirmed'))fail(409,'Esta mudança não é permitida para o status atual.');
      if(b.status===status)return json({ok:true});
      const commands=[env.DB.prepare('UPDATE bookings SET status=?,updated_at=? WHERE id=?').bind(status,datetime(),id)];
      if(['rejected','cancelled'].includes(status))commands.push(env.DB.prepare('DELETE FROM booking_slots WHERE booking_id=?').bind(id));
      await env.DB.batch(commands);return json({ok:true});
    }
    if(m==='PATCH'&&p==='/api/admin/settings'){
      const x=await body(req),name=saneText(x.salon_name,80),tagline=saneText(x.tagline,140),whatsapp=saneText(x.whatsapp,30),address=saneText(x.address,220),instagram=saneText(x.instagram,100);
      const hours=x.opening_hours;if(!name||!tagline||typeof hours!=='object'||!hours||Array.isArray(hours))fail(422,'Revise os dados.');
      const validated={};
      for(let d=0;d<7;d++){
        const h=hours[String(d)];
        if(h===null){validated[d]=null;continue;}
        if(!Array.isArray(h)||h.length!==2||!/^([01]\d|2[0-3]):(00|30)$/.test(h[0])||!/^([01]\d|2[0-3]):(00|30)$/.test(h[1])||h[0]>=h[1])fail(422,`Horário inválido para dia ${d}.`);
        validated[d]=h;
      }
      await env.DB.prepare('UPDATE salon_settings SET salon_name=?,tagline=?,whatsapp=?,address=?,instagram=?,opening_hours_json=? WHERE id=1').bind(name,tagline,whatsapp,address,instagram,JSON.stringify(validated)).run();return json({ok:true});
    }
    if(m==='POST'&&p==='/api/admin/upload'){
      if(!env.MEDIA)fail(503,'Configure o bucket R2.');
      if(Number(req.headers.get('content-length')||0)>4*1024*1024)fail(413,'Imagem maior que 3 MB.');
      const form=await req.formData(),file=form.get('file');
      if(!file||typeof file==='string')fail(422,'Envie uma imagem.');
      const allowed={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
      const ext=allowed[file.type];if(!ext||file.size>3*1024*1024||file.size<100)fail(422,'Envie JPG, PNG ou WebP com até 3 MB.');
      const bytes=await file.arrayBuffer();
      const header=new Uint8Array(bytes.slice(0,12));
      const sig=(...nums)=>nums.every((v,i)=>header[i]===v);
      const valid=ext==='jpg'?sig(0xff,0xd8,0xff):ext==='png'?sig(137,80,78,71,13,10,26,10):sig(82,73,70,70)&&String.fromCharCode(...header.slice(8,12))==='WEBP';
      if(!valid)fail(422,'O arquivo não parece ser uma imagem válida.');
      const key=`salon/${uuid()}.${ext}`;
      await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:file.type}});
      return json({image_key:key,url:`/api/media/${key}`},201);
    }
  }
  fail(404,'Rota não encontrada.');
}
export default {
  async fetch(req,env){
    try{
      if(!new URL(req.url).pathname.startsWith('/api/'))return env.ASSETS.fetch(req);
      return await route(req,env);
    }catch(e){
      if(!(e instanceof HttpError))console.error('API error',new URL(req.url).pathname,String(e?.message||e),String(e?.cause?.message||''));
      // Mensagem operacional sem revelar queries ou dados sensíveis do banco ao visitante.
      const details=`${String(e?.message||'')} ${String(e?.cause?.message||'')}`;
      const missing=details.match(/no such table:\s*(?:main\.)?[`\"]?([a-z_]+)[`\"]?/i);
      const expectedTables=new Set(['request_limits','admin_credentials','admin_sessions','salon_settings','services','vouchers','bookings','booking_slots']);
      if(!(e instanceof HttpError) && missing && expectedTables.has(missing[1]))
        return json({error:`O banco D1 está sem a tabela ${missing[1]}. Execute: npx wrangler d1 migrations apply aura-beauty-db --remote`},503);
      return json({error:e instanceof HttpError?e.message:'Erro inesperado do servidor. Consulte os logs do Cloudflare Worker.'},e instanceof HttpError?e.status:500);
    }
  }
};
