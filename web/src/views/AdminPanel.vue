<script setup lang="ts">
import type { Card, UserCard } from '@/stores/user'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const EDGE_RE = /Edg\/([\d.]+)/
const CHROME_RE = /Chrome\/([\d.]+)/
const FIREFOX_RE = /Firefox\/([\d.]+)/
const SAFARI_VERSION_RE = /Version\/([\d.]+)/

const userStore = useUserStore()
const toast = useToastStore()

const activeTab = ref<'card' | 'user' | 'log'>(
  (localStorage.getItem('admin-active-tab') as 'card' | 'user' | 'log') || 'card',
)

watch(activeTab, (newTab) => {
  localStorage.setItem('admin-active-tab', newTab)
})

const tabs = [
  { key: 'card', label: '卡密', icon: 'i-carbon-ticket' },
  { key: 'user', label: '用户', icon: 'i-carbon-user-admin' },
  { key: 'log', label: '日志', icon: 'i-carbon-document' },
] as const

const modalVisible = ref(false)
const modalConfig = ref({
  title: '',
  message: '',
  type: 'primary' as 'primary' | 'danger',
  isAlert: true,
})

// ========== 卡密管理 ==========
const cards = ref<Card[]>([])
const cardsLoading = ref(false)
const showCreateModal = ref(false)

const newCard = ref({
  description: '',
  days: 30,
  count: 1,
  type: 'time' as 'time' | 'quota',
})

const selectedCards = ref<Set<string>>(new Set())
const selectAll = ref(false)

const searchQuery = ref('')
const filterStatus = ref<'all' | 'used' | 'unused' | 'enabled' | 'disabled'>('all')
const cardTypeFilter = ref<'all' | 'time' | 'quota'>('all')

// 卡密领取功能
const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)
const cardClaimCardCode = ref('')

const unusedTimeCardsCount = computed(() => {
  return cards.value.filter(c => c.type === 'time' && !c.usedBy && c.enabled).length
})

const cardClaimCardOptions = computed(() => {
  const items = cards.value
    .filter(c => c.type === 'time' && !c.usedBy && c.enabled)
    .map(card => ({
      value: card.code,
      label: `${card.code} · ${card.description || '时间卡'} · ${card.days === -1 ? '永久' : `${card.days}天`}`,
    }))
  return [{ value: '', label: '自动选择首张可用时间卡' }, ...items]
})

const activeClaimCard = computed(() => {
  if (!cardClaimCardCode.value)
    return null
  return cards.value.find(card => card.code === cardClaimCardCode.value) || null
})

const filteredCards = computed(() => {
  let result = cards.value

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(card =>
      card.code.toLowerCase().includes(query)
      || card.description.toLowerCase().includes(query)
      || (card.usedBy && card.usedBy.toLowerCase().includes(query)),
    )
  }

  switch (filterStatus.value) {
    case 'used':
      result = result.filter(card => card.usedBy)
      break
    case 'unused':
      result = result.filter(card => !card.usedBy)
      break
    case 'enabled':
      result = result.filter(card => card.enabled)
      break
    case 'disabled':
      result = result.filter(card => !card.enabled)
      break
  }

  if (cardTypeFilter.value !== 'all') {
    result = result.filter(card => card.type === cardTypeFilter.value)
  }

  return result
})

async function fetchCards() {
  cardsLoading.value = true
  try {
    const result = await userStore.getAllCards()
    if (result.ok) {
      cards.value = result.data
    }
    else {
      toast.error(result.error || '获取卡密列表失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取卡密列表失败')
  }
  finally {
    cardsLoading.value = false
  }
}

async function fetchCardClaimStatus() {
  cardClaimLoading.value = true
  try {
    const res = await api.get('/api/admin/card-claim/status')
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.data?.enabled === true
      cardClaimCardCode.value = String(res.data.data?.cardCode || '')
    }
  }
  catch (e: any) {
    console.error('获取卡密领取状态失败:', e)
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function toggleCardClaimStatus(enabled: boolean | undefined) {
  if (enabled === undefined)
    return
  cardClaimLoading.value = true
  try {
    const res = await api.post('/api/admin/card-claim/status', {
      enabled,
      type: 'card',
      cardCode: cardClaimCardCode.value,
    })
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.data?.enabled === true
      cardClaimCardCode.value = String(res.data.data?.cardCode || '')
      toast.success(enabled ? '卡密领取功能已开启' : '卡密领取功能已关闭')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
    cardClaimEnabled.value = !enabled
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function saveCardClaimCardCode() {
  cardClaimLoading.value = true
  try {
    const res = await api.post('/api/admin/card-claim/status', {
      enabled: cardClaimEnabled.value,
      type: 'card',
      cardCode: cardClaimCardCode.value,
    })
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.data?.enabled === true
      cardClaimCardCode.value = String(res.data.data?.cardCode || '')
      toast.success(cardClaimCardCode.value ? '发放卡密已更新' : '已切换为自动选择可用时间卡')
    }
  }
  catch (e: any) {
    toast.error(e.message || '保存卡密领取配置失败')
  }
  finally {
    cardClaimLoading.value = false
  }
}

async function createCard() {
  if (!newCard.value.description) {
    toast.warning('请输入卡密描述')
    return
  }

  const count = Math.min(Math.max(Number.parseInt(String(newCard.value.count), 10) || 1, 1), 100)

  try {
    const result = await userStore.createCard(
      newCard.value.description,
      newCard.value.days,
      count > 1 ? count : undefined,
      newCard.value.type,
    )
    if (result.ok) {
      const batchCards = result.data?.cards
      if (batchCards && batchCards.length > 1) {
        toast.success(`成功创建 ${batchCards.length} 个卡密`)
        exportCardsToFile(batchCards, `卡密批量导出_${newCard.value.description}_${formatDateForFile(Date.now())}.txt`)
      }
      else {
        toast.success('卡密创建成功')
      }
      showCreateModal.value = false
      newCard.value = { description: '', days: 30, count: 1, type: 'time' }
      await fetchCards()
    }
    else {
      toast.error(result.error || '创建卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '创建卡密失败')
  }
}

async function toggleCardStatus(card: Card) {
  try {
    const result = await userStore.updateCard(card.code, { enabled: !card.enabled })
    if (result.ok) {
      toast.success(card.enabled ? '卡密已禁用' : '卡密已启用')
      await fetchCards()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function deleteCard(card: Card) {
  if (!confirm(`确定要删除卡密 ${card.code} 吗？`))
    return

  try {
    const result = await userStore.deleteCard(card.code)
    if (result.ok) {
      toast.success('卡密删除成功')
      await fetchCards()
    }
    else {
      toast.error(result.error || '删除卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '删除卡密失败')
  }
}

async function deleteSelectedCards() {
  const selectedCodes = Array.from(selectedCards.value)
  if (selectedCodes.length === 0) {
    toast.warning('请先选择要删除的卡密')
    return
  }

  if (!confirm(`确定要删除选中的 ${selectedCodes.length} 个卡密吗？此操作不可恢复！`))
    return

  try {
    const result = await userStore.deleteCardsBatch(selectedCodes)
    if (result.ok) {
      const deleted = result.data?.deleted ?? 0
      toast.success(`成功删除 ${deleted} 个卡密`)
      selectedCards.value.clear()
      selectAll.value = false
      await fetchCards()
    }
    else {
      toast.error(result.error || '批量删除卡密失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '批量删除卡密失败')
  }
}

async function copyCode(code: string) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code)
      toast.success('卡密已复制到剪贴板')
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = code
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      toast.success('卡密已复制到剪贴板')
      document.body.removeChild(textArea)
    }
  }
  catch (e) {
    toast.error('复制失败，请手动复制')
    console.error('复制失败:', e)
  }
}

async function copySelectedCards() {
  const codes = Array.from(selectedCards.value)
  if (codes.length === 0)
    return

  try {
    const text = codes.join('\n')
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 ${codes.length} 个卡密到剪贴板`)
    }
    else {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      toast.success(`已复制 ${codes.length} 个卡密到剪贴板`)
      document.body.removeChild(textArea)
    }
  }
  catch (e) {
    toast.error('复制失败，请手动复制')
    console.error('复制失败:', e)
  }
}

function formatDate(timestamp: string | number | null) {
  if (!timestamp)
    return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatDateForFile(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
}

function getCardTypeLabel(card: Card) {
  if (card.type === 'quota') {
    return '额度'
  }
  return '时间'
}

function getCardValueLabel(card: Card) {
  if (card.type === 'quota') {
    return `+${card.days}额度`
  }
  if (card.days === -1)
    return '永久'
  return `${card.days}天`
}

function isClaimTargetCard(card: Card) {
  return cardClaimEnabled.value && !!cardClaimCardCode.value && card.code === cardClaimCardCode.value
}

function exportCardsToFile(cardsToExport: Card[], filename?: string) {
  if (!cardsToExport || cardsToExport.length === 0) {
    toast.warning('没有可导出的卡密')
    return
  }

  const content = cardsToExport.map(card =>
    `卡密: ${card.code}\n描述: ${card.description}\n时长: ${getCardTypeLabel(card)}\n状态: ${card.enabled ? '启用' : '禁用'}\n${card.usedBy ? `使用者: ${card.usedBy}\n使用时间: ${formatDate(card.usedAt)}` : '未使用'}\n创建时间: ${formatDate(card.createdAt)}\n${'='.repeat(40)}`,
  ).join('\n\n')

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || `卡密导出_${formatDateForFile(Date.now())}.txt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  toast.success(`已导出 ${cardsToExport.length} 个卡密到文件`)
}

function toggleSelectAll() {
  if (selectAll.value) {
    filteredCards.value.forEach(card => selectedCards.value.add(card.code))
  }
  else {
    filteredCards.value.forEach(card => selectedCards.value.delete(card.code))
  }
}

function toggleSelectCard(code: string) {
  if (selectedCards.value.has(code)) {
    selectedCards.value.delete(code)
    selectAll.value = false
  }
  else {
    selectedCards.value.add(code)
    if (filteredCards.value.every(card => selectedCards.value.has(card.code))) {
      selectAll.value = true
    }
  }
}

// ========== 用户管理 ==========
interface UserInfo {
  username: string
  role: string
  card: UserCard | null
  accountLimit: number
}

interface EditForm {
  newUsername: string
  password: string
  accountLimit: number
  expiresAt: string
  isPermanent: boolean
}

const users = ref<UserInfo[]>([])
const usersLoading = ref(false)
const showEditModal = ref(false)
const selectedUser = ref<UserInfo | null>(null)
const editForm = ref<EditForm>({
  newUsername: '',
  password: '',
  accountLimit: 2,
  expiresAt: '',
  isPermanent: false,
})
const editLoading = ref(false)

// ========== 用户统计 ==========
interface UserStats {
  total: number
  valid: number
  expired: number
  banned: number
  noCard: number
}

const userStats = ref<UserStats>({ total: 0, valid: 0, expired: 0, banned: 0, noCard: 0 })
const statsLoading = ref(false)
const showCleanupExpiredConfirm = ref(false)
const cleanupLoading = ref(false)

async function fetchUserStats() {
  statsLoading.value = true
  try {
    const result = await userStore.getUserStats()
    if (result.ok) {
      userStats.value = result.data
    }
    else {
      toast.error(result.error || '获取用户统计失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取用户统计失败')
  }
  finally {
    statsLoading.value = false
  }
}

async function confirmCleanupExpired() {
  cleanupLoading.value = true
  try {
    const result = await userStore.cleanupExpiredUsers()
    if (result.ok) {
      const count = result.data?.count ?? 0
      toast.success(count > 0 ? `已清理 ${count} 个过期用户` : '没有需要清理的过期用户')
      showCleanupExpiredConfirm.value = false
      await fetchUsers()
      await fetchUserStats()
    }
    else {
      toast.error(result.error || '清理失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '清理失败')
  }
  finally {
    cleanupLoading.value = false
  }
}

const currentUsername = computed(() => userStore.username)

async function fetchUsers() {
  usersLoading.value = true
  try {
    const result = await userStore.getAllUsers()
    if (result.ok) {
      users.value = result.data
    }
    else {
      toast.error(result.error || '获取用户列表失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取用户列表失败')
  }
  finally {
    usersLoading.value = false
  }
}

async function toggleUserStatus(user: UserInfo) {
  try {
    const result = await userStore.editUser(user.username, {
      cardEnabled: !user.card?.enabled,
    })
    if (result.ok) {
      toast.success(user.card?.enabled ? '用户已封禁' : '用户已解封')
      await fetchUsers()
    }
    else {
      toast.error(result.error || '操作失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '操作失败')
  }
}

async function deleteUser(user: UserInfo) {
  if (!confirm(`确定要删除用户 ${user.username} 吗？此操作不可恢复！`))
    return

  try {
    const result = await userStore.deleteUser(user.username)
    if (result.ok) {
      toast.success('用户删除成功')
      await fetchUsers()
    }
    else {
      toast.error(result.error || '删除用户失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '删除用户失败')
  }
}

function openEditModal(user: UserInfo) {
  selectedUser.value = user
  editForm.value = {
    newUsername: user.username,
    password: '',
    accountLimit: user.accountLimit || 2,
    expiresAt: user.card?.expiresAt ? formatDateTimeLocal(user.card.expiresAt) : '',
    isPermanent: user.card?.days === -1,
  }
  showEditModal.value = true
}

function formatDateTimeLocal(timestamp: string | number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

async function handleEdit() {
  if (!selectedUser.value)
    return

  editLoading.value = true
  try {
    const expiresAtValue = editForm.value.isPermanent
      ? null
      : (editForm.value.expiresAt ? new Date(editForm.value.expiresAt).getTime() : null)

    const updateData: Record<string, any> = {
      accountLimit: editForm.value.accountLimit,
      expiresAt: expiresAtValue,
      isPermanent: editForm.value.isPermanent,
    }

    if (editForm.value.newUsername && editForm.value.newUsername !== selectedUser.value.username) {
      updateData.newUsername = editForm.value.newUsername
    }

    if (editForm.value.password) {
      updateData.password = editForm.value.password
    }

    const res = await api.post(`/api/admin/users/${selectedUser.value.username}/edit`, updateData)

    if (res.data.ok) {
      toast.success('用户信息已更新')
      showEditModal.value = false
      await fetchUsers()
    }
    else {
      toast.error(res.data.error || '更新失败')
    }
  }
  catch (e: any) {
    toast.error(e?.response?.data?.error || e?.message || '更新失败')
  }
  finally {
    editLoading.value = false
  }
}

function getDaysLabel(days: number) {
  if (days === -1)
    return '永久'
  return `${days}天`
}

function isExpired(card: UserCard | null) {
  if (!card?.expiresAt)
    return false
  return Date.now() > new Date(card.expiresAt).getTime()
}

// ========== 登录日志 ==========
interface LoginLog {
  id: string
  timestamp: number
  event: 'login_success' | 'login_failed'
  username: string
  errorType: string | null
  ip: string
  userAgent: string
}

const loginLogs = ref<LoginLog[]>([])
const loginLogsLoading = ref(false)
const loginLogsTotal = ref(0)
const showClearLogsConfirm = ref(false)
const clearLogsLoading = ref(false)

async function fetchLoginLogs() {
  loginLogsLoading.value = true
  try {
    const result = await userStore.getLoginLogs()
    if (result.ok) {
      loginLogs.value = result.data.logs
      loginLogsTotal.value = result.data.total
    }
    else {
      toast.error(result.error || '获取登录日志失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '获取登录日志失败')
  }
  finally {
    loginLogsLoading.value = false
  }
}

function openClearLogsConfirm() {
  if (loginLogsTotal.value === 0) {
    toast.warning('暂无日志可清空')
    return
  }
  showClearLogsConfirm.value = true
}

async function confirmClearLogs() {
  clearLogsLoading.value = true
  try {
    const result = await userStore.clearLoginLogs()
    if (result.ok) {
      toast.success('日志已清空')
      loginLogs.value = []
      loginLogsTotal.value = 0
      showClearLogsConfirm.value = false
    }
    else {
      toast.error(result.error || '清空失败')
    }
  }
  catch (e: any) {
    toast.error(e.message || '清空失败')
  }
  finally {
    clearLogsLoading.value = false
  }
}

function formatLogTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN')
}

function getEventLabel(event: string): string {
  return event === 'login_success' ? '登录成功' : '登录失败'
}

function getEventClass(event: string): string {
  return event === 'login_success'
    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
}

function getErrorTypeLabel(errorType: string | null): string {
  if (!errorType)
    return '-'
  const labels: Record<string, string> = {
    rate_limit: '速率限制',
    locked: '账户锁定',
    invalid_credentials: '凭证错误',
  }
  return labels[errorType] || errorType
}

function parseBrowser(userAgent: string): string {
  if (!userAgent || userAgent === 'unknown')
    return '未知'

  if (userAgent.includes('Edg/')) {
    const match = userAgent.match(EDGE_RE)
    return `Edge ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Chrome/')) {
    const match = userAgent.match(CHROME_RE)
    return `Chrome ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Firefox/')) {
    const match = userAgent.match(FIREFOX_RE)
    return `Firefox ${match ? match[1] : ''}`
  }
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) {
    const match = userAgent.match(SAFARI_VERSION_RE)
    return `Safari ${match ? match[1] : ''}`
  }
  if (userAgent.includes('MSIE') || userAgent.includes('Trident/')) {
    return 'IE'
  }

  return '其他'
}

onMounted(() => {
  fetchCards()
  fetchUsers()
  fetchLoginLogs()
  fetchCardClaimStatus()
  fetchUserStats()
})
</script>

<template>
  <div class="admin-panel">
    <div class="mb-4">
      <h1 class="flex items-center gap-2 text-2xl text-gray-900 font-bold dark:text-gray-100">
        <div class="i-fas-user-shield text-lg" />
        后台管理
      </h1>
    </div>

    <div class="card border border-gray-200 rounded-2xl bg-white shadow-md dark:border-gray-700 dark:bg-gray-800">
      <div class="border-b border-gray-200 dark:border-gray-700">
        <nav class="flex gap-1 p-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all"
            :class="activeTab === tab.key
              ? 'text-white shadow-sm'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'"
            :style="activeTab === tab.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
            @click="activeTab = tab.key"
          >
            <div :class="tab.icon" />
            {{ tab.label }}
          </button>
        </nav>
      </div>

      <div class="p-4">
        <!-- 卡密管理 -->
        <div v-if="activeTab === 'card'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-800 font-semibold dark:text-gray-200">
              卡密管理
            </h3>
            <div class="flex gap-2">
              <BaseButton variant="secondary" size="sm" @click="fetchCards">
                刷新
              </BaseButton>
              <BaseButton variant="primary" size="sm" @click="showCreateModal = true">
                创建卡密
              </BaseButton>
            </div>
          </div>

          <!-- 卡密领取功能开关 -->
          <div class="card flex items-center justify-between border border-gray-200 rounded-2xl bg-white p-4 shadow-md dark:border-gray-700 dark:bg-gray-800">
            <div>
              <h4 class="text-sm text-gray-900 font-medium dark:text-white">
                卡密领取功能
              </h4>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                开启后，用户注册时可免费领取一张时间卡密
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-500">
                库存: <span class="font-medium" :class="unusedTimeCardsCount > 0 ? 'text-green-600' : 'text-red-600'">{{ unusedTimeCardsCount }}</span> 张
              </span>
              <BaseSwitch
                v-model="cardClaimEnabled"
                :disabled="cardClaimLoading"
                @update:model-value="toggleCardClaimStatus"
              />
            </div>
          </div>

          <div class="card flex flex-col gap-3 border border-gray-200 rounded-2xl bg-white p-4 shadow-md md:flex-row md:items-end md:justify-between dark:border-gray-700 dark:bg-gray-800">
            <div class="flex-1">
              <div class="text-sm text-gray-900 font-medium dark:text-white">
                免费领取发放卡密
              </div>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                你可以指定注册页免费领取时发放的卡密，留空时自动选择首张可用时间卡。
              </p>
              <select
                v-model="cardClaimCardCode"
                class="mt-3 w-full border border-gray-300 rounded-xl bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                :disabled="cardClaimLoading"
              >
                <option v-for="option in cardClaimCardOptions" :key="option.value || 'auto'" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
              <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                <template v-if="cardClaimEnabled && activeClaimCard">
                  当前固定发放：<span class="text-amber-600 font-medium dark:text-amber-300">{{ activeClaimCard.code }}</span>
                </template>
                <template v-else-if="cardClaimEnabled">
                  当前发放策略：<span class="text-emerald-600 font-medium dark:text-emerald-300">自动选择首张可用时间卡</span>
                </template>
                <template v-else>
                  当前发放策略：功能未开启
                </template>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <BaseButton variant="secondary" size="sm" :loading="cardClaimLoading" @click="saveCardClaimCardCode">
                保存发放配置
              </BaseButton>
            </div>
          </div>

          <div class="flex gap-2">
            <button
              class="btn btn-sm rounded-xl px-3 py-1.5 text-sm font-medium transition-colors"
              :class="cardTypeFilter === 'all'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="cardTypeFilter === 'all' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="cardTypeFilter = 'all'"
            >
              全部
            </button>
            <button
              class="btn btn-sm rounded-xl px-3 py-1.5 text-sm font-medium transition-colors"
              :class="cardTypeFilter === 'time'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="cardTypeFilter === 'time' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="cardTypeFilter = 'time'"
            >
              时间卡密
            </button>
            <button
              class="btn btn-sm rounded-xl px-3 py-1.5 text-sm font-medium transition-colors"
              :class="cardTypeFilter === 'quota'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
              :style="cardTypeFilter === 'quota' ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="cardTypeFilter = 'quota'"
            >
              配额卡密
            </button>
          </div>

          <div class="card flex items-center gap-2 rounded-2xl bg-white px-2 py-1.5 shadow-md dark:bg-gray-800">
            <input
              v-model="searchQuery"
              placeholder="搜索卡密、描述或使用者..."
              class="farm-input h-8 w-64 border border-gray-300 rounded-xl bg-white px-3 text-sm text-gray-900 outline-none transition-all dark:border-gray-600 focus:border-green-500 dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-green-500/20"
            >
            <select
              v-model="filterStatus"
              class="farm-input border border-gray-300 rounded-xl bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="all">
                全部状态
              </option>
              <option value="unused">
                未使用
              </option>
              <option value="used">
                已使用
              </option>
              <option value="enabled">
                已启用
              </option>
              <option value="disabled">
                已禁用
              </option>
            </select>
          </div>

          <div v-if="selectedCards.size > 0" class="flex items-center gap-3 rounded-lg p-3" style="background-color: rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1);">
            <span style="color: var(--theme-primary);">
              已选择 {{ selectedCards.size }} 个卡密
            </span>
            <BaseButton variant="secondary" size="sm" @click="copySelectedCards">
              一键复制
            </BaseButton>
            <BaseButton variant="danger" size="sm" @click="deleteSelectedCards">
              批量删除
            </BaseButton>
            <button
              class="ml-auto text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700"
              @click="selectedCards.clear(); selectAll = false"
            >
              清除选择
            </button>
          </div>

          <div v-if="cardsLoading" class="py-8 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>加载中...</div>
          </div>

          <div v-else class="card overflow-hidden rounded-2xl bg-white shadow-md dark:bg-gray-800">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead class="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th class="px-3 py-2 text-left">
                      <input
                        v-model="selectAll"
                        type="checkbox"
                        class="border-gray-300 rounded"
                        @change="toggleSelectAll"
                      >
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      卡密
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      描述
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      类型
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      数值
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      状态
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      使用者
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      生成时间
                    </th>
                    <th class="px-4 py-2 text-left text-xs text-gray-500 font-medium dark:text-gray-300">
                      使用时间
                    </th>
                    <th class="px-4 py-2 text-right text-xs text-gray-500 font-medium dark:text-gray-300">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
                  <tr
                    v-for="card in filteredCards"
                    :key="card.code"
                    class="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    :class="isClaimTargetCard(card) ? 'bg-amber-50/80 dark:bg-amber-900/10' : ''"
                  >
                    <td class="px-3 py-2">
                      <input
                        :checked="selectedCards.has(card.code)"
                        type="checkbox"
                        class="border-gray-300 rounded"
                        @change="toggleSelectCard(card.code)"
                      >
                    </td>
                    <td class="whitespace-nowrap px-4 py-2">
                      <div class="flex items-center gap-2">
                        <code class="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700">{{ card.code }}</code>
                        <span
                          v-if="isClaimTargetCard(card)"
                          class="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                        >
                          免费发放中
                        </span>
                      </div>
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-900 dark:text-white">
                      {{ card.description }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2">
                      <span
                        class="inline-flex rounded-full px-2 py-0.5 text-xs"
                        :class="card.type === 'quota' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'"
                      >
                        {{ getCardTypeLabel(card) }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-900 dark:text-white">
                      {{ getCardValueLabel(card) }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2">
                      <span
                        class="inline-flex rounded-full px-2 py-0.5 text-xs"
                        :class="card.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'"
                      >
                        {{ card.enabled ? '启用' : '禁用' }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {{ card.usedBy || '-' }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {{ card.createdAt ? new Date(card.createdAt).toLocaleString() : '-' }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {{ card.usedAt ? new Date(card.usedAt).toLocaleString() : '-' }}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2 text-right text-sm">
                      <button class="mr-2 hover:opacity-80" style="color: var(--theme-primary);" @click="copyCode(card.code)">
                        复制
                      </button>
                      <button class="mr-2 hover:opacity-80" style="color: var(--theme-primary);" @click="toggleCardStatus(card)">
                        {{ card.enabled ? '禁用' : '启用' }}
                      </button>
                      <button class="text-red-600 dark:text-red-400 hover:text-red-900" @click="deleteCard(card)">
                        删除
                      </button>
                    </td>
                  </tr>
                  <tr v-if="filteredCards.length === 0">
                    <td colspan="10" class="px-4 py-4 text-center text-gray-500 dark:text-gray-400">
                      暂无卡密
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div
            v-if="showCreateModal"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showCreateModal = false"
          >
            <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                创建卡密
              </h2>
              <div class="space-y-3">
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    描述
                  </label>
                  <BaseInput
                    v-model="newCard.description"
                    placeholder="例如：月卡-2024"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    卡密类型
                  </label>
                  <div class="flex gap-4">
                    <label class="flex cursor-pointer items-center gap-2">
                      <input
                        v-model="newCard.type"
                        type="radio"
                        value="time"
                        class="text-blue-600 focus:ring-blue-500"
                      >
                      <span class="text-sm text-gray-700 dark:text-gray-300">时间卡（增加使用时长）</span>
                    </label>
                    <label class="flex cursor-pointer items-center gap-2">
                      <input
                        v-model="newCard.type"
                        type="radio"
                        value="quota"
                        class="text-orange-600 focus:ring-orange-500"
                      >
                      <span class="text-sm text-gray-700 dark:text-gray-300">额度卡（增加账号额度）</span>
                    </label>
                  </div>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    {{ newCard.type === 'quota' ? '额度数量' : '天数' }}
                  </label>
                  <BaseInput
                    v-model.number="newCard.days"
                    type="number"
                    :placeholder="newCard.type === 'quota' ? '可添加的账号数量' : '天数'"
                  />
                  <p v-if="newCard.type === 'time'" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    输入-1表示永久，其他数字表示天数
                  </p>
                  <p v-else class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    用户使用后可增加的账号额度数量
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    数量
                  </label>
                  <BaseInput
                    v-model.number="newCard.count"
                    type="number"
                    min="1"
                    max="100"
                    placeholder="数量"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    批量创建数量（1-100），批量创建后会自动导出文件
                  </p>
                </div>
              </div>
              <div class="mt-5 flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showCreateModal = false">
                  取消
                </BaseButton>
                <BaseButton variant="primary" size="sm" @click="createCard">
                  创建
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 用户管理 -->
        <div v-else-if="activeTab === 'user'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              用户管理
            </h3>
            <div class="flex items-center gap-2">
              <BaseButton
                v-if="userStats.expired > 0"
                variant="danger"
                size="sm"
                :disabled="statsLoading"
                @click="showCleanupExpiredConfirm = true"
              >
                清理过期用户
              </BaseButton>
              <BaseButton variant="primary" size="sm" :loading="statsLoading" @click="fetchUserStats">
                刷新统计
              </BaseButton>
              <BaseButton variant="secondary" size="sm" @click="fetchUsers">
                刷新
              </BaseButton>
            </div>
          </div>

          <!-- 用户统计 -->
          <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div class="card border border-gray-200 rounded-2xl bg-white p-4 shadow-md dark:border-gray-700 dark:bg-gray-800">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                总用户
              </div>
              <div class="mt-1 text-2xl text-gray-900 font-bold dark:text-white">
                {{ userStats.total }}
              </div>
            </div>
            <div class="card border border-gray-200 rounded-2xl bg-white p-4 shadow-md dark:border-gray-700 dark:bg-gray-800">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                有效用户
              </div>
              <div class="mt-1 text-2xl text-green-600 font-bold dark:text-green-400">
                {{ userStats.valid }}
              </div>
            </div>
            <div class="card border border-gray-200 rounded-2xl bg-white p-4 shadow-md dark:border-gray-700 dark:bg-gray-800">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                过期用户
              </div>
              <div
                class="mt-1 text-2xl font-bold"
                :class="userStats.expired > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-900 dark:text-white'"
              >
                {{ userStats.expired }}
              </div>
            </div>
            <div class="card border border-gray-200 rounded-2xl bg-white p-4 shadow-md dark:border-gray-700 dark:bg-gray-800">
              <div class="text-xs text-gray-500 dark:text-gray-400">
                封禁 / 无卡
              </div>
              <div
                class="mt-1 text-2xl font-bold"
                :class="userStats.banned > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'"
              >
                {{ userStats.banned }}
              </div>
            </div>
          </div>

          <div v-if="userStats.expired > 0" class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-yellow-700 dark:text-yellow-300" style="background-color: rgba(250, 204, 21, 0.12);">
            <div class="i-carbon-warning-alt" />
            当前有 <span class="font-semibold">{{ userStats.expired }}</span> 个已过期用户，点击右上角「清理过期用户」可批量删除（连同其卡密）。
          </div>

          <div v-if="usersLoading" class="py-8 text-center text-gray-500">
            <div i-svg-spinners-90-ring-with-bg class="mb-2 inline-block text-2xl" />
            <div>加载中...</div>
          </div>

          <div v-else class="card overflow-hidden border border-gray-200 rounded-2xl shadow-md dark:border-gray-700">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead class="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      用户名
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      角色
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      额度
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      时长
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      过期时间
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      状态
                    </th>
                    <th class="px-3 py-2 text-right text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                  <tr v-for="user in users" :key="user.username">
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 font-medium dark:text-white">
                      {{ user.username }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      <span
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="user.role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'"
                      >
                        {{ user.role === 'admin' ? '管理员' : '用户' }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      <span
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="user.role === 'admin' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' : 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'"
                      >
                        {{ user.role === 'admin' ? '无限制' : `${user.accountLimit || 2}个` }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      {{ user.card ? getDaysLabel(user.card.days) : '无' }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm" :class="isExpired(user.card) ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'">
                      {{ formatDate(user.card?.expiresAt || null) }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2">
                      <span
                        v-if="user.card"
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="user.card.enabled === false ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : (isExpired(user.card) ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200')"
                      >
                        {{ user.card.enabled === false ? '封禁' : (isExpired(user.card) ? '已过期' : '正常') }}
                      </span>
                      <span v-else class="text-gray-500 dark:text-gray-400">-</span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-right text-sm font-medium">
                      <button
                        class="mr-3 text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                        @click="openEditModal(user)"
                      >
                        编辑
                      </button>
                      <button
                        v-if="user.card"
                        class="mr-3 text-yellow-600 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-300"
                        @click="toggleUserStatus(user)"
                      >
                        {{ user.card.enabled === false ? '解封' : '封禁' }}
                      </button>
                      <button
                        v-if="user.username !== currentUsername"
                        class="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                        @click="deleteUser(user)"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                  <tr v-if="users.length === 0">
                    <td colspan="8" class="px-3 py-4 text-center text-gray-500 dark:text-gray-400">
                      暂无用户
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div
            v-if="showEditModal"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showEditModal = false"
          >
            <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                编辑用户：{{ selectedUser?.username }}
              </h2>
              <div class="space-y-3">
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    用户名
                  </label>
                  <BaseInput
                    v-model="editForm.newUsername"
                    placeholder="输入新用户名（留空则不修改）"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    用户名只能包含字母、数字和下划线，长度3-32位
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    新密码
                  </label>
                  <BaseInput
                    v-model="editForm.password"
                    type="password"
                    placeholder="输入新密码（留空则不修改）"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    密码长度至少6位，需包含大写字母、小写字母、数字、特殊符号中的至少两种
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    账号额度
                  </label>
                  <BaseInput
                    v-model.number="editForm.accountLimit"
                    type="number"
                    min="1"
                    placeholder="可添加的账号数量"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    用户最多可添加的农场账号数量
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-sm text-gray-700 font-medium dark:text-gray-300">
                    过期时间
                  </label>
                  <div class="flex items-center gap-3">
                    <input
                      v-model="editForm.isPermanent"
                      type="checkbox"
                      class="border-gray-300 rounded text-blue-600 focus:ring-blue-500"
                    >
                    <span class="text-sm text-gray-600 dark:text-gray-400">永久有效</span>
                  </div>
                  <input
                    v-if="!editForm.isPermanent"
                    v-model="editForm.expiresAt"
                    type="datetime-local"
                    class="farm-input mt-2 w-full border border-gray-200 rounded-xl bg-white px-3 py-2 text-sm dark:border-gray-600 focus:border-blue-500 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                </div>
              </div>
              <div class="mt-5 flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showEditModal = false">
                  取消
                </BaseButton>
                <BaseButton
                  variant="primary"
                  size="sm"
                  :disabled="editLoading"
                  @click="handleEdit"
                >
                  {{ editLoading ? '保存中...' : '保存' }}
                </BaseButton>
              </div>
            </div>
          </div>
          <ConfirmModal
            :show="showCleanupExpiredConfirm"
            type="danger"
            title="清理过期用户"
            :message="`确定要删除 ${userStats.expired} 个已过期的用户吗？此操作会连同其卡密一起删除，且不可恢复！`"
            confirm-text="确认清理"
            :loading="cleanupLoading"
            @confirm="confirmCleanupExpired"
            @cancel="showCleanupExpiredConfirm = false"
            @close="showCleanupExpiredConfirm = false"
          />
        </div>

        <!-- 登录日志 -->
        <div v-else-if="activeTab === 'log'" class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
              登录日志
            </h3>
            <div class="flex items-center gap-2">
              <BaseButton
                variant="danger"
                size="sm"
                @click="openClearLogsConfirm"
              >
                清空日志
              </BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                :loading="loginLogsLoading"
                @click="fetchLoginLogs"
              >
                刷新
              </BaseButton>
            </div>
          </div>

          <div class="card overflow-hidden border border-gray-200 rounded-2xl bg-white shadow-md dark:border-gray-700 dark:bg-gray-800">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead class="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      时间
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      事件
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      用户名
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      错误类型
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      IP地址
                    </th>
                    <th class="px-3 py-2 text-left text-xs text-gray-500 font-medium uppercase dark:text-gray-300">
                      浏览器
                    </th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
                  <tr v-if="loginLogsLoading">
                    <td colspan="6" class="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                      加载中...
                    </td>
                  </tr>
                  <tr v-else-if="loginLogs.length === 0">
                    <td colspan="6" class="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                      暂无登录日志
                    </td>
                  </tr>
                  <tr v-for="log in loginLogs" :key="log.id">
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      {{ formatLogTime(log.timestamp) }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2">
                      <span
                        class="inline-flex rounded-full px-2 text-xs font-semibold leading-5"
                        :class="getEventClass(log.event)"
                      >
                        {{ getEventLabel(log.event) }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 font-medium dark:text-white">
                      {{ log.username }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-900 dark:text-white">
                      {{ getErrorTypeLabel(log.errorType) }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-600 font-mono dark:text-gray-300">
                      {{ log.ip }}
                    </td>
                    <td class="whitespace-nowrap px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                      {{ parseBrowser(log.userAgent) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="loginLogsTotal > 0" class="border-t border-gray-200 px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              共 {{ loginLogsTotal }} 条记录
            </div>
          </div>

          <!-- 清空日志确认弹窗 -->
          <div
            v-if="showClearLogsConfirm"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            @click.self="showClearLogsConfirm = false"
          >
            <div class="max-w-md w-full rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800" @click.stop>
              <h2 class="mb-4 text-lg text-gray-900 font-bold dark:text-white">
                确认清空日志
              </h2>
              <p class="mb-4 text-gray-600 dark:text-gray-300">
                确定要清空所有登录日志吗？此操作不可恢复。
              </p>
              <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
                当前共有 {{ loginLogsTotal }} 条记录
              </p>
              <div class="flex justify-end space-x-3">
                <BaseButton variant="secondary" size="sm" @click="showClearLogsConfirm = false">
                  取消
                </BaseButton>
                <BaseButton
                  variant="danger"
                  size="sm"
                  :loading="clearLogsLoading"
                  @click="confirmClearLogs"
                >
                  确认清空
                </BaseButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ConfirmModal
      :show="modalVisible"
      :title="modalConfig.title"
      :message="modalConfig.message"
      :type="modalConfig.type"
      :is-alert="modalConfig.isAlert"
      confirm-text="知道了"
      @confirm="modalVisible = false"
      @cancel="modalVisible = false"
    />
  </div>
</template>

<style scoped lang="postcss">
</style>
