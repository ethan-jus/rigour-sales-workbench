export type AppFeature =
  | 'home'
  | 'profile'
  | 'sales.attendance'
  | 'sales.targets'
  | 'sales.visit'
  | 'sales.track'
  | 'sales.policy'
  | 'sales.appeals';

export interface FeatureDefinition {
  feature: AppFeature;
  permissionAny: string[];
}

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    feature: 'sales.attendance',
    permissionAny: ['sales:work-day:write', 'sales:location:write', 'sales:track:own:read'],
  },
  {
    feature: 'sales.targets',
    permissionAny: ['sales:visit-target:read', 'sales:visit-plan:own:read', 'sales:poi:read'],
  },
  {
    feature: 'sales.visit',
    permissionAny: ['sales:visit:own:read', 'sales:visit:own:write'],
  },
  {
    feature: 'sales.track',
    permissionAny: ['sales:track:own:read'],
  },
  {
    feature: 'sales.policy',
    permissionAny: ['sales:context:read', 'sales:visit-target:read'],
  },
  {
    feature: 'sales.appeals',
    permissionAny: ['sales:work-day:write'],
  },
  {
    feature: 'profile',
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
  profile: 'profile',
};

export function hasPermission(permissions: Iterable<string>, required: string): boolean {
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  return set.has(required);
}

export function hasAnyPermission(permissions: Iterable<string>, required: string[]): boolean {
  if (required.length === 0) return true;
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  return required.some((permission) => set.has(permission));
}

export function inferGrantedFeatures(
  permissions: Iterable<string>,
  mockMode = false,
): Set<AppFeature> {
  const granted = new Set<AppFeature>(['home', 'profile']);
  const permissionSet = permissions instanceof Set ? permissions : new Set(permissions);
  if (mockMode) {
    FEATURE_DEFINITIONS.forEach((definition) => granted.add(definition.feature));
    return granted;
  }

  for (const definition of FEATURE_DEFINITIONS) {
    const grantedByPermission = hasAnyPermission(permissionSet, definition.permissionAny);
    if (grantedByPermission) granted.add(definition.feature);
  }
  return granted;
}
