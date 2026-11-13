/// <reference types="vite/client" />

/**
 * 是否启用服务端状态同步，由 vite.config.ts 的 define 注入：
 * `"1"` 启用，`"0"` 禁用。
 *
 * 生产构建恒为 "1"；本地 `npm run dev` 默认 "0"（没有后端，
 * 且避免请求噪声影响既有 Playwright 用例）；联调多端时设置
 * `VITE_API_PROXY` 会变回 "1"。
 */
declare const __REMOTE_SYNC__: "0" | "1"
