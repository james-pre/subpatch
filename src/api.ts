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

export interface Patch extends PatchInit {
	/** Directory containing node_modules and root package.json */
	rootDir: string;
	/** Path to the dependent of the dependency to be patched */
	sourceDir: string;
	/** Specifier for the dependent of the dependency to be patched */
	source?: string;
	/** Specifier for the dependency to be patched */
	target: string;
	/** If set, use the built-in `npm patch` functionality. */
	usePatchedDependencies?: boolean;

	// These are for re-using already computed values.
	/** Resolved path to the target dependency's `package.json` */
	targetDir: string;
	/** The version of the target dependency */
	targetVersion: string;
}

export function formatPatch(patch: Patch, patchesDir?: string): string {
	let text = patchesDir ? styleText('dim', patchesDir + '/') + relative(patchesDir, patch.path) : patch.path;
	if (patch.version) text += styleText('blue', ' ' + patch.version);
	if (patch.optional) text += styleText('green', ' optional');
	return text;
}

export function formatPatchTarget(patch: Patch, includePath?: boolean): string {
	const { rootDir, target, targetDir, targetVersion } = patch;
	let text = styleText('bold', target) + styleText('dim', '@' + targetVersion);
	if (includePath) {
		const relTarget = relative(rootDir, targetDir);
		text += `-> ${styleText('dim', relTarget.startsWith('../') ? targetDir : relTarget)}`;
	}
	return text;
}

export function patchDependent(patch: Patch) {
	const root = join(patch.rootDir, 'package.json');

	const patchPath = resolve('node_modules', patch.sourceDir, patch.path);

	if (patch.usePatchedDependencies) {
		const dependant = JSON.parse(readFileSync(root, 'utf8'));
		dependant.patchedDependencies ??= {};
		const key = `${patch.target}@${patch.targetVersion}`;
		if (dependant.patchedDependencies[key] !== patchPath) {
			dependant.patchedDependencies[key] = patchPath;
			writeFileSync(root, JSON.stringify(dependant, null, '\t') + '\n');
		}
	}

	io.debug('Patching', patch.target, 'v' + patch.targetVersion, 'using', patchPath);
	const applied = applyPatchToDir(readFileSync(patchPath, 'utf8'), patch.targetDir);
	console.log(
		applied ? 'Patched' : styleText('yellow', 'Skipped'),
		styleText('bold', patch.target),
		'v' + patch.targetVersion,
		'using',
		patchPath
	);
}
