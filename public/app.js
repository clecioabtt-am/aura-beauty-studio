const $=s=>document.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((c||0)/100);
const prettyDate=s=>{try{return new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',day:'2-digit',month:'long',year:'numeric'}).format(new Date(`${s}T12:00:00Z`));}catch{return s}};
const api=async(path,options={})=>{const r=await fetch('/api'+path,{credentials:'same-origin',...options});let data;try{data=await r.json()}catch{throw Error('Servidor indisponível. Tente novamente.')}if(!r.ok)throw Error(data.error||'Erro ao carregar os dados.');return data};
const post=(path,obj)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
const state={services:[],vouchers:[],salon:null,category:'Todos',selectedTime:'',voucher:null,trackingLink:''};
let toastTimer,slotQuery=0;
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4400)}
function serviceVisual(s){if(s.image_key)return `<div class="service-image" style="background-image:url('/api/media/${encodeURIComponent(s.image_key).replace('%2F','/')}')"><span class="service-icon">✦</span></div>`;
 const category=s.category.toLowerCase();const cls=category.includes('unha')?'nails':category.includes('barb')?'barber':category.includes('estét')?'beauty':'hair';const emoji=cls==='barber'?'✂':cls==='nails'?'✧':cls==='beauty'?'✦':'❃';return `<div class="service-image ${cls}"><span class="service-icon">${emoji}</span></div>`;}
function renderServices(){const cats=['Todos',...new Set(state.services.map(s=>s.category))];$('#categoryPills').innerHTML=cats.map(c=>`<button class="pill ${state.category===c?'active':''}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join('');
 const filtered=state.services.filter(s=>state.category==='Todos'||s.category===state.category);
 $('#servicesGrid').innerHTML=filtered.length?filtered.map(s=>`<article class="service-card">${serviceVisual(s)}<div class="service-body"><div class="service-label">${esc(s.category).toUpperCase()} • ${s.duration_min} MIN</div><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><div class="service-bottom"><div><strong>${money(s.price_cents)}</strong><small>Valor do serviço</small></div><button type="button" title="Agendar ${esc(s.name)}" aria-label="Agendar ${esc(s.name)}" data-service="${esc(s.id)}">↗</button></div></div></article>`).join(''):'<div class="empty-state">Ainda não há serviços nesta categoria.</div>';
 document.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.cat;renderServices()}));
 document.querySelectorAll('[data-service]').forEach(b=>b.addEventListener('click',()=>chooseService(b.dataset.service)));
}
function renderPromos(){const el=$('#promosGrid');if(!state.vouchers.length){el.innerHTML='<div class="empty-state">As próximas ofertas especiais serão divulgadas aqui. ✦</div>';return;}
 el.innerHTML=state.vouchers.map(v=>`<article class="promo-card">${v.image_key?`<img src="/api/media/${esc(v.image_key)}" alt="Imagem da promoção">`:''}<div class="promo-top"><span>OFERTA EXCLUSIVA ✧</span><span>ATÉ ${esc(v.valid_until.split('-').reverse().join('/'))}</span></div><div class="promo-discount">${v.discount_pct}%<small>OFF</small></div><h3>${esc(v.title)}</h3><p>${esc(v.service_name)} · ${esc(v.description)}</p><div class="promo-bottom"><span class="promo-code">${esc(v.code)}</span><button type="button" data-voucher="${esc(v.id)}">Usar voucher ↗</button></div></article>`).join('');
 el.querySelectorAll('[data-voucher]').forEach(b=>b.addEventListener('click',()=>{const v=state.vouchers.find(x=>x.id===b.dataset.voucher);if(!v)return;$('#bookService').value=v.service_id;$('#bookCode').value=v.code;resetVoucher();renderPrice();loadSlots();location.hash='#agendamento';toast(`Voucher ${v.code} preenchido. Escolha a data e clique em Aplicar.`)}));
}
function chooseService(id){$('#bookService').value=id;$('#bookService').dispatchEvent(new Event('change'));location.hash='#agendamento';$('#bookService').focus({preventScroll:true})}
function resetVoucher(){state.voucher=null;$('#voucherHelp').className='';$('#voucherHelp').textContent=$('#bookCode').value?'Clique em Aplicar para validar seu voucher.':'Sem código? Você pode agendar normalmente.';renderPrice()}
function renderPrice(){const s=state.services.find(x=>x.id===$('#bookService').value),original=$('#priceOriginal'),final=$('#priceFinal');if(!s){original.textContent='Selecione o serviço';final.textContent='—';return;}
 original.textContent=state.voucher?`De ${money(s.price_cents)} • ${state.voucher.discount_pct}% OFF`:`${s.duration_min} minutos de atendimento`;final.textContent=money(state.voucher?.final_price_cents??s.price_cents);
}
async function loadSlots(){const s=$('#bookService').value,date=$('#bookDate').value;const query=++slotQuery;state.selectedTime='';$('#selectedTime').textContent='Selecione um horário';$('#slotsGrid').innerHTML='';if(!s||!date)return;
 $('#slotsGrid').innerHTML='<div class="slot-empty">Consultando horários disponíveis...</div>';
 try{const data=await api(`/slots?service_id=${encodeURIComponent(s)}&date=${encodeURIComponent(date)}`);if(query!==slotQuery)return;
  $('#slotsGrid').innerHTML=data.slots.length?data.slots.map(t=>`<button type="button" class="slot-button" data-time="${t}">${t}</button>`).join(''):'<div class="slot-empty">Não há horários disponíveis para essa data. Selecione outro dia.</div>';
  $('#slotsGrid').querySelectorAll('[data-time]').forEach(btn=>btn.addEventListener('click',()=>{$('#slotsGrid').querySelectorAll('.slot-button').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state.selectedTime=btn.dataset.time;$('#selectedTime').textContent=btn.dataset.time}));
 }catch(e){if(query===slotQuery){$('#slotsGrid').innerHTML='<div class="slot-empty">Não foi possível consultar horários.</div>';toast(e.message)}}
}
async function validateVoucher(){const code=$('#bookCode').value.trim(),service_id=$('#bookService').value,date=$('#bookDate').value;if(!code){resetVoucher();return;}if(!service_id||!date){toast('Selecione o serviço e a data antes de aplicar o voucher.');return;}
 const btn=$('#applyCode');btn.disabled=true;btn.textContent='Validando...';
 try{const res=await post('/vouchers/validate',{code,service_id,date});state.voucher={...res,code:code.toUpperCase(),service_id,date};$('#voucherHelp').textContent=`✓ ${res.title} — ${res.discount_pct}% de desconto aplicado.`;$('#voucherHelp').className='valid';renderPrice();toast('Voucher aplicado com sucesso!')}
 catch(e){resetVoucher();$('#voucherHelp').textContent=e.message;$('#voucherHelp').className='invalid';toast(e.message)}finally{btn.disabled=false;btn.textContent='Aplicar'}
}
async function sendBooking(ev){ev.preventDefault();const s=$('#bookService').value,date=$('#bookDate').value,time=state.selectedTime,code=$('#bookCode').value.trim();
 if(!s||!date||!time){toast('Selecione o serviço, a data e um horário disponível.');return;}
 if(code&&(!state.voucher||state.voucher.code!==code.toUpperCase()||state.voucher.service_id!==s||state.voucher.date!==date)){toast('Valide seu voucher clicando em Aplicar.');return;}
 if(!$('#consent').checked){toast('É necessário autorizar o uso dos dados para o agendamento.');return;}
 const btn=$('#sendBooking');btn.disabled=true;btn.innerHTML='Enviando solicitação...';
 try{const result=await post('/bookings',{service_id:s,date,time,customer_name:$('#bookName').value,customer_phone:$('#bookPhone').value,customer_email:$('#bookEmail').value,notes:$('#bookNotes').value,code,website:$('#website').value});
   state.trackingLink=`${location.origin}/?reserva=${result.tracking_token}`;
   $('#successDetails').textContent=`${result.service_name} • ${prettyDate(result.date)} às ${result.time}. Valor previsto: ${money(result.final_price_cents)}${result.discount_pct?` (${result.discount_pct}% de desconto)` :''}.`;
   $('#successDialog').showModal();ev.target.reset();state.selectedTime='';resetVoucher();$('#slotsGrid').innerHTML='';$('#selectedTime').textContent='Escolha uma data primeiro';
 }catch(e){toast(e.message);if(e.message.includes('horário'))loadSlots()}finally{btn.disabled=false;btn.innerHTML='Solicitar agendamento <span>↗</span>'}
}
async function copyText(txt){try{await navigator.clipboard.writeText(txt);toast('Copiado! ✦')}catch{window.prompt('Copie o texto abaixo:',txt)}}
async function showTracking(token){$('#trackingInfo').textContent='Consultando agendamento...';$('#trackingDialog').showModal();try{const data=await api(`/booking-status?token=${encodeURIComponent(token)}`);const status={pending:'Aguardando confirmação',confirmed:'Agendamento confirmado',rejected:'Solicitação recusada',cancelled:'Agendamento cancelado',completed:'Atendimento concluído'};
 $('#trackingInfo').innerHTML=`<p><strong>${esc(data.service_name)}</strong><br>${prettyDate(data.appointment_date)} às ${esc(data.appointment_time)}<br>Valor previsto: <strong>${money(data.final_price_cents)}</strong></p><p><span class="status-chip status-${esc(data.status)}">${status[data.status]||'Status desconhecido'}</span></p>`;
 }catch(e){$('#trackingInfo').textContent=e.message}}
function initEvents(){
 $('#menuToggle').addEventListener('click',()=>{const open=$('#mainNav').classList.toggle('open');$('#menuToggle').setAttribute('aria-expanded',String(open))});
 $('#mainNav').querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{$('#mainNav').classList.remove('open');$('#menuToggle').setAttribute('aria-expanded','false')}));
 $('#bookService').addEventListener('change',()=>{resetVoucher();loadSlots()});$('#bookDate').addEventListener('change',()=>{resetVoucher();loadSlots()});$('#bookCode').addEventListener('input',resetVoucher);
 $('#applyCode').addEventListener('click',validateVoucher);$('#bookingForm').addEventListener('submit',sendBooking);
 $('#closeSuccess').addEventListener('click',()=>$('#successDialog').close());$('#closeTracking').addEventListener('click',()=>{$('#trackingDialog').close();history.replaceState(null,'',location.pathname+location.hash)});
 $('#copyTracking').addEventListener('click',()=>copyText(state.trackingLink));
 $('#year').textContent=new Date().getFullYear();
}
async function init(){initEvents();try{const data=await api('/public');state.salon=data.salon;state.services=data.services;state.vouchers=data.vouchers;
 $('#bookService').innerHTML='<option value="">Selecione um serviço</option>'+state.services.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} — ${money(s.price_cents)}</option>`).join('');
 const today=data.today;$('#bookDate').min=today;const max=new Date(today+'T12:00:00Z');max.setUTCDate(max.getUTCDate()+60);$('#bookDate').max=max.toISOString().slice(0,10);
 document.title=`${data.salon.salon_name} | Agendamentos & Beleza`;
 const brandWords=data.salon.salon_name.trim().split(/\s+/);const brandMain=brandWords.shift()||'AURA';const brandSmall=brandWords.join(' ')||'BEAUTY STUDIO';document.querySelectorAll('.brand > span:last-child').forEach(el=>{el.textContent=brandMain.toUpperCase();const small=document.createElement('small');small.textContent=brandSmall.toUpperCase();el.appendChild(small)});document.querySelector('.hero-seal strong').textContent=brandMain.toUpperCase();
 $('#contactAddress').textContent=data.salon.address||'Personalize o endereço do salão no painel gerencial.';
 if(data.salon.whatsapp){$('#contactWhatsapp').href=`https://wa.me/${data.salon.whatsapp.replace(/\D/g,'')}`;$('#contactWhatsapp').target='_blank';$('#contactWhatsapp').rel='noopener'}
 if(data.salon.instagram){$('#contactInstagram').href=`https://instagram.com/${data.salon.instagram.replace(/^@/,'')}`;$('#contactInstagram').target='_blank';$('#contactInstagram').rel='noopener'}
 renderServices();renderPromos();
 }catch(e){$('#servicesGrid').innerHTML=`<div class="empty-state">Não foi possível carregar os serviços. ${esc(e.message)}</div>`;$('#promosGrid').innerHTML='';toast(e.message)}
 const track=new URLSearchParams(location.search).get('reserva');if(track)showTracking(track);
 if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
init();
