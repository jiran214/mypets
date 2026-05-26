import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  AiSettings,
  CodexApprovalPolicy,
  CodexReasoningEffort,
  PermissionMode,
  PiThinkingLevel,
  ProviderId,
  ThinkingIntensity,
} from '@/ai/ai-types';
import type { ReadyPetWorkspace } from '@/workspaces';
import { loadPiProviderAuth, savePiProviderAuth } from '@/ai/ai-api';
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
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
import { SettingDropdown } from './setting-dropdown';

const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'default', label: 'default', description: '标准模式，执行有风险操作前会询问确认' },
  { value: 'acceptEdits', label: 'acceptEdits', description: '自动接受文件编辑，敏感操作仍可能需要权限' },
  { value: 'plan', label: 'plan', description: '计划模式，批准后再执行' },
  { value: 'auto', label: 'auto', description: '自动判断是否批准工具调用' },
  { value: 'dontAsk', label: 'dontAsk', description: '未预先允许的操作直接拒绝' },
  { value: 'bypassPermissions', label: 'bypassPermissions', description: '跳过权限检查，风险最高' },
];
const THINKING_INTENSITY_OPTIONS: { value: ThinkingIntensity; label: string }[] = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max' },
];
const PROVIDER_OPTIONS: { value: ProviderId; label: string; description: string }[] = [
  { value: 'pi', label: 'Pi', description: '使用 Pi Coding Agent RPC 模式。' },
  { value: 'claude', label: 'Claude Code', description: '使用 Claude Agent SDK 与本地 Claude Code。' },
  { value: 'codex', label: 'Codex', description: '使用 OpenAI Codex app-server 协议。' },
];
const PI_PROVIDER_OPTIONS: { value: string; label: string; envVar: string; authKey: string }[] = [
  { value: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', authKey: 'anthropic' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI Responses', envVar: 'AZURE_OPENAI_API_KEY', authKey: 'azure-openai-responses' },
  { value: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', authKey: 'openai' },
  { value: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY', authKey: 'deepseek' },
  { value: 'google', label: 'Google Gemini', envVar: 'GEMINI_API_KEY', authKey: 'google' },
  { value: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY', authKey: 'mistral' },
  { value: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY', authKey: 'groq' },
  { value: 'cerebras', label: 'Cerebras', envVar: 'CEREBRAS_API_KEY', authKey: 'cerebras' },
  { value: 'cloudflare-ai-gateway', label: 'Cloudflare AI Gateway', envVar: 'CLOUDFLARE_API_KEY', authKey: 'cloudflare-ai-gateway' },
  { value: 'cloudflare-workers-ai', label: 'Cloudflare Workers AI', envVar: 'CLOUDFLARE_API_KEY', authKey: 'cloudflare-workers-ai' },
  { value: 'xai', label: 'xAI', envVar: 'XAI_API_KEY', authKey: 'xai' },
  { value: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY', authKey: 'openrouter' },
  { value: 'vercel-ai-gateway', label: 'Vercel AI Gateway', envVar: 'AI_GATEWAY_API_KEY', authKey: 'vercel-ai-gateway' },
  { value: 'zai', label: 'ZAI', envVar: 'ZAI_API_KEY', authKey: 'zai' },
  { value: 'opencode', label: 'OpenCode Zen', envVar: 'OPENCODE_API_KEY', authKey: 'opencode' },
  { value: 'opencode-go', label: 'OpenCode Go', envVar: 'OPENCODE_API_KEY', authKey: 'opencode-go' },
  { value: 'huggingface', label: 'Hugging Face', envVar: 'HF_TOKEN', authKey: 'huggingface' },
  { value: 'fireworks', label: 'Fireworks', envVar: 'FIREWORKS_API_KEY', authKey: 'fireworks' },
  { value: 'together', label: 'Together AI', envVar: 'TOGETHER_API_KEY', authKey: 'together' },
  { value: 'kimi-coding', label: 'Kimi For Coding', envVar: 'KIMI_API_KEY', authKey: 'kimi-coding' },
  { value: 'minimax', label: 'MiniMax', envVar: 'MINIMAX_API_KEY', authKey: 'minimax' },
  { value: 'minimax-cn', label: 'MiniMax China', envVar: 'MINIMAX_CN_API_KEY', authKey: 'minimax-cn' },
  { value: 'xiaomi', label: 'Xiaomi MiMo', envVar: 'XIAOMI_API_KEY', authKey: 'xiaomi' },
  { value: 'xiaomi-token-plan-cn', label: 'Xiaomi Token Plan CN', envVar: 'XIAOMI_TOKEN_PLAN_CN_API_KEY', authKey: 'xiaomi-token-plan-cn' },
  { value: 'xiaomi-token-plan-ams', label: 'Xiaomi Token Plan Amsterdam', envVar: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY', authKey: 'xiaomi-token-plan-ams' },
  { value: 'xiaomi-token-plan-sgp', label: 'Xiaomi Token Plan Singapore', envVar: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY', authKey: 'xiaomi-token-plan-sgp' },
];
const PI_THINKING_OPTIONS: { value: PiThinkingLevel; label: string }[] = [
  { value: 'off', label: 'off' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];
const CODEX_APPROVAL_OPTIONS: { value: CodexApprovalPolicy; label: string; description: string }[] = [
  { value: 'untrusted', label: 'untrusted', description: '高风险操作默认先请求批准。' },
  { value: 'on-failure', label: 'on-failure', description: '先尝试受限执行，失败后再请求放宽。' },
  { value: 'on-request', label: 'on-request', description: '由 Codex 自主决定何时发起批准请求。' },
  { value: 'never', label: 'never', description: '不请求额外批准，受限于当前策略。' },
];
const CODEX_REASONING_OPTIONS: { value: CodexReasoningEffort; label: string }[] = [
  { value: 'none', label: 'none' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];

function piProviderOption(value: string): (typeof PI_PROVIDER_OPTIONS)[number] | undefined {
  const normalized = value.trim();
  return PI_PROVIDER_OPTIONS.find((option) => option.value === normalized);
}

export interface AgentSettingsProps {
  readyWorkspace: ReadyPetWorkspace | null;
  settingsDraft: AiSettings;
  onSettingsChange: (settings: AiSettings) => void;
}

export function AgentSettings({
  readyWorkspace,
  settingsDraft,
  onSettingsChange,
}: AgentSettingsProps): ReactNode {
  const disabled = !readyWorkspace;
  const selectedProvider = PROVIDER_OPTIONS.find((option) => option.value === settingsDraft.providerId);
  const selectedPiThinkingLevel = PI_THINKING_OPTIONS.find((option) => option.value === settingsDraft.pi.thinkingLevel);
  const selectedPermissionMode = PERMISSION_MODE_OPTIONS.find((option) => option.value === settingsDraft.claude.permissionMode);
  const selectedThinkingIntensity = THINKING_INTENSITY_OPTIONS.find((option) => option.value === settingsDraft.claude.thinkingIntensity);
  const selectedCodexApprovalPolicy = CODEX_APPROVAL_OPTIONS.find((option) => option.value === settingsDraft.codex.approvalPolicy);
  const selectedCodexReasoningEffort = CODEX_REASONING_OPTIONS.find((option) => option.value === settingsDraft.codex.reasoningEffort);
  const selectedPiProvider = piProviderOption(settingsDraft.pi.provider);
  const piProviderValue = settingsDraft.pi.provider.trim();
  const knownPiProvider = Boolean(selectedPiProvider);
  const piAuthKey = selectedPiProvider?.authKey ?? '';
  const piEnvVar = selectedPiProvider?.envVar ?? '';
  const allPiProviders = PI_PROVIDER_OPTIONS;
  const [piApiKey, setPiApiKey] = useState('');
  const [piAuthStatus, setPiAuthStatus] = useState('');
  const [piAuthLoadedKey, setPiAuthLoadedKey] = useState('');
  const piAuthDirtyRef = useRef(false);

  useEffect(() => {
    if (disabled || settingsDraft.providerId !== 'pi' || !knownPiProvider || !piAuthKey) {
      setPiApiKey('');
      setPiAuthStatus(knownPiProvider ? '' : '自定义 provider 不写入 Pi auth.json，请在自定义环境变量中配置 API key。');
      setPiAuthLoadedKey('');
      return;
    }

    let disposed = false;
    setPiAuthStatus('读取 Pi API key...');
    void loadPiProviderAuth(piProviderValue, piAuthKey)
      .then((auth) => {
        if (disposed) return;
        piAuthDirtyRef.current = false;
        setPiApiKey(auth.key);
        setPiAuthLoadedKey(piAuthKey);
        setPiAuthStatus(auth.key ? '已从 Pi auth.json 读取 API key。' : '尚未保存 API key。');
      })
      .catch((error) => {
        if (disposed) return;
        piAuthDirtyRef.current = false;
        setPiApiKey('');
        setPiAuthLoadedKey(piAuthKey);
        setPiAuthStatus(error instanceof Error ? error.message : String(error));
      });

    return () => {
      disposed = true;
    };
  }, [disabled, settingsDraft.providerId, knownPiProvider, piProviderValue, piAuthKey]);

  useEffect(() => {
    if (disabled || settingsDraft.providerId !== 'pi' || !knownPiProvider || !piAuthKey || piAuthLoadedKey !== piAuthKey) return;
    if (!piAuthDirtyRef.current) return;

    const saveTimer = setTimeout(() => {
      setPiAuthStatus('保存 Pi API key...');
      void savePiProviderAuth(piProviderValue, piAuthKey, piApiKey)
        .then(() => {
          piAuthDirtyRef.current = false;
          setPiAuthStatus(piApiKey.trim() ? '已保存到 Pi auth.json。' : '已从 Pi auth.json 移除。');
        })
        .catch((error) => {
          setPiAuthStatus(error instanceof Error ? error.message : String(error));
        });
    }, 600);

    return () => window.clearTimeout(saveTimer);
  }, [disabled, settingsDraft.providerId, knownPiProvider, piProviderValue, piAuthKey, piAuthLoadedKey, piApiKey]);

  return (
    <div className="flex flex-col gap-4">
      <FieldSet disabled={disabled}>
        <FieldLegend>{selectedProvider?.label ?? 'Agent'} Agent</FieldLegend>
        <FieldGroup className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field className="lg:col-span-2" data-disabled={disabled}>
            <FieldLabel>Provider</FieldLabel>
            <SettingDropdown
              disabled={disabled}
              value={selectedProvider?.label ?? settingsDraft.providerId}
              menuClassName="max-w-[32rem]"
            >
              <DropdownMenuRadioGroup
                value={settingsDraft.providerId}
                onValueChange={(value) => onSettingsChange({
                  ...settingsDraft,
                  providerId: value as ProviderId,
                })}
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="items-start gap-2 py-2 pr-8 whitespace-normal break-words leading-5"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </SettingDropdown>
          </Field>

          {settingsDraft.providerId === 'pi' ? (
            <>
              <Field data-disabled={disabled}>
                <FieldLabel>Pi provider</FieldLabel>
                <SettingDropdown
                  disabled={disabled}
                  value={allPiProviders.find((o) => o.value === settingsDraft.pi.provider)?.label ?? settingsDraft.pi.provider}
                >
                  <DropdownMenuRadioGroup
                    value={settingsDraft.pi.provider}
                    onValueChange={(value) => onSettingsChange({ ...settingsDraft, pi: { ...settingsDraft.pi, provider: value } })}
                  >
                    {allPiProviders.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </SettingDropdown>
                <FieldDescription>可从列表选择，也可输入自定义 provider id。</FieldDescription>
              </Field>

              <Field data-disabled={disabled}>
                <FieldLabel>模型</FieldLabel>
                <Input
                  value={settingsDraft.pi.model}
                  disabled={disabled}
                  aria-invalid={!settingsDraft.pi.model.trim()}
                  className={!settingsDraft.pi.model.trim() ? 'border-destructive focus-visible:ring-destructive/30' : undefined}
                  placeholder="必填，例如 gpt-5.4"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, model: event.currentTarget.value },
                  })}
                />
                {!settingsDraft.pi.model.trim() ? (
                  <FieldDescription className="text-destructive">Pi 模型为必填项。</FieldDescription>
                ) : (
                  <FieldDescription>支持 Pi 的模型匹配格式，例如 `anthropic/claude-sonnet-4`。</FieldDescription>
                )}
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="pi-api-key">{piEnvVar}</FieldLabel>
                <Input
                  id="pi-api-key"
                  value={piApiKey}
                  disabled={disabled || !knownPiProvider}
                  type="password"
                  placeholder={knownPiProvider ? `保存到 ~/.pi/agent/auth.json 的 ${piAuthKey}` : '自定义 provider 请使用自定义环境变量'}
                  onChange={(event) => {
                    piAuthDirtyRef.current = true;
                    setPiApiKey(event.currentTarget.value);
                  }}
                />
                <FieldDescription>
                  {piAuthStatus || `将写入 auth.json key: ${piAuthKey}`}
                </FieldDescription>
              </Field>

              <Field data-disabled={disabled}>
                <FieldLabel>思考等级</FieldLabel>
                <SettingDropdown
                  disabled={disabled}
                  value={selectedPiThinkingLevel?.label ?? settingsDraft.pi.thinkingLevel}
                >
                  <DropdownMenuRadioGroup
                    value={settingsDraft.pi.thinkingLevel}
                    onValueChange={(value) => onSettingsChange({
                      ...settingsDraft,
                      pi: { ...settingsDraft.pi, thinkingLevel: value as PiThinkingLevel },
                    })}
                  >
                    {PI_THINKING_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </SettingDropdown>
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="pi-executable">Pi 可执行文件</FieldLabel>
                <Input
                  id="pi-executable"
                  value={settingsDraft.pi.pathToPiExecutable}
                  disabled={disabled}
                  placeholder="不填写会优先使用项目内 pi，再查找 PATH"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, pathToPiExecutable: event.currentTarget.value },
                  })}
                />
              </Field>

              <Field orientation="horizontal" data-disabled={disabled}>
                <Switch
                  id="pi-auto-compaction"
                  disabled={disabled}
                  checked={settingsDraft.pi.autoCompactionEnabled}
                  onCheckedChange={(checked) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, autoCompactionEnabled: checked },
                  })}
                />
                <FieldContent>
                  <FieldLabel htmlFor="pi-auto-compaction">自动上下文压缩</FieldLabel>
                  <FieldDescription>接近上下文上限时允许 Pi 自动 compact。</FieldDescription>
                </FieldContent>
              </Field>

              <Field orientation="horizontal" data-disabled={disabled}>
                <Switch
                  id="pi-auto-retry"
                  disabled={disabled}
                  checked={settingsDraft.pi.autoRetryEnabled}
                  onCheckedChange={(checked) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, autoRetryEnabled: checked },
                  })}
                />
                <FieldContent>
                  <FieldLabel htmlFor="pi-auto-retry">自动重试</FieldLabel>
                  <FieldDescription>遇到限流、过载或 5xx 时允许 Pi 自动 retry。</FieldDescription>
                </FieldContent>
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="pi-extra-skills">额外 skill 路径</FieldLabel>
                <Textarea
                  id="pi-extra-skills"
                  value={settingsDraft.pi.extraSkillPaths}
                  disabled={disabled}
                  rows={4}
                  placeholder="每行一个 skill 文件或目录路径"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, extraSkillPaths: event.currentTarget.value },
                  })}
                />
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="pi-custom-env">自定义环境变量</FieldLabel>
                <Textarea
                  id="pi-custom-env"
                  value={settingsDraft.pi.customEnvText}
                  disabled={disabled}
                  rows={7}
                  placeholder="KEY=value"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    pi: { ...settingsDraft.pi, customEnvText: event.currentTarget.value },
                  })}
                />
              </Field>
            </>
          ) : settingsDraft.providerId === 'claude' ? (
            <>
          <Field data-disabled={disabled}>
            <FieldLabel>权限模式</FieldLabel>
            <SettingDropdown
              disabled={disabled}
              value={selectedPermissionMode?.label ?? settingsDraft.claude.permissionMode}
              menuClassName="max-w-[32rem]"
            >
              <DropdownMenuRadioGroup
                value={settingsDraft.claude.permissionMode}
                onValueChange={(value) => onSettingsChange({
                  ...settingsDraft,
                  claude: { ...settingsDraft.claude, permissionMode: value as PermissionMode },
                })}
              >
                {PERMISSION_MODE_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="items-start gap-2 py-2 pr-8 whitespace-normal break-words leading-5"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </SettingDropdown>
          </Field>

          <Field data-disabled={disabled}>
            <FieldLabel>思考强度</FieldLabel>
            <SettingDropdown
              disabled={disabled}
              value={selectedThinkingIntensity?.label ?? settingsDraft.claude.thinkingIntensity}
            >
              <DropdownMenuRadioGroup
                value={settingsDraft.claude.thinkingIntensity}
                onValueChange={(value) => onSettingsChange({
                  ...settingsDraft,
                  claude: { ...settingsDraft.claude, thinkingIntensity: value as ThinkingIntensity },
                })}
              >
                {THINKING_INTENSITY_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </SettingDropdown>
          </Field>

          <Field className="lg:col-span-2" data-disabled={disabled}>
            <FieldLabel htmlFor="claude-executable">Claude CLI 路径</FieldLabel>
            <Input
              id="claude-executable"
              value={settingsDraft.claude.pathToClaudeCodeExecutable}
              disabled={disabled}
              placeholder="不填写会自动查找 Claude"
              onChange={(event) => onSettingsChange({
                ...settingsDraft,
                claude: {
                  ...settingsDraft.claude,
                  pathToClaudeCodeExecutable: event.currentTarget.value,
                },
              })}
            />
          </Field>

          <Field className="lg:col-span-2" orientation="horizontal" data-disabled={disabled}>
            <Switch
              id="claude-user-settings"
              disabled={disabled}
              checked={settingsDraft.claude.useUserSettings}
              onCheckedChange={(checked) => onSettingsChange({
                ...settingsDraft,
                claude: { ...settingsDraft.claude, useUserSettings: checked },
              })}
            />
            <FieldContent>
              <FieldLabel htmlFor="claude-user-settings">加载用户 Claude 设置</FieldLabel>
              <FieldDescription>读取用户目录下的 Claude 配置。</FieldDescription>
            </FieldContent>
          </Field>

          <Field className="lg:col-span-2" data-disabled={disabled}>
            <FieldLabel htmlFor="claude-custom-env">自定义环境变量</FieldLabel>
            <Textarea
              id="claude-custom-env"
              value={settingsDraft.claude.customEnvText}
              disabled={disabled}
              rows={7}
              placeholder="KEY=value"
              onChange={(event) => onSettingsChange({
                ...settingsDraft,
                claude: { ...settingsDraft.claude, customEnvText: event.currentTarget.value },
              })}
            />
          </Field>
            </>
          ) : (
            <>
              <Field data-disabled={disabled}>
                <FieldLabel>批准策略</FieldLabel>
                <SettingDropdown
                  disabled={disabled}
                  value={selectedCodexApprovalPolicy?.label ?? settingsDraft.codex.approvalPolicy}
                  menuClassName="max-w-[32rem]"
                >
                  <DropdownMenuRadioGroup
                    value={settingsDraft.codex.approvalPolicy}
                    onValueChange={(value) => onSettingsChange({
                      ...settingsDraft,
                      codex: { ...settingsDraft.codex, approvalPolicy: value as CodexApprovalPolicy },
                    })}
                  >
                    {CODEX_APPROVAL_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                        className="items-start gap-2 py-2 pr-8 whitespace-normal break-words leading-5"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-medium">{option.label}</span>
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </SettingDropdown>
              </Field>

              <Field data-disabled={disabled}>
                <FieldLabel>推理强度</FieldLabel>
                <SettingDropdown
                  disabled={disabled}
                  value={selectedCodexReasoningEffort?.label ?? settingsDraft.codex.reasoningEffort}
                >
                  <DropdownMenuRadioGroup
                    value={settingsDraft.codex.reasoningEffort}
                    onValueChange={(value) => onSettingsChange({
                      ...settingsDraft,
                      codex: { ...settingsDraft.codex, reasoningEffort: value as CodexReasoningEffort },
                    })}
                  >
                    {CODEX_REASONING_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </SettingDropdown>
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="codex-executable">Codex 可执行文件</FieldLabel>
                <Input
                  id="codex-executable"
                  value={settingsDraft.codex.pathToCodexExecutable}
                  disabled={disabled}
                  placeholder="不填写会自动查找 codex"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    codex: {
                      ...settingsDraft.codex,
                      pathToCodexExecutable: event.currentTarget.value,
                    },
                  })}
                />
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="codex-model">模型</FieldLabel>
                <Input
                  id="codex-model"
                  value={settingsDraft.codex.model}
                  disabled={disabled}
                  placeholder="留空则使用 Codex 默认模型"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    codex: { ...settingsDraft.codex, model: event.currentTarget.value },
                  })}
                />
                <FieldDescription>例如 `gpt-5.3-codex`。留空时沿用 Codex 当前默认配置。</FieldDescription>
              </Field>

              <Field className="lg:col-span-2" data-disabled={disabled}>
                <FieldLabel htmlFor="codex-custom-env">自定义环境变量</FieldLabel>
                <Textarea
                  id="codex-custom-env"
                  value={settingsDraft.codex.customEnvText}
                  disabled={disabled}
                  rows={7}
                  placeholder="KEY=value"
                  onChange={(event) => onSettingsChange({
                    ...settingsDraft,
                    codex: { ...settingsDraft.codex, customEnvText: event.currentTarget.value },
                  })}
                />
                <FieldDescription>Codex 默认会读取用户登录态和 `~/.codex` 配置。</FieldDescription>
              </Field>
            </>
          )}
        </FieldGroup>
      </FieldSet>

    </div>
  );
}
