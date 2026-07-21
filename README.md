# Subpatch

Subpatch is a package designed to help you patch dependents in production. For example, let's say you need to patch `typescript` for an extra feature that will be needed. Since npm's built-in patch functionality explicitly disallows publishing patch information, this means consumers of your package would be missing the patch.

Visually:

```
example-dependent
├─┬ your-package
  └── dependency-needing-patch <-- need to patch this one
```

You can use subpatch by adding a postinstall script and then defining the patches you want to be applied in the `subpatch` field in your package.json:

```json
{
	"scripts": {
		"postinstall": "subpatch"
	},
	"subpatch": {
		"patches": {
			"typescript": "patches/typescript-example-feature.patch"
		}
	}
}
```
