export function createDisabledSkillNotice(providerName, settings, allSkillNames) {
  const disabled = Array.isArray(settings.disabledSkills) ? settings.disabledSkills.filter(Boolean) : [];
  if (disabled.length === 0) return '';

  const known = Array.isArray(allSkillNames) && allSkillNames.length > 0
    ? disabled.filter((name) => allSkillNames.includes(name))
    : disabled;
  if (known.length === 0) return '';

  return `本轮 ${providerName} 集成已禁用这些 skills，请不要主动调用或加载它们：${known.join(', ')}。`;
}
