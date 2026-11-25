/** Host-selected APIs and attributed action views sharing one accepted runtime lifetime. */
export interface PackServiceAccess {
  readonly services: Readonly<Record<string, unknown>>;
  readonly servicesForAction: (label: string) => Readonly<Record<string, unknown>>;
}
