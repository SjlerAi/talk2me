'use strict';

const fs=require('fs');
const assert=require('assert');

const source=fs.readFileSync('public/js/calendar-home-uat.js','utf8');

assert(source.includes('const shortStaffName = value =>'),'My Day must have a short staff-name formatter.');
for(const pair of [
  "['gertrudia johanna le roux', 'Gerda']",
  "['elias booyens', 'Sias']",
  "['jonathan olivier', 'Johnny']"
]){
  assert(source.includes(pair),'Missing approved staff display alias: '+pair);
}
assert(source.includes('name: shortStaffName(item.assignedName)'),'Team filter must render short staff names.');
assert(source.includes("esc(shortStaffName(item.assignedName))"),'Agenda and calendar markers must use short staff names.');
assert(source.includes("subtitle: `${meta.label} · ${shortStaffName(item.assignedName)}`"),'Calendar item windows must use short staff names.');

console.log('CALENDAR_SHORT_STAFF_NAMES_VALIDATION=PASS');
