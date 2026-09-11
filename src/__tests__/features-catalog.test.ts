import { describe, expect, it } from 'vitest';
import { inferGrantedFeatures, SALES_FEATURES } from '@/features/catalog';

describe('Feature Catalog 后台配置映射', () => {
  it('只有协作权限时不授予销售外勤功能', () => {
    const granted = inferGrantedFeatures(['collaboration:im:use'], [], false);

    expect(granted.has('chat')).toBe(true);
    for (const feature of SALES_FEATURES) {
      expect(granted.has(feature)).toBe(false);
    }
  });

  it('销售权限可以按权限映射授予销售拜访能力', () => {
    const granted = inferGrantedFeatures(['sales:visit:own:write'], [], false);

    expect(granted.has('sales.visit')).toBe(true);
  });
});
