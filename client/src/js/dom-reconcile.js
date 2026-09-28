/** Small keyed reconciler for same-view patches. Route changes still replace the view. */
function key(node) {
  if (node.nodeType !== 1) return null;
  const data = node.dataset;
  if (node.id) return `id:${node.id}`;
  if (data.region) return `region:${data.region}`;
  if (data.activityKey) return `activity:${data.activityKey}`;
  if (data.deviceRef) return `device:${data.deviceRef}`;
  if (data.action) return JSON.stringify(['action', data.action, data.deviceId, data.candidateId, data.screen, data.route, data.siteCode, data.capabilityId, data.action.includes('select') ? data.valueJson : null]);
  if (data.field) return JSON.stringify(['field', data.field, data.deviceId, data.capabilityId]);
  if (data.scrollKey) return `scroll:${data.scrollKey}`;
  return null;
}

function compatible(left, right) {
  return left?.nodeType === right.nodeType && left.nodeName === right.nodeName && key(left) === key(right);
}

export function reconcileElement(current, next, { preserveInput = node => node === node.ownerDocument.activeElement, onMutation = () => {} } = {}) {
  if (!compatible(current, next)) { current.replaceWith(next); onMutation('replace'); return next; }
  if (current.nodeType === 3) {
    if (current.nodeValue !== next.nodeValue) { current.nodeValue = next.nodeValue; onMutation('text'); }
    return current;
  }
  if (current.nodeType !== 1) return current;
  const keepValue = /^(INPUT|TEXTAREA|SELECT)$/.test(current.nodeName) && preserveInput(current) && !next.disabled;
  for (const attribute of [...current.attributes]) {
    if (attribute.name === 'value' && keepValue) continue;
    if (!next.hasAttribute(attribute.name)) { current.removeAttribute(attribute.name); onMutation('attribute'); }
  }
  for (const attribute of [...next.attributes]) {
    if (attribute.name === 'value' && keepValue) continue;
    if (current.getAttribute(attribute.name) !== attribute.value) { current.setAttribute(attribute.name, attribute.value); onMutation('attribute'); }
  }
  if ('value' in current && !keepValue && current.value !== next.value) { current.value = next.value; onMutation('value'); }
  const remaining = new Set(current.childNodes);
  let position = current.firstChild;
  for (const desired of [...next.childNodes]) {
    const identity = key(desired);
    const match = identity != null
      ? [...remaining].find(child => key(child) === identity && compatible(child, desired))
      : remaining.has(position) && compatible(position, desired) ? position
        : [...remaining].find(child => key(child) == null && compatible(child, desired));
    const node = match ? reconcileElement(match, desired, { preserveInput, onMutation }) : desired;
    if (match) remaining.delete(match);
    if (node !== position) { current.insertBefore(node, position); onMutation(match ? 'move' : 'insert'); }
    position = node.nextSibling;
  }
  for (const obsolete of remaining) { obsolete.remove(); onMutation('remove'); }
  return current;
}
