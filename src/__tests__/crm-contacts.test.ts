import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import Vant from 'vant';
import StoreContacts from '@/components/StoreContacts.vue';
import { crmContactsApi, type StoreContact } from '@/api/core/crm-contacts';

vi.mock('@/api/core/crm-contacts', () => ({
  crmContactsApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    link: vi.fn(),
    addMethod: vi.fn(),
    verify: vi.fn(),
    reception: vi.fn(),
    saveReception: vi.fn(),
    changes: vi.fn(),
  },
}));
vi.mock('@/api/core/crm-customers', () => ({ crmCustomersApi: { list: vi.fn() } }));
const response = <T>(data: T) => ({ code: 'OK', data, message: '', timestamp: '', requestId: '' });
const person: StoreContact = {
  id: '10',
  name: '王店长',
  role: '店长',
  primary: true,
  status: 'ACTIVE',
  revision: 1,
  personRevision: 1,
  wecomRelations: [],
  methods: [
    {
      id: '20',
      type: 'PHONE',
      value: '13800000001',
      status: 'PENDING',
      revision: 1,
      verificationMethod: null,
      verifiedAt: null,
      verifiedBy: null,
    },
  ],
};
let page: VueWrapper;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(crmContactsApi.list).mockResolvedValue(response([person]));
  vi.mocked(crmContactsApi.reception).mockResolvedValue(response([]));
  vi.mocked(crmContactsApi.saveReception).mockResolvedValue(response([]));
});
afterEach(() => page?.unmount());
function setup(props = {}) {
  page = mount(StoreContacts, {
    props: { storeId: '100', ...props },
    global: { plugins: [Vant], stubs: { teleport: true } },
  });
  return flushPromises();
}
function button(label: string) {
  return page.findAll('button').find((b) => b.text() === label)!;
}
async function field(label: string, value: string) {
  const input = page
    .findAllComponents({ name: 'VanField' })
    .find((f) => f.props('label') === label)!;
  input.vm.$emit('update:modelValue', value);
  await page.vm.$nextTick();
}
it('待核实电话明确展示；只读用户不能录入、核验或关联', async () => {
  await setup({ editable: false });
  expect(page.text()).toContain('待核实');
  expect(page.text()).toContain('主要联系人');
  for (const label of ['新增联系人', '编辑关系', '核验', '补联系方式'])
    expect(button(label)).toBeUndefined();
});
it('无留资允许保存空接待人；重试复用原请求标识', async () => {
  await setup({ visitId: '300' });
  const exposed = page.vm as unknown as { saveReception(): Promise<void> };
  vi.mocked(crmContactsApi.saveReception).mockRejectedValueOnce(new Error('网络中断'));
  await expect(exposed.saveReception()).rejects.toThrow('网络中断');
  await exposed.saveReception();
  const calls = vi.mocked(crmContactsApi.saveReception).mock.calls;
  expect(calls[0][2].contactIds).toEqual([]);
  expect(calls[1][2].requestId).toBe(calls[0][2].requestId);
});
it('创建需电话，网络重试不重复建联系人，手填微信仅作为线索', async () => {
  await setup();
  await button('新增联系人').trigger('click');
  await flushPromises();
  await field('姓名 / 称呼', '小李');
  await field('本店角色', '前台');
  await button('保存').trigger('click');
  await flushPromises();
  expect(crmContactsApi.create).not.toHaveBeenCalled();
  await field('电话', '13800000002');
  await field('微信线索', '小李微信');
  vi.mocked(crmContactsApi.create)
    .mockRejectedValueOnce(new Error('网络中断'))
    .mockResolvedValue(response(person));
  await button('保存').trigger('click');
  await flushPromises();
  await button('保存').trigger('click');
  await flushPromises();
  const calls = vi.mocked(crmContactsApi.create).mock.calls;
  expect(calls[1][1]).toEqual(calls[0][1]);
  expect(calls[0][1]).toMatchObject({
    name: '小李',
    role: '前台',
    phone: '13800000002',
    wechatHint: '小李微信',
  });
});
it('已提交拜访展示当时快照，不用后来改名的联系人替换', async () => {
  vi.mocked(crmContactsApi.reception).mockResolvedValue(
    response([{ ...person, name: '历史称呼', role: '前台' }]),
  );
  await setup({ visitId: '300', submitted: true });
  expect(page.text()).toContain('本次接待：历史称呼（前台）');
  expect(page.findAllComponents({ name: 'VanCheckboxGroup' })).toHaveLength(0);
  await (page.vm as unknown as { saveReception(): Promise<void> }).saveReception();
  expect(crmContactsApi.saveReception).not.toHaveBeenCalled();
});
it('门店切换后权限失败清空上一门店资料并禁止提交接待人', async () => {
  await setup({ visitId: '300' });
  vi.mocked(crmContactsApi.list).mockRejectedValue(new Error('无权限'));
  await page.setProps({ storeId: '101' });
  await flushPromises();
  expect(page.text()).not.toContain('王店长');
  expect(page.text()).toContain('无权限');
  await expect(
    (page.vm as unknown as { saveReception(): Promise<void> }).saveReception(),
  ).rejects.toThrow('无权限');
});
