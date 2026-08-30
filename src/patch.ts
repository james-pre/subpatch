// Adapted from @npmcli/arborist. Credit to @manzoorwanijk / Claude.

import { applyPatch, parsePatch, reversePatch, type StructuredPatch } from 'diff';
import * as fs from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import * as io from './io.js';
import { styleText } from 'node:util';

// Strip a leading git-style "a/" or "b/" prefix from a diff path.
const stripPrefix = (file?: string) => file?.replace(/^[ab]\//, '') || '';

// True when a diff path points at /dev/null, signalling a file add or delete.
const isDevNull = (file?: string) => !file || file === '/dev/null' || /(^|\/)\.dev\/null$/.test(file);

const patchError = (message: string, file: string, code: string = 'EPATCHFAILED') =>
	Object.assign(new Error(message), { code, file });

export interface MergeResult {
	/** The file content, with a conflict region in place of every hunk that would not apply */
	text: string;
	/** The conflict regions on their own, each headed by where in the file it belongs */
	conflicts: string[];
}

/**
 * Apply what can be applied and leave `git`-style conflict markers for the rest, like `git apply --3way`.
 * @param label Names the patch on the `>>>>>>>` side
 */
export function mergeFilePatch(source: string, filePatch: StructuredPatch, label: string): MergeResult {
	const file = stripPrefix(filePatch.newFileName);
	const conflicts: string[] = [];

	let text = source,
		delta = 0;

	for (const hunk of filePatch.hunks) {
		const single: StructuredPatch = { ...filePatch, hunks: [hunk] };

		const applied = applyPatch(text, single, { fuzzFactor: 0 });
		if (applied !== false) {
			text = applied;
			delta += hunk.newLines - hunk.oldLines;
			continue;
		}

		if (applyPatch(text, reversePatch(single), { fuzzFactor: 0 }) !== false) {
			delta += hunk.newLines - hunk.oldLines;
			continue;
		}

		const lines = text.split('\n');

		const start = Math.min(Math.max(hunk.oldStart - 1 + delta, 0), lines.length);

		const ours = lines.slice(start, start + hunk.oldLines);
		const theirs = hunk.lines.filter(line => line[0] != '-').map(line => line.slice(1));

		const block = [`<<<<<<< installed`, ...ours, '=======', ...theirs, `>>>>>>> ${label}`];

		conflicts.push(styleText('bold', `${file}:${start + 1}\n`) + block.join('\n'));

		lines.splice(start, ours.length, ...block);
		delta += block.length - ours.length;
		text = lines.join('\n');
	}

	return { text, conflicts };
}

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

export interface ApplyPatchOptions {
	label?: string;
	writeConflicts?: boolean;
}

const conflictMarkers = /^<{7}[ \t].+^={7}$.+^>{7}[ \t]/ms;

/**
 * Apply a single parsed file patch under cwd.
 * Handles modified, added (--- /dev/null) and deleted (+++ /dev/null) files.
 * @returns whether the patch was applied or skipped
 */
export function applyFilePatch(filePatch: StructuredPatch, cwd: string, options: ApplyPatchOptions): boolean {
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

	if (!fs.existsSync(target)) throw patchError(`patch modifies ${file}, which does not exist in the package`, file);

	const source = fs.readFileSync(target, 'utf8');

	if (conflictMarkers.test(source))
		throw patchError(`${file} has unresolved conflict markers from an earlier failed patch`, file);

	if (applyPatch(source, reversePatch(filePatch), { fuzzFactor: 0 }) !== false) {
		io.debug(`Skipping ${file}: already applied`);
		return false;
	}

	const { mode } = fs.statSync(target);
	const patched = applyPatch(source, filePatch, { fuzzFactor: 0 });

	if (patched === false) {
		const { text, conflicts } = mergeFilePatch(source, filePatch, options.label || 'patch');

		if (!options.writeConflicts)
			throw patchError(`patch could not be applied to ${file}\n` + conflicts.join('\n\n'), file);

		fs.writeFileSync(target, text);
		fs.chmodSync(target, mode);
		throw patchError(`patch could not be applied to ${target} (wrote conflicts)`, file);
	}

	fs.writeFileSync(target, patched);
	fs.chmodSync(target, mode);
	return true;
}

/**
 * Apply a unified diff to the package extracted at `cwd`.
 * @param patch Raw diff contents
 * @returns whether the patch was applied or skipped
 */
export function applyPatchToDir(patch: string, cwd: string, options: ApplyPatchOptions): boolean {
	const filePatches = parsePatch(patch);
	let applied = 0,
		skipped = 0;
	for (const filePatch of filePatches) {
		// jsdiff emits an empty trailing patch for some inputs; skip those.
		if (!filePatch.hunks.length && isDevNull(filePatch.oldFileName) && isDevNull(filePatch.newFileName)) {
			continue;
		}
		try {
			const result = applyFilePatch(filePatch, cwd, options);
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
