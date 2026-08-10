/** 生成幂等键/设备事件 ID；优先使用 crypto.randomUUID，退化到时间戳+随机串。 */
export function createIdempotencyKey(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
