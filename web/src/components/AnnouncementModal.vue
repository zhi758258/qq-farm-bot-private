<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import { onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'

interface Announcement {
  content: string
  showOnce: boolean
  enabled: boolean
  updatedAt: number
}

const DISMISSED_KEY = 'announcement_dismissed_at'

const announcement = ref<Announcement | null>(null)
const loading = ref(false)

const dismissedAt = useStorage<string>(DISMISSED_KEY, '')

const shouldShow = ref(false)

async function fetchAnnouncement() {
  loading.value = true
  try {
    const res = await api.get('/api/announcement')
    if (res.data?.ok) {
      announcement.value = res.data.data
      evaluateVisibility()
    }
    else {
      announcement.value = null
      shouldShow.value = false
    }
  }
  catch {
    announcement.value = null
    shouldShow.value = false
  }
  finally {
    loading.value = false
  }
}

function evaluateVisibility() {
  const ann = announcement.value
  if (!ann || !ann.enabled || !ann.content.trim()) {
    shouldShow.value = false
    return
  }
  if (ann.showOnce === false) {
    shouldShow.value = true
    return
  }
  shouldShow.value = String(ann.updatedAt) !== String(dismissedAt.value)
}

async function handleConfirm() {
  const ann = announcement.value
  if (!ann)
    return
  dismissedAt.value = String(ann.updatedAt)
  shouldShow.value = false
  try {
    await api.post('/api/announcement/read')
  }
  catch {
    // 未登录或读取失败时静默忽略，本地已记录关闭状态
  }
}

onMounted(() => {
  fetchAnnouncement()
})

defineExpose({
  fetchAnnouncement,
})
</script>

<template>
  <Teleport to="body">
    <Transition name="announcement-fade">
      <div
        v-if="shouldShow"
        class="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      >
        <div class="max-h-[85vh] max-w-lg w-full flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
          <div class="flex shrink-0 items-center gap-2 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
            <div class="i-carbon-megaphone text-lg text-amber-500" />
            <h3 class="text-base text-gray-900 font-semibold dark:text-gray-100">
              公告
            </h3>
          </div>
          <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-4 text-sm text-gray-700 leading-relaxed dark:text-gray-200">
            {{ announcement?.content }}
          </div>
          <div class="flex shrink-0 justify-end border-t border-gray-100 px-5 py-3 dark:border-gray-700">
            <BaseButton variant="primary" :disabled="loading" @click="handleConfirm">
              确认
            </BaseButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.announcement-fade-enter-active,
.announcement-fade-leave-active {
  transition: opacity 0.2s ease;
}

.announcement-fade-enter-from,
.announcement-fade-leave-to {
  opacity: 0;
}

.announcement-fade-enter-active .rounded-2xl,
.announcement-fade-leave-active .rounded-2xl {
  transition: transform 0.2s ease;
}

.announcement-fade-enter-from .rounded-2xl,
.announcement-fade-leave-to .rounded-2xl {
  transform: scale(0.95);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 3px;
}
</style>
