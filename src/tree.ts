import { existsSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { styleText } from 'node:util';
import { formatPackage, formatPatch } from './api.js';
import { findPackage, resolvePackage } from './config.js';
import { parseDependency, type Dependency, type DependencyCallback } from './dependency.js';

/** A package in the dependency tree that (transitively) contains subpatch patches. */
export interface DependencyTree extends Dependency {
	/** Dependencies that themselves contain patches somewhere below */
	children: DependencyTree[];
}

/** The dependency fields walked when descending the tree. */
const depFields = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

function dependencyNames(pkg: Dependency, includeDev: boolean): Set<string> {
	const fields = includeDev ? [...depFields, 'devDependencies'] : depFields;
	const names = new Set<string>();
	for (const field of fields) {
		const deps = pkg[field];
		if (deps && typeof deps == 'object') for (const name of Object.keys(deps)) names.add(name);
	}
	return names;
}

/** Remove branches that contain no patches anywhere below them. */
function prune(node: DependencyTree): void {
	node.children = node.children.filter(child => {
		prune(child);
		return child.targets.length || child.children.length;
	});
}

/**
 * Walk the dependency tree rooted at `at`.
 *
 * @param rootDir Directory containing node_modules and the root package.json
 * @param at specifier or path for the package at the root of the (sub)tree
 */
export function buildDependencyTree(
	rootDir: string,
	at: string,
	onMissing?: DependencyCallback,
	seen: Set<string> = new Set()
): DependencyTree {
	const rootPath = resolvePackage(rootDir, at);
	if (!rootPath || !existsSync(rootPath)) throw new Error('Can not find package.json');

	const makeNode = (path: string): DependencyTree =>
		Object.assign(parseDependency(rootDir, dirname(path), onMissing), { children: [] as DependencyTree[] });

	const root = makeNode(rootPath);
	seen.add(realpathSync(dirname(rootPath)));

	const queue: { node: DependencyTree; path: string; isRoot: boolean }[] = [
		{ node: root, path: rootPath, isRoot: true },
	];

	while (queue.length) {
		const { node, path, isRoot } = queue.shift()!;
		for (const name of dependencyNames(node, isRoot)) {
			const depPath = findPackage(name, path);
			if (!depPath) continue;

			const realDir = realpathSync(dirname(depPath));
			if (seen.has(realDir)) continue;
			seen.add(realDir);

			const child = makeNode(depPath);
			node.children.push(child);
			queue.push({ node: child, path: depPath, isRoot: false });
		}
	}

	prune(root);
	return root;
}

/** Render a dependency tree using box-drawing characters, like `tree` or `npm ls`. */
export function* formatDependencyTree(tree: DependencyTree, _patchesDir?: string): Generator<string> {
	yield formatPackage(tree);

	const lastItem = (tree.targets.length ? tree.targets : tree.children).at(-1);

	for (const child of tree.children) {
		const last = lastItem === child;

		const [branch, indent] = last ? ['└── ', '    '] : ['├── ', '│   '];

		yield* formatDependencyTree(child, _patchesDir).map(
			(line, i) => styleText('dim', i === 0 ? branch : indent) + line
		);
	}

	for (const target of tree.targets) {
		const last = lastItem === target;
		const [branch, indent] = last ? ['└── ', '    '] : ['├── ', '│   '];

		yield styleText('dim', branch) + formatPackage(target);
		for (const patch of target.patches) {
			yield styleText('dim', indent + (patch === target.patches[0] ? branch : indent)) +
				formatPatch(patch, _patchesDir);
		}
	}
}
