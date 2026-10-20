<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import ChatView from './views/chat/ChatView.vue'
import WorkView from './views/work/WorkView.vue'
import InfoView from './views/info/InfoView.vue'

type ModeKey = 'chat' | 'work' | 'info'

// 三个模式各自一个目录，对应三个人各自负责的模块，互不干扰
const VIEWS = {
  chat: ChatView,
  work: WorkView,
  info: InfoView
} as const

const MODES: { key: ModeKey; label: string; desc: string; owner: string }[] = [
  { key: 'chat', label: '对话', desc: '模型推理与多轮问答', owner: '龙' },
  { key: 'work', label: '工作', desc: '知识库 · 检索 · Agent', owner: '赵' },
  { key: 'info', label: '信息', desc: '多源采集与数据清洗', owner: '胡' }
]

const activeMode = shallowRef<ModeKey>('chat')
const activeView = computed(() => VIEWS[activeMode.value])
</script>

<template>
  <div class="app" :class="'mode-' + activeMode">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <i v-for="n in 9" :key="n" />
        </span>
        <span class="brand-text">
          <strong>AiDesktopSoftware</strong>
          <small>多源采集 · 研究助手</small>
        </span>
      </div>

      <nav class="nav">
        <button
          v-for="mode in MODES"
          :key="mode.key"
          class="nav-item"
          :class="{ 'is-active': activeMode === mode.key }"
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
            <template v-if="mode.key === 'chat'">
              <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-3.6 3v-3H6.5A2.5 2.5 0 0 1 4 13.5z" />
              <circle cx="9.2" cy="10" r="0.9" fill="currentColor" stroke="none" />
              <circle cx="12.5" cy="10" r="0.9" fill="currentColor" stroke="none" />
              <circle cx="15.8" cy="10" r="0.9" fill="currentColor" stroke="none" />
            </template>
            <template v-else-if="mode.key === 'work'">
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

      <div class="sidebar-foot">
        <span class="dot" />
        <span>v0.1.0 · 骨架阶段</span>
      </div>
    </aside>

    <main class="content">
      <Transition name="mode" mode="out-in">
        <component :is="activeView" :key="activeMode" />
      </Transition>
    </main>
  </div>
</template>
