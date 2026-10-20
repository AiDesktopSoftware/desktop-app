// 工作流引擎：定义读写 + 顺序执行 + 运行记录
// 存储照搬 knowledge-base/store.ts 的「原子写 + 进程内串行队列」模式
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { getNode, isNodeType, renderArgs } from './nodes'
import { BUILTIN_WORKFLOWS, isBuiltinWorkflow } from './templates'
import type {
  RunStep,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStep,
  WorkflowVariable
} from './types'

const WORKFLOW_DIR = 'workflows'
const DEFINITIONS_FILE = 'index.json'
const RUNS_FILE = 'runs.json'
const MAX_RUNS = 20
const STEP_EVENT_LIMIT = 400
const STEP_STORE_LIMIT = 1000
const RESULT_EVENT_LIMIT = 8000
const RESULT_STORE_LIMIT = 8000

export interface WorkflowSaveResult {
  ok: boolean
  workflow?: WorkflowDefinition
  message?: string
}

export interface WorkflowRemoveResult {
  ok: boolean
  message?: string
}

export interface WorkflowRunResult {
  ok: boolean
  run?: WorkflowRun
  message?: string
}

export interface RunWorkflowOptions {
  workflowId: string
  variables: Record<string, string>
  runId: string
  signal: AbortSignal
  send: (channel: string, payload: unknown) => void
}

const RUN_STATUSES: WorkflowRun['status'][] = ['running', 'done', 'failed', 'aborted']
const STEP_STATUSES: RunStep['status'][] = ['pending', 'running', 'done', 'failed', 'skipped']

function workflowDir(): string {
  return join(app.getPath('userData'), WORKFLOW_DIR)
}

function definitionsPath(): string {
  return join(workflowDir(), DEFINITIONS_FILE)
}

function runsPath(): string {
  return join(workflowDir(), RUNS_FILE)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}……` : text
}

function stringMap(input: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

// 进程内串行队列：保存与写入运行记录都会「读文件—改内容—写文件」，必须互斥
let queue: Promise<unknown> = Promise.resolve()

function withFlowLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

/** 先写临时文件再原子替换，避免中途失败把文件写坏 */
async function writeJson(target: string, data: unknown): Promise<void> {
  const temp = `${target}.tmp`
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(temp, target)
}

function normalizeVariables(input: unknown): WorkflowVariable[] {
  if (!Array.isArray(input)) return []
  const result: WorkflowVariable[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const key = asText(raw.key)
    if (!key) continue
    if (result.some((variable) => variable.key === key)) continue
    const variable: WorkflowVariable = { key, label: asText(raw.label) || key }
    const placeholder = asText(raw.placeholder)
    if (placeholder) variable.placeholder = placeholder
    if (raw.required === true) variable.required = true
    result.push(variable)
  }
  return result
}

/** 校验步骤：类型必须已注册，id 不能重复，参数统一成字符串 */
function normalizeSteps(input: unknown): WorkflowStep[] | null {
  if (!Array.isArray(input) || input.length === 0) return null
  const steps: WorkflowStep[] = []
  const ids = new Set<string>()
  for (let index = 0; index < input.length; index++) {
    const item = input[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const raw = item as Record<string, unknown>
    const type = asText(raw.type)
    if (!isNodeType(type)) return null

    const id = asText(raw.id) || `s${index + 1}`
    if (ids.has(id)) return null
    ids.add(id)

    const args: Record<string, string> = {}
    if (raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args)) {
      for (const [key, value] of Object.entries(raw.args as Record<string, unknown>)) {
        args[key] =
          typeof value === 'string'
            ? value
            : value === undefined || value === null
              ? ''
              : String(value)
      }
    }

    steps.push({
      id,
      type,
      label: asText(raw.label) || getNode(type)?.label || type,
      args,
      enabled: raw.enabled !== false,
      onEmpty: raw.onEmpty === 'fail' ? 'fail' : 'skip'
    })
  }
  return steps
}

/** 统一的定义校验：内置模板与用户自定义都先经过这一步 */
function normalizeWorkflow(input: unknown): WorkflowDefinition | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const id = asText(raw.id)
  if (!id) return null
  const steps = normalizeSteps(raw.steps)
  if (!steps) return null

  const now = Date.now()
  return {
    id,
    name: asText(raw.name) || '未命名工作流',
    description: asText(raw.description),
    version: 1,
    builtin: raw.builtin === true,
    variables: normalizeVariables(raw.variables),
    steps,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now
  }
}

async function readUserWorkflows(): Promise<WorkflowDefinition[]> {
  try {
    const raw = await fs.readFile(definitionsPath(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const result: WorkflowDefinition[] = []
    for (const item of parsed) {
      const workflow = normalizeWorkflow(item)
      // 内置模板始终以内置定义为准，文件里的同名定义直接忽略
      if (!workflow || workflow.builtin || isBuiltinWorkflow(workflow.id)) continue
      if (result.some((existing) => existing.id === workflow.id)) continue
      result.push(workflow)
    }
    return result
  } catch {
    return []
  }
}

function normalizeRunStep(input: unknown): RunStep | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const id = asText(raw.id)
  if (!id) return null
  const status =
    typeof raw.status === 'string' && STEP_STATUSES.includes(raw.status as RunStep['status'])
      ? (raw.status as RunStep['status'])
      : 'pending'
  const step: RunStep = { id, label: asText(raw.label) || id, status }
  if (typeof raw.output === 'string') step.output = raw.output
  if (typeof raw.error === 'string') step.error = raw.error
  if (typeof raw.startedAt === 'number') step.startedAt = raw.startedAt
  if (typeof raw.endedAt === 'number') step.endedAt = raw.endedAt
  return step
}

function normalizeRun(input: unknown): WorkflowRun | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const id = asText(raw.id)
  const workflowId = asText(raw.workflowId)
  if (!id || !workflowId) return null

  const status =
    typeof raw.status === 'string' && RUN_STATUSES.includes(raw.status as WorkflowRun['status'])
      ? (raw.status as WorkflowRun['status'])
      : 'failed'
  const steps: RunStep[] = []
  if (Array.isArray(raw.steps)) {
    for (const item of raw.steps) {
      const step = normalizeRunStep(item)
      if (step) steps.push(step)
    }
  }

  const run: WorkflowRun = {
    id,
    workflowId,
    name: asText(raw.name) || workflowId,
    status,
    variables: stringMap(raw.variables),
    steps,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
  }
  if (typeof raw.result === 'string') run.result = raw.result
  if (typeof raw.endedAt === 'number') run.endedAt = raw.endedAt
  return run
}

async function readRuns(): Promise<WorkflowRun[]> {
  try {
    const raw = await fs.readFile(runsPath(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => normalizeRun(item))
      .filter((run): run is WorkflowRun => run !== null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_RUNS)
  } catch {
    return []
  }
}

async function appendRun(run: WorkflowRun): Promise<void> {
  await withFlowLock(async () => {
    const runs = await readRuns()
    const next = [run, ...runs.filter((item) => item.id !== run.id)].slice(0, MAX_RUNS)
    await writeJson(runsPath(), next)
  })
}

/** 内置模板 + 用户自定义，内置排在前面 */
export async function listWorkflows(): Promise<WorkflowDefinition[]> {
  const userDefined = await readUserWorkflows()
  return [...BUILTIN_WORKFLOWS, ...userDefined]
}

/** 保存用户自定义工作流：按 id 覆盖，内置模板不可覆盖 */
export async function saveWorkflow(input: unknown): Promise<WorkflowSaveResult> {
  let draftInput = input
  // 新流程允许不传 id，这里补一个稳定标识
  if (draftInput && typeof draftInput === 'object' && !Array.isArray(draftInput)) {
    const raw = draftInput as Record<string, unknown>
    if (!asText(raw.id)) {
      draftInput = { ...raw, id: `flow-${Date.now().toString(36)}` }
    }
  }

  const draft = normalizeWorkflow(draftInput)
  if (!draft) {
    return { ok: false, message: '工作流格式不正确：至少需要一个步骤，节点类型必须合法' }
  }
  if (isBuiltinWorkflow(draft.id)) {
    return { ok: false, message: '内置模板不可修改，请另存为新的工作流' }
  }

  return withFlowLock(async () => {
    const existing = await readUserWorkflows()
    const found = existing.find((item) => item.id === draft.id)
    const now = Date.now()
    const workflow: WorkflowDefinition = {
      ...draft,
      builtin: false,
      createdAt: found ? found.createdAt : now,
      updatedAt: now
    }
    const next = found
      ? existing.map((item) => (item.id === workflow.id ? workflow : item))
      : [...existing, workflow]
    await writeJson(definitionsPath(), next)
    return { ok: true, workflow }
  })
}

/** 删除用户自定义工作流，内置模板拒绝删除 */
export async function removeWorkflow(id: string): Promise<WorkflowRemoveResult> {
  const target = asText(id)
  if (!target) return { ok: false, message: '缺少工作流标识' }
  if (isBuiltinWorkflow(target)) return { ok: false, message: '内置模板不可删除' }

  return withFlowLock(async () => {
    const existing = await readUserWorkflows()
    const next = existing.filter((item) => item.id !== target)
    if (next.length === existing.length) {
      return { ok: false, message: '未找到该工作流' }
    }
    await writeJson(definitionsPath(), next)
    return { ok: true }
  })
}

/** 运行记录，最新的在前 */
export async function listRuns(): Promise<WorkflowRun[]> {
  return readRuns()
}

/** 只保留定义中声明过的运行时变量，其余忽略 */
function runtimeVariables(
  workflow: WorkflowDefinition,
  input: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const variable of workflow.variables) {
    result[variable.key] = (input[variable.key] ?? '').trim()
  }
  return result
}

function isBlankArgs(args: Record<string, string>): boolean {
  return Object.values(args).every((value) => !value.trim())
}

/**
 * 顺序执行工作流：每个步骤前推送 running，结束推送 done / failed；
 * 任意节点失败即终止，未执行的步骤保持 pending；全部结束后写入运行记录。
 */
export async function runWorkflow(options: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const { runId, signal, send } = options
  const workflow = (await listWorkflows()).find((item) => item.id === options.workflowId)
  if (!workflow) {
    send('work:workflow:done', {
      runId,
      ok: false,
      result: '',
      message: '未找到该工作流'
    })
    return { ok: false, message: '未找到该工作流' }
  }

  const variables = runtimeVariables(workflow, options.variables)
  const steps: RunStep[] = workflow.steps.map((item) => ({
    id: item.id,
    label: item.label,
    status: 'pending'
  }))
  const outputs: Record<string, string> = {}
  const createdAt = Date.now()
  let lastOutput = ''
  let failedStep = ''
  let aborted = false

  const emitStep = (
    step: RunStep,
    status: RunStep['status'],
    extra: { output?: string; message?: string } = {}
  ): void => {
    send('work:workflow:step', {
      runId,
      stepId: step.id,
      status,
      ...(extra.output !== undefined ? { output: extra.output } : {}),
      ...(extra.message !== undefined ? { message: extra.message } : {})
    })
  }

  for (let index = 0; index < workflow.steps.length; index++) {
    const definitionStep = workflow.steps[index]
    const step = steps[index]

    if (signal.aborted) {
      aborted = true
      break
    }

    if (!definitionStep.enabled) {
      step.status = 'skipped'
      emitStep(step, 'skipped')
      continue
    }

    const context = { variables, prev: lastOutput, steps: outputs }
    const args = renderArgs(definitionStep.args, context)

    // 参数全部为空：默认跳过；配置为 fail 时终止
    if (isBlankArgs(args)) {
      if (definitionStep.onEmpty === 'fail') {
        step.status = 'failed'
        step.error = '该步骤没有可用的输入参数'
        emitStep(step, 'failed', { message: step.error })
        failedStep = definitionStep.label || definitionStep.id
        break
      }
      step.status = 'skipped'
      emitStep(step, 'skipped')
      continue
    }

    step.status = 'running'
    step.startedAt = Date.now()
    emitStep(step, 'running')

    const node = getNode(definitionStep.type)
    const outcome = node
      ? await node.run(args, context, signal)
      : { ok: false, text: '', message: `未知节点类型：${definitionStep.type}` }
    step.endedAt = Date.now()

    if (signal.aborted) {
      aborted = true
      step.status = 'failed'
      step.error = '已停止运行'
      emitStep(step, 'failed', { message: step.error })
      break
    }

    if (outcome.ok) {
      step.status = 'done'
      // 运行记录里保留较长文本，事件里只带 400 字，避免一次性推送过大
      step.output = clip(outcome.text, STEP_STORE_LIMIT)
      outputs[definitionStep.id] = outcome.text
      if (outcome.text.trim()) lastOutput = outcome.text
      emitStep(step, 'done', { output: clip(outcome.text, STEP_EVENT_LIMIT) })
      continue
    }

    step.status = 'failed'
    step.error = outcome.message || '节点执行失败'
    emitStep(step, 'failed', { message: step.error })
    failedStep = definitionStep.label || definitionStep.id
    break
  }

  const result = lastOutput.trim()
  if (!aborted && !failedStep && !result) failedStep = '全部步骤均被跳过'

  const status: WorkflowRun['status'] = aborted ? 'aborted' : failedStep ? 'failed' : 'done'
  const run: WorkflowRun = {
    id: runId,
    workflowId: workflow.id,
    name: workflow.name,
    status,
    variables,
    steps,
    ...(result ? { result: clip(result, RESULT_STORE_LIMIT) } : {}),
    createdAt,
    endedAt: Date.now()
  }
  await appendRun(run)

  let message = ''
  if (aborted) message = '已停止运行'
  else if (failedStep) {
    message = failedStep.includes('跳过')
      ? '全部步骤均被跳过，没有产生结果'
      : `步骤「${failedStep}」执行失败`
  }

  send('work:workflow:done', {
    runId,
    ok: status === 'done',
    result: clip(result, RESULT_EVENT_LIMIT),
    ...(message ? { message } : {})
  })
  return { ok: status === 'done', run, ...(message ? { message } : {}) }
}
