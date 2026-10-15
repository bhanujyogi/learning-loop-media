export const PROJECT_REF: string;
export const FUNCTIONS: string[];
export function migrationName(file: string): string;
export function pendingMigrations(files: string[], appliedNames: string[]): string[];
export function isSafeEmail(e: unknown): boolean;
export function roleSql(email: string): string;
export function includeInBundle(path: string): boolean;
export function assertProject(ref: string): void;
