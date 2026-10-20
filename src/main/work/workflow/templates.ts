// 内置工作流模板：固定 id，用户不能修改或删除
import type { WorkflowDefinition, WorkflowStep } from './types'

const BUILTIN_TIME = 0

function step(
  id: string,
  type: string,
  label: string,
  args: Record<string, string>
): WorkflowStep {
  return { id, type, label, args, enabled: true, onEmpty: 'skip' }
}

/** 三个模板共用同一个运行时变量：主题 */
function topicVariable() {
  return {
    key: '主题',
    label: '研究主题',
    placeholder: '例如：RAG 与长上下文的工程差异',
    required: true
  }
}

/** 快速问答：本地检索 + 模型回答 */
const QUICK: WorkflowDefinition = {
  id: 'tpl-quick',
  name: '快速问答',
  description: '先检索本地资料，再让模型基于命中片段回答，适合有明确问题、需要快速给出结论的场景。',
  version: 1,
  builtin: true,
  variables: [topicVariable()],
  steps: [
    step('s1', 'kb_search', '本地知识库检索', { query: '{{主题}}' }),
    step('s2', 'llm', '模型分析', {
      prompt: [
        '请基于下面的本地资料片段，回答研究主题「{{主题}}」。',
        '要求：先给出直接结论，再分 2 到 4 点说明依据，最后列出用到的资料（文件名 · 段号）。',
        '材料不足或互相矛盾时明确说明，不要编造。',
        '',
        '本地资料：',
        '{{prev}}'
      ].join('\n')
    })
  ],
  createdAt: BUILTIN_TIME,
  updatedAt: BUILTIN_TIME
}

/** 深度研究：本地检索 + 联网搜索 + 综合回答 + 报告 */
const DEEP: WorkflowDefinition = {
  id: 'tpl-deep',
  name: '深度研究',
  description: '本地检索与联网搜索各取一路材料，模型综合后生成结构化报告，适合调研类任务。',
  version: 1,
  builtin: true,
  variables: [topicVariable()],
  steps: [
    step('s1', 'kb_search', '本地知识库检索', { query: '{{主题}}' }),
    step('s2', 'web_search', '联网搜索', { query: '{{主题}}', limit: '5' }),
    step('s3', 'llm', '模型分析', {
      prompt: [
        '请综合下面两组材料，回答研究主题「{{主题}}」。',
        '要求：先给出结论，再分点对比与论证；每条关键信息注明来自「本地资料」还是「联网资料」；',
        '两组材料冲突时指出分歧；材料不足时明确说明，不要编造。',
        '',
        '本地资料：',
        '{{step.s1}}',
        '',
        '联网资料：',
        '{{step.s2}}'
      ].join('\n')
    }),
    step('s4', 'report', '生成报告', {
      title: '{{主题}}',
      instruction: '基于前面的检索与分析结果，形成一份可交付的中文研究报告。'
    })
  ],
  createdAt: BUILTIN_TIME,
  updatedAt: BUILTIN_TIME
}

/** 本地资料综述：扩大检索范围后整理要点并成文 */
const REVIEW: WorkflowDefinition = {
  id: 'tpl-review',
  name: '本地资料综述',
  description: '检索更多本地片段，先整理要点再成文，适合写文献综述或资料汇编。',
  version: 1,
  builtin: true,
  variables: [topicVariable()],
  steps: [
    step('s1', 'kb_search', '本地知识库检索', { query: '{{主题}}', topK: '8' }),
    step('s2', 'llm', '模型分析', {
      prompt: [
        '以下是本地资料中与研究主题「{{主题}}」相关的片段。',
        '请整理成结构化要点：',
        '1）核心观点；2）关键论据与数据；3）不同资料之间的一致与分歧；4）仍然缺失的信息。',
        '只依据给定片段，标注对应的文件名与段号，不要编造。',
        '',
        '资料：',
        '{{prev}}'
      ].join('\n')
    }),
    step('s3', 'report', '生成报告', {
      title: '{{主题}} 资料综述',
      instruction: '只依据本地资料整理，不引入外部信息。'
    })
  ],
  createdAt: BUILTIN_TIME,
  updatedAt: BUILTIN_TIME
}

export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [QUICK, DEEP, REVIEW]

export function getBuiltinWorkflow(id: string): WorkflowDefinition | undefined {
  return BUILTIN_WORKFLOWS.find((workflow) => workflow.id === id)
}

export function isBuiltinWorkflow(id: string): boolean {
  return BUILTIN_WORKFLOWS.some((workflow) => workflow.id === id)
}
