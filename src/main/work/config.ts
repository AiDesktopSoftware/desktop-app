import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// 工作模式的模型配置：优先用户数据目录下的设置文件，再回退到项目根的本地配置
export interface WorkConfig {
  apiKey: string
  baseUrl: string
  model: string
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-flash'

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
