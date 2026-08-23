import chalk from 'chalk';
import { loadConfig } from '../src/config.js';
import { OpenRouterClient } from '../src/openrouter/client.js';
import { TestbedRunner } from './runner.js';

async function main() {
  console.log(chalk.bold.cyan('\n=== STARN Autonomous Testbed Runner ===\n'));

  const config = loadConfig();
  if (!config.apiKey) {
    console.warn(chalk.yellow('Warning: OPENROUTER_API_KEY is not set. Live test execution requires a valid key.'));
  }

  const client = new OpenRouterClient({
    apiKey: config.apiKey || 'mock-key',
    siteUrl: config.siteUrl,
    appName: config.appName
  });

  const runner = new TestbedRunner(client);
  const suites = runner.loadTestSuites();

  console.log(chalk.white(`Loaded ${suites.length} test scenarios:`));
  for (const s of suites) {
    console.log(`  ${chalk.green('•')} [${s.id}] ${chalk.bold(s.name)} -> expected specialist: ${s.expectedSpecialist}`);
  }

  console.log(chalk.dim('\nTo run live model evaluation against all test scenarios, execute with valid API key.'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
