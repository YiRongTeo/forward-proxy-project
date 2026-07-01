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

const DYNAMIC_RULE_IDS = {
  connect: 1,
  http: 2,
};

const SESSION_RULE_IDS = {
  connect: 101,
  http: 102,
};

function buildHeaderRules(sessionId, ids) {
  if (!sessionId) return [];

  const headerAction = {
    type: 'modifyHeaders',
    requestHeaders: [{ header: SESSION_HEADER, operation: 'set', value: sessionId }],
  };

  return [
    {
      id: ids.connect,
      priority: 2,
      action: headerAction,
      condition: {
        requestMethods: ['connect'],
        resourceTypes: ALL_RESOURCE_TYPES,
      },
    },
    {
      id: ids.http,
      priority: 1,
      action: headerAction,
      condition: {
        urlFilter: '|http*',
        resourceTypes: ALL_RESOURCE_TYPES,
      },
    },
  ];
}

function buildDynamicHeaderRules(sessionId) {
  return buildHeaderRules(sessionId, DYNAMIC_RULE_IDS);
}

function buildSessionHeaderRules(sessionId) {
  return buildHeaderRules(sessionId, SESSION_RULE_IDS);
}

function allRuleIds(ids) {
  return [ids.connect, ids.http];
}
