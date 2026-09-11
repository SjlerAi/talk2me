'use strict';

const { normaliseSouthAfricanMobile } = require('./sa-phone-normalisation');

function normaliseAccountCore(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  const withoutLegacyCheckDigit = raw.replace(/[-/]\d\s*$/, '');
  return withoutLegacyCheckDigit.replace(/[^A-Z0-9]/g, '');
}

function uniqueById(values) {
  return [...new Map(values.map(value => [Number(value.id), value])).values()];
}

function accountCoreForClient(candidate, references) {
  const account = candidate.accountId ? references.accountsById.get(Number(candidate.accountId)) : null;
  return normaliseAccountCore(account?.account_number || candidate.accountNumber || '');
}

function accountJson(account) {
  return {
    id: Number(account.id),
    accountNumber: account.account_number || null,
    displayName: account.display_name || null,
    accountCore: normaliseAccountCore(account.account_number || account.account_number_normalised || '')
  };
}

function baseDetailsResult(row, references) {
  const canonical = normaliseSouthAfricanMobile(row.phone_original || row.phone_normalised);
  const masterAccount = String(row.account_number || '').trim().toUpperCase();
  const masterAccountCore = normaliseAccountCore(masterAccount);
  const clients = canonical ? [...(references.mobile.get(canonical)?.values() || [])] : [];
  const accountCandidates = uniqueById(references.accountsByCore.get(masterAccountCore) || []);
  const enrichedClients = clients.map(candidate => {
    const accountCore = accountCoreForClient(candidate, references);
    return { ...candidate, accountCore, accountMatchesMaster: accountCore === masterAccountCore };
  });
  const candidateJson = {
    canonicalPhone: canonical || null,
    masterAccount: masterAccount || null,
    masterAccountCore: masterAccountCore || null,
    clients: enrichedClients,
    accounts: accountCandidates.map(accountJson)
  };

  if (!canonical || !masterAccountCore) {
    return {
      classification: 'conflict', domain: 'mobile', confidence: 0,
      reason: 'Base Details requires both a valid South African MSISDN and Account Code before reconciliation.',
      candidates: candidateJson, actionType: 'stage_base_invalid_identity', targetType: 'mobile_base_current', targetId: null
    };
  }

  if (enrichedClients.length === 0) {
    if (accountCandidates.length === 0) {
      return {
        classification: 'new_record', domain: 'mobile', confidence: 90,
        reason: `MSISDN ${canonical} is new to Talk2Me and account core ${masterAccountCore} does not yet exist. Staging only; no live customer is created.`,
        candidates: candidateJson, actionType: 'stage_base_new_service_new_account', targetType: 'mobile_base_current', targetId: null
      };
    }
    if (accountCandidates.length === 1) {
      return {
        classification: 'new_record', domain: 'mobile', confidence: 95,
        proposedAccountId: Number(accountCandidates[0].id),
        reason: `MSISDN ${canonical} is new to Talk2Me but account core ${masterAccountCore} uniquely matches customer account #${accountCandidates[0].id}. Staging only.`,
        candidates: candidateJson, actionType: 'stage_base_new_service_existing_account', targetType: 'customer_accounts', targetId: Number(accountCandidates[0].id)
      };
    }
    return {
      classification: 'possible_match', domain: 'mobile', confidence: 70,
      reason: `MSISDN ${canonical} is new, while account core ${masterAccountCore} maps to ${accountCandidates.length} legacy account records. Resolve the account aliases before assigning one account id.`,
      candidates: candidateJson, actionType: 'stage_base_account_alias_review', targetType: 'customer_accounts', targetId: null
    };
  }

  if (enrichedClients.length === 1) {
    const client = enrichedClients[0];
    if (client.accountMatchesMaster) {
      return {
        classification: 'exact_match', domain: 'mobile', confidence: 100,
        proposedClientId: Number(client.id), proposedAccountId: client.accountId ? Number(client.accountId) : null,
        reason: `MSISDN ${canonical} uniquely matches client #${client.id} and the client account core agrees with Base Details (${masterAccountCore}). Staging only.`,
        candidates: candidateJson, actionType: 'stage_base_existing_client', targetType: 'clients', targetId: Number(client.id)
      };
    }
    return {
      classification: 'conflict', domain: 'mobile', confidence: 0,
      proposedClientId: Number(client.id),
      proposedAccountId: accountCandidates.length === 1 ? Number(accountCandidates[0].id) : null,
      reason: `MSISDN ${canonical} uniquely matches client #${client.id}, but CRM account core ${client.accountCore || '(blank)'} differs from Base Details ${masterAccountCore}. No account is overwritten.`,
      candidates: candidateJson, actionType: 'stage_base_account_conflict', targetType: 'mobile_base_current', targetId: null
    };
  }

  const clientCores = new Set(enrichedClients.map(candidate => candidate.accountCore).filter(Boolean));
  const allHistoryOnMasterAccount = clientCores.size <= 1 && (clientCores.size === 0 || clientCores.has(masterAccountCore));
  if (allHistoryOnMasterAccount) {
    const accountIds = [...new Set(enrichedClients.map(candidate => Number(candidate.accountId)).filter(Number.isSafeInteger))];
    const proposedAccountId = accountIds.length === 1
      ? accountIds[0]
      : (accountCandidates.length === 1 ? Number(accountCandidates[0].id) : null);
    return {
      classification: 'possible_match', domain: 'mobile', confidence: 95,
      proposedAccountId,
      reason: `MSISDN ${canonical} matches ${enrichedClients.length} historical client rows, all on account core ${masterAccountCore}. Preserve the history and stage one current Base Details service without choosing an arbitrary historical client.`,
      candidates: candidateJson, actionType: 'stage_base_existing_history', targetType: 'mobile_base_current', targetId: null
    };
  }

  return {
    classification: 'conflict', domain: 'mobile', confidence: 0,
    proposedAccountId: accountCandidates.length === 1 ? Number(accountCandidates[0].id) : null,
    reason: `MSISDN ${canonical} matches ${enrichedClients.length} historical client rows across different account cores (${[...clientCores].join(', ') || 'blank'}), while Base Details says ${masterAccountCore}. No live record is changed.`,
    candidates: candidateJson, actionType: 'stage_base_account_conflict', targetType: 'mobile_base_current', targetId: null
  };
}

module.exports = { normaliseAccountCore, baseDetailsResult };
