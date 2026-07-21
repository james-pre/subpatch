// Adapted from @npmcli/arborist. Credit to @manzoorwanijk / Claude.

import { applyPatch, parsePatch } from 'diff';
import * as fs from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';

// Strip a leading git-style "a/" or "b/" prefix from a diff path.
const stripPrefix = (file: string) => file.replace(/^[ab]\//, '');

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
function strictApply(source: string, filePatch: any, file: string): string {
	const patched = applyPatch(source, filePatch, { fuzzFactor: 0 });
	if (patched === false) {
		throw patchError(`patch could not be applied to ${file}`, file);
	}
	return patched;
}

// Apply a single parsed file patch under cwd.
// Handles modified, added (--- /dev/null) and deleted (+++ /dev/null) files.
export function applyFilePatch(filePatch: any, cwd: string) {
	const isAdd = isDevNull(filePatch.oldFileName);
	const isDelete = isDevNull(filePatch.newFileName);

	if (isDelete) {
		const file = stripPrefix(filePatch.oldFileName);
		const target = containedTarget(cwd, file);

		let source;
		try {
			source = fs.readFileSync(target, 'utf8');
		} catch {
			throw patchError(`patch target to delete is missing: ${file}`, file);
		}

		strictApply(source, filePatch, file);
		fs.rmSync(target, { force: true });
		return;
	}

	const file = stripPrefix(filePatch.newFileName);
	const target = containedTarget(cwd, file);

	if (isAdd) {
		// a new file must not already exist, otherwise the tarball drifted
		if (fs.existsSync(target)) {
			throw patchError(`patch adds a file that already exists: ${file}`, file);
		}
		const created = strictApply('', filePatch, file);
		fs.mkdirSync(dirname(target), { recursive: true });
		fs.writeFileSync(target, created);
		return;
	}

	const source = fs.readFileSync(target, 'utf8');
	const { mode } = fs.statSync(target);
	const patched = strictApply(source, filePatch, file);
	fs.writeFileSync(target, patched);
	fs.chmodSync(target, mode);
}

/**
 * Apply a unified diff to the package extracted at `cwd`.
 * @param patch Raw diff contents
 * @throws EPATCHFAILED on any hunk or file that cannot be applied.
 */
export function applyPatchToDir(patch: string, cwd: string) {
	const filePatches = parsePatch(patch);
	for (const filePatch of filePatches) {
		// jsdiff emits an empty trailing patch for some inputs; skip those.
		if (!filePatch.hunks.length && isDevNull(filePatch.oldFileName) && isDevNull(filePatch.newFileName)) {
			continue;
		}
		try {
			applyFilePatch(filePatch, cwd);
		} catch (er: any) {
			// re-code raw filesystem errors so a patch failure is never mistaken for an optional-install skip
			if (typeof er?.code === 'string' && er.code.startsWith('EPATCH')) {
				throw er;
			}
			throw Object.assign(new Error(`failed to apply patch: ${er.message}`), { code: 'EPATCHFAILED', cause: er });
		}
	}
}
