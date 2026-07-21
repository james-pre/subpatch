import { existsSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { basename, join } from 'node:path';
import type { PatchInit } from './api.js';

/**
 * Resolves the package.json path for a given specifier or path using and root directory
 */
export function resolvePackage(rootDir: string, specifierOrPath: string): string | undefined {
	const pkgJson =
		basename(specifierOrPath) === 'package.json' ? specifierOrPath : join(specifierOrPath, 'package.json');
	return existsSync(pkgJson) ? pkgJson : findPackageJSON(specifierOrPath, join(rootDir, 'package.json'));
}

/**
 * Resolve a package's `package.json` by trying each base in order.
 * `findPackageJSON` throws `ERR_MODULE_NOT_FOUND` when a specifier can't be resolved from a base,
 * so each attempt is guarded and we move on to the next base.
 */
export function findPackage(specifier: string, ...bases: string[]): string | undefined {
	for (const base of bases) {
		try {
			const path = findPackageJSON(specifier, base);
			if (path) return path;
		} catch {
			// Not resolvable from this base; try the next one.
		}
	}
}

export type PackageJsonPatch = string | PatchInit | (string | PatchInit)[];

export function parsePatchInit(init: PackageJsonPatch): PatchInit[] {
	const patches = Array.isArray(init) ? init : [init];
	return patches.map(p => (typeof p == 'string' ? { path: p } : p));
}
