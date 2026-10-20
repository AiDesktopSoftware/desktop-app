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

const MODES: { key: ModeKey; label: string; owner: string }[] = [
  { key: 'chat', label: '对话', owner: '龙' },
  { key: 'work', label: '工作', owner: '赵' },
  { key: 'info', label: '信息', owner: '胡' }
]

const activeMode = shallowRef<ModeKey>('chat')
const activeView = computed(() => VIEWS[activeMode.value])
</script>

<template>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-title">研究助手</span>
        <span class="brand-sub">多源采集 · 检索分析</span>
      </div>

      <nav class="nav">
        <button
          v-for="mode in MODES"
          :key="mode.key"
          class="nav-item"
          :class="{ 'is-active': activeMode === mode.key }"
          @click="activeMode = mode.key"
        >
          <span class="nav-label">{{ mode.label }}</span>
          <span class="nav-owner">{{ mode.owner }}</span>
        </button>
      </nav>
    </aside>

    <main class="content">
      <component :is="activeView" />
    </main>
  </div>
</template>
