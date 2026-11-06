import test from 'node:test';
import assert from 'node:assert/strict';
import {discountPrice,slotsForDay,proposedSlots,validDate,withinBookingWindow} from '../src/lib.js';
test('preço tem arredondamento em centavos',()=> {assert.equal(discountPrice(8999,15),7649);assert.equal(discountPrice(10000,50),5000)});
test('data inválida não aceita 31 de fevereiro',()=> assert.equal(validDate('2026-02-31'),false));
test('reserva ocupa todos os blocos da duração',()=>assert.deepEqual(proposedSlots('2026-11-10','10:00',90),['2026-11-10T10:00','2026-11-10T10:30','2026-11-10T11:00']));
test('bloqueio de sobreposição e horário futuro',()=>{
 const d='2026-11-10'; const taken=new Set(['2026-11-10T10:30']);
 const slots=slotsForDay(d,60,['09:00','12:00'],taken,{date:'2026-11-09',time:'12:00'});
 assert.deepEqual(slots,['09:00','09:30','11:00']);
});
test('não aceita horário passado',()=>assert.equal(withinBookingWindow('2026-11-10','09:00',{date:'2026-11-10',time:'08:30'}),false));
