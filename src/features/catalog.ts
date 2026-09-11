import type { NavigationNodeView } from '@/api/core/iam';

export type AppFeature =
  | 'home'
  | 'chat'
  | 'profile'
  | 'sales.attendance'
  | 'sales.targets'
  | 'sales.visit'
  | 'sales.track'
  | 'sales.policy'
  | 'sales.appeals';

export interface FeatureDefinition {
  feature: AppFeature;
  routeKeys: string[];
  permissionAny: string[];
}

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    feature: 'chat',
    routeKeys: ['workbench.chat', 'workbench.conversation', 'workbench.meeting'],
    permissionAny: ['collaboration:im:use', 'collaboration:meeting:use'],
  },
  {
    feature: 'sales.attendance',
    routeKeys: ['workbench.attendance'],
    permissionAny: ['sales:work-day:write', 'sales:location:write', 'sales:track:own:read'],
  },
  {
    feature: 'sales.targets',
    routeKeys: ['workbench.targets'],
    permissionAny: ['sales:visit-target:read', 'sales:visit-plan:own:read', 'sales:poi:read'],
  },
  {
    feature: 'sales.visit',
    routeKeys: ['workbench.visit'],
    permissionAny: ['sales:visit:own:read', 'sales:visit:own:write'],
  },
  {
    feature: 'sales.track',
    routeKeys: ['workbench.track'],
    permissionAny: ['sales:track:own:read'],
  },
  {
    feature: 'sales.policy',
    routeKeys: ['workbench.policy'],
    permissionAny: ['sales:context:read', 'sales:visit-target:read'],
  },
  {
    feature: 'sales.appeals',
    routeKeys: ['workbench.appeals'],
    permissionAny: ['sales:work-day:write'],
  },
  {
    feature: 'profile',
    routeKeys: ['workbench.profile'],
    permissionAny: [],
  },
];

export const SALES_FEATURES = new Set<AppFeature>([
  'sales.attendance',
  'sales.targets',
  'sales.visit',
  'sales.track',
  'sales.policy',
  'sales.appeals',
]);

export const ROUTE_FEATURES: Record<string, AppFeature> = {
  attendance: 'sales.attendance',
  targets: 'sales.targets',
  visit: 'sales.visit',
  track: 'sales.track',
  policy: 'sales.policy',
  appeals: 'sales.appeals',
  chat: 'chat',
  conversation: 'chat',
  meeting: 'chat',
  profile: 'profile',
};

export function hasPermission(permissions: Iterable<string>, required: string): boolean {
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  return set.has('*:*:*') || set.has(required);
}

export function hasAnyPermission(permissions: Iterable<string>, required: string[]): boolean {
  if (required.length === 0) return true;
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  return set.has('*:*:*') || required.some((permission) => set.has(permission));
}

export function flattenNavigation(nodes: NavigationNodeView[]): NavigationNodeView[] {
  const result: NavigationNodeView[] = [];
  const visit = (node: NavigationNodeView) => {
    result.push(node);
    for (const child of node.children || []) visit(child);
  };
  for (const node of nodes) visit(node);
  return result;
}

export function inferGrantedFeatures(
  permissions: Iterable<string>,
  navigation: NavigationNodeView[],
  mockMode = false,
): Set<AppFeature> {
  const granted = new Set<AppFeature>(['home', 'profile']);
  const permissionSet = permissions instanceof Set ? permissions : new Set(permissions);
  const isAdmin = permissionSet.has('*:*:*');
  if (mockMode || isAdmin) {
    FEATURE_DEFINITIONS.forEach((definition) => granted.add(definition.feature));
    return granted;
  }

  const routeKeys = new Set(
    flattenNavigation(navigation)
      .filter((node) => node.visible !== false && node.type === 'PAGE' && node.routeKey)
      .map((node) => String(node.routeKey)),
  );

  for (const definition of FEATURE_DEFINITIONS) {
    const grantedByNavigation = definition.routeKeys.some((routeKey) => routeKeys.has(routeKey));
    const grantedByPermission = hasAnyPermission(permissionSet, definition.permissionAny);
    if (grantedByNavigation || grantedByPermission) granted.add(definition.feature);
  }
  return granted;
}
