import type { ReactNode } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import type { AiSettings } from '@/ai/ai-types';
import type { PetWorkspace, ReadyPetWorkspace } from '@/workspaces';
import { isReadyWorkspace } from '@/workspaces';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  FieldSet,
  FieldLegend,
  FieldGroup,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

export interface GeneralSettingsProps {
  selectedWorkspace: PetWorkspace | null;
  readyWorkspace: ReadyPetWorkspace | null;
  settingsDraft: AiSettings;
  settingsStatus: string;
  personaDraft: string;
  onSettingsChange: (settings: AiSettings) => void;
  onPersonaChange: (persona: string) => void;
  onDeleteWorkspace: () => void;
  onOpenWorkspaceFolder: () => void;
}

export function GeneralSettings({
  selectedWorkspace,
  readyWorkspace,
  settingsDraft,
  settingsStatus,
  personaDraft,
  onSettingsChange,
  onPersonaChange,
  onDeleteWorkspace,
  onOpenWorkspaceFolder,
}: GeneralSettingsProps): ReactNode {
  const disabled = !readyWorkspace;

  return (
    <div className="flex min-h-full flex-col gap-4">
      <FieldSet disabled={disabled}>
        <FieldLegend>通用</FieldLegend>
        <FieldGroup>
          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="pet-display-name">桌宠名</FieldLabel>
            <Input
              id="pet-display-name"
              value={settingsDraft.displayName || readyWorkspace?.meta.displayName || ''}
              disabled={disabled}
              placeholder="给桌宠起个名字"
              onChange={(event) => {
                onSettingsChange({ ...settingsDraft, displayName: event.currentTarget.value });
              }}
            />
            <FieldDescription>保存到当前工作空间的 settings.json，并同步已打开窗口标题。</FieldDescription>
          </Field>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Field orientation="horizontal" data-disabled={disabled} className="rounded-lg border bg-background p-3">
              <Switch
                id="pet-always-on-top"
                disabled={disabled}
                checked={settingsDraft.petAlwaysOnTop}
                onCheckedChange={(checked) => onSettingsChange({ ...settingsDraft, petAlwaysOnTop: checked })}
                aria-label="置顶"
              />
              <FieldContent>
                <FieldLabel htmlFor="pet-always-on-top">置顶</FieldLabel>
                <FieldDescription>开启后桌宠窗口始终保持在其他窗口上方。</FieldDescription>
              </FieldContent>
            </Field>

            <Field orientation="horizontal" data-disabled={disabled} className="rounded-lg border bg-background p-3">
              <Switch
                id="pet-gravity"
                disabled={disabled}
                checked={settingsDraft.petGravityEnabled}
                onCheckedChange={(checked) => onSettingsChange({ ...settingsDraft, petGravityEnabled: checked })}
                aria-label="重力"
              />
              <FieldContent>
                <FieldLabel htmlFor="pet-gravity">重力</FieldLabel>
                <FieldDescription>开启后桌宠会自由落体并停在任务栏上方。</FieldDescription>
              </FieldContent>
            </Field>

            <Field orientation="horizontal" data-disabled={disabled} className="rounded-lg border bg-background p-3">
              <Switch
                id="pet-standing-on-top"
                disabled={disabled}
                checked={settingsDraft.petStandingOnTop}
                onCheckedChange={(checked) => onSettingsChange({ ...settingsDraft, petStandingOnTop: checked })}
                aria-label="站立在顶部"
              />
              <FieldContent>
                <FieldLabel htmlFor="pet-standing-on-top">站立在顶部</FieldLabel>
                <FieldDescription>开启后桌宠会倒立站在窗口顶部。</FieldDescription>
              </FieldContent>
            </Field>
          </div>

          <Field data-disabled={disabled}>
            <FieldLabel htmlFor="pet-persona">桌宠人设</FieldLabel>
            <Textarea
              id="pet-persona"
              value={personaDraft}
              disabled={disabled}
              rows={12}
              className="min-h-60"
              placeholder="在此编辑桌宠人设，保存到工作空间的 AGENTS.md 文件"
              onChange={(event) => onPersonaChange(event.currentTarget.value)}
            />
            <FieldDescription>自动保存到 AGENTS.md，作为当前桌宠的对话人格注入当前 Agent。</FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {settingsStatus ? <div className="text-sm text-destructive">{settingsStatus}</div> : <div />}
        <div className="flex items-center gap-2">
        <Button type="button" variant="outline" disabled={!selectedWorkspace} onClick={onOpenWorkspaceFolder}>
          <FolderOpen data-icon="inline-start" />
          在资源管理器打开
        </Button>
        <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={!selectedWorkspace}>
                <Trash2 data-icon="inline-start" />
                删除
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除当前桌宠？</AlertDialogTitle>
                <AlertDialogDescription>
                  {isReadyWorkspace(selectedWorkspace)
                    ? `将从应用中移除该桌宠（原文件夹不会被删除）：${selectedWorkspace.folder}`
                    : `将从列表移除该丢失资源：${selectedWorkspace?.folder ?? ''}`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onDeleteWorkspace}>删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
