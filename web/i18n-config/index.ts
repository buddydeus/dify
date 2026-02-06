import type { Locale } from '@/i18n-config/language'

import Cookies from 'js-cookie'
import { LOCALE_COOKIE_NAME } from '@/config'
import { changeLanguage } from '@/i18n-config/client'
import { LanguagesSupported } from '@/i18n-config/language'

// 仅允许使用中文，默认界面语言改为 zh-Hans
export const i18n = {
  defaultLocale: 'zh-Hans' as const, // 原 'en-US'
  locales: LanguagesSupported,
} as const

export { Locale }

export const setLocaleOnClient = async (locale: Locale, reloadPage = true) => {
  Cookies.set(LOCALE_COOKIE_NAME, locale, { expires: 365 })
  await changeLanguage(locale)
  if (reloadPage)
    location.reload()
}

export const renderI18nObject = (obj: Record<string, string>, language: string) => {
  if (!obj)
    return ''
  if (obj?.[language])
    return obj[language]
  if (obj?.en_US)
    return obj.en_US
  return Object.values(obj)[0]
}
