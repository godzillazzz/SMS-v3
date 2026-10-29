'use strict';

const { z } = require('zod');
const { LEAVE_POLICY_KEYS, NUMBER_RANGES } = require('./leave-policy.service');
const { getSystemSettingDefinition, normalizeRegisteredSystemSettingValue, presentRegisteredSystemSetting } = require('./system-setting-registry.service');

const policySchema = z.object(Object.fromEntries(Object.entries(LEAVE_POLICY_KEYS).map(([field, key]) => {
  const range = NUMBER_RANGES[key];
  return [field, range ? z.number().finite().min(range[0]).max(range[1]) : z.boolean()];
}))).strict();

async function saveLeavePolicyBatch({ prisma, audit, actor, policy }) {
  const input = policySchema.parse(policy);
  // Validate and normalize the complete request before beginning any writes.
  const settings = Object.entries(LEAVE_POLICY_KEYS).map(([field, key]) => {
    const definition = getSystemSettingDefinition(key);
    if (!definition?.editable || definition.group !== 'LEAVE') throw new Error('Leave policy setting is not registered for Admin configuration.');
    return { key, definition, value: normalizeRegisteredSystemSettingValue(key, String(input[field])) };
  });
  return prisma.$transaction(async (tx) => {
    const results = [];
    for (const { key, definition, value } of settings) {
      const before = await tx.systemSetting.findUnique({ where: { key } });
      const after = await tx.systemSetting.upsert({ where: { key }, update: { value, description: definition.description }, create: { key, value, description: definition.description } });
      await audit.log({ actorUserId: actor.sub, action: before ? 'UPDATE' : 'CREATE', entityType: 'SystemSetting', entityId: key, metadata: { key, group: definition.group, valueType: definition.valueType, beforeConfigured: Boolean(before), afterConfigured: true, valueChanged: before?.value !== after.value } }, tx);
      results.push(presentRegisteredSystemSetting(after));
    }
    return results;
  });
}

module.exports = { saveLeavePolicyBatch };
