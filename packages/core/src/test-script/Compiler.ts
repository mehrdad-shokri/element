import {
	ITestScript,
	TestScriptError,
	TestScriptOptions,
	TestScriptDefaultOptions,
	ErrorWrapper,
	unwrapError,
} from '../TestScript'
import { CategorisedDiagnostics } from './TypescriptDiagnostics'
import * as ts from 'typescript'
import * as path from 'path'
import { existsSync, readFileSync } from 'fs'
import { VMScript } from 'vm2'
import * as parseComments from 'comment-parser'
import { SourceUnmapper } from './SourceUnmapper'
import * as debugFactory from 'debug'

const debug = debugFactory('element:test-script:compiler')

const elementRoot = require.resolve('@flood/element')
debug('elementRoot', elementRoot)

const floodelementRoot = path.join(__dirname, '../..')
const sandboxPath = 'test-script-sandbox'
const sandboxRoot = path.join(floodelementRoot, sandboxPath)
const sandboxedBasenameTypescript = 'flood-chrome.ts'
const sandboxedBasenameJavascript = 'flood-chrome.js'

// handle e.g. during dev/test vs built/dist mode
let indexModuleFile: string
const indexTypescriptFile = path.join(floodelementRoot, 'index.ts')
const indexDeclarationsFile = path.join(floodelementRoot, 'index.d.ts')

if (existsSync(indexTypescriptFile)) {
	indexModuleFile = indexTypescriptFile
} else if (existsSync(indexDeclarationsFile)) {
	indexModuleFile = indexDeclarationsFile
} else {
	throw new Error('unable to find index.ts or index.d.ts')
}

// manually find @types/node
const nodeTypesPath = (require.resolve.paths('@types/node') || [])
	.map(p => path.resolve(p, '@types/node'))
	.find(existsSync)

if (nodeTypesPath === undefined) {
	throw new Error('unable to find @types/node')
}

const nodeTypesPkg = JSON.parse(readFileSync(path.resolve(nodeTypesPath, 'package.json'), 'utf8'))
const nodeTypesVersion = nodeTypesPkg.version

const nodeTypeReference = {
	primary: false,
	resolvedFileName: path.join(nodeTypesPath, 'index.d.ts'),
	packageId: {
		name: '@types/node',
		subModuleName: 'index.d.ts',
		version: nodeTypesVersion,
	},
}

const NoModuleImportedTypescript = `Test scripts must import the module '@flood/element'
Please add an import as follows:

import { suite } from '@flood/element'
`

const NoModuleImportedJavascript = `Test scripts must import the module '@flood/element'
Please add an import as follows:

import { suite } from '@flood/element'
`

const FloodChromeErrors = {
	NoModuleImportedTypescript,
	NoModuleImportedJavascript,
}

const defaultCompilerOptions: ts.CompilerOptions = {
	noEmitOnError: true,
	noImplicitAny: false,
	strictNullChecks: true,
	noUnusedParameters: false,
	noUnusedLocals: false,
	allowSyntheticDefaultImports: true,
	experimentalDecorators: true,
	allowJs: true,
	checkJs: true,
	suppressOutputPathCheck: true,

	sourceMap: true,

	// tracing useful for our debugging
	traceResolution: false,

	rootDirs: [sandboxRoot],

	module: ts.ModuleKind.CommonJS,
	moduleResolution: ts.ModuleResolutionKind.NodeJs,
	target: ts.ScriptTarget.ES2017,

	pretty: true,
	lib: [
		'lib.dom.d.ts',
		'lib.dom.iterable.d.ts',
		'lib.es2017.d.ts',
		'lib.es2016.array.include.d.ts',
		'lib.es2017.object.d.ts',
	],
	types: ['@types/node'],
	typeRoots: ['node_modules/@types'],
}

type sourceKinds = 'typescript' | 'javascript'

interface OutputFile {
	name: string
	text: string
	writeByteOrderMark: boolean
}

export class TypeScriptTestScript implements ITestScript {
	public sandboxedBasename: string
	public sandboxedFilename: string
	public sandboxedRelativeFilename: string
	public source: string
	public sourceMap: string
	private sourceUnmapper: SourceUnmapper
	public floodChromeErrors: string[] = []
	public sourceKind: sourceKinds
	private vmScriptMemo: VMScript
	private diagnostics: CategorisedDiagnostics
	public testScriptOptions: TestScriptOptions

	constructor(
		public originalSource: string,
		public originalFilename: string,
		options: TestScriptOptions = TestScriptDefaultOptions,
	) {
		this.testScriptOptions = Object.assign({}, TestScriptDefaultOptions, options)

		if (this.originalFilename.endsWith('.js')) {
			this.sourceKind = 'javascript'
			this.sandboxedBasename = sandboxedBasenameJavascript
		} else {
			this.sourceKind = 'typescript'
			this.sandboxedBasename = sandboxedBasenameTypescript
		}
		this.sandboxedFilename = path.join(sandboxRoot, this.sandboxedBasename)
		this.sandboxedRelativeFilename = path.join(sandboxPath, this.sandboxedBasename)
	}

	public get hasErrors(): boolean {
		return this.floodChromeErrors.length > 0 || this.diagnostics.has('errors')
	}

	public get formattedErrorString(): string {
		let errors: string[] = []

		if (this.floodChromeErrors.length > 0) {
			errors = errors.concat(this.floodChromeErrors)
		}

		if (this.diagnostics) {
			errors.push(this.diagnostics.formattedForCategory('errors'))
		}

		return errors.join('\n')
	}

	get compilerOptions(): ts.CompilerOptions {
		const compilerOptions = Object.assign({}, defaultCompilerOptions)

		if (this.testScriptOptions.stricterTypeChecking) {
			compilerOptions.noImplicitAny = true
		}

		if (this.testScriptOptions.traceResolution || debug.enabled) {
			compilerOptions.traceResolution = true
		}

		return compilerOptions
	}

	public async compile(): Promise<TypeScriptTestScript> {
		if (!this.isFloodElementCorrectlyImported) {
			switch (this.sourceKind) {
				case 'javascript':
					this.floodChromeErrors.push(FloodChromeErrors.NoModuleImportedJavascript)
					break
				case 'typescript':
					this.floodChromeErrors.push(FloodChromeErrors.NoModuleImportedTypescript)
					break
			}
			return this
		}

		// debugger

		// const sandboxedBasename = this.sandboxedBasename
		const sandboxedFilename = this.sandboxedFilename
		const inputSource = this.originalSource

		const compilerOptions = this.compilerOptions

		const host = ts.createCompilerHost(compilerOptions)

		const outputFiles: OutputFile[] = []
		host.writeFile = function(name, text, writeByteOrderMark) {
			outputFiles.push({ name, text, writeByteOrderMark })
		}

		const originalGetSourceFile = host.getSourceFile
		host.getSourceFile = function(
			fileName: string,
			languageVersion: ts.ScriptTarget,
			onError?: (message: string) => void,
		): ts.SourceFile {
			debug('getSourceFile', fileName)
			// inject our source string if its the sandboxedBasename
			if (fileName == sandboxedFilename) {
				return ts.createSourceFile(fileName, inputSource, languageVersion, false)
			} else {
				return originalGetSourceFile.apply(this, arguments)
			}
		}

		const moduleResolutionCache = ts.createModuleResolutionCache(host.getCurrentDirectory(), x =>
			host.getCanonicalFileName(x),
		)

		host.resolveModuleNames = function(
			moduleNames: string[],
			containingFile: string,
		): ts.ResolvedModule[] {
			const resolvedModules: ts.ResolvedModule[] = []

			for (let moduleName of moduleNames) {
				debug('resolve', moduleName)
				if (moduleName === '@flood/chrome' || moduleName === '@flood/element') {
					debug('resolving @flood/element as %s', indexModuleFile)
					resolvedModules.push({
						resolvedFileName: indexModuleFile,
						isExternalLibraryImport: true,
					})
					continue
				}

				// TODO manually resolve all the allowed files

				const result = ts.resolveModuleName(
					moduleName,
					containingFile,
					compilerOptions,
					host,
					moduleResolutionCache,
				).resolvedModule! // original-TODO: GH#18217

				resolvedModules.push(result)
			}
			return resolvedModules
		}

		host.resolveTypeReferenceDirectives = (
			typeReferenceDirectiveNames: string[],
			containingFile: string,
		): ts.ResolvedTypeReferenceDirective[] => {
			debug('resolveTypeReferenceDirectives', typeReferenceDirectiveNames, containingFile)
			return typeReferenceDirectiveNames
				.map(typeRef => {
					if (typeRef === '@types/node') {
						return nodeTypeReference
					} else {
						return ts.resolveTypeReferenceDirective(typeRef, containingFile, compilerOptions, host)
							.resolvedTypeReferenceDirective!
					}
				})
				.map(t => {
					debug('res', t)
					return t
				})
		}

		const program = ts.createProgram([this.sandboxedFilename], compilerOptions, host)
		const emitResult = program.emit()

		this.diagnostics = new CategorisedDiagnostics(host, this.filenameMapper.bind(this))

		// sortAndDeduplicateDiagnostics when its released
		const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics)

		allDiagnostics.forEach(diagnostic => this.diagnostics.add(diagnostic))

		if (emitResult.emitSkipped) {
			return this
		}

		console.assert(outputFiles.length == 2, 'There should only be two output files')

		// XXX tidy
		this.source = (outputFiles.find(f => f.name.endsWith('.js')) || { text: '' }).text
		this.sourceMap = (outputFiles.find(f => f.name.endsWith('.js.map')) || { text: '' }).text

		this.sourceUnmapper = await SourceUnmapper.init(
			this.originalSource,
			this.originalFilename,
			this.sourceMap,
		)

		return this
	}

	public filenameMapper(filename: string): string {
		if (filename == this.sandboxedFilename || filename == this.sandboxedBasename) {
			return this.originalFilename
		} else {
			return filename
		}
	}

	public get vmScript(): VMScript {
		if (!this.vmScriptMemo) {
			this.vmScriptMemo = new VMScript(this.source, this.sandboxedFilename)
		}

		return this.vmScriptMemo
	}

	public get isFloodElementCorrectlyImported(): boolean {
		return (
			this.originalSource.includes('@flood/chrome') ||
			this.originalSource.includes('@flood/element')
		)
	}

	public get testName(): string {
		return this.parsedComments('name')
	}

	public get testDescription(): string {
		return this.parsedComments('description')
	}

	private parsedCommentsMemo: { name: string; description: string }
	private parsedComments(key: string) {
		if (!this.parsedCommentsMemo) {
			let comments = parseComments(this.originalSource)
			let description = '',
				name = ''
			if (comments.length) {
				let { description: body } = comments[0]
				let [line1, ...lines] = body.split('\n')
				name = line1
				description = lines
					.filter(l => l.length)
					.join('\n')
					.trim()
			}
			this.parsedCommentsMemo = { name, description }
		}

		return this.parsedCommentsMemo[key]
	}

	public isScriptError(e: Error | ErrorWrapper): boolean {
		const error: Error = unwrapError(e)
		const stack = error.stack || ''
		return stack.split('\n').filter(s => s.includes(this.sandboxedFilename)).length > 0
	}

	public liftError(e: Error | ErrorWrapper): TestScriptError {
		const error: Error = unwrapError(e)
		const stack = error.stack || ''

		const filteredStack = stack.split('\n').filter(s => s.includes(this.sandboxedFilename))
		let callsite
		let unmappedStack: string[] = []

		if (filteredStack.length > 0) {
			callsite = this.sourceUnmapper.unmapCallsite(filteredStack[0])
			unmappedStack = this.sourceUnmapper.unmapStackNodeStrings(filteredStack)
		}

		return new TestScriptError(error.message, stack, callsite, unmappedStack, error)
	}

	public maybeLiftError(e: Error | ErrorWrapper): Error {
		const error: Error = unwrapError(e)
		if (this.isScriptError(error)) {
			return this.liftError(error)
		} else {
			return error
		}
	}

	public filterAndUnmapStack(input: string | Error | ErrorWrapper | undefined): string[] {
		let stack: string

		if (input === undefined) {
			return []
		} else if (typeof input === 'string') {
			stack = input
		} else {
			const maybeStack = unwrapError(input).stack
			if (maybeStack === undefined) {
				return []
			} else {
				stack = maybeStack
			}
		}

		const filteredStack = stack.split('\n').filter(s => s.includes(this.sandboxedFilename))

		return this.sourceUnmapper.unmapStackNodeStrings(filteredStack)
	}
}