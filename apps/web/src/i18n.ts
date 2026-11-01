import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import HttpBackend from 'i18next-http-backend'
import LanguageDetector from 'i18next-browser-languagedetector'

i18next
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    backend: {
      loadPath: `./locales/{{lng}}.json`
    },
    react: {
      useSuspense: true
    },
    fallbackLng: 'en',
    preload: ['en'],
    keySeparator: false,
    interpolation: { escapeValue: false }
  })

// Keep English as the default while respecting a language selected by the user.
// The language detector persists the selection under i18nextLng.
if (typeof window === 'undefined' || !window.localStorage.getItem('i18nextLng')) {
  i18next.changeLanguage('en')
}

export default i18next
