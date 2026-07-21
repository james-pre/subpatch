// SPDX-License-Identifier: LGPL-3.0-or-later
// Copied from ioium

import { styleText } from 'node:util';

function* maybeStyle(style: Parameters<typeof styleText>[0], parts: any[]): Generator<string> {
	for (const part of parts) {
		if (typeof part != 'string') yield part;
		else if (part.startsWith('\x1b')) yield part;
		else yield styleText(style, part);
	}
}

export function debug(...args: unknown[]) {
	if (!process.env.DEBUG && !process.argv.includes('--debug')) return;
	console.debug(...maybeStyle('dim', args));
}

export function error(...args: unknown[]) {
	console.error(...maybeStyle('red', args));
}

export function warn(...args: unknown[]) {
	console.error(...maybeStyle('red', args));
}

export function errorText(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export function exit(message: unknown, code: number = 1): never {
	if (typeof message == 'number') {
		code = message;
		message = 'Unknown error!';
	}
	error(errorText(message));
	process.exit(code);
}
