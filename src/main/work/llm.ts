import { getConfig } from './config'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  messages: LlmMessage[]
  model?: string
  temperature?: number
  signal?: AbortSignal
  /** 要求模型只输出 JSON（计划拆解用） */
  jsonObject?: boolean
}

export interface StreamChatOptions extends ChatOptions {
  onDelta?: (delta: string) => void
}

/** OpenAI 兼容的 function calling 工具定义 */
export interface LlmToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface LlmToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/** Agent 循环使用：assistant 可携带 tool_calls，工具结果用 tool 角色回传 */
export type LlmAgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string }

export interface ToolChatOptions {
  messages: LlmAgentMessage[]
  /** 不传时不开放工具，用于收尾回答 */
  tools?: LlmToolSchema[]
  toolChoice?: 'auto' | 'none'
  model?: string
  temperature?: number
  signal?: AbortSignal
}

export interface ToolChatResult {
  content: string
  toolCalls: LlmToolCall[]
}

/** 带 HTTP 状态码的模型调用错误，便于界面给出可读提示 */
export class LlmError extends Error {
  readonly status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'LlmError'
    this.status = status
  }
}

const REQUEST_TIMEOUT_MS = 120_000

function extractErrorDetail(body: string): string {
  try {
    const data = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown }
    const raw =
      (typeof data.error === 'object' && data.error?.message) ||
      (typeof data.error === 'string' ? data.error : '') ||
      data.message ||
      ''
    return typeof raw === 'string' ? raw.slice(0, 160) : ''
  } catch {
    return body.trim().slice(0, 160)
  }
}

function describeHttpError(status: number, body: string): string {
  const detail = extractErrorDetail(body)
  const suffix = detail ? `（${detail}）` : ''
  switch (status) {
    case 401:
      return `API Key 无效或已过期，请检查配置${suffix}`
    case 402:
      return `账户余额不足，请充值后再试${suffix}`
    case 429:
      return `请求过于频繁，已触发频率限制，请稍后重试${suffix}`
    case 408:
    case 504:
      return `模型服务响应超时，请稍后重试${suffix}`
    case 400:
      return `请求参数有误${suffix}`
    default:
      if (status >= 500) return `模型服务暂时不可用（${status}）${suffix}`
      return `模型请求失败（${status}）${suffix}`
  }
}

function abortError(): Error {
  const error = new Error('已停止生成')
  error.name = 'AbortError'
  return error
}

/** 逐行解析 SSE，返回完整文本 */
async function readSseStream(
  response: Response,
  onDelta?: (delta: string) => void
): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let finished = false

  const consumePayload = (payload: string): boolean => {
    if (payload === '[DONE]') return true
    try {
      const data = JSON.parse(payload) as {
        choices?: { delta?: { content?: string } }[]
      }
      const delta = data.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) {
        full += delta
        onDelta?.(delta)
      }
    } catch {
      // 单个分片解析失败不影响整体流
    }
    return false
  }

  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let lineEnd = buffer.indexOf('\n')
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).replace(/\r$/, '').trim()
      buffer = buffer.slice(lineEnd + 1)
      lineEnd = buffer.indexOf('\n')
      if (!line.startsWith('data:')) continue
      if (consumePayload(line.slice(5).trim())) {
        finished = true
        break
      }
    }
  }

  // 处理末尾没有换行符的残留数据
  if (!finished) {
    const tail = buffer.replace(/\r$/, '').trim()
    if (tail.startsWith('data:')) consumePayload(tail.slice(5).trim())
  }

  try {
    await reader.cancel()
  } catch {
    // 流已结束时 cancel 可能抛错，忽略
  }
  return full
}

async function requestChat(
  options: ChatOptions,
  stream: boolean,
  onDelta?: (delta: string) => void
): Promise<string> {
  const config = getConfig()
  if (!config.apiKey) {
    throw new LlmError('未配置 API Key，请在 config.local.json 或 work-settings.json 中填写。')
  }

  // 内置超时控制，同时兼容调用方传入的中断信号
  const timeoutController = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, REQUEST_TIMEOUT_MS)
  const signals: AbortSignal[] = [timeoutController.signal]
  if (options.signal) signals.push(options.signal)
  const signal = signals.length > 1 ? AbortSignal.any(signals) : timeoutController.signal

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || config.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        stream,
        ...(options.jsonObject ? { response_format: { type: 'json_object' } } : {})
      }),
      signal
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new LlmError(describeHttpError(response.status, body), response.status)
    }

    if (stream) {
      return await readSseStream(response, onDelta)
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content
    return typeof content === 'string' ? content : ''
  } catch (error) {
    if (options.signal?.aborted) throw abortError()
    if (timedOut) throw new LlmError('请求超时，请稍后重试。', 408)
    if (error instanceof LlmError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new LlmError(`网络请求失败：${detail.slice(0, 120)}。请检查网络连接或代理设置。`)
  } finally {
    clearTimeout(timer)
  }
}

/** 流式对话，逐块回调增量文本 */
export function streamChat(options: StreamChatOptions): Promise<string> {
  return requestChat(options, true, options.onDelta)
}

/** 非流式调用，用于任务计划生成与单步执行 */
export function chatOnce(options: ChatOptions): Promise<string> {
  return requestChat(options, false)
}

/**
 * 支持 function calling 的非流式调用，供 Agent 循环使用。
 * 返回 assistant 的文本内容与工具调用列表，不改变原有导出行为。
 */
export async function chatWithTools(options: ToolChatOptions): Promise<ToolChatResult> {
  const config = getConfig()
  if (!config.apiKey) {
    throw new LlmError('未配置 API Key，请在 config.local.json 或 work-settings.json 中填写。')
  }

  const timeoutController = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, REQUEST_TIMEOUT_MS)
  const signals: AbortSignal[] = [timeoutController.signal]
  if (options.signal) signals.push(options.signal)
  const signal = signals.length > 1 ? AbortSignal.any(signals) : timeoutController.signal

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || config.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.3,
        stream: false,
        ...(options.tools && options.tools.length > 0
          ? { tools: options.tools, tool_choice: options.toolChoice ?? 'auto' }
          : {})
      }),
      signal
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new LlmError(describeHttpError(response.status, body), response.status)
    }

    const data = (await response.json()) as {
      choices?: {
        message?: {
          content?: string | null
          tool_calls?: {
            id?: string
            type?: string
            function?: { name?: string; arguments?: string }
          }[]
        }
      }[]
    }
    const message = data.choices?.[0]?.message
    const content = typeof message?.content === 'string' ? message.content : ''
    const toolCalls: LlmToolCall[] = Array.isArray(message?.tool_calls)
      ? message.tool_calls
          .filter((call) => call && typeof call.function?.name === 'string')
          .map((call, index) => ({
            id: typeof call.id === 'string' && call.id ? call.id : `call_${index}`,
            type: 'function',
            function: {
              name: call.function?.name ?? '',
              arguments:
                typeof call.function?.arguments === 'string' ? call.function.arguments : '{}'
            }
          }))
      : []
    return { content, toolCalls }
  } catch (error) {
    if (options.signal?.aborted) throw abortError()
    if (timedOut) throw new LlmError('请求超时，请稍后重试。', 408)
    if (error instanceof LlmError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new LlmError(`网络请求失败：${detail.slice(0, 120)}。请检查网络连接或代理设置。`)
  } finally {
    clearTimeout(timer)
  }
}
