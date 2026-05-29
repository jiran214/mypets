import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  AiSettings,
  PiThinkingLevel,
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
  const selectedPiThinkingLevel = PI_THINKING_OPTIONS.find((option) => option.value === settingsDraft.pi.thinkingLevel);
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
    if (disabled || !knownPiProvider || !piAuthKey) {
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
  }, [disabled, knownPiProvider, piProviderValue, piAuthKey]);

  useEffect(() => {
    if (disabled || !knownPiProvider || !piAuthKey || piAuthLoadedKey !== piAuthKey) return;
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
  }, [disabled, knownPiProvider, piProviderValue, piAuthKey, piAuthLoadedKey, piApiKey]);

  return (
    <div className="flex flex-col gap-4">
      <FieldSet disabled={disabled}>
        <FieldLegend>Pi Agent</FieldLegend>
        <FieldGroup className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
        </FieldGroup>
      </FieldSet>

    </div>
  );
}
