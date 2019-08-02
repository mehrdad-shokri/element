import { PageFnOptions, EvaluateFn, Frame } from 'puppeteer'
import { NullableLocatable } from '../../runtime/types'
import { LocatorCondition, debug } from '../Condition'
import * as recast from 'recast'
import * as prettier from 'prettier'
import { ElementHandle } from '../ElementHandle'
export abstract class ElementCondition extends LocatorCondition<ElementHandle | null> {
	constructor(desc: string = '*BASE ELEMENT CONDITION', locator: NullableLocatable) {
		super(desc, locator, null)
	}
	public abstract toString(): string
	get locatorPageFunc(): EvaluateFn {
		return this.locator.pageFunc
	}

	public async waitFor(frame: Frame /*, page?: Page*/): Promise<ElementHandle | null> {
		const argSeparator = '-SEP-'
		let options: PageFnOptions = { polling: 'raf', timeout: this.timeout }
		let locatorFunc = this.locatorPageFunc
		let conditionFunc = this.pageFunc
		let fn = function predicate(...args: any[]) {
			const argSeparator = '-SEP-'
			let args1: any[] = []
			let args2: any[] = []
			let foundSep = false
			for (const a of args) {
				if (!foundSep) {
					if (a === argSeparator) {
						foundSep = true
					} else {
						args1.push(a)
					}
				} else {
					args2.push(a)
				}
			}
			let locatorFunc: EvaluateFn = function() {
				return null
			}
			let node: HTMLElement | null = locatorFunc(...args1)
			if (node === null) return false
			let conditionFunc = function(node: HTMLElement, ...args2: any[]) {
				return false
			}
			return conditionFunc(node, ...args2)
		}
		let fnAST = recast.parse(fn.toString())
		let locatorFuncAST = recast.parse(locatorFunc.toString()).program.body[0]
		if (!conditionFunc) throw new Error(`Condition.pageFunc is not defined`)
		let conditionFuncAST = recast.parse(conditionFunc.toString()).program.body[0]
		recast.visit(fnAST, {
			visitVariableDeclaration(path: any) {
				if (path.node.declarations[0].id.name === 'locatorFunc') {
					path
						.get('declarations', 0)
						.get('init')
						.replace(locatorFuncAST)
				} else if (path.node.declarations[0].id.name === 'conditionFunc') {
					path
						.get('declarations', 0)
						.get('init')
						.replace(conditionFuncAST)
				}
				this.traverse(path)
			},
		})

		let code = prettier.format(recast.print(fnAST).code, { parser: 'babylon' })

		debug('waitFor code', code)
		let args = Array.prototype.concat(this.locator.pageFuncArgs, argSeparator, this.pageFuncArgs)

		debug('waitFor args', args)
		code = `(${code})(...args)`

		let jsHandle = await frame.waitForFunction(code, options, ...args)
		let element = jsHandle.asElement()
		if (element) {
			return new ElementHandle(element)
		}
		return null
	}
}
