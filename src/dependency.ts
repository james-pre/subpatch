import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { satisfies as satisfiesSemver } from 'semver';
import type { PackageInfo, Patch, PatchedPackageInfo } from './api.js';
import { findPackage, parsePatchInit, resolvePackage, type PackageJsonPatch } from './config.js';
import * as io from './io.js';

/** Subpatch configuration in package.json */
export interface DependencyConfig {
	/** If set, use the built-in `npm patch` functionality. */
	usePatchedDependencies?: boolean;
	/** Map of specifier to patch path */
	patches: Record<string, string | PackageJsonPatch>;
	/** If set, resolve patch paths relative to this directory */
	directory?: string;
}

export interface Dependency extends PackageInfo {
	patches: Patch[];
	targets: PatchedPackageInfo[];
	/** If set, patch paths were resolved relative to this directory */
	patchesDir?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DependencyCallbackInfo extends Omit<Patch, 'path' | 'targetVersion'> {}

export interface DependencyCallback {
	(info: DependencyCallbackInfo): unknown;
}

function defaultMissingCallback(info: DependencyCallbackInfo) {
	io.warn('Missing dependency', JSON.stringify(info.target), 'of', JSON.stringify(info.source));
}

/**
 * @param rootDir Directory containing node_modules and root package.json for the dependency
 * @param sourceInit specifier or path for the dependency
 */
export function parseDependency(
	rootDir: string,
	sourceInit: string,
	onMissing: DependencyCallback = defaultMissingCallback
): Dependency {
	const sourcePath = resolvePackage(rootDir, sourceInit);

	if (!sourcePath || !existsSync(sourcePath)) throw new Error('Can not find package.json');

	const pkg = JSON.parse(readFileSync(sourcePath, 'utf8'));

	const source = { name: pkg.name, version: pkg.version, dir: dirname(sourcePath) };

	if (!pkg.subpatch) return { ...source, targets: [], patches: [] };

	const { patches: _patches, usePatchedDependencies, directory: patchesDir } = pkg.subpatch as DependencyConfig;

	const patches: Patch[] = [],
		targets: PatchedPackageInfo[] = [];
	for (const [name, patchesInit] of Object.entries(_patches)) {
		const targetPath = findPackage(name, sourcePath, join(rootDir, 'package.json')) || '',
			dir = dirname(targetPath);

		const target: PackageInfo = { name, dir };

		const patchConfigs = parsePatchInit(patchesInit);

		if (!targetPath) {
			if (patchConfigs.every(p => p.optional)) onMissing({ source, target, rootDir, usePatchedDependencies });
			else
				io.warn(
					`Skipping optional patches for missing dependency "${target.name}": ${patchConfigs.map(p => p.path).join(', ')}`
				);
			continue;
		}

		const { version } = JSON.parse(readFileSync(targetPath, 'utf8'));
		target.version = version;

		const targetPatches: Patch[] = [];

		for (const patchConfig of patchConfigs) {
			const path = patchesDir ? join(patchesDir, patchConfig.path) : patchConfig.path;
			if (patchConfig.version && !satisfiesSemver(version, patchConfig.version)) {
				io.error(`Skipping patch ${path} because it is not compatible with ${name} v${version}`);
				continue;
			}

			const patch = {
				...patchConfig,
				source,
				target,
				rootDir,
				path,
				usePatchedDependencies,
			};

			patches.push(patch);
			targetPatches.push(patch);
		}

		targets.push({ ...target, patches: targetPatches });
	}

	return { ...source, targets, patches, patchesDir };
}
