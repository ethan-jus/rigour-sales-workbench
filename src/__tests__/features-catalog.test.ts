import { describe, expect, it } from 'vitest';
import { inferGrantedFeatures, SALES_FEATURES } from '@/features/catalog';

describe('Feature Catalog 后台配置映射', () => {
  it('遗留协作权限不能恢复已移除的聊天或授予销售功能', () => {
    const granted = inferGrantedFeatures(['collaboration:im:use'], false);

    expect([...granted]).not.toContain('chat');
    for (const feature of SALES_FEATURES) {
      expect(granted.has(feature)).toBe(false);
    }
  });

  it('管理员和 Mock 模式也不展示已退出的协同功能', () => {
    expect([...inferGrantedFeatures(['*:*:*'], false)]).toEqual(['home', 'profile']);
    expect([...inferGrantedFeatures([], true)]).not.toContain('chat');
  });

  it('销售权限可以按权限映射授予销售拜访能力', () => {
    const granted = inferGrantedFeatures(['sales:visit:own:write'], false);

    expect(granted.has('sales.visit')).toBe(true);
  });
});
