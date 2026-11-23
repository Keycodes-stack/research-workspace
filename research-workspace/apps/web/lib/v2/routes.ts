/** Base path of the app. The app lives at the root (the old /v2 prefix was removed with the old app). */
export const V2 = "";

/** Link to a project: its slug when it has one (spec /projects/[slug]), otherwise its id. Both work in the API. */
export const projectHref = (p: { id: string; slug?: string | null }) => `${V2}/projects/${p.slug || p.id}`;
