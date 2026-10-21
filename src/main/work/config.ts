import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { CAPABILITIES } from './capabilities'

// 工作模式的模型配置：优先用户数据目录下的设置文件，再回退到项目根的本地配置
export interface WorkConfig {
  apiKey: string
  baseUrl: string
  model: string
}

/**
 * Agent 行为的可调参数，保存在 work-settings.json 的 preferences 字段。
 * 该对象可以安全下发渲染层，apiKey 永远不在其中。
 */
export interface WorkPreferences {
  enabledTools: string[]
  defaultProvider: 'local' | 'cloud' | 'both'
  topK: number
  temperature: number
  extraSystemPrompt: string
  /** 写文件/跑命令等危险操作的审批策略 */
  approvalPolicy: 'auto' | 'ask' | 'deny'
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-flash'
const DEFAULT_TOP_K = 5
const DEFAULT_TEMPERATURE = 0.4
const MIN_TOP_K = 1
const MAX_TOP_K = 10
const PROVIDERS: WorkPreferences['defaultProvider'][] = ['local', 'cloud', 'both']

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function pickString(source: Record<string, unknown> | null, key: string): string {
  const value = source?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readUserSettings(): Record<string, unknown> | null {
  return readJsonObject(join(app.getPath('userData'), 'work-settings.json'))
}

function readProjectConfig(): Record<string, unknown> | null {
  // 开发态 cwd 是项目根，打包后尝试 app 目录，两者取先存在的
  const candidates = [
    join(process.cwd(), 'config.local.json'),
    join(app.getAppPath(), 'config.local.json')
  ]
  for (const candidate of candidates) {
    const data = readJsonObject(candidate)
    if (data) return data
  }
  return null
}

export function getConfig(): WorkConfig {
  const userSettings = readUserSettings()
  const projectConfig = readProjectConfig()
  const apiKey = pickString(userSettings, 'apiKey') || pickString(projectConfig, 'apiKey')
  const rawBaseUrl =
    pickString(userSettings, 'baseUrl') || pickString(projectConfig, 'baseUrl') || DEFAULT_BASE_URL
  const model = pickString(userSettings, 'model') || pickString(projectConfig, 'model') || DEFAULT_MODEL
  return {
    apiKey,
    baseUrl: rawBaseUrl.replace(/\/+$/, ''),
    model
  }
}

export function isConfigured(): boolean {
  const config = getConfig()
  return Boolean(config.apiKey && config.baseUrl)
}

// 只用于界面展示，绝不下发完整 Key
export function maskApiKey(apiKey: string): string {
  if (!apiKey) return ''
  return apiKey.length <= 4 ? '****' : `****${apiKey.slice(-4)}`
}

function settingsFilePath(): string {
  return join(app.getPath('userData'), 'work-settings.json')
}

/** 默认允许 Agent 使用的能力：注册表里全部 agentEnabled 能力 */
function defaultEnabledTools(): string[] {
  return CAPABILITIES.filter((capability) => capability.agentEnabled).map((capability) => capability.id)
}

function defaultPreferences(): WorkPreferences {
  return {
    enabledTools: defaultEnabledTools(),
    defaultProvider: 'local',
    topK: DEFAULT_TOP_K,
    temperature: DEFAULT_TEMPERATURE,
    extraSystemPrompt: '',
    approvalPolicy: 'auto'
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 逐字段校验偏好值，任何非法字段都回退默认值 */
function normalizePreferences(input: unknown): WorkPreferences {
  const defaults = defaultPreferences()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults
  const raw = input as Record<string, unknown>

  let enabledTools = defaults.enabledTools
  if (Array.isArray(raw.enabledTools)) {
    const known = new Set<string>(CAPABILITIES.map((capability) => capability.id))
    const valid = raw.enabledTools.filter(
      (id): id is string => typeof id === 'string' && known.has(id)
    )
    // 数组非空但全部是未知 id，视为非法，回退默认
    enabledTools = raw.enabledTools.length > 0 && valid.length === 0 ? defaults.enabledTools : valid
  }

  const rawProvider = raw.defaultProvider
  const defaultProvider =
    typeof rawProvider === 'string' && PROVIDERS.includes(rawProvider as WorkPreferences['defaultProvider'])
      ? (rawProvider as WorkPreferences['defaultProvider'])
      : defaults.defaultProvider

  const rawTopK = typeof raw.topK === 'number' && Number.isFinite(raw.topK) ? raw.topK : defaults.topK
  const topK = clampNumber(Math.round(rawTopK), MIN_TOP_K, MAX_TOP_K)

  const rawTemperature =
    typeof raw.temperature === 'number' && Number.isFinite(raw.temperature)
      ? raw.temperature
      : defaults.temperature
  const temperature = clampNumber(rawTemperature, 0, 1)

  const extraSystemPrompt =
    typeof raw.extraSystemPrompt === 'string' ? raw.extraSystemPrompt : defaults.extraSystemPrompt

  const policy = raw.approvalPolicy
  const approvalPolicy =
    typeof policy === 'string' && ['auto', 'ask', 'deny'].includes(policy)
      ? (policy as WorkPreferences['approvalPolicy'])
      : defaults.approvalPolicy

  return { enabledTools, defaultProvider, topK, temperature, extraSystemPrompt, approvalPolicy }
}

/** 读取偏好设置：文件缺失或字段非法时按默认值补齐 */
export function getPreferences(): WorkPreferences {
  return normalizePreferences(readUserSettings()?.preferences)
}

/** 原子写：先写临时文件再替换，避免中途失败把设置文件写坏 */
async function writeUserSettings(data: Record<string, unknown>): Promise<void> {
  const target = settingsFilePath()
  const temp = `${target}.tmp`
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(temp, target)
}

/**
 * 合并并保存偏好设置，只接受 WorkPreferences 已知字段。
 * 同文件中的 apiKey / baseUrl / model 原样保留，不会被覆盖。
 */
export async function savePreferences(patch: Partial<WorkPreferences>): Promise<WorkPreferences> {
  const current = readUserSettings() ?? {}
  const existingPreferences =
    current.preferences && typeof current.preferences === 'object' && !Array.isArray(current.preferences)
      ? (current.preferences as Record<string, unknown>)
      : {}
  const incoming = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const preferences = normalizePreferences({ ...existingPreferences, ...incoming })
  await writeUserSettings({ ...current, preferences })
  return preferences
}
