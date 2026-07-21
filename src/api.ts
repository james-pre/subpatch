import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { applyPatchToDir } from './patch.js';
import { debug } from './io.js';

/**
 * Automatically determines the target directory for patching.
 */
export function detectDirectory(): string {
	return process.env.INIT_CWD || process.cwd();
}

export function resolvePackage(directory: string, specifierOrPath: string): string | undefined {
	const pkgJson = join(specifierOrPath, 'package.json');
	return existsSync(pkgJson) ? pkgJson : findPackageJSON(specifierOrPath, join(directory, 'package.json'));
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

export interface PatchConfig {
	/** Path for the dependent of the dependency to be patched */
	source: string;
	/** Directory containing node_modules and root package.json */
	directory: string;
	/** Specifier for the dependency to be patched */
	target: string;
	/** Path to the patch file */
	patchFile: string;
	/** If set, use the built-in `npm patch` functionality. */
	usePatchedDependencies: boolean;
	/** Resolved path to the target dependency's `package.json` */
	targetPath: string;
}

export function patchDependent(config: PatchConfig) {
	const root = join(config.directory, 'package.json');

	const pkg = JSON.parse(readFileSync(config.targetPath, 'utf8'));
	const { version } = pkg;

	const patchPath = resolve('node_modules', config.source, config.patchFile);

	if (config.usePatchedDependencies) {
		const dependant = JSON.parse(readFileSync(root, 'utf8'));
		dependant.patchedDependencies ??= {};
		const key = `${config.target}@${version}`;
		if (dependant.patchedDependencies[key] !== patchPath) {
			dependant.patchedDependencies[key] = patchPath;
			writeFileSync(root, JSON.stringify(dependant, null, '\t') + '\n');
		}
	}

	debug('Patching', config.target, 'v' + version, 'using', patchPath);
	const applied = applyPatchToDir(readFileSync(patchPath, 'utf8'), dirname(config.targetPath));
	console.log(applied ? 'Patched' : 'Skipped', styleText('bold', config.target), 'v' + version, 'using', patchPath);
}

/** Subpatch configuration in package.json */
export interface PackageJsonConfig {
	/** If set, use the built-in `npm patch` functionality. */
	usePatchedDependencies: boolean;
	/** Map of specifier to patch path */
	patches: Record<string, string>;
}

/**
 *
 * @param directory Directory containing node_modules and root package.json for the dependency
 * @param source specifier for the dependency
 */
export function parseDependency(directory: string, source: string, onMissing: (info: PatchConfig) => any): PatchConfig[] {
	const path = resolvePackage(directory, source);

	if (!path || !existsSync(path)) throw new Error('Can not find package.json');

	const pkg = JSON.parse(readFileSync(path, 'utf8'));

	if (!pkg.subpatch) return [];

	const { patches, usePatchedDependencies } = pkg.subpatch as PackageJsonConfig;

	const configs: PatchConfig[] = [];
	for (const [target, patchFile] of Object.entries(patches)) {
		const targetPath = findPackage(target, path, join(directory, 'package.json')) || '';
		const config = { source, target, directory, patchFile, usePatchedDependencies, targetPath };

		if (!targetPath) {
			onMissing(config);
			continue;
		}

		configs.push(config);
	}
	return configs;
}
