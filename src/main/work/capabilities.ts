// 工作模式能力注册表：能力元数据的单一事实来源
// Agent 的工具 schema、界面能力面板、工具中文名都从这里读取，避免多处重复定义
import type { LlmToolSchema } from './llm'
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

export function getCapability(id: string): Capability | undefined {
  return CAPABILITIES.find((capability) => capability.id === id)
}

/** 交给 Agent 的工具定义，只包含 agentEnabled 的能力 */
export function capabilitySchemas(): LlmToolSchema[] {
  return CAPABILITIES.filter((capability) => capability.agentEnabled).map((capability) => ({
    type: 'function',
    function: {
      name: capability.id,
      description: capability.description,
      parameters: capability.paramsSchema
    }
  }))
}

/** 下发到渲染层的元数据，剔除 Agent 专用的 schema */
export function capabilityMetadata(): WorkCapability[] {
  return CAPABILITIES.map(({ id, label, description, fields, permission, agentEnabled }) => ({
    id,
    label,
    description,
    fields,
    permission,
    agentEnabled
  }))
}
