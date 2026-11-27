/** Breadcrumb trail click event delivered to a surface when the user clicks a crumb. */
export type TrailClickEvent<TInfo = unknown> = { type: 'TRAIL_CLICK'; target: string; info?: TInfo };
