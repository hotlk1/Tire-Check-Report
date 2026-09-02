import { adminEn } from "./admin.en";

type DeepWiden<T> = { [K in keyof T]: T[K] extends string ? string : DeepWiden<T[K]> };
export type AdminMessages = DeepWiden<typeof adminEn>;
export { adminEn };
