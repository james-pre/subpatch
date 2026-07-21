import { existsSync, readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { satisfies as satisfiesSemver } from 'semver';
import type { Patch, PatchInit } from './api.js';
import * as io from './io.js';

export function resolvePackage(rootDir: string, specifierOrPath: string): string | undefined {
	const pkgJson = join(specifierOrPath, 'package.json');
	return existsSync(pkgJson) ? pkgJson : findPackageJSON(specifierOrPath, join(rootDir, 'package.json'));
}

/**
 * Resolve a package's `package.json` by trying each base in order.
 * `findPackageJSON` throws `ERR_MODULE_NOT_FOUND` when a specifier can't be resolved from a base,
 * so each attempt is guarded and we move on to the next base.
 */
function findPackage(specifier: string, ...bases: string[]): string | undefined {
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

/** Subpatch configuration in package.json */
export interface DependencyConfig {
	/** If set, use the built-in `npm patch` functionality. */
	usePatchedDependencies?: boolean;
	/** Map of specifier to patch path */
	patches: Record<string, string | PackageJsonPatch>;
	/** If set, resolve patch paths relative to this directory */
	directory?: string;
}

export interface ParsedDependency {
	/** Specifier for the resolved dependency */
	source: string;
	/** Path to the resolved dependency */
	sourceDir: string;
	patches: Patch[];
	/** If set, patch paths were resolved relative to this directory */
	patchesDir?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MissingDependencyPatchInfo extends Omit<Patch, 'path' | 'targetVersion'> {}

/**
 * @param rootDir Directory containing node_modules and root package.json for the dependency
 * @param sourceInit specifier or path for the dependency
 */
export function parseDependency(
	rootDir: string,
	sourceInit: string,
	onMissing: (info: MissingDependencyPatchInfo) => unknown
): ParsedDependency {
	const sourcePath = resolvePackage(rootDir, sourceInit);

	if (!sourcePath || !existsSync(sourcePath)) throw new Error('Can not find package.json');

	const pkg = JSON.parse(readFileSync(sourcePath, 'utf8'));

	const source = pkg.name,
		sourceDir = dirname(sourcePath);

	if (!pkg.subpatch) return { source, sourceDir, patches: [] };

	const { patches: _patches, usePatchedDependencies, directory: patchesDir } = pkg.subpatch as DependencyConfig;

	const optionsConfig: Patch[] = [];
	for (const [target, patchesInit] of Object.entries(_patches)) {
		const targetPath = findPackage(target, sourcePath, join(rootDir, 'package.json')) || '',
			targetDir = dirname(targetPath);

		const patchConfigs = parsePatchInit(patchesInit);

		if (!targetPath) {
			if (patchConfigs.every(p => p.optional))
				onMissing({ source, sourceDir, target, rootDir, targetDir, usePatchedDependencies });
			else
				io.warn(
					`Skipping optional patches for missing dependency "${target}": ${patchConfigs.map(p => p.path).join(', ')}`
				);
			continue;
		}

		const { version: targetVersion } = JSON.parse(readFileSync(targetPath, 'utf8'));

		for (const patchConfig of patchConfigs) {
			const path = patchesDir ? join(patchesDir, patchConfig.path) : patchConfig.path;
			if (patchConfig.version && !satisfiesSemver(targetVersion, patchConfig.version)) {
				io.error(`Skipping patch ${path} because it is not compatible with ${target} v${targetVersion}`);
				continue;
			}

			optionsConfig.push({
				...patchConfig,
				sourceDir,
				target,
				rootDir,
				path,
				usePatchedDependencies,
				targetDir,
				targetVersion,
			});
		}
	}

	return { source, sourceDir, patches: optionsConfig, patchesDir };
}
