import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { applyPatchToDir } from './patch.js';

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
}

export function patchDependent(config: PatchConfig) {
	const root = join(config.directory, 'package.json');

	const targetPath = findPackageJSON(config.target, root);
	if (!targetPath) throw new Error('Target package not found');
	const pkg = JSON.parse(readFileSync(targetPath, 'utf8'));
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

	console.log('Patching', styleText('bold', config.target), 'v' + version, 'using', patchPath);
	applyPatchToDir(readFileSync(patchPath, 'utf8'), dirname(targetPath));
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
		const config = { source, target, directory, patchFile, usePatchedDependencies };

		const depPath = findPackageJSON(target, join(directory, 'package.json'));
		if (!depPath) {
			onMissing(config);
			continue;
		}

		configs.push(config);
	}
	return configs;
}
