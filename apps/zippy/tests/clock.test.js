'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {parseWhen,readRecurrence,nextDue,dateParts,normal}=require('../src/clock');
const friday=new Date('2026-10-16T07:30:00.000Z'); // Friday 09:30 SA
const iso=message=>parseWhen(message,{now:friday});
test('Johannesburg time is used, not UTC browser clock',()=>{assert.deepEqual(dateParts(friday),{year:2026,month:10,day:16,hour:9,minute:30});assert.equal(iso('today at 12').at,'2026-10-16T10:00:00.000Z');});
test('plain spoken noon and Afrikaans hours',()=>{assert.equal(iso('remind me at twelve to call mom').at,'2026-10-16T10:00:00.000Z');assert.equal(iso('herinner my om twaalfuur').at,'2026-10-16T10:00:00.000Z');});
test('tomorrow, weekday names and numeric dates',()=>{assert.equal(iso('tomorrow at 9').at,'2026-10-17T07:00:00.000Z');assert.equal(iso('Vrydag at 14:00').at,'2026-10-16T12:00:00.000Z');assert.equal(iso('next Tuesday at eleven').at,'2026-10-20T09:00:00.000Z');assert.equal(iso('19/10/2026 at 11:15').at,'2026-10-19T09:15:00.000Z');});
test('missing time asks rather than guessing and invalid dates reject',()=>{assert.equal(iso('remind me tomorrow').ok,false);assert.match(iso('remind me tomorrow').question,/time/i);assert.equal(iso('2026-02-30 at 10:00').ok,false);assert.equal(iso('today at 7:00').ok,false);});
test('recurring Friday schedule and weekdays',()=>{assert.equal(readRecurrence(normal('Every Friday pay gardener')),'weekly:5');assert.equal(iso('Every Friday at noon').recurrence,'weekly:5');assert.equal(iso('Every Friday at noon').at,'2026-10-16T10:00:00.000Z');assert.equal(nextDue('2026-10-16T10:00:00Z','weekly:5'),'2026-10-23T10:00:00.000Z');assert.equal(nextDue('2026-10-16T16:00:00Z','weekdays'),'2026-10-19T16:00:00.000Z');});
test('repeating daily and monthly do not depend on the app being open',()=>{assert.equal(nextDue('2026-10-16T10:00:00Z','daily'),'2026-10-17T10:00:00.000Z');assert.equal(nextDue('2026-01-31T10:00:00Z','monthly'),'2026-02-28T10:00:00.000Z');});
