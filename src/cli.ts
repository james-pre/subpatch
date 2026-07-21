#!/usr/bin/env node
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { formatPatch, formatPackage, patchDependent } from './api.js';
import { parseDependency } from './dependency.js';
import { buildDependencyTree, formatDependencyTree } from './tree.js';
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
    tree        Show all subpatch patches, including in dependencies
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

const debugValues = [
	['INIT_CWD', process.env.INIT_CWD],
	['cwd', process.cwd()],
	['directory', options.directory],
];
io.debug(debugValues.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', '));

const { patches, patchesDir, targets } = parseDependency(options.directory, process.cwd());

switch (args[0] ?? 'apply') {
	case 'tree': {
		const tree = buildDependencyTree(options.directory, process.cwd());
		for (const line of formatDependencyTree(tree, patchesDir)) console.log(line);
		break;
	}
	case 'ls':
	case 'list':
		for (const target of targets) {
			console.log(formatPackage(target));
			for (const patch of target.patches) console.log('    ' + formatPatch(patch, patchesDir));
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
