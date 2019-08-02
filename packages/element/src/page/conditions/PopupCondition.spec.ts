import { expect } from 'chai'
import 'mocha'
import { DogfoodServer } from '../../../tests/support/fixture-server'
import { launchPuppeteer, testPuppeteer } from '../../../tests/support/launch-browser'
import { Page } from 'puppeteer'
import { Until } from '../Until'
import { Browser } from '../../runtime/Browser'
import { testWorkRoot } from '../../../tests/support/test-run-env'
import { DEFAULT_SETTINGS } from '../../runtime/Settings'

let dogfoodServer = new DogfoodServer()
let browser: Browser
let page: Page
let puppeteer: testPuppeteer
let workRoot = testWorkRoot()

describe.only('Condition', function() {
	this.timeout(30e3)
	describe('PopupCondition', () => {
		before(async () => {
			await dogfoodServer.start()
			puppeteer = await launchPuppeteer()
			page = puppeteer.page
			browser = new Browser(workRoot, puppeteer, DEFAULT_SETTINGS)
		})

		after(async () => {
			await dogfoodServer.close()
			await puppeteer.close()
		})

		beforeEach(async () => {
			await page.goto('http://localhost:1337/window_switching.html')
		})

		it('waits Until.popupIsPresent', async () => {
			let condition = Until.popupIsPresent()

			page.click('#open')

			let newPage = await condition.waitForEvent(page, (page: Page) => browser.withPage(page))
			expect(await newPage!.title()).to.equal('closeable window')
		})
	})
})
