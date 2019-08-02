import * as findRoot from 'find-root'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export default function ownPackage(): any {
	const root = findRoot(__dirname)
	const pkgFile = join(root, 'package.json')

	if (!existsSync(pkgFile)) {
		throw new Error(`no package.json found in "${root}"`)
	}

	return JSON.parse(readFileSync(pkgFile, 'utf8'))
}
