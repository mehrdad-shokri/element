import 'mocha'
import { expect } from 'chai'
import { DogfoodServer } from '../../tests/support/fixture-server'
import { testWorkRoot } from '../../tests/support/test-run-env'
import { launchPuppeteer, testPuppeteer } from '../../tests/support/launch-browser'
import { Browser } from './Browser'
import { DEFAULT_SETTINGS } from './Settings'
import { Until } from '../page/Until'
import { By } from '../page/By'

let dogfoodServer = new DogfoodServer()

let puppeteer: testPuppeteer
const workRoot = testWorkRoot()

describe.only('Browser.wait', function() {
	this.timeout(30e3)

	let browser: Browser

	before(async () => {
		await dogfoodServer.start()
		puppeteer = await launchPuppeteer()
		browser = new Browser(workRoot, puppeteer, DEFAULT_SETTINGS)
	})

	after(async () => {
		await dogfoodServer.close()
		await puppeteer.close()
	})

	describe('Until element', () => {
		beforeEach(async () => {
			await browser.visit('http://localhost:1337/forms_with_input_elements.html')
		})

		it('elementIsDisabled', async () => {
			let element = await browser.wait(Until.elementIsDisabled(By.id('new_user_species')))
			expect(element).to.not.be.null
			if (element) {
				expect(await element.getId()).to.equal('new_user_species')
			}
		})
	})
})
