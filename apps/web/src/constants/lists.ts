// Keep the local token list same-origin so the app works on both localhost and
// 127.0.0.1 without triggering a browser CORS failure.
export const DEFAULT_TOKEN_LIST_URL = `${window.location.origin}/tokenlist.json`

export const DEFAULT_LIST_OF_LISTS: string[] = [
  DEFAULT_TOKEN_LIST_URL
]
