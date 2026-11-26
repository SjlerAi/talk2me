'use strict';
const { resolveCustomerAccountForWrite } = require('./customer-account-link');
const { loadOrCreateFixedAccount,loadOrCreateFixedService,roleOf } = require('./provisional-account-approval');

// Caller owns the transaction and the locked customer row. This is an
// ordinary authorised management addition, NOT an approval of old requests.
async function saveKnownFixedService(conn,{client,service,user,ipAddress,userAgent}){
 if(!['owner','manager','admin'].includes(roleOf(user)))throw Error('Management access required.');
 if(!client?.is_active||!String(client.account_number||'').trim())throw Error('An active customer with an existing official account is required.');
 if(!String(service?.branch_name||'').trim()&&!String(service?.installation_address||'').trim())throw Error('Enter a branch/site or installation address.');
 const link=await resolveCustomerAccountForWrite(conn,client,client.account_number,client.client_name,Number(user.id));
 const [[account]]=await conn.execute('SELECT * FROM customer_accounts WHERE id=:id FOR UPDATE',{id:link.accountId});
 if(!account||Number(account.id)!==Number(link.accountId))throw Error('The account could not be verified.');
 await conn.execute('UPDATE clients SET account_id=:accountId,account_number=:accountNumber,updated_at=NOW() WHERE id=:id',{id:client.id,...link});
 const request={client_id:client.id};
 const proposal={client_name:client.client_name,fixed_service:service};
 const {fixedAccount}=await loadOrCreateFixedAccount(conn,account,request,proposal,account.assigned_staff_id||null);
 const {fixedService,created}=await loadOrCreateFixedService(conn,fixedAccount,request,proposal);
 if(!fixedService||Number(fixedService.fixed_account_id)!==Number(fixedAccount.id))throw Error('The service could not be verified against the fixed account.');
 await conn.execute("INSERT INTO audit_log (staff_id,action_type,entity_type,entity_id,description,before_json,after_json,ip_address,user_agent) VALUES (:staffId,'fixed_service_captured','fixed_services',:id,:description,:beforeJson,:afterJson,:ip,:userAgent)",{
  staffId:Number(user.id),id:fixedService.id,description:created?'Management saved fixed service against existing official account':'Management reselected an already saved fixed service',
  beforeJson:JSON.stringify({account_id:client.account_id||null}),afterJson:JSON.stringify({account_id:account.id,client_id:client.id,fixed_account_id:fixedAccount.id,fixed_service_id:fixedService.id,created}),
  ip:String(ipAddress||'').slice(0,64),userAgent:String(userAgent||'').slice(0,255)
 });
 return {accountId:account.id,fixedAccountId:fixedAccount.id,fixedServiceId:fixedService.id,created};
}
module.exports={saveKnownFixedService};
