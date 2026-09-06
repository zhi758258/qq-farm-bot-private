import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import api from '@/api'

export interface UserCard {
  code: string
  description: string
  days: number
  expiresAt: string | number | null
  enabled: boolean
}

export interface User {
  username: string
  role: 'user' | 'admin' | 'super_admin'
  card: UserCard | null
  accountLimit: number
  qq?: string
  avatar?: string
  mustChangePassword?: boolean
}

export interface LoginResult {
  ok: boolean
  error?: string
  code?: string
  errorType?: 'rate_limit' | 'locked' | 'invalid_credentials'
  remainingMs?: number
  qqGroupNumber?: string
  qq?: string
  lockout?: {
    locked?: boolean
    remainingAttempts?: number
    lockRemainingMs?: number
  }
  data?: {
    token: string
    role?: string
    card?: UserCard | null
    accountLimit?: number
    qq?: string
    mustChangePassword?: boolean
    user: {
      username: string
      role: string
      card: UserCard | null
      accountLimit: number
      qq?: string
      mustChangePassword?: boolean
    }
  }
}

export interface Card {
  code: string
  description: string
  days: number
  type: string
  enabled: boolean
  status: string
  usedBy: string | null
  usedAt: string | null
  createdAt: string
  expiresAt?: string | null
}

function toTimestamp(value: string | number | null | undefined): number {
  if (!value)
    return 0
  if (typeof value === 'number')
    return value
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? 0 : t
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  const userInfo = useStorage<User | null>('user_info', null)
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => userInfo.value?.role === 'admin' || userInfo.value?.role === 'super_admin')
  const isSuperAdmin = computed(() => userInfo.value?.role === 'super_admin')
  const username = computed(() => userInfo.value?.username || '')
  const userCard = computed(() => userInfo.value?.card)
  const accountLimit = computed(() => userInfo.value?.accountLimit ?? 2)
  const avatar = computed(() => userInfo.value?.avatar || '')

  // 检查用户是否过期
  const isExpired = computed(() => {
    if (!userInfo.value?.card?.expiresAt)
      return false
    return Date.now() > toTimestamp(userInfo.value.card.expiresAt)
  })

  // 获取过期时间显示
  const expireTimeText = computed(() => {
    if (!userInfo.value?.card)
      return '无卡密'
    if (userInfo.value.card.days === -1)
      return '永久有效'
    if (!userInfo.value.card.expiresAt)
      return '未激活'
    const date = new Date(toTimestamp(userInfo.value.card.expiresAt))
    if (Number.isNaN(date.getTime()))
      return '未激活'
    return date.toLocaleString('zh-CN')
  })

  async function login(username: string, password: string): Promise<LoginResult> {
    try {
      const res = await api.post('/api/login', { username, password })
      if (res.data.ok) {
        token.value = res.data.data.token
        const u = res.data.data.user
        userInfo.value = {
          username: u.username,
          role: u.role,
          card: u.card,
          accountLimit: u.accountLimit ?? 2,
          qq: u.qq,
          mustChangePassword: res.data.data.mustChangePassword ?? u.mustChangePassword,
        }
      }
      return res.data
    }
    catch (error: any) {
      const data = error.response?.data
      if (data) {
        return {
          ok: false,
          error: data.error,
          code: data.code,
          errorType: data.errorType,
          remainingMs: data.remainingMs,
          qqGroupNumber: data.qqGroupNumber,
          qq: data.qq,
          lockout: data.lockout,
        }
      }
      return { ok: false, error: error.message || '网络错误' }
    }
  }

  async function register(username: string, password: string, cardCode: string, qq: string) {
    const res = await api.post('/api/register', { username, password, cardCode, qq })
    return res.data
  }

  async function logout() {
    try {
      await api.post('/api/logout')
    }
    finally {
      token.value = ''
      userInfo.value = null
    }
  }

  async function fetchUserInfo() {
    try {
      const res = await api.get('/api/user/me')
      if (res.data.ok) {
        const d = res.data.data
        userInfo.value = {
          username: d.username,
          role: d.role,
          card: d.card,
          accountLimit: d.accountLimit ?? 2,
          avatar: d.avatar,
          mustChangePassword: d.mustChangePassword,
        }
      }
      return res.data
    }
    catch {
      return { ok: false }
    }
  }

  async function renew(cardCode: string) {
    const res = await api.post('/api/user/renew', { cardCode })
    if (res.data.ok && userInfo.value) {
      if (res.data.data.card)
        userInfo.value.card = res.data.data.card
      if (typeof res.data.data.accountLimit === 'number')
        userInfo.value.accountLimit = res.data.data.accountLimit
    }
    return res.data
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    const res = await api.post('/api/user/change-password', { oldPassword, newPassword })
    if (res.data.ok && userInfo.value)
      userInfo.value.mustChangePassword = false
    return res.data
  }

  // 管理员功能
  async function getAllUsers() {
    const res = await api.get('/api/admin/users')
    return res.data
  }

  async function getUserStats() {
    const res = await api.get('/api/admin/users/stats')
    return res.data
  }

  async function cleanupExpiredUsers(dryRun = false) {
    const res = await api.post('/api/admin/users/cleanup-expired', { dryRun })
    return res.data
  }

  async function getLoginLogs() {
    const res = await api.get('/api/admin/login-logs')
    return res.data
  }

  async function clearLoginLogs() {
    const res = await api.delete('/api/admin/login-logs')
    return res.data
  }

  async function editUser(username: string, updates: Record<string, any>) {
    const res = await api.post(`/api/admin/users/${username}/edit`, updates)
    return res.data
  }

  async function updateUser(username: string, updates: Partial<User>) {
    const res = await api.post(`/api/admin/users/${username}`, updates)
    return res.data
  }

  async function deleteUser(username: string) {
    const res = await api.delete(`/api/admin/users/${username}`)
    return res.data
  }

  async function renewUser(username: string, cardCode: string) {
    const res = await api.post(`/api/admin/users/${username}/renew`, { cardCode })
    return res.data
  }

  async function getAllCards() {
    const res = await api.get('/api/admin/cards')
    return res.data
  }

  async function createCard(description: string, days: number, count?: number, type?: string) {
    const res = await api.post('/api/admin/cards', { description, days, count, type })
    return res.data
  }

  async function updateCard(code: string, updates: Partial<Card>) {
    const res = await api.post(`/api/admin/cards/${code}`, updates)
    return res.data
  }

  async function deleteCard(code: string) {
    const res = await api.delete(`/api/admin/cards/${code}`)
    return res.data
  }

  async function deleteCardsBatch(codes: string[]) {
    const res = await api.post('/api/admin/cards/batch-delete', { codes })
    return res.data
  }

  return {
    token,
    userInfo,
    isLoggedIn,
    isAdmin,
    isSuperAdmin,
    username,
    userCard,
    accountLimit,
    avatar,
    isExpired,
    expireTimeText,
    login,
    register,
    logout,
    fetchUserInfo,
    renew,
    changePassword,
    getAllUsers,
    getUserStats,
    cleanupExpiredUsers,
    getLoginLogs,
    clearLoginLogs,
    editUser,
    updateUser,
    deleteUser,
    renewUser,
    getAllCards,
    createCard,
    updateCard,
    deleteCard,
    deleteCardsBatch,
  }
})
