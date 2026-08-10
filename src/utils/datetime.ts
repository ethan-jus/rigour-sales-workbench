/**
 * 本地业务日期（YYYY-MM-DD）。
 * 工作日按本地自然天对齐，直接 toISOString 会因 UTC 偏移在前一天/后一天之间跳变。
 */
export function localDate(): string {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** 把 ISO 时间格式化为本地 HH:mm，空值返回占位符。 */
export function formatTime(value: string | null | undefined): string {
  if (!value) return '--:--';
  const date = new Date(value);
  const pad = (part: number) => part.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 把 ISO 时间格式化为本地 YYYY-MM-DD HH:mm。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '--';
  const date = new Date(value);
  const pad = (part: number) => part.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 面向业务人员的分钟时长，避免页面直接显示大整数分钟。 */
export function formatDurationMinutes(value: number | null | undefined): string {
  if (value == null) return '--';
  const minutes = Math.max(0, Math.round(value));
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}小时${remaining}分钟` : `${hours}小时`;
}

/** 米转成便于销售阅读的距离。 */
export function formatDistance(value: number | null | undefined): string {
  if (value == null) return '--';
  if (value < 1_000) return `${Math.round(value)}米`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}公里`;
}
