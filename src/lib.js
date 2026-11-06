export const INTERVAL = 30;
export const ACTIVE_STATUSES = ['pending', 'confirmed', 'completed'];
export const money = (cents) => Math.round(cents) / 100;
export const discountPrice = (cents, percent = 0) => Math.max(0, Math.round(cents * (100 - percent) / 100));
export const saneText = (value, max = 150) => String(value ?? '').trim().slice(0, max);
export const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value;
export const validTime = (value) => /^([01]\d|2[0-3]):(00|30)$/.test(value || '');
export const toMinutes = (value) => Number(value.slice(0,2)) * 60 + Number(value.slice(3,5));
export const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`;
export function dateForTimezone(timezone, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
  const p = Object.fromEntries(fmt.formatToParts(date).map(v=>[v.type,v.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
export function withinBookingWindow(date, time, now, maxDays = 60) {
  if (!validDate(date) || !validTime(time)) return false;
  const day = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${now.date}T12:00:00Z`))/86400000);
  if (day < 0 || day > maxDays) return false;
  if (day === 0 && toMinutes(time) < toMinutes(now.time) + 60) return false;
  return true;
}
export function proposedSlots(date,time,duration) {
  if (!validDate(date) || !validTime(time) || duration < 30 || duration > 240 || duration % INTERVAL) return [];
  return Array.from({ length: duration / INTERVAL }, (_,i) => `${date}T${toTime(toMinutes(time)+i*INTERVAL)}`);
}
export function slotsForDay(date, duration, hours, taken, now) {
  if (!hours || !Array.isArray(hours) || hours.length !== 2 || !duration) return [];
  const start = toMinutes(hours[0]); const end = toMinutes(hours[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const list=[];
  for (let t=start; t+duration <= end; t+=INTERVAL) {
    const time=toTime(t);
    if (!withinBookingWindow(date,time,now)) continue;
    const required=proposedSlots(date,time,duration);
    if (required.length && required.every(s=>!taken.has(s))) list.push(time);
  }
  return list;
}
export function errorMessage(err) {
  const msg=String(err?.message || err);
  if (msg.includes('UNIQUE constraint failed: booking_slots.slot_key')) return 'Este horário acabou de ser reservado. Escolha outro.';
  if (msg.includes('VOUCHER_INVALID_OR_EXHAUSTED')) return 'Voucher expirado, inválido ou esgotado. Atualize seu agendamento.';
  return 'Não foi possível concluir esta operação.';
}
export function upperVoucher(v) {return saneText(v,30).toUpperCase().replace(/[^A-Z0-9-]/g,'');}
export function weekday(date) {return new Date(`${date}T12:00:00Z`).getUTCDay();}
