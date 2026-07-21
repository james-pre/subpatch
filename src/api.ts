import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { debug } from './io.js';
import { styleText } from 'node:util';

interface ArboristPatch {
	applyPatchToDir(options: { patch: string; cwd: string }): Promise<void>;
}

let arboristPatch: ArboristPatch = {
	applyPatchToDir() {
		throw new Error('Can not find a valid installation of @npmcli/arborist');
	},
};

const arboristSpec = '@npmcli/arborist/lib/patch.js';
const globalDirs = ['/usr/lib/node_modules/', '/usr/local/lib/node_modules', '/usr/lib/node_modules_24'];

for (const spec of [...globalDirs.map(d => join(d, arboristSpec)), ...globalDirs.map(d => join(d, 'npm/node_modules', arboristSpec)), arboristSpec]) {
	try {
		arboristPatch = await import(spec);
		if (arboristPatch) {
			debug('Found @npmcli/arborist in', spec.replace(arboristSpec, '') || 'local');
			break;
		}
	} catch {
		// probably not installed
	}
}

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

export async function patchDependent(config: PatchConfig) {
	const root = join(config.directory, 'package.json');

	const targetPath = findPackageJSON(config.target, root);
	if (!targetPath) throw new Error('Target package not found');
	const pkg = JSON.parse(readFileSync(targetPath, 'utf8'));
	const { version } = pkg;

	const patchPath = join('node_modules', config.source, config.patchFile);

	if (config.usePatchedDependencies) {
		const dependant = JSON.parse(readFileSync(root, 'utf8'));
		dependant.patchedDependencies ??= {};
		const key = `${config.target}@${version}`;
		if (dependant.patchedDependencies[key] !== patchPath) {
			dependant.patchedDependencies[key] = patchPath;
			writeFileSync(root, JSON.stringify(dependant, null, '\t') + '\n');
		}
	}

	debug('Patching', styleText(['bold', 'dim'], config.target), 'v' + version, 'using', patchPath);
	await arboristPatch.applyPatchToDir({ patch: config.patchFile, cwd: dirname(targetPath) });
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
