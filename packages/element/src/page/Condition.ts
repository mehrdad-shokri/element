import { Page, EvaluateFn, Frame } from 'puppeteer'
import { Locator } from './types'
import { DEFAULT_SETTINGS } from '../runtime/Settings'
import { locatableToLocator, Browser } from '../runtime/Browser'
import { NullableLocatable } from '../runtime/types'

import debugFactory from 'debug'
export const debug = debugFactory('element:page:condition')

export { NullableLocatable }

interface ConditionSettings {
	waitTimeout: number
}

export type BrowserFactory = (page: Page) => Promise<Browser | null>

/**
 * A Condition represents a predicate which can be used to wait for an <[ElementHandle]>. They are generally created by using <[Until]>'s helper methods.
 * @docOpaque
 */
export abstract class Condition<T> {
	public hasWaitFor = true
	public settings: ConditionSettings = DEFAULT_SETTINGS

	constructor(public desc: string = '*BASE CONDITION') {}

	public abstract toString(): string
	public abstract async waitFor(frame: Frame, page?: Page): Promise<T | null>

	public async waitForEvent(page: Page, browserFactory?: BrowserFactory): Promise<T | null> {
		return null
	}

	protected get timeout(): number {
		return this.settings.waitTimeout * 1e3
	}
}

export abstract class LocatorCondition<T> extends Condition<T> {
	public pageFuncArgs: any[]
	public locator: Locator

	constructor(
		public desc: string = '*BASE CONDITION',
		locator: NullableLocatable,
		public pageFunc: EvaluateFn | null,
		...pageFuncArgs: any[]
	) {
		super(desc)
		this.locator = this.locatableToLocator(locator)
		this.pageFuncArgs = pageFuncArgs
	}

	/**
	 * @internal
	 */
	protected locatableToLocator(el: NullableLocatable): Locator {
		const e = new Error()
		Error.captureStackTrace(e)
		debug('e', e.stack)

		try {
			return locatableToLocator(el, `${this.desc}(locatable)`)
		} catch (e) {
			// TODO
			throw new Error(`condition '${this.desc}' unable to use locator: ${e}`)
		}
	}
}
