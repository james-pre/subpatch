import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { styleText } from 'node:util';
import * as io from './io.js';
import { applyPatchToDir } from './patch.js';

export interface PatchInit {
	/** The path to the patch file */
	path: string;
	/** If set and the dependency is missing, the patch will be skipped */
	optional?: boolean;
	/** A semver range to limit the patch to */
	version?: string;
}

export interface PackageInfo {
	/** Specifier */
	name: string;
	/** Usually in node_modules */
	dir: string;
	version?: string;
}

export function formatPackage(target: PackageInfo, rootDir?: string): string {
	let text = styleText('bold', target.name);
	if (target.version) text += styleText('dim', '@' + target.version);
	if (rootDir) {
		const relTarget = relative(rootDir, target.dir);
		text += `-> ${styleText('dim', relTarget.startsWith('../') ? target.dir : relTarget)}`;
	}
	return text;
}

export interface Patch extends PatchInit {
	/** Directory containing node_modules and root package.json */
	rootDir: string;
	/** The dependent of the dependency to be patched */
	source: PackageInfo;
	/** The dependency to be patched */
	target: PackageInfo;
	/** If set, use the built-in `npm patch` functionality. */
	usePatchedDependencies?: boolean;
}

export function formatPatch(patch: Patch, patchesDir?: string): string {
	let text = patchesDir ? styleText('dim', patchesDir + '/') + relative(patchesDir, patch.path) : patch.path;
	if (patch.version) text += styleText('blue', ' ' + patch.version);
	if (patch.optional) text += styleText('green', ' optional');
	return text;
}

export function patchDependent(patch: Patch) {
	const root = join(patch.rootDir, 'package.json');

	const patchPath = resolve('node_modules', patch.source.dir, patch.path);

	if (patch.usePatchedDependencies) {
		const dependant = JSON.parse(readFileSync(root, 'utf8'));
		dependant.patchedDependencies ??= {};
		const key = `${patch.target.name}@${patch.target.version}`;
		if (dependant.patchedDependencies[key] !== patchPath) {
			dependant.patchedDependencies[key] = patchPath;
			writeFileSync(root, JSON.stringify(dependant, null, '\t') + '\n');
		}
	}

	io.debug('Patching', patch.target.name, 'v' + patch.target.version, 'using', patchPath);
	const applied = applyPatchToDir(readFileSync(patchPath, 'utf8'), patch.target.dir);
	console.log(
		applied ? 'Patched' : styleText('yellow', 'Skipped'),
		styleText('bold', patch.target.name),
		'v' + patch.target.version,
		'using',
		patchPath
	);
}

export interface PatchedPackageInfo extends PackageInfo {
	/** The patches applied to this package */
	patches: Patch[];
}

export function groupByTarget(patches: Patch[]): PatchedPackageInfo[] {
	const targets: PatchedPackageInfo[] = [];
	for (const targetPatches of Object.values(Object.groupBy(patches, p => p.target.name))) {
		if (!targetPatches?.length) continue;
		targets.push({ ...targetPatches[0].target, patches: targetPatches });
	}
	return targets;
}
