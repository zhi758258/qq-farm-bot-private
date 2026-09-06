<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import AnnouncementModal from '@/components/AnnouncementModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

declare const __APP_VERSION__: string

const LOWERCASE_RE = /[a-z]/
const UPPERCASE_RE = /[A-Z]/
const DIGIT_RE = /\d/
const SPECIAL_CHAR_RE = /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'/`~]/
const USERNAME_RE = /^\w+$/
const QQ_RE = /^\d{5,11}$/

const userStore = useUserStore()
const appStore = useAppStore()
const toastStore = useToastStore()
const appVersion = __APP_VERSION__
const gameVersion = ref('')

const isLogin = ref(true)
const username = ref('')
const password = ref('')
const cardCode = ref('')
const qq = ref('')
const error = ref('')
const success = ref('')
const loading = ref(false)
const showPasswordStrength = ref(false)
const lockoutRemaining = ref(0)
const rateLimitRemaining = ref(0)

const showGroupVerifyModal = ref(false)
const groupVerifyContent = ref({
  qq: '',
  qqGroupNumber: '',
})

const cardClaimEnabled = ref(false)
const cardClaimLoading = ref(false)
const showClaimModal = ref(false)
const claimModalContent = ref({
  success: true,
  title: '',
  message: '',
  cardCode: '',
  days: 0,
})

const passwordStrength = computed(() => {
  const pwd = password.value
  if (!pwd)
    return { score: 0, level: '', color: '', valid: false }

  let score = 0

  if (pwd.length >= 6)
    score++
  if (pwd.length >= 10)
    score++

  let typeCount = 0
  if (LOWERCASE_RE.test(pwd))
    typeCount++
  if (UPPERCASE_RE.test(pwd))
    typeCount++
  if (DIGIT_RE.test(pwd))
    typeCount++
  if (SPECIAL_CHAR_RE.test(pwd))
    typeCount++

  if (typeCount >= 2)
    score += 2
  if (typeCount >= 3)
    score++
  if (typeCount >= 4)
    score++

  const commonPasswords = ['password', '123456', 'qwerty', 'abc123', '111111']
  if (commonPasswords.some(p => pwd.toLowerCase().includes(p)))
    score = Math.max(0, score - 2)

  const level = score <= 2 ? '弱' : score <= 4 ? '中' : score <= 6 ? '强' : '非常强'
  const color = score <= 2 ? '#ef5350' : score <= 4 ? '#ffa726' : score <= 6 ? '#22c55e' : '#16a34a'
  const valid = pwd.length >= 6 && typeCount >= 2

  return { score, level, color, valid }
})

const usernameValid = computed(() => {
  const name = username.value
  if (!name)
    return { valid: false, message: '' }
  if (name.length < 3)
    return { valid: false, message: '用户名至少3位' }
  if (name.length > 32)
    return { valid: false, message: '用户名最多32位' }
  if (!USERNAME_RE.test(name))
    return { valid: false, message: '只能包含字母、数字、下划线' }
  return { valid: true, message: '' }
})

const qqValid = computed(() => {
  const value = qq.value
  if (!value)
    return { valid: false, message: '' }
  if (!QQ_RE.test(value))
    return { valid: false, message: 'QQ号应为5-11位数字' }
  return { valid: true, message: '' }
})

watch(password, () => {
  if (!isLogin.value && password.value)
    showPasswordStrength.value = true
})

function validateForm(): boolean {
  if (!username.value) {
    error.value = '请输入用户名'
    return false
  }

  if (!usernameValid.value.valid) {
    error.value = usernameValid.value.message
    return false
  }

  if (!password.value) {
    error.value = '请输入密码'
    return false
  }

  if (!isLogin.value) {
    if (password.value.length < 6) {
      error.value = '密码长度至少6位'
      return false
    }

    if (!passwordStrength.value.valid) {
      error.value = '密码强度不足：需包含大写字母、小写字母、数字、特殊符号中的至少两种'
      return false
    }

    if (!cardCode.value) {
      error.value = '请输入卡密'
      return false
    }

    if (!qq.value) {
      error.value = '请输入QQ号（填写的QQ必须已加入QQ群）'
      return false
    }

    if (!QQ_RE.test(qq.value)) {
      error.value = 'QQ号应为5-11位数字'
      return false
    }
  }

  return true
}

function applyLoginError(result: any) {
  if (result?.code === 'NOT_IN_GROUP') {
    groupVerifyContent.value = {
      qq: result.qq || '',
      qqGroupNumber: result.qqGroupNumber || '',
    }
    showGroupVerifyModal.value = true
    error.value = result.error || '请先加入QQ群后再登录'
  }
  else if (result?.errorType === 'rate_limit' || result?.code === 'RATE_LIMIT') {
    error.value = result.error || '请求过于频繁，请稍后重试'
    const ms = result.remainingMs
    if (ms)
      rateLimitRemaining.value = Math.ceil(ms / 1000)
  }
  else if (result?.code === 'BANNED' || result?.code === 'EXPIRED') {
    error.value = result.error || '账号不可用'
  }
  else if (result?.errorType === 'locked' || result?.lockout?.locked) {
    error.value = result.error || '账号已被锁定'
    const ms = result.remainingMs || result?.lockout?.lockRemainingMs
    if (ms)
      lockoutRemaining.value = Math.ceil(ms / 1000 / 60)
  }
  else {
    error.value = result.error || '登录失败'
  }
}

async function handleSubmit() {
  if (!validateForm())
    return

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    if (isLogin.value) {
      const result: any = await userStore.login(username.value, password.value)
      if (result.ok) {
        if (result.data?.mustChangePassword)
          success.value = '登录成功！请修改默认密码以确保账户安全'
        else
          success.value = '登录成功，正在跳转...'
        setTimeout(() => {
          window.location.href = '/'
        }, 500)
      }
      else {
        applyLoginError(result)
      }
    }
    else {
      const result: any = await userStore.register(username.value, password.value, cardCode.value, qq.value)
      if (result.ok) {
        success.value = '注册成功，请登录'
        isLogin.value = true
        cardCode.value = ''
        password.value = ''
        qq.value = ''
      }
      else {
        error.value = result.error || '注册失败'
      }
    }
  }
  catch (e: any) {
    const data = e.response?.data
    if (data)
      applyLoginError(data)
    else
      error.value = e.message || '操作异常'
  }
  finally {
    loading.value = false
  }
}

function toggleMode() {
  isLogin.value = !isLogin.value
  error.value = ''
  success.value = ''
  showPasswordStrength.value = false
  lockoutRemaining.value = 0
  rateLimitRemaining.value = 0
}

function closeGroupVerifyModal() {
  showGroupVerifyModal.value = false
}

function handleJoinGroup() {
  const url = appStore.loginPageConfig.qqGroupUrl
  if (!url) {
    toastStore.warning('加群链接暂未配置，请联系管理员', 4000)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function checkCardClaimStatus() {
  try {
    const res = await api.get('/api/card-claim/status')
    if (res.data.ok) {
      cardClaimEnabled.value = res.data.data?.enabled === true
    }
  }
  catch (e) {
    console.error('检查卡密领取状态失败:', e)
  }
}

async function claimFreeCard() {
  if (cardClaimLoading.value)
    return

  cardClaimLoading.value = true
  error.value = ''

  try {
    const res = await api.post('/api/card-claim/claim')

    if (res.data.ok) {
      const d = res.data.data
      cardCode.value = d.cardCode
      claimModalContent.value = {
        success: true,
        title: '领取成功',
        message: `成功领取 ${d.days} 天卡密！`,
        cardCode: d.cardCode,
        days: d.days,
      }
      showClaimModal.value = true
    }
    else {
      claimModalContent.value = {
        success: false,
        title: '领取失败',
        message: res.data.error || '领取失败，请稍后重试',
        cardCode: '',
        days: 0,
      }
      showClaimModal.value = true
    }
  }
  catch (e: any) {
    const data = e.response?.data
    claimModalContent.value = {
      success: false,
      title: '领取失败',
      message: data?.error || e.message || '领取失败',
      cardCode: '',
      days: 0,
    }
    showClaimModal.value = true
  }
  finally {
    cardClaimLoading.value = false
  }
}

function closeClaimModal() {
  showClaimModal.value = false
}

async function fetchGameVersion() {
  try {
    const res = await api.get('/api/game-version')
    if (res.data.ok) {
      gameVersion.value = res.data.clientVersion
    }
  }
  catch (e) {
    console.error('获取游戏版本失败:', e)
  }
}

onMounted(() => {
  appStore.fetchLoginPageConfig()
  checkCardClaimStatus()
  fetchGameVersion()
})
</script>

<template>
  <div class="login-page">
    <!-- Login Card -->
    <div class="login-card">
      <!-- Logo -->
      <div class="login-logo">
        <div v-if="appStore.loginPageConfig.logoUrl" class="login-logo-img">
          <img :src="appStore.loginPageConfig.logoUrl" :alt="`${appStore.loginPageConfig.title || 'QQ农场智能助手'}logo`">
        </div>
        <div v-else class="login-logo-icon">
          <div class="i-carbon-sprout text-3xl text-white" />
        </div>
        <h1 class="login-title">
          {{ appStore.loginPageConfig.title || 'QQ农场智能助手' }}
        </h1>
        <p class="login-subtitle">
          {{ isLogin ? appStore.loginPageConfig.loginSubtitle : appStore.loginPageConfig.registerSubtitle }}
        </p>
      </div>

      <!-- Form -->
      <form class="login-form" @submit.prevent="handleSubmit">
        <div class="form-field">
          <label class="form-label">
            <div class="i-carbon-user text-sm opacity-50" />
            用户名
          </label>
          <BaseInput
            id="username"
            v-model="username"
            type="text"
            placeholder="请输入用户名"
            required
          />
          <p v-if="username && !usernameValid.valid" class="form-hint error">
            {{ usernameValid.message }}
          </p>
        </div>

        <div class="form-field">
          <label class="form-label">
            <div class="i-carbon-locked text-sm opacity-50" />
            密码
          </label>
          <BaseInput
            id="password"
            v-model="password"
            type="password"
            placeholder="请输入密码"
            required
          />
          <div v-if="showPasswordStrength && password" class="password-strength">
            <div class="strength-bar">
              <div
                class="strength-fill"
                :style="{ width: `${Math.min(passwordStrength.score * 12.5, 100)}%`, backgroundColor: passwordStrength.color }"
              />
            </div>
            <span class="strength-text" :style="{ color: passwordStrength.color }">
              {{ passwordStrength.level }}
            </span>
          </div>

          <div v-if="error" class="message error-message">
            {{ error }}
            <span v-if="lockoutRemaining > 0" class="lockout-timer">
              ({{ lockoutRemaining }} 分钟后解锁)
            </span>
            <span v-if="rateLimitRemaining > 0" class="lockout-timer">
              ({{ rateLimitRemaining }} 秒后可重试)
            </span>
          </div>
          <div v-if="success" class="message success-message">
            {{ success }}
          </div>
        </div>

        <div v-if="!isLogin" class="form-field">
          <label class="form-label">
            <div class="i-carbon-ticket text-sm opacity-50" />
            卡密
          </label>

          <div v-if="cardClaimEnabled" class="mb-2">
            <button
              type="button"
              class="btn btn-primary btn-sm w-full"
              :disabled="cardClaimLoading"
              @click="claimFreeCard"
            >
              <span v-if="cardClaimLoading" class="i-svg-spinners-90-ring-with-bg animate-spin" />
              <template v-else>
                <div class="i-carbon-gift text-sm" />
                <span>免费领取卡密</span>
              </template>
            </button>
          </div>

          <BaseInput
            id="cardCode"
            v-model="cardCode"
            type="text"
            placeholder="请输入卡密"
            :required="!isLogin"
          />
        </div>

        <div v-if="!isLogin" class="form-field">
          <label class="form-label">
            <div class="i-carbon-identification text-sm opacity-50" />
            QQ号
          </label>
          <BaseInput
            id="qq"
            v-model="qq"
            type="text"
            placeholder="请输入QQ号"
            :required="!isLogin"
          />
          <p class="form-hint error font-semibold">
            重要：填写的 QQ 一定要加群，否则登录不了！
          </p>
          <p v-if="qq && !qqValid.valid" class="form-hint error">
            {{ qqValid.message }}
          </p>
        </div>

        <BaseButton
          type="submit"
          variant="primary"
          block
          :loading="loading"
          size="lg"
        >
          {{ isLogin ? '登录' : '注册' }}
        </BaseButton>
      </form>

      <!-- Switch -->
      <div class="login-switch">
        <button type="button" class="text-sm opacity-50 transition-opacity hover:opacity-80" @click="toggleMode">
          {{ isLogin ? '没有账号？立即注册' : '已有账号？立即登录' }}
        </button>
      </div>

      <!-- Footer -->
      <div class="login-footer">
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs opacity-30">
            v{{ appVersion }}
            <template v-if="appStore.loginPageConfig.purchaseUrl">
              <span class="mx-1">|</span>
              <a
                :href="appStore.loginPageConfig.purchaseUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="transition-opacity hover:opacity-80"
              >购买卡密</a>
            </template>
          </div>
          <div v-if="gameVersion" class="text-xs opacity-25">
            游戏版本：{{ gameVersion }}
          </div>
        </div>
        <button
          type="button"
          class="mx-auto mt-2.5 flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all hover:opacity-85 hover:shadow-sm"
          style="color: var(--theme-primary); background: color-mix(in srgb, var(--theme-primary) 12%, transparent);"
          :title="appStore.loginPageConfig.qqGroupUrl ? '点击加入QQ群' : '加群链接暂未配置'"
          @click="handleJoinGroup"
        >
          <img
            src="/qq-group.png"
            alt="加QQ群"
            class="h-6 w-6 rounded-full object-cover ring-1 ring-white/60 dark:ring-black/30"
          >
          <span>加QQ群</span>
        </button>
      </div>
    </div>

    <!-- Claim Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showGroupVerifyModal"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          @click.self="closeGroupVerifyModal"
        >
          <div class="w-[360px] rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-800">
            <div class="mb-4 text-center">
              <div class="mx-auto mb-2 h-14 w-14 flex items-center justify-center overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-gray-200 dark:ring-gray-700">
                <img
                  src="/qq-group.png"
                  alt="QQ群"
                  class="h-full w-full object-cover"
                >
              </div>
              <h3 class="text-lg font-semibold">
                请先加入QQ群
              </h3>
            </div>
            <div class="mb-4 text-center text-sm opacity-70">
              您的QQ未通过加群验证，加入QQ群后才能登录使用。
            </div>
            <div class="mb-4 rounded-lg bg-slate-50 p-3 text-center text-sm dark:bg-slate-700/50">
              <div v-if="groupVerifyContent.qq" class="mb-1 text-xs opacity-50">
                当前绑定QQ：{{ groupVerifyContent.qq }}
              </div>
              <div v-if="groupVerifyContent.qqGroupNumber" class="mb-1 text-xs opacity-50">
                QQ群号：{{ groupVerifyContent.qqGroupNumber }}
              </div>
              <div class="text-xs opacity-50">
                加群后返回此页面重新登录即可
              </div>
            </div>
            <button
              class="btn btn-primary btn-block"
              @click="handleJoinGroup"
            >
              加入QQ群
            </button>
            <button class="btn btn-primary btn-block mt-2" @click="closeGroupVerifyModal">
              我知道了
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Claim Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showClaimModal"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          @click.self="closeClaimModal"
        >
          <div class="w-[360px] rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-800">
            <div class="mb-4 text-center">
              <div class="mb-2" :class="claimModalContent.success ? 'i-carbon-checkmark text-4xl text-green-500' : 'i-carbon-warning text-4xl text-red-500'" />
              <h3 class="text-lg font-semibold">
                {{ claimModalContent.title }}
              </h3>
            </div>
            <div class="mb-4 text-center text-sm opacity-70">
              {{ claimModalContent.message }}
            </div>
            <div v-if="claimModalContent.success && claimModalContent.cardCode" class="mb-4 rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-700/50">
              <div class="mb-1 text-xs opacity-50">
                卡密已自动填入
              </div>
              <div class="break-all text-sm font-medium font-mono" :style="{ color: 'var(--theme-primary)' }">
                {{ claimModalContent.cardCode }}
              </div>
            </div>
            <button class="btn btn-primary btn-block" @click="closeClaimModal">
              {{ claimModalContent.success ? '开始注册' : '我知道了' }}
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <AnnouncementModal />
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 50%, #f0fdf4 100%);
  padding: 20px;
}

.dark .login-page {
  background: linear-gradient(135deg, #022c22 0%, #064e3b 50%, #022c22 100%);
}

.login-card {
  width: 100%;
  max-width: 400px;
  padding: 40px 32px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 16px;
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.06),
    0 1px 4px rgba(0, 0, 0, 0.04);
  backdrop-filter: blur(12px);
}

.dark .login-card {
  background: rgba(30, 41, 59, 0.95);
  border-color: rgba(255, 255, 255, 0.06);
}

.login-logo {
  text-align: center;
  margin-bottom: 32px;
}

.login-logo-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--theme-gradient);
  margin-bottom: 16px;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--theme-primary) 25%, transparent);
}

.login-logo-img {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 16px;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--theme-primary) 25%, transparent);
}

.login-logo-img img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.login-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--theme-primary);
  margin-bottom: 4px;
}

.login-subtitle {
  font-size: 0.875rem;
  opacity: 0.5;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  font-weight: 600;
  opacity: 0.6;
}

.form-hint {
  font-size: 0.75rem;
  opacity: 0.5;
}

.form-hint.error {
  color: #ef4444;
  opacity: 1;
}

.password-strength {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.strength-bar {
  flex: 1;
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  overflow: hidden;
}

.strength-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.strength-text {
  font-size: 0.75rem;
  font-weight: 500;
  min-width: 50px;
}

.lockout-timer {
  display: block;
  font-size: 0.75rem;
  opacity: 0.6;
  margin-top: 2px;
}

.message {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.error-message {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

.success-message {
  background: #f0fdf4;
  color: #16a34a;
  border: 1px solid #bbf7d0;
}

.login-switch {
  text-align: center;
  margin-top: 20px;
}

.login-footer {
  text-align: center;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.dark .login-footer {
  border-top-color: rgba(255, 255, 255, 0.06);
}

.modal-enter-active,
.modal-leave-active {
  transition: all 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .login-card,
.modal-leave-to .login-card {
  transform: scale(0.95);
}
</style>
