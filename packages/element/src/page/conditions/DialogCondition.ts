import { Condition } from '../Condition'
import { Frame, Page, Dialog } from 'puppeteer'
import { clearTimeout } from 'timers'

/**
 * TODO: Generalize waitFor such that we can avoid needing waitForEvent custom
 * handler.
 */
export class DialogCondition extends Condition<Dialog | null> {
	toString() {
		return 'waiting for dialog to appear'
	}

	hasWaitFor = false

	public async waitFor(frame: Frame): Promise<null> {
		return null
	}

	public async waitForEvent(page: Page): Promise<Dialog> {
		return new Promise<Dialog>((yeah, nah) => {
			let timeout = setTimeout(nah, this.timeout)

			page.once('dialog', (dialog: Dialog) => {
				clearTimeout(timeout)
				yeah(dialog)
			})
		})
	}
}
