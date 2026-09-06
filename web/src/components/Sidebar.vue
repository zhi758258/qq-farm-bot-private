<script setup lang="ts">
import { useDateFormat, useIntervalFn, useNow } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'

import { menuRoutes } from '@/router/menu'
import { useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useShopStore } from '@/stores/shop'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const appStore = useAppStore()
const userStore = useUserStore()
const shopStore = useShopStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()
const { currentAccount, currentAccountId } = storeToRefs(accountStore)
const { status, realtimeConnected } = storeToRefs(statusStore)
const { mysteryOffer, mysteryOfferAccountId } = storeToRefs(shopStore)
const { loginPageConfig, sidebarOpen } = storeToRefs(appStore)

const wsErrorNotifiedAt = ref<Record<string, number>>({})
const hasUnadaptedActivities = ref(false)
const unadaptedActivityIds = ref<number[]>([])
const notifiedActivitySignature = ref('')

const systemConnected = ref(true)
const serverUptimeBase = ref(0)
const lastPingTime = ref(Date.now())
const now = useNow()
const formattedTime = useDateFormat(now, 'YYYY-MM-DD HH:mm:ss')

async function checkConnection() {
  try {
    const res = await api.get('/api/ping')
    systemConnected.value = true
    if (res.data.ok && res.data.data) {
      if (res.data.data.uptime) {
        serverUptimeBase.value = res.data.data.uptime
        lastPingTime.value = Date.now()
      }
    }
    const accountRef = currentAccount.value?.id || currentAccount.value?.uin
    if (accountRef) {
      statusStore.connectRealtime(String(accountRef))
    }
  }
  catch {
    systemConnected.value = false
  }
}

async function refreshStatusFallback() {
  if (realtimeConnected.value)
    return

  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  if (accountRef) {
    await statusStore.fetchStatus(String(accountRef))
  }
}

async function refreshActivityUpdateReminder() {
  if (!userStore.isAdmin) {
    hasUnadaptedActivities.value = false
    return
  }
  try {
    const { data } = await api.get('/api/activity/update/status')
    const ids = Array.isArray(data?.report?.unknownActivityIds)
      ? data.report.unknownActivityIds.map(Number).filter((id: number) => id > 0).sort((a: number, b: number) => a - b)
      : []
    unadaptedActivityIds.value = ids
    hasUnadaptedActivities.value = ids.length > 0
    const signature = ids.join(',')
    if (signature && signature !== notifiedActivitySignature.value) {
      notifiedActivitySignature.value = signature
      const groups = Array.isArray(data?.report?.online?.groups) ? data.report.online.groups : []
      const titles = [...new Set(groups.map((item: any) => String(item?.title || '').trim()).filter(Boolean))]
      toast.warning(`发现未适配活动：${titles.join('、') || `${ids.length} 个活动组`}`, 8000)
    }
  }
  catch {
    // 提醒查询失败不影响侧边栏及其他后台功能。
  }
}

onMounted(() => {
  appStore.fetchLoginPageConfig()
  accountStore.fetchAccounts()
  checkConnection()
  // 获取当前用户信息
  userStore.fetchUserInfo()
  refreshActivityUpdateReminder()
})

onBeforeUnmount(() => {
  statusStore.disconnectRealtime()
})

useIntervalFn(checkConnection, 30000)
useIntervalFn(refreshActivityUpdateReminder, 60000)
useIntervalFn(() => {
  refreshStatusFallback()
  accountStore.fetchAccounts()
}, 10000)

watch(() => currentAccount.value?.id || currentAccount.value?.uin || '', () => {
  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  statusStore.connectRealtime(String(accountRef || ''))
  refreshStatusFallback()
}, { immediate: true })

watch(() => status.value?.wsError, (wsError: any) => {
  if (!wsError || Number(wsError.code) !== 400 || !currentAccount.value)
    return

  const errAt = Number(wsError.at) || 0
  const accId = String(currentAccount.value.id || currentAccount.value.uin || '')
  const lastNotified = wsErrorNotifiedAt.value[accId] || 0
  if (errAt <= lastNotified)
    return

  wsErrorNotifiedAt.value[accId] = errAt
  router.push('/settings')
}, { deep: true })

const uptime = computed(() => {
  const diff = Math.floor(serverUptimeBase.value + (now.value.getTime() - lastPingTime.value) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h}h ${m}m ${s}s`
})

const connectionStatus = computed(() => {
  if (!systemConnected.value) {
    return {
      text: '系统离线',
      color: 'bg-red-500',
      pulse: false,
    }
  }

  if (!currentAccount.value?.id) {
    return {
      text: '请添加账号',
      color: 'bg-gray-400',
      pulse: false,
    }
  }

  const isConnected = status.value?.connection?.connected
  if (isConnected) {
    return {
      text: '运行中',
      color: 'bg-green-500',
      pulse: true,
    }
  }

  return {
    text: '未连接',
    color: 'bg-gray-400', // Or red? Old version uses gray/offline class which is gray usually
    pulse: false,
  }
})

// 根据用户角色过滤导航菜单
const navItems = computed(() => {
  const isAdmin = userStore.isAdmin
  return menuRoutes
    .filter(item => item.showInNav !== false && (!item.adminOnly || isAdmin))
    .map(item => ({
      path: item.path ? `/${item.path}` : '/',
      label: item.label,
      icon: item.icon,
    }))
})

const hasActiveMysteryOffer = computed(() => {
  const offer = mysteryOffer.value
  if (!currentAccountId.value || mysteryOfferAccountId.value !== String(currentAccountId.value))
    return false
  if (!offer?.active || offer.purchased)
    return false
  const endTime = Number(offer.endTime || 0)
  const endMs = endTime > 10_000_000_000 ? endTime : endTime * 1000
  return !endMs || endMs > Date.now()
})

const version = __APP_VERSION__

watch(
  () => route.path,
  () => {
    // Close sidebar on route change (mobile only)
    if (window.innerWidth < 1024)
      appStore.closeSidebar()
  },
)

const showThemeDropdown = ref(false)
const showRenewModal = ref(false)
const renewCardCode = ref('')
const renewLoading = ref(false)
const renewError = ref('')
const renewSuccess = ref(false)
const renewCardInfo = ref<{ type: string, days: number, description: string } | null>(null)
const renewChecking = ref(false)

async function handleLogout() {
  await userStore.logout()
  router.push('/login')
}

function handleJoinGroup() {
  const url = loginPageConfig.value.qqGroupUrl
  if (!url) {
    toast.warning('加群链接暂未配置，请联系管理员', 4000)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function checkCardInfo() {
  if (!renewCardCode.value.trim()) {
    renewError.value = '请输入卡密'
    return
  }
  renewChecking.value = true
  renewError.value = ''
  renewCardInfo.value = null
  try {
    const res = await api.get(`/api/card/info/${renewCardCode.value.trim()}`)
    if (res.data.ok) {
      renewCardInfo.value = res.data.data
    }
    else {
      renewError.value = res.data.error || '卡密不存在或已使用'
    }
  }
  catch (e: any) {
    renewError.value = e?.response?.data?.error || e?.message || '查询卡密失败'
  }
  finally {
    renewChecking.value = false
  }
}

async function handleRenew() {
  if (!renewCardCode.value.trim()) {
    renewError.value = '请输入卡密'
    return
  }
  renewLoading.value = true
  renewError.value = ''
  renewSuccess.value = false
  try {
    const res: any = await userStore.renew(renewCardCode.value.trim())
    if (res.ok) {
      renewSuccess.value = true
      renewCardCode.value = ''
      renewCardInfo.value = null
      setTimeout(() => {
        showRenewModal.value = false
        renewSuccess.value = false
      }, 1500)
    }
    else {
      renewError.value = res.error || '续费失败'
    }
  }
  catch (e: any) {
    renewError.value = e?.response?.data?.error || e?.message || '续费失败'
  }
  finally {
    renewLoading.value = false
  }
}

function openRenewModal() {
  renewCardCode.value = ''
  renewError.value = ''
  renewSuccess.value = false
  renewCardInfo.value = null
  showRenewModal.value = true
}

function getDaysLabel(days: number) {
  if (days === -1)
    return '永久'
  return `${days}天`
}
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-50 h-full w-72 flex flex-col border-r border-gray-200/60 p-3 transition-transform duration-300 lg:static lg:translate-x-0 dark:border-gray-700/60"
    :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    :style="{ background: 'color-mix(in srgb, var(--surface-1) 90%, transparent)', color: 'var(--theme-text)' }"
  >
    <!-- Brand -->
    <div class="relative h-16 flex flex-none items-center justify-between px-2">
      <div class="min-w-0 flex items-center gap-3">
        <div class="h-11 w-11 flex flex-none items-center justify-center overflow-hidden rounded-full shadow-sm ring-1 ring-gray-200 dark:ring-gray-700">
          <img
            src="/icon.png"
            :alt="`${loginPageConfig.title || 'QQ农场智能助手'}图标`"
            class="h-full w-full scale-150 object-cover"
          >
        </div>
        <div class="min-w-0">
          <div class="truncate text-[15px] font-bold tracking-tight" style="color: var(--theme-text);">
            {{ loginPageConfig.title || 'QQ农场智能助手' }}
          </div>
          <div class="truncate text-[11px] font-mono opacity-45" style="color: var(--theme-text);">
            QQ FARM ASSISTANT
          </div>
        </div>
      </div>
      <!-- Mobile Close Button -->
      <button
        class="h-8 w-8 flex flex-none items-center justify-center rounded-lg text-gray-500 transition lg:hidden hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        @click="appStore.closeSidebar"
      >
        <div class="i-carbon-close text-xl" />
      </button>
    </div>

    <!-- 渐变分隔线 -->
    <div class="mx-2 mb-3 h-px flex-none" style="background: linear-gradient(90deg, color-mix(in srgb, var(--theme-primary) 45%, transparent), transparent);" />

    <!-- Navigation -->
    <nav class="custom-scrollbar flex-1 overflow-y-auto px-1 py-1 space-y-1">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        :active-class="item.path === '/' ? '' : 'router-link-active'"
        :exact-active-class="item.path === '/' ? 'router-link-active' : 'router-link-exact-active'"
        class="nav-item group relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-200"
        :class="item.path === '/admin-announcement' ? 'announcement-nav-item' : ''"
      >
        <span class="nav-icon h-9 w-9 flex flex-none items-center justify-center rounded-lg text-[22px] transition-colors duration-200">
          <div :class="[item.icon]" />
        </span>
        <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ item.label }}</span>
        <span
          v-if="item.path === '/admin-announcement'"
          class="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] text-white font-semibold shadow-sm"
        >
          公告
        </span>
        <span
          v-if="item.path === '/shop' && hasActiveMysteryOffer"
          class="h-2 w-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]"
          title="神秘商人已出现"
        />
        <span
          v-if="item.path === '/activity' && hasUnadaptedActivities"
          class="h-2 w-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]"
          :title="`发现 ${unadaptedActivityIds.length} 个未适配活动`"
        />
      </router-link>
    </nav>

    <!-- User Info -->
    <div class="flex-none rounded-xl px-3 py-2.5" style="background: color-mix(in srgb, var(--surface-2) 80%, transparent);">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0 flex items-center gap-2.5">
          <div class="h-8 w-8 shrink-0 overflow-hidden rounded-full" style="outline: 2px solid var(--theme-primary); outline-offset: 2px;">
            <img
              src="/icon.png"
              class="h-full w-full object-cover"
            >
          </div>
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold" style="color: var(--theme-text);">
              {{ userStore.username || '未登录' }}
            </div>
            <div class="text-[11px] opacity-55" style="color: var(--theme-text);">
              {{ userStore.isAdmin ? '管理员' : `用户 · 额度 ${userStore.accountLimit}` }}
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="h-8 w-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-200/60 dark:hover:bg-gray-700/60"
            :title="loginPageConfig.qqGroupUrl ? '加QQ群' : '加群链接暂未配置'"
            @click="handleJoinGroup"
          >
            <img
              src="/qq-group.png"
              alt="加QQ群"
              class="h-[22px] w-[22px] rounded-full object-cover ring-1 ring-white/60 dark:ring-black/30"
            >
          </button>
          <button
            v-if="!userStore.isAdmin"
            class="h-8 w-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-200/60 dark:hover:bg-gray-700/60"
            :title="userStore.isExpired ? '账号已过期，请续费' : '续费'"
            @click="openRenewModal"
          >
            <div class="i-carbon-renew text-sm" :style="{ color: userStore.isExpired ? '#ef4444' : 'var(--theme-primary)' }" />
          </button>
          <button
            class="h-8 w-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-200/60 dark:hover:bg-gray-700/60"
            title="退出登录"
            @click="handleLogout"
          >
            <div class="i-carbon-logout text-sm" :style="{ color: 'var(--theme-text)' }" />
          </button>
        </div>
      </div>
      <div v-if="userStore.userCard" class="mt-2 flex items-center justify-between border-t pt-2 text-[11px]" style="border-color: color-mix(in srgb, var(--theme-text) 10%, transparent); color: var(--theme-text);">
        <span class="opacity-55">
          {{ getDaysLabel(userStore.userCard.days) }} · {{ userStore.accountLimit }} 额度
        </span>
        <span :class="userStore.isExpired ? 'text-red-500' : 'opacity-80'" :style="userStore.isExpired ? {} : { color: 'var(--theme-primary)' }">
          {{ userStore.expireTimeText }}
        </span>
      </div>
    </div>

    <!-- Footer Status -->
    <div class="relative mt-4 flex-none rounded-xl px-3 py-2.5" style="background: color-mix(in srgb, var(--surface-2) 80%, transparent);">
      <div class="flex items-center justify-between text-xs">
        <div class="flex items-center gap-1.5 font-medium" style="color: var(--theme-text);">
          <span class="h-2 w-2 rounded-full" :class="[connectionStatus.color, { 'animate-pulse': connectionStatus.pulse }]" />
          <span>{{ connectionStatus.text }}</span>
        </div>
        <span class="font-mono opacity-60" style="color: var(--theme-text);">{{ uptime }}</span>
      </div>

      <div class="mt-2 flex items-center justify-between border-t pt-2 text-xs opacity-80" style="border-color: color-mix(in srgb, var(--theme-text) 10%, transparent); color: var(--theme-text);">
        <span class="font-mono">{{ formattedTime }}</span>
        <!-- 主题调色盘按钮 -->
        <button
          class="h-7 w-7 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-200/60 dark:hover:bg-gray-700/60"
          title="主题设置"
          @click="showThemeDropdown = !showThemeDropdown"
        >
          <div class="i-carbon-color-palette text-sm" :style="{ color: 'var(--theme-primary)' }" />
        </button>
      </div>

      <div class="mt-1 flex items-center justify-between text-[11px] font-mono opacity-45" style="color: var(--theme-text);">
        <span>v{{ version }}</span>
        <span>283405278</span>
      </div>

      <!-- 主题选择弹出面板 -->
      <div
        v-show="showThemeDropdown"
        class="glass-panel absolute bottom-full left-0 right-0 z-50 grid grid-cols-4 mb-2 gap-1.5 rounded-lg p-2"
      >
        <button
          v-for="(t, theme) in appStore.themes"
          :key="theme"
          class="group relative flex flex-col items-center justify-center gap-1 rounded-lg p-2 transition-all hover:scale-105"
          :class="{
            'ring-2 ring-offset-1': appStore.currentTheme === theme,
          }"
          :style="{
            'background': t.gradient,
            '--tw-ring-color': t.primary,
            '--tw-ring-offset-color': 'var(--theme-bg)',
          }"
          :title="t.name"
          @click="appStore.applyTheme(theme as any); showThemeDropdown = false"
        >
          <div :class="t.icon" class="text-base text-white" />
          <span class="text-[10px] text-white font-medium leading-tight">{{ t.name }}</span>
          <div
            v-if="appStore.currentTheme === theme"
            class="absolute right-1 top-1 h-3 w-3 flex items-center justify-center rounded-full bg-white shadow"
          >
            <div class="i-carbon-checkmark text-xs" :style="{ color: t.primary }" />
          </div>
        </button>
      </div>
    </div>
  </aside>

  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="showRenewModal"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
        @click.self="showRenewModal = false"
      >
        <div class="max-w-md w-full rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-lg font-bold" style="color: var(--theme-text);">
              续费卡密
            </h3>
            <button
              class="h-8 w-8 flex items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              @click="showRenewModal = false"
            >
              <div class="i-carbon-close text-lg" />
            </button>
          </div>
          <div class="space-y-3">
            <input
              v-model="renewCardCode"
              type="text"
              placeholder="请输入卡密"
              class="farm-input w-full border border-gray-200 rounded-xl bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              @keyup.enter="handleRenew"
            >
            <div class="flex gap-2">
              <button
                class="flex-1 rounded-xl bg-gray-100 py-2 text-sm font-medium transition dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
                :disabled="renewChecking"
                @click="checkCardInfo"
              >
                {{ renewChecking ? '查询中...' : '查询' }}
              </button>
              <button
                class="flex-1 rounded-xl py-2 text-sm text-white font-medium transition disabled:opacity-50"
                style="background: var(--theme-gradient);"
                :disabled="renewLoading"
                @click="handleRenew"
              >
                {{ renewLoading ? '续费中...' : '确认续费' }}
              </button>
            </div>
            <p v-if="renewCardInfo" class="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-700/50" style="color: var(--theme-text);">
              {{ renewCardInfo.days }}天 · {{ renewCardInfo.description || renewCardInfo.type }}
            </p>
            <p v-if="renewError" class="text-sm text-red-500">
              {{ renewError }}
            </p>
            <p v-if="renewSuccess" class="text-sm text-green-500">
              续费成功！
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 2px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}

/* ===== 导航菜单项 ===== */

/* 默认态 */
.nav-item {
  opacity: 0.82;
}
.nav-item:hover {
  background: var(--surface-2);
  opacity: 1;
}

/* 公告管理：醒目高亮 */
.announcement-nav-item {
  background: linear-gradient(90deg, color-mix(in srgb, #f59e0b 16%, transparent), transparent 85%);
  border: 1px solid color-mix(in srgb, #f59e0b 34%, transparent);
  opacity: 1;
}
.announcement-nav-item:hover {
  background: linear-gradient(90deg, color-mix(in srgb, #f59e0b 26%, transparent), transparent 85%);
  border-color: color-mix(in srgb, #f59e0b 52%, transparent);
}
.announcement-nav-item.router-link-active,
.announcement-nav-item.router-link-exact-active {
  border-color: color-mix(in srgb, #f59e0b 70%, transparent) !important;
}
.announcement-nav-item .nav-icon {
  color: #d97706;
}

/* 图标容器 */
.nav-item .nav-icon {
  color: color-mix(in srgb, var(--theme-text) 58%, transparent);
}
.nav-item:hover .nav-icon {
  background: color-mix(in srgb, var(--theme-text) 7%, transparent);
  color: var(--theme-text);
}

/* 选中态：渐变图标胶囊 + 左侧指示条 */
.router-link-active.nav-item,
.router-link-exact-active.nav-item {
  background: color-mix(in srgb, var(--theme-primary) 9%, transparent) !important;
  color: var(--theme-primary) !important;
  opacity: 1;
}

.router-link-active .nav-icon,
.router-link-exact-active .nav-icon {
  background: var(--theme-gradient) !important;
  color: #fff !important;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--theme-primary) 28%, transparent);
}

.router-link-active::before,
.router-link-exact-active::before {
  content: '';
  position: absolute;
  top: 50%;
  left: -4px;
  width: 3px;
  height: 56%;
  transform: translateY(-50%);
  border-radius: 0 4px 4px 0;
  background: var(--theme-gradient);
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
