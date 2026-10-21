// 工作模式右侧面板注册表：面板元数据与组件的单一事实来源
// 新增面板只需在 PANELS 里追加一项，容器按注册表动态渲染标签，无需改动容器模板
import type { Component } from 'vue'
import SourcesPanel from './SourcesPanel.vue'
import TracePanel from './TracePanel.vue'
import KnowledgePanel from './KnowledgePanel.vue'
import SearchPanel from './SearchPanel.vue'
import ArtifactsPanel from './ArtifactsPanel.vue'
import ModePanel from './ModePanel.vue'

export interface PanelDefinition {
  /** 面板唯一 id，同时作为布局持久化的键 */
  id: string
  /** 标签文案 */
  label: string
  /** 新增面板下拉里的说明 */
  description: string
  component: Component
  /** 固定面板，不显示关闭按钮 */
  pinnable?: boolean
  /** 是否可关闭，默认 true */
  closable?: boolean
}

/** 注册顺序即默认标签顺序 */
export const PANELS: PanelDefinition[] = [
  {
    id: 'sources',
    label: '检索来源',
    description: '当前会话自动汇总的网页与本地资料来源',
    component: SourcesPanel,
    pinnable: true
  },
  {
    id: 'trace',
    label: '执行轨迹',
    description: '当前回答的工具调用过程与执行状态',
    component: TracePanel,
    pinnable: true
  },
  {
    id: 'knowledge',
    label: '本地知识库',
    description: '导入本地资料，为检索提供片段',
    component: KnowledgePanel
  },
  {
    id: 'search',
    label: '知识库检索',
    description: '按问题在本地库或云端公共库中检索片段',
    component: SearchPanel
  },
  {
    id: 'artifacts',
    label: '产物',
    description: '工作流产出的报告与清单',
    component: ArtifactsPanel
  },
  {
    id: 'mode',
    label: '当前模式',
    description: '当前模式的工具、温度与检索默认值',
    component: ModePanel
  }
]
