'use strict';
const express=require('express');
const {requireOwner}=require('../middleware/auth');
const daily=require('../services/tk2m-daily-screen-usage');
const router=express.Router();

function csvCell(v){
 let value=String(v==null?'':v).replace(/[\r\n]+/g,' ').slice(0,500);
 if(/^\s*[=+\-@]/.test(value))value="'"+value;
 return '"'+value.replace(/"/g,'""')+'"';
}
function filterError(error){return /^(Choose |Invalid staff filter|Unknown staff member)/.test(String(error.message||''));}
async function build(req,res,next,format){
 try{
  const data=await daily.report(req.query);
  res.set('Cache-Control','private, no-store');
  if(format==='csv'){
   const rows=[['Section','Category','Screen','Tracking route / launcher','Status','Page views','Launcher clicks','Window opens','Button attempts','Staff with observations','Users observed']];
   for(const s of data.screens){
    rows.push(['Screens',s.category,s.label,s.path||('Launcher: '+s.feature),s.status,
      s.views,s.launches,s.windows,s.buttons,s.users,
      s.staffNames.map(x=>x.name+' ('+x.count+')').join('; ')]);
   }
   rows.push(['Summary','Period',data.filter.first+' to '+data.filter.last,'SAST','','','','','','','']);
   for(const p of data.visibleStaff){
    rows.push(['Staff',p.role,p.full_name,'','',p.views,p.launches,p.windows,p.buttons,'',p.active?'Active':'Inactive']);
   }
   const body=rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
   res.set('Content-Type','text/csv; charset=utf-8');
   res.set('Content-Disposition','attachment; filename="tk2m-screen-usage-'+data.filter.day+'-'+data.filter.days+'d.csv"');
   return res.send('\ufeff'+body);
  }
  return res.render('staff-usage-daily',{title:'TK2M Daily Screen Usage',data});
 }catch(error){
  if(filterError(error))return res.status(400).render('error',{title:'Invalid daily audit filter',message:error.message});
  return next(error);
 }
}
router.get('/backoffice/staff-usage/daily',requireOwner,(req,res,next)=>build(req,res,next,'html'));
router.get('/backoffice/staff-usage/daily.csv',requireOwner,(req,res,next)=>build(req,res,next,'csv'));
module.exports=router;
