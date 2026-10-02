export const AI_QUICK_PROMPTS = Object.freeze([
  Object.freeze({ id: 'receipt-help', label: '回执说明',
    prompt: '解释指令待确认、超时与执行失败的区别。' }),
  Object.freeze({ id: 'bluetooth-help', label: '蓝牙排查',
    prompt: '说明蓝牙连接断开后重新连接的排查步骤。' }),
  Object.freeze({ id: 'condensation-help', label: '结露常识',
    prompt: '解释结露风险的一般形成原因与巡检注意事项。' })
]);

export function resolveAiQuickPrompt(state, id) {
  if (!state?.enabled || state.busy || state.loading || state.pending) return null;
  const item = AI_QUICK_PROMPTS.find(value => value.id === id);
  const limit = Number(state.limits?.maxQuestionChars);
  if (!item || !Number.isInteger(limit) || limit < 1 || item.prompt.length > limit) return null;
  return item;
}
