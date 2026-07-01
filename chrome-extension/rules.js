const SESSION_HEADER = 'x-session-id';

const ALL_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
];

// Legacy CONNECT rule IDs from earlier versions (DNR cannot modify proxy CONNECT).
const LEGACY_CONNECT_RULE_IDS = [1, 101];

const DYNAMIC_RULE_IDS = {
  http: 2,
};

const SESSION_RULE_IDS = {
  http: 102,
};

function buildHttpHeaderRule(sessionId, id) {
  if (!sessionId) return null;

  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: SESSION_HEADER, operation: 'set', value: sessionId },
      ],
    },
    condition: {
      urlFilter: '|http*',
      resourceTypes: ALL_RESOURCE_TYPES,
    },
  };
}

function buildDynamicHeaderRules(sessionId) {
  const rule = buildHttpHeaderRule(sessionId, DYNAMIC_RULE_IDS.http);
  return rule ? [rule] : [];
}

function buildSessionHeaderRules(sessionId) {
  const rule = buildHttpHeaderRule(sessionId, SESSION_RULE_IDS.http);
  return rule ? [rule] : [];
}

function allRuleIds(ids) {
  return Object.values(ids);
}

function allRuleIdsToRemove(ids) {
  return [...LEGACY_CONNECT_RULE_IDS, ...allRuleIds(ids)];
}
