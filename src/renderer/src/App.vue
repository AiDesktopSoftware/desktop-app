<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import WorkView from './views/work/WorkView.vue'
import InfoView from './views/info/InfoView.vue'

type ModeKey = 'work' | 'info'

// 两个模式各自一个目录，对应两个人各自负责的模块，互不干扰
const VIEWS = {
  work: WorkView,
  info: InfoView
} as const

const MODES: { key: ModeKey; label: string; desc: string; owner: string }[] = [
  { key: 'work', label: '工作', desc: '知识库 · 检索 · Agent', owner: '赵' },
  { key: 'info', label: '信息', desc: '多源采集与数据清洗', owner: '胡' }
]

const COLLAPSE_KEY = 'shell.sidebar-collapsed'

const activeMode = shallowRef<ModeKey>('work')
const activeView = computed(() => VIEWS[activeMode.value])
const activeModeLabel = computed(() => MODES.find((m) => m.key === activeMode.value)?.label ?? '')
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1')

// 自绘窗口按钮：最大化状态（用于切换最大化/还原图标）
const isMaximized = ref(false)
let maximizeUnsub: (() => void) | null = null

// 窗口控制按钮包装函数（script 里定义避免 Vue template scope 问题）
function doMinimize() { window.api.minimizeWindow() }
function doToggleMaximize() { window.api.toggleMaximize() }
function doClose() { window.api.closeWindow() }

function toggleSidebar() {
  collapsed.value = !collapsed.value
  localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0')
}

// 快捷键：Alt+1/2 切模式，Ctrl+B 收起/展开侧栏
function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    toggleSidebar()
    return
  }
  if (e.altKey && ['1', '2'].includes(e.key)) {
    e.preventDefault()
    activeMode.value = MODES[Number(e.key) - 1].key
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  maximizeUnsub = window.api.onMaximizeState((s) => (isMaximized.value = s))
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (maximizeUnsub) maximizeUnsub()
})
</script>

<template>
  <div class="app" :class="['mode-' + activeMode, { 'is-collapsed': collapsed }]">
    <!-- 自绘标题栏：左侧可拖动窗口，右侧自绘三个窗口控制按钮 -->
    <header class="titlebar">
      <span class="titlebar-mark" aria-hidden="true">
        <i v-for="n in 9" :key="n" />
      </span>
      <span class="titlebar-name">AI 多源信息采集与研究助手</span>
      <span class="titlebar-mode">{{ activeModeLabel }}</span>
      <div class="window-controls">
        <button
          class="wc-btn wc-min"
          title="最小化"
          @click="doMinimize"
        >
          <svg viewBox="0 0 10 1" aria-hidden="true"><rect width="10" height="1" /></svg>
        </button>
        <button
          class="wc-btn wc-max"
          :title="isMaximized ? '还原' : '最大化'"
          @click="doToggleMaximize"
        >
          <!-- 未最大化：空心方角矩形 -->
          <template v-if="!isMaximized">
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" />
            </svg>
          </template>
          <!-- 已最大化：带内缩的重叠矩形，表示还原 -->
          <template v-else>
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <rect x="2" y="0.5" width="7.5" height="7.5" rx="1" fill="none" />
              <rect x="0.5" y="2" width="7.5" height="7.5" rx="1" fill="none" />
            </svg>
          </template>
        </button>
        <button
          class="wc-btn wc-close"
          title="关闭"
          @click="doClose"
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </header>

    <div class="app-body">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <i v-for="n in 9" :key="n" />
          </span>
          <span class="brand-text">
            <strong>AiDesktopSoftware</strong>
            <small>多源采集 · 研究助手</small>
          </span>
          <button
            class="collapse-btn"
            :title="collapsed ? '展开侧栏 (Ctrl+B)' : '收起侧栏 (Ctrl+B)'"
            @click="toggleSidebar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 7l-5 5 5 5" />
            </svg>
          </button>
        </div>

        <nav class="nav">
          <button
            v-for="(mode, idx) in MODES"
            :key="mode.key"
            class="nav-item"
            :class="{ 'is-active': activeMode === mode.key }"
            :title="mode.label + '（Alt+' + (idx + 1) + '）'"
            @click="activeMode = mode.key"
          >
            <svg
              class="nav-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <template v-if="mode.key === 'work'">
                <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
                <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
                <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
                <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
              </template>
              <template v-else>
                <circle cx="10.5" cy="10.5" r="5.5" />
                <path d="M14.8 14.8 20 20" />
              </template>
            </svg>

            <span class="nav-text">
              <span class="nav-label">{{ mode.label }}</span>
              <span class="nav-desc">{{ mode.desc }}</span>
            </span>

            <span class="nav-owner">{{ mode.owner }}</span>
          </button>
        </nav>

        <div class="sidebar-foot" title="Alt+1/2 切换模式">
          <span class="dot" />
          <span class="foot-text">v0.1.0 · 骨架阶段</span>
        </div>
      </aside>

      <main class="content">
        <Transition name="mode" mode="out-in">
          <component :is="activeView" :key="activeMode" />
        </Transition>
      </main>
    </div>
  </div>
</template>
