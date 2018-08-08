import { expect } from '../../utils/Expect'
import Test from '../Test'
import { Step } from '../Step'
import { TestObserver } from './Observer'
import NetworkRecorder from '../../network/Recorder'
import { CompoundMeasurement } from '../../Reporter'
import { ResponseTiming } from '../../../index'
import { StructuredError } from '../../utils/StructuredError'

import * as debugFactory from 'debug'
const debug = debugFactory('element:test:timing')

const measurementKeysForDOM = {
	'first-contentful-paint': 'first_contentful_paint',
	'first-paint': 'first_paint',
}

type TimingRec = { start: number; end: number; thinkTime: number }
type TimingSegmentName = 'beforeStep' | 'step' | 'afterStep'

class Timing {
	private segments: Map<TimingSegmentName, TimingRec>
	constructor(public epoch: Date = new Date()) {
		this.segments = new Map()
	}

	start(segmentName: TimingSegmentName) {
		let now = new Date().valueOf()
		this.segments.set(segmentName, { start: now, end: 0, thinkTime: 0 })
	}

	end(segmentName: TimingSegmentName) {
		let seg = expect(this.segments.get(segmentName), `No timing started for ${segmentName}`)
		let now = new Date().valueOf()
		seg.end = now
		this.segments.set(segmentName, seg)
	}
	// TODO thinkTime

	getDurationForSegment(segmentName: TimingSegmentName): number {
		let { start, end } = expect(
			this.segments.get(segmentName),
			`No timing started for ${segmentName}`,
		)
		return end - start
	}

	getThinkTimeForSegment(segmentName: TimingSegmentName): number {
		let { thinkTime } = expect(
			this.segments.get(segmentName),
			`No timing started for ${segmentName}`,
		)
		return thinkTime
	}

	getDurationWithoutThinkTimeForSegment(segmentName: TimingSegmentName): number {
		return this.getDurationForSegment(segmentName) - this.getThinkTimeForSegment(segmentName)
	}

	async measureThinkTime(segmentName: TimingSegmentName, func: Function, ...args: any[]) {
		let seg = expect(this.segments.get(segmentName), `No timing started for ${segmentName}`)
		let start = new Date()
		await func.apply(this, ...args)
		let end = new Date()
		seg.thinkTime += end.valueOf() - start.valueOf()
	}

	reset() {
		this.segments.clear()
	}
}

export default class TimingObserver implements TestObserver {
	private passed: number = 0
	private failed: number = 0
	private t: Timing = new Timing()

	constructor(private next: TestObserver) {}

	/**
	 * Public callback before all steps are run
	 *
	 * @memberof Test
	 */
	async before(test: Test): Promise<void> {
		return this.next.before(test)
	}

	public async after(test: Test): Promise<void> {
		return this.next.after(test)
	}

	async beforeStep(test: Test, step: Step) {
		debug('beforeStep')
		this.t.reset()
		this.passed = 0
		this.failed = 0
		this.t.start('beforeStep')

		const name = step.name
		const reporter = test.reporter
		reporter.reset(name)

		await this.next.beforeStep(test, step)

		this.t.end('beforeStep')
		this.t.start('step')
		debug(`Before step: ${name}`)
	}

	async afterStep(test: Test, step: Step) {
		this.t.end('step')
		this.t.start('afterStep')

		await test.syncNetworkRecorder()

		debug(`After step: ${step.name}`)

		await this.reportResult(test, step)

		this.t.end('afterStep')

		// XXX order??
		return this.next.afterStep(test, step)
	}

	async onStepPassed(test: Test, step: Step): Promise<void> {
		this.passed++
		return this.next.onStepPassed(test, step)
	}

	async onStepError(test: Test, step: Step, err: StructuredError<any>) {
		this.failed++
		return this.next.onStepError(test, step, err)
	}

	async beforeStepAction(test: Test, step: Step, action: string): Promise<void> {
		await this.t.measureThinkTime('step', async () => {
			debug(`Before action: '${action}()' waiting on networkRecorder sync`)
			await test.syncNetworkRecorder()
			await this.next.beforeStepAction(test, step, action)
		})
	}

	async afterStepAction(test: Test, step: Step, action: string): Promise<void> {
		await this.t.measureThinkTime('step', async () => {
			debug(`After action: ${action}`)
			// Force reporting concurrency to ensure steps which take >15s don't skew metrics
			// this.reporter.addMeasurement('concurrency', this.numberOfBrowsers, name)
			await this.next.afterStepAction(test, step, action)
		})
	}

	async onStepSkipped(test: Test, step: Step) {
		debug(`Skipped step: ${step.name}`)
		return this.next.onStepSkipped(test, step)
	}

	private async reportResult(test: Test, step: Step): Promise<void> {
		if (test.runningBrowser === null) {
			return
		}
		const browser = test.runningBrowser

		const reporter = test.reporter
		const name = step.name

		expect(name == reporter.stepName, 'reporting this step')

		await test.syncNetworkRecorder()

		debug(`Report Result: ${name}`)

		let responseCode = String(test.networkRecorder.documentResponseCode || 0)
		let documentResponseTime = this.getResponseTimeMeasurement(
			test.settings.responseTimeMeasurement,
			test.networkRecorder,
		)
		let documentLatency = test.networkRecorder.latencyForType('Document')

		test.reporter.responseCode = responseCode

		// console.log(`Report: Document Response Time: ${documentResponseTime}ms`)
		// console.log(`Report: Document Latency: ${documentLatency}ms`)

		// TODO decouple
		let tti = await browser.interactionTiming()
		let performanceTiming = await browser.performanceTiming()

		let browserPerformanceTiming: CompoundMeasurement = {
			time_to_first_interactive: tti,
			dom_interactive: performanceTiming.domInteractive - performanceTiming.navigationStart,
			dom_complete: performanceTiming.domComplete - performanceTiming.navigationStart,
		}

		let paintTimingEntries = await browser.paintTiming()
		paintTimingEntries.forEach(entry => {
			if (measurementKeysForDOM[entry.name]) {
				browserPerformanceTiming[measurementKeysForDOM[entry.name]] = Math.round(entry.startTime)
			}
		})

		reporter.addCompoundMeasurement('browser_performance', browserPerformanceTiming, name)
		reporter.addMeasurement('throughput', test.networkRecorder.networkThroughput(), name)
		reporter.addMeasurement('transaction_rate', 1, name)
		reporter.addMeasurement('concurrency', 1, name) //TODO see whether concurrency changes in go grid work with this
		reporter.addMeasurement('passed', this.passed, name)
		reporter.addMeasurement('failed', this.failed, name)
		reporter.addMeasurement('response_time', documentResponseTime, name)
		reporter.addMeasurement('latency', documentLatency, name)

		await reporter.flushMeasurements()
	}

	private getResponseTimeMeasurement(
		responseTimeMeasurement: ResponseTiming,
		networkRecorder: NetworkRecorder,
	): number {
		if (responseTimeMeasurement === 'page') {
			return networkRecorder.responseTimeForType('Document')
		} else if (responseTimeMeasurement === 'network') {
			return networkRecorder.meanResponseTime()
		} else if (responseTimeMeasurement === 'step') {
			const value = this.t.getDurationWithoutThinkTimeForSegment('step')
			const thinkTime = this.t.getThinkTimeForSegment('step')
			debug(`Step Timing: thinking=${thinkTime} ms, interaction: ${value} ms`)
			return value
		} else if (responseTimeMeasurement === 'stepWithThinkTime') {
			const value = this.t.getDurationForSegment('step')
			const thinkTime = this.t.getThinkTimeForSegment('step')
			debug(`Step Timing: thinking=${thinkTime} ms, step: ${value} ms`)
			return value
		} else {
			return 0
		}
	}
}