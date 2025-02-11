import { Argv, Arguments, CommandModule } from 'yargs'
import { inspect } from 'util'
import { IEvaluatedScript } from '@flood/element-api'
import chalk from 'chalk'
import boxen from 'boxen'
import { checkFile } from './common'

function rpad(n: number, maxN: number, padChar = ' '): string {
	const ns = String(n)
	const width = String(maxN).length
	if (ns.length >= width) return ns
	return ns + padChar.repeat(width - ns.length)
}

const main = async (args: Arguments) => {
	const { EvaluatedScript, nullRuntimeEnvironment } = require('@flood/element-api')
	const script = await EvaluatedScript.mustCompileFile(args.file, nullRuntimeEnvironment)

	if (args.json) return printJSON(script)

	const { settings, steps } = script

	console.log(
		boxen(
			chalk`test script
{blue ${settings.name || '<no name>'}}
{blue ${settings.description || '<no description>'}}`,
			{ padding: 1, margin: 1, align: 'center' },
		),
	)

	console.log(chalk`{blue Settings}:`)
	console.log(inspect(settings, { colors: true }))
	console.log()
	console.log(
		chalk`{blue The test script has ${String(steps.length)} step${steps.length !== 1 ? 's' : ''}}:`,
	)

	steps.forEach((step: any, i: number) => {
		console.log(chalk`{blue step ${rpad(i + 1, steps.length)}}: ${step.name}`)
	})
	console.log()

	console.log(chalk`{blue Test data:}`)
	console.log(script.testData.toString())
	console.log()
}

function printJSON(script: IEvaluatedScript) {
	const o = {
		settings: script.settings,
		steps: script.steps!.map(s => s.name),
	}
	console.log(JSON.stringify(o, null, '  '))
}

const cmd: CommandModule = {
	command: 'plan <file> [options]',
	describe: 'Output the test script plan without executing it',
	handler: main,
	builder(yargs: Argv) {
		return yargs
			.option('json', {
				describe: 'Return the test output as JSON',
				default: !process.stdout.isTTY,
			})
			.check(({ file }) => {
				let fileErr = checkFile(file)
				if (fileErr) return fileErr

				return true
			})
	},
}

export default cmd
