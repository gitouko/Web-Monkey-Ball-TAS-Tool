const RULESET_ID = 'webmonkeyball_bridge';

type RulesetMessage = {
  type: 'WMB_TAS_SET_RULESET';
  enabled: boolean;
};

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const candidate = message as Partial<RulesetMessage> | null;
  if (!candidate || candidate.type !== 'WMB_TAS_SET_RULESET' || typeof candidate.enabled !== 'boolean') {
    return false;
  }
  const update = candidate.enabled
    ? { enableRulesetIds: [RULESET_ID], disableRulesetIds: [] }
    : { enableRulesetIds: [], disableRulesetIds: [RULESET_ID] };
  chrome.declarativeNetRequest.updateEnabledRulesets(update)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
