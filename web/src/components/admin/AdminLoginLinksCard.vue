<script setup lang="ts">
import type { LoginLinks } from '@/composables/useAdminSystemConfig'
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'

withDefaults(defineProps<{
  saving: boolean
  logoUploading: boolean
}>(), {})

const emit = defineEmits<{
  save: []
  reset: []
  upload: [file: File]
}>()

const links = defineModel<LoginLinks>('links', { required: true })

const fileInput = ref<HTMLInputElement | null>(null)

const previewUrl = computed(() => String(links.value?.logoUrl || ''))

function openFilePicker() {
  fileInput.value?.click()
}

function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file)
    emit('upload', file)
  input.value = ''
}
</script>

<template>
  <div class="border border-gray-200 rounded-xl bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 class="flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-link" />
          登录页链接设置
        </h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          配置登录页/侧边栏的标题、图标与跳转链接。加QQ群链接留空时，用户点击「加QQ群」会提示未配置。
        </p>
      </div>
      <div class="flex gap-2">
        <BaseButton
          size="sm"
          variant="secondary"
          :loading="saving"
          @click="emit('reset')"
        >
          恢复默认
        </BaseButton>
        <BaseButton
          size="sm"
          :loading="saving"
          @click="emit('save')"
        >
          保存设置
        </BaseButton>
      </div>
    </div>

    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-4">
        <div
          class="h-16 w-16 flex items-center justify-center overflow-hidden border border-gray-200 rounded-xl bg-gray-50 dark:border-gray-600 dark:bg-gray-700"
        >
          <img
            v-if="previewUrl"
            :src="previewUrl"
            alt="登录图标"
            class="h-full w-full object-contain"
          >
          <div v-else class="i-carbon-image text-xl text-gray-400" />
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="flex flex-wrap gap-2">
            <BaseButton
              size="sm"
              :loading="logoUploading"
              :disabled="saving"
              @click="openFilePicker"
            >
              {{ previewUrl ? '更换图标' : '上传图标' }}
            </BaseButton>
            <BaseButton
              v-if="previewUrl"
              size="sm"
              variant="secondary"
              :disabled="logoUploading || saving"
              @click="links.logoUrl = ''"
            >
              移除图标
            </BaseButton>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            支持 PNG、JPG、WebP、GIF、SVG、ICO，大小不超过 2MB；上传后需点「保存设置」生效
          </p>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
          class="hidden"
          @change="onFileChosen"
        >
      </div>

      <BaseInput
        v-model="links.title"
        label="系统标题"
        type="text"
        placeholder="QQ农场智能助手"
      />
      <div class="grid gap-3 md:grid-cols-2">
        <BaseInput
          v-model="links.loginSubtitle"
          label="登录页副标题"
          type="text"
          placeholder="欢迎回来，开启智慧农耕之旅"
        />
        <BaseInput
          v-model="links.registerSubtitle"
          label="注册页副标题"
          type="text"
          placeholder="创建账号，开启智慧农耕之旅"
        />
      </div>

      <div class="rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
        登录图标与标题需刷新登录页后可见；「加QQ群」按钮位于登录页与登录后侧边栏底部。
      </div>

      <BaseInput
        v-model="links.qqGroupUrl"
        label="加QQ群链接"
        type="text"
        placeholder="https://qun.qq.com/qqweb/m/qun/confirm?_wv=3&key=..."
      />
      <BaseInput
        v-model="links.purchaseUrl"
        label="购买/开通地址"
        type="text"
        placeholder="https://你的购买页地址（留空则不显示购买入口）"
      />

      <div class="rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        填写的群链接会出现在登录页与侧边栏的「加QQ群」按钮上。请先在手机 QQ 中打开群邀请链接获取真实地址后粘贴到这里，确认普通用户点击即可跳转加群。
      </div>
    </div>
  </div>
</template>
