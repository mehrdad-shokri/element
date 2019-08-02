import { Condition, BrowserFactory } from '../Condition'
import { Frame, Page } from 'puppeteer'
import { clearTimeout } from 'timers'
import { Browser } from '../../runtime/Browser'

export class PopupCondition extends Condition<Browser | null> {
	toString() {
		return 'waiting for window or tab to appear'
	}

	hasWaitFor = false

	public async waitFor(frame: Frame): Promise<null> {
		return null
	}

	public async waitForEvent(page: Page, browserFactory?: BrowserFactory): Promise<Browser | null> {
		return new Promise((yeah, nah) => {
			let timeout = setTimeout(nah, this.timeout)

			page.once('popup', page => {
				clearTimeout(timeout)
				if (browserFactory) {
					yeah(browserFactory(page))
				} else {
					yeah(null)
				}
			})
		})
	}
}
