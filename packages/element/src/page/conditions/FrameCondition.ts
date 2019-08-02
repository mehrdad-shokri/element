import { Condition, NullableLocatable } from '../Condition'
import { Frame, Page } from 'puppeteer'
import { getFrames } from '../../runtime/Browser'

export class FrameCondition extends Condition<Frame | null> {
	constructor(desc: string, public id: NullableLocatable) {
		super(desc)
	}

	toString() {
		return `frame [name='${this.id}']`
	}

	public async waitFor(frame: Frame, page: Page): Promise<Frame | null> {
		let waiterPromise = new Promise<Frame>(yeah => {
			const cleanup = () => {
				page.removeListener('framenavigated', handler)
			}

			const handler = (frame: Frame) => {
				// console.log(`Frame: '${frame.name()}'`)
				if (frame.name() === this.id) {
					cleanup()
					yeah(frame)
				}
			}

			page.addListener('framenavigated', handler)

			if (typeof this.id === 'string') {
				// Check all existing frames as well to ensure we don't race
				let frames = getFrames(page.frames())
				for (const frame of frames) {
					handler(frame)
				}
			} else {
				throw new Error(
					`Calling ableToSwitchFrame() with anything other than frame name or ID as a string is not yet supported.`,
				)
			}
		})

		return Promise.race<Frame | null>([waiterPromise, this.createTimeoutPromise()]).then(result => {
			clearTimeout(this.maximumTimer)
			return result
		})
	}

	private maximumTimer: NodeJS.Timer

	private createTimeoutPromise() {
		const errorMessage = `Frame Wait Timeout Exceeded: ${this.timeout}ms exceeded`
		return new Promise<Error>(yeah => (this.maximumTimer = setTimeout(yeah, this.timeout))).then(
			() => {
				throw new Error(errorMessage)
			},
		)
	}
}
