#!/usr/bin/env node
import { relative } from 'node:path';
import { parseArgs, styleText, type ParseArgsConfig } from 'node:util';
import { formatPatch, patchDependent } from './api.js';
import { parseDependency } from './config.js';
import * as io from './io.js';

const defaultDirectory = process.env.INIT_CWD || process.cwd();

const parseArgsConfig = {
	options: {
		directory: { short: 'd', type: 'string', default: defaultDirectory },
		debug: { type: 'boolean' },
		help: { short: 'h', type: 'boolean' },
	},
	allowPositionals: true,
	strict: true,
} as const satisfies ParseArgsConfig;

const usageText = `Usage: subpatch [command] [options]

Commands:
    [apply]     Apply configured patches (default)
    ls, list    List configured patches
    help        Show this help message

Options:
    -d, --directory <path>  The directory to work with, like npm prefix. (default=${defaultDirectory})
    --debug                 Show debug output
    -h, --help              Show this help message
`;

let _parsed: ReturnType<typeof parseArgs<typeof parseArgsConfig>>;

try {
	_parsed = parseArgs(parseArgsConfig);
} catch (e) {
	io.error(io.errorText(e));
	console.error(usageText);
	process.exit(1);
}

const { values: options, positionals: args } = _parsed;

if (options.help) {
	console.log(usageText);
	process.exit(0);
}

io.debug(`INIT_CWD=${JSON.stringify(process.env.INIT_CWD)}, cwd=${JSON.stringify(process.cwd())}, directory=${JSON.stringify(options.directory)}`);

const { patches, patchesDir } = parseDependency(options.directory, process.cwd(), info =>
	io.warn('Missing dependency', JSON.stringify(info.target), 'of', JSON.stringify(info.source))
);

switch (args[0] ?? 'apply') {
	case 'ls':
	case 'list':
		for (const [target, targetPatches] of Object.entries(Object.groupBy(patches, p => p.target))) {
			if (!targetPatches?.length) continue;
			const { targetDir, targetVersion } = targetPatches[0];
			const relTarget = relative(options.directory, targetDir);
			console.log(styleText('bold', target) + styleText('dim', '@' + targetVersion), '->', styleText('dim', relTarget.startsWith('../') ? targetDir : relTarget));
			for (const patch of targetPatches) console.log('    ' + formatPatch(patch, patchesDir));
		}
		break;
	case 'apply':
		for (const patch of patches) patchDependent(patch);
		break;
	case 'help':
		console.log(usageText);
		break;
	default:
		console.error(usageText);
		process.exit(1);
}
