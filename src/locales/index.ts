import { createI18n } from 'vue-i18n'
import type { I18n } from 'vue-i18n'
// GreenGameVault：仅保留简体中文语言包（zh-TW / en / ja 已随非游戏功能裁剪移除）
import zhCN from './zh-CN'

const messages = {
  'zh-CN': zhCN
}

export type MessageSchema = typeof zhCN

const detectSystemLanguage = (): string => {
  return 'zh-CN'
}

const getSavedLanguage = (): string => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('app-language') || detectSystemLanguage()
  }
  return detectSystemLanguage()
}

const i18n: I18n<{ messages: typeof messages }, {}, {}, string, false> = createI18n<{ messages: typeof messages }, string, false>({
  legacy: false,
  locale: getSavedLanguage(),
  fallbackLocale: 'zh-CN',
  messages,
  globalInjection: true
})

export default i18n

export const setLanguage = (lang: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('app-language', lang)
  }
  i18n.global.locale.value = lang as any
}

export const getCurrentLanguage = (): string => {
  return i18n.global.locale.value as string
}

export const availableLanguages = [
  { value: 'zh-CN', label: '简体中文' }
]
