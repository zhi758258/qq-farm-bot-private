<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useToastStore } from '@/stores/toast'

const toast = useToastStore()

const loading = ref(false)
const saving = ref(false)
const content = ref('')
const enabled = ref(true)
const showOnce = ref(true)
const updatedAt = ref(0)
const savedPreview = ref('')

const previewContent = computed(() => content.value.trim())

async function loadAnnouncement() {
  loading.value = true
  try {
    const res = await api.get('/api/admin/announcement')
    if (res.data?.ok) {
      const data = res.data.data || {}
      content.value = String(data.content || '')
      enabled.value = data.enabled !== false
      showOnce.value = data.showOnce !== false
      updatedAt.value = Number(data.updatedAt) || 0
      savedPreview.value = content.value
    }
    else {
      toast.error(res.data?.error || '获取公告失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '获取公告失败')
  }
  finally {
    loading.value = false
  }
}

async function handleSave() {
  saving.value = true
  try {
    const res = await api.put('/api/admin/announcement', {
      content: content.value,
      enabled: enabled.value,
      showOnce: showOnce.value,
    })
    if (res.data?.ok) {
      const data = res.data.data || {}
      content.value = String(data.content || '')
      enabled.value = data.enabled !== false
      showOnce.value = data.showOnce !== false
      updatedAt.value = Number(data.updatedAt) || 0
      savedPreview.value = content.value
      toast.success('公告已保存')
    }
    else {
      toast.error(res.data?.error || '保存失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '保存失败')
  }
  finally {
    saving.value = false
  }
}

onMounted(() => {
  loadAnnouncement()
})
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 class="flex items-center gap-2 text-base text-gray-800 font-semibold dark:text-gray-100">
            <div class="i-carbon-megaphone text-lg text-amber-500" />
            编辑公告
          </h3>
          <p class="mt-1 text-xs text-gray-400">
            公告会以弹窗形式出现在登录页和登录后的所有页面，用户点击「确认」后关闭
          </p>
        </div>
        <div v-if="updatedAt" class="shrink-0 text-xs text-gray-400">
          上次保存：{{ new Date(updatedAt).toLocaleString('zh-CN') }}
        </div>
      </div>

      <div class="mb-4 flex flex-wrap items-center gap-6">
        <BaseSwitch v-model="enabled" label="启用公告" />
        <BaseSwitch v-model="showOnce" label="仅显示一次（更新公告后重新弹出）" />
      </div>
      <p class="mb-2 text-xs text-gray-400">
        关闭「仅显示一次」后，每次打开登录页或刷新页面都会弹出公告
      </p>

      <div class="grid gap-4 lg:grid-cols-2">
        <div>
          <label class="mb-1.5 block text-sm text-gray-700 font-medium dark:text-gray-300">
            公告内容
          </label>
          <textarea
            v-model="content"
            rows="10"
            placeholder="请输入公告内容，支持多行文本&#10;例如：&#10;1. 每周六 10:00 全服维护&#10;2. 请及时收取作物，避免损失"
            class="w-full border border-gray-300 rounded-lg bg-white p-3 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label class="mb-1.5 block text-sm text-gray-700 font-medium dark:text-gray-300">
            弹窗预览
          </label>
          <div class="h-full flex flex-col overflow-hidden border border-gray-200 rounded-lg dark:border-gray-600">
            <div class="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
              <div class="i-carbon-megaphone text-lg text-amber-500" />
              <span class="text-sm text-gray-900 font-semibold dark:text-gray-100">
                公告
              </span>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-sm text-gray-700 leading-relaxed dark:text-gray-200">
              {{ previewContent || '（预览为空）' }}
            </div>
            <div class="flex shrink-0 justify-end border-t border-gray-100 px-4 py-2.5 dark:border-gray-700">
              <button
                class="rounded-lg px-4 py-1.5 text-sm text-white"
                style="background: var(--theme-gradient);"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <BaseButton :loading="saving" variant="primary" @click="handleSave">
          保存公告
        </BaseButton>
        <span v-if="savedPreview !== previewContent" class="text-xs text-amber-600 dark:text-amber-400">
          有未保存的修改
        </span>
      </div>
    </div>
  </div>
</template>
