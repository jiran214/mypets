import { useEffect, useState, type ReactNode } from 'react';
import type { AiSettings, SkillInfo } from '@/ai-types';
import type { ReadyPetWorkspace } from '@/workspaces';
import { listSkills } from '@/ai-api';
import {
  FieldSet,
  FieldLegend,
  FieldGroup,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

export function SkillSettings({
  readyWorkspace,
  settingsDraft,
  onSettingsChange,
}: {
  readyWorkspace: ReadyPetWorkspace | null;
  settingsDraft: AiSettings;
  onSettingsChange: (settings: AiSettings) => void;
}): ReactNode {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const disabled = !readyWorkspace;

  useEffect(() => {
    if (!readyWorkspace) {
      setSkills([]);
      return;
    }

    let disposed = false;
    setLoading(true);

    void listSkills(readyWorkspace.folder, settingsDraft.providerId)
      .then((result) => {
        if (!disposed) setSkills(result);
      })
      .catch((error) => {
        console.warn('Failed to load skills:', error);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [readyWorkspace, settingsDraft.providerId]);

  const disabledSkills = settingsDraft.providerId === 'pi'
    ? settingsDraft.pi.disabledSkills
    : settingsDraft.providerId === 'codex'
      ? settingsDraft.codex.disabledSkills
      : settingsDraft.claude.disabledSkills;

  const toggleSkill = (name: string, enabled: boolean): void => {
    const next = enabled
      ? disabledSkills.filter((n) => n !== name)
      : [...new Set([...disabledSkills, name])];
    if (settingsDraft.providerId === 'pi') {
      onSettingsChange({
        ...settingsDraft,
        pi: { ...settingsDraft.pi, disabledSkills: next },
      });
    } else if (settingsDraft.providerId === 'codex') {
      onSettingsChange({
        ...settingsDraft,
        codex: { ...settingsDraft.codex, disabledSkills: next },
      });
    } else {
      onSettingsChange({
        ...settingsDraft,
        claude: { ...settingsDraft.claude, disabledSkills: next },
      });
    }
  };

  const workspaceSkills = skills.filter((s) => s.scope === 'workspace');
  const builtinSkills = skills.filter((s) => s.scope === 'builtin');
  const globalSkills = skills.filter((s) => s.scope === 'global');

  const renderSkillItem = (skill: SkillInfo): ReactNode => {
    const isEnabled = !disabledSkills.includes(skill.name);
    return (
      <div
        key={`${skill.scope}-${skill.name}`}
        className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{skill.name}</div>
          {skill.description && (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{skill.description}</div>
          )}
        </div>
        <Switch
          checked={isEnabled}
          disabled={disabled}
          aria-label={`${isEnabled ? '禁用' : '启用'} ${skill.name}`}
          onCheckedChange={(checked) => toggleSkill(skill.name, checked)}
        />
      </div>
    );
  };

  const hasSkills = workspaceSkills.length > 0 || builtinSkills.length > 0 || globalSkills.length > 0;

  return (
    <FieldSet disabled={disabled}>
      <FieldLegend>技能</FieldLegend>
      <FieldGroup>
        {settingsDraft.providerId === 'codex' && (
          <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            Codex 会读取全局 Codex 配置中的技能；这里的开关会作为本应用会话的禁用提示发送给 Codex。
          </div>
        )}
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">加载中...</div>
        ) : !hasSkills ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            未发现已安装的技能
          </div>
        ) : (
          <>
            {workspaceSkills.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">项目内技能</div>
                {workspaceSkills.map(renderSkillItem)}
              </div>
            )}
            {builtinSkills.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">内置技能</div>
                {builtinSkills.map(renderSkillItem)}
              </div>
            )}
            {settingsDraft.providerId === 'codex' || settingsDraft.claude.useUserSettings ? (
              globalSkills.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-xs font-medium text-muted-foreground">全局技能</div>
                  {globalSkills.map(renderSkillItem)}
                </div>
              )
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
                未加载用户配置
              </div>
            )}
          </>
        )}
      </FieldGroup>
    </FieldSet>
  );
}
