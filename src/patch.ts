// Adapted from @npmcli/arborist. Credit to @manzoorwanijk / Claude.

import { applyPatch, parsePatch, reversePatch, type StructuredPatch } from 'diff';
import * as fs from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import * as io from './io.js';

// Strip a leading git-style "a/" or "b/" prefix from a diff path.
const stripPrefix = (file?: string) => file?.replace(/^[ab]\//, '') || '';

// True when a diff path points at /dev/null, signalling a file add or delete.
const isDevNull = (file?: string) => !file || file === '/dev/null' || /(^|\/)\.dev\/null$/.test(file);

const patchError = (message: string, file: string, code: string = 'EPATCHFAILED') => Object.assign(new Error(message), { code, file });

// Resolve a diff path under cwd and refuse anything that escapes the package directory.
function containedTarget(cwd: string, file: string) {
	const target = resolve(cwd, file);
	const rel = relative(cwd, target);
	if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
		throw patchError(`patch path escapes the package directory: ${file}`, file, 'EPATCHUNSAFE');
	}
	return target;
}

// Run a parsed file patch against a source string with fuzz 0.
// Returns the patched text, or throws EPATCHFAILED on any context mismatch.
function strictApply(source: string, filePatch: StructuredPatch, file: string): string {
	const patched = applyPatch(source, filePatch, { fuzzFactor: 0 });
	if (patched === false) {
		throw patchError(`patch could not be applied to ${file}`, file);
	}
	return patched;
}

/**
 * Apply a single parsed file patch under cwd.
 * Handles modified, added (--- /dev/null) and deleted (+++ /dev/null) files.
 * @returns whether the patch was applied or skipped
 */
export function applyFilePatch(filePatch: StructuredPatch, cwd: string): boolean {
	const isAdd = isDevNull(filePatch.oldFileName);
	const isDelete = isDevNull(filePatch.newFileName);

	if (isDelete) {
		const file = stripPrefix(filePatch.oldFileName);
		const target = containedTarget(cwd, file);

		// The file is already gone: the deletion has already been applied.
		if (!fs.existsSync(target)) {
			io.debug(`Skipping ${file}: already deleted`);
			return false;
		}

		const source = fs.readFileSync(target, 'utf8');
		strictApply(source, filePatch, file);
		fs.rmSync(target, { force: true });
		return true;
	}

	const file = stripPrefix(filePatch.newFileName);
	const target = containedTarget(cwd, file);

	if (isAdd) {
		const created = strictApply('', filePatch, file);
		if (fs.existsSync(target)) {
			// Already holds exactly what we would create: the addition has already been applied.
			if (fs.readFileSync(target, 'utf8') === created) {
				io.debug(`Skipping ${file}: already created`);
				return false;
			}
			throw patchError(`patch adds a file that already exists: ${file}`, file);
		}
		fs.mkdirSync(dirname(target), { recursive: true });
		fs.writeFileSync(target, created);
		return true;
	}

	const source = fs.readFileSync(target, 'utf8');

	if (applyPatch(source, reversePatch(filePatch), { fuzzFactor: 0 }) !== false) {
		io.debug(`Skipping ${file}: already applied`);
		return false;
	}

	const { mode } = fs.statSync(target);
	const patched = strictApply(source, filePatch, file);
	fs.writeFileSync(target, patched);
	fs.chmodSync(target, mode);
	return true;
}

/**
 * Apply a unified diff to the package extracted at `cwd`.
 * @param patch Raw diff contents
 * @returns whether the patch was applied or skipped
 */
export function applyPatchToDir(patch: string, cwd: string): boolean {
	const filePatches = parsePatch(patch);
	let applied = 0,
		skipped = 0;
	for (const filePatch of filePatches) {
		// jsdiff emits an empty trailing patch for some inputs; skip those.
		if (!filePatch.hunks.length && isDevNull(filePatch.oldFileName) && isDevNull(filePatch.newFileName)) {
			continue;
		}
		try {
			const result = applyFilePatch(filePatch, cwd);
			result ? applied++ : skipped++;
		} catch (er: any) {
			// re-code raw filesystem errors so a patch failure is never mistaken for an optional-install skip
			if (typeof er?.code === 'string' && er.code.startsWith('EPATCH')) {
				throw er;
			}
			throw Object.assign(new Error(`failed to apply patch: ${er.message}`), { code: 'EPATCHFAILED', cause: er });
		}
	}

	if (applied && skipped) io.warn('Patch was only partially applied, some files where already patched');

	return !!applied;
}
