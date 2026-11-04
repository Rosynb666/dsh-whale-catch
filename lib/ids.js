/**
 * 会话 id 与归档批次名的唯一校验口径。
 *
 * 这两个值会被拿去拼目录 / 文件名，Host 与台账必须用同一套规则，
 * 否则「路由放行、落盘拒绝」这种错位迟早出一次。
 */

/** 会话 id：只允许字母数字与 `.` `_` `-`，最长 128。 */
export const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/

/** 归档批次目录名：`YYYYMMDD-HHMMSS-mmm`，重名时 `-2` / `-3`。 */
export const RUN_NAME = /^\d{8}-\d{6}-\d{3}(?:-\d+)?$/

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value)
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRunName(value) {
  return typeof value === 'string' && RUN_NAME.test(value)
}
