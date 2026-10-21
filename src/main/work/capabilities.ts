// 工作模式能力注册表：内置能力（静态常量）+ 用户自定义能力（从存储动态加载）
// Agent 的工具 schema、界面能力面板、工具中文名都从这里读取，避免多处重复定义
import type { LlmToolSchema } from './llm'
import type { CustomCapability } from './capabilities/custom'
import { listCustomCapabilities } from './capabilities/custom'
import type { WorkCapability } from '../../renderer/src/views/work/types'

/** 工具参数的 JSON Schema（即 function.parameters 部分） */
export interface ToolSchema {
  type: 'object'
  properties: Record<string, { type: string; description?: string }>
  required?: string[]
  [key: string]: unknown
}

/** 注册表中的一项能力：界面元数据 + Agent 工具 schema */
export interface Capability extends WorkCapability {
  paramsSchema: ToolSchema
}

// ---- 内置能力（静态）----
export const CAPABILITIES: Capability[] = [
  {
    id: 'web_search',
    label: '联网搜索',
    description: '按关键词联网搜索，返回标题、链接与摘要，需要最新信息时优先使用。',
    permission: 'read',
    agentEnabled: true,
    fields: [
      { key: 'query', label: '搜索关键词', placeholder: '例如：RAG 与长上下文的差异' },
      { key: 'limit', label: '返回条数', placeholder: '可选，默认 5，最多 8' }
    ],
    paramsSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        limit: { type: 'number', description: '返回条数，默认 5，最多 8' }
      },
      required: ['query']
    }
  },
  {
    id: 'fetch_url',
    label: '读取网页',
    description: '抓取网页正文，自动去掉脚本与标签，正文截断到 4000 字。',
    permission: 'read',
    agentEnabled: true,
    fields: [{ key: 'url', label: '网页地址', placeholder: 'https://…' }],
    paramsSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整的 http/https 地址' }
      },
      required: ['url']
    }
  },
  {
    id: 'list_files',
    label: '列目录',
    description: '列出目录下的文件名、类型与大小，最多 200 条。',
    permission: 'read',
    agentEnabled: true,
    fields: [{ key: 'dir', label: '目录路径', placeholder: '项目内相对路径或绝对路径' }],
    paramsSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '目录路径' }
      },
      required: ['dir']
    }
  },
  {
    id: 'read_file',
    label: '读文件',
    description: '读取本地文本文件，超过 200KB 只读取前 200KB。',
    permission: 'read',
    agentEnabled: true,
    fields: [{ key: 'path', label: '文件路径', placeholder: '项目内相对路径或绝对路径' }],
    paramsSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' }
      },
      required: ['path']
    }
  },
  {
    id: 'write_file',
    label: '写文件',
    description: '写入文本文件，自动创建父目录并覆盖原内容。',
    permission: 'write',
    agentEnabled: true,
    fields: [
      { key: 'path', label: '文件路径', placeholder: '项目内相对路径或绝对路径' },
      { key: 'content', label: '文件内容', placeholder: '要写入的完整文本', multiline: true }
    ],
    paramsSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '要写入的完整文本' }
      },
      required: ['path', 'content']
    }
  },
  {
    id: 'kb_search',
    label: '本地知识库检索',
    description: '在用户导入的本地资料中检索片段，适合回答依赖已有文档的问题。',
    permission: 'read',
    agentEnabled: true,
    fields: [
      { key: 'query', label: '检索问题', placeholder: '例如：课程设计的验证方法', multiline: true },
      { key: 'topK', label: '返回片段数', placeholder: '可选，默认 5，最多 10' }
    ],
    paramsSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索问题或关键词' },
        topK: { type: 'number', description: '返回片段数，1–10，默认 5' }
      },
      required: ['query']
    }
  },
  {
    id: 'run_command',
    label: '执行命令',
    description: '在本机执行 PowerShell 命令，默认在项目根目录运行，60 秒超时。',
    permission: 'exec',
    agentEnabled: true,
    fields: [
      { key: 'command', label: '命令', placeholder: '例如：npm run typecheck', multiline: true },
      { key: 'cwd', label: '工作目录', placeholder: '可选，默认项目根目录' }
    ],
    paramsSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        cwd: { type: 'string', description: '可选的工作目录，默认项目根目录' }
      },
      required: ['command']
    }
  }
]

/** 把 CustomCapability 转成内部 Capability 格式 */
function customToCapability(custom: CustomCapability): Capability {
  const properties: Record<string, { type: string; description?: string }> = {}
  for (const [key, schema] of Object.entries(custom.paramsSchema)) {
    properties[key] = { type: schema.type, ...(schema.description ? { description: schema.description } : {}) }
  }
  const fields = Object.keys(custom.paramsSchema).map((key) => ({
    key,
    label: key,
    placeholder: custom.paramsSchema[key].description ?? key
  }))
  return {
    id: custom.id,
    label: custom.name,
    description: custom.description,
    permission: 'read',
    agentEnabled: true,
    fields,
    paramsSchema: {
      type: 'object',
      properties,
      ...(custom.required && custom.required.length > 0 ? { required: custom.required } : {})
    }
  }
}

// ---- 导出：同步查询内置，异步查询全部 ----

/** 同步：只查内置能力（Agent 工具循环运行路径里用，避免额外 await） */
export function getBuiltinCapability(id: string): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.id === id)
}

/** 异步：查全部（内置 + 自定义） */
export async function getCapability(id: string): Promise<Capability | undefined> {
  const builtin = CAPABILITIES.find((capability) => capability.id === id)
  if (builtin) return builtin
  const customAll = await listCustomCapabilities()
  const found = customAll.find((item) => item.id === id)
  return found ? customToCapability(found) : undefined
}

/** 异步：合并内置 + 自定义，按 enabledTools 过滤后返回给 Agent 的工具 schema */
export async function capabilitySchemas(enabledTools?: string[]): Promise<LlmToolSchema[]> {
  const customList = await listCustomCapabilities()
  const all: Capability[] = [...CAPABILITIES, ...customList.map(customToCapability)]
  const allowed =
    enabledTools && enabledTools.length > 0 ? new Set(enabledTools) : null
  return all
    .filter(
      (capability) => capability.agentEnabled && (!allowed || allowed.has(capability.id))
    )
    .map((capability) => ({
      type: 'function',
      function: {
        name: capability.id,
        description: capability.description,
        parameters: capability.paramsSchema
      }
    }))
}

/** 异步：合并后剔除 schema，下发给渲染层 */
export async function capabilityMetadata(): Promise<WorkCapability[]> {
  const customList = await listCustomCapabilities()
  const all: Capability[] = [...CAPABILITIES, ...customList.map(customToCapability)]
  return all.map(
    ({ id, label, description, fields, permission, agentEnabled }) => ({
      id,
      label,
      description,
      fields,
      permission,
      agentEnabled
    })
  )
}

/** 同步常量：内置能力 id 集合，用于快速判断是不是自定义能力（无 await 开销） */
export const BUILTIN_IDS = new Set(CAPABILITIES.map((c) => c.id))
